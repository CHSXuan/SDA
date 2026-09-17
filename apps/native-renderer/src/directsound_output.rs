//! DirectSound secondary-buffer output. Owns the same rendered stereo FIFO as WASAPI.
use super::*;
use windows::{
    Win32::{
        Foundation::BOOL,
        Media::Audio::{DirectSound::*, WAVEFORMATEX},
        UI::WindowsAndMessaging::GetDesktopWindow,
    },
    core::{GUID, PCWSTR},
};
const FRAMES: u32 = 9600;
const LEAD: u32 = 2400;
unsafe extern "system" fn enumerate(
    g: *mut GUID,
    name: PCWSTR,
    _: PCWSTR,
    ctx: *mut std::ffi::c_void,
) -> BOOL {
    unsafe {
        if !g.is_null() {
            let list = &mut *(ctx as *mut Vec<Endpoint>);
            list.push(Endpoint {
                id: format!("dsound:{:?}", *g),
                name: format!("DirectSound · {}", name.to_string().unwrap_or_default()),
                available: true,
                is_default: false,
                sample_rate: Some(48000),
                channels: Some(2),
            });
        }
        BOOL(1)
    }
}
pub(super) fn endpoints() -> Vec<Endpoint> {
    let mut list = Vec::new();
    unsafe {
        let _ = DirectSoundEnumerateW(
            Some(enumerate),
            Some((&mut list as *mut Vec<Endpoint>).cast()),
        );
    }
    list
}
pub(super) struct DirectSoundOutput {
    buffer: IDirectSoundBuffer,
    _device: IDirectSound8,
    id: String,
    name: String,
    float: bool,
    stride: u32,
    cursor: u32,
    last: Instant,
    converter: device_output::DeviceOutput,
    monitor: output_monitor::OutputMonitor,
    fade: f32,
}
impl DirectSoundOutput {
    pub(super) fn open(s: &Settings) -> Result<Self, String> {
        unsafe {
            let id = s.device_id.as_deref().ok_or("请选择 DirectSound 设备")?;
            let raw = id
                .strip_prefix("dsound:")
                .ok_or("无效的 DirectSound 设备")?
                .replace("-", "");
            let guid = GUID::from_u128(
                u128::from_str_radix(&raw, 16).map_err(|_| "无效的 DirectSound GUID")?,
            );
            let name = endpoints()
                .into_iter()
                .find(|d| d.id == id)
                .ok_or("DirectSound 设备已断开")?
                .name;
            let mut device = None;
            DirectSoundCreate8(Some(&guid), &mut device, None).map_err(|e| e.to_string())?;
            let device = device.ok_or("DirectSound 初始化失败")?;
            device
                .SetCooperativeLevel(GetDesktopWindow(), DSSCL_NORMAL)
                .map_err(|e| e.to_string())?;
            let mut selected = None;
            for float in [true, false] {
                let stride = if float { 8 } else { 4 };
                let mut fmt = WAVEFORMATEX {
                    wFormatTag: if float { 3 } else { 1 },
                    nChannels: 2,
                    nSamplesPerSec: 48000,
                    nAvgBytesPerSec: 48000 * stride,
                    nBlockAlign: stride as u16,
                    wBitsPerSample: if float { 32 } else { 16 },
                    cbSize: 0,
                };
                let desc = DSBUFFERDESC {
                    dwSize: std::mem::size_of::<DSBUFFERDESC>() as u32,
                    dwFlags: DSBCAPS_GLOBALFOCUS
                        | DSBCAPS_GETCURRENTPOSITION2
                        | DSBCAPS_LOCSOFTWARE,
                    dwBufferBytes: FRAMES * stride,
                    lpwfxFormat: &mut fmt,
                    ..Default::default()
                };
                let mut buffer = None;
                if device.CreateSoundBuffer(&desc, &mut buffer, None).is_ok() {
                    if let Some(b) = buffer {
                        selected = Some((b, float, stride));
                        break;
                    }
                }
            }
            let (buffer, float, stride) = selected.ok_or("DirectSound 不支持 48 kHz 双声道输出")?;
            let mut out = Self {
                buffer,
                _device: device,
                id: id.into(),
                name,
                float,
                stride,
                cursor: 0,
                last: Instant::now(),
                converter: device_output::DeviceOutput::new(48000, STEREO_FIFO_START_FRAMES),
                monitor: output_monitor::OutputMonitor::default(),
                fade: 0.0,
            };
            out.clear()?;
            Ok(out)
        }
    }
    fn clear(&mut self) -> Result<(), String> {
        unsafe {
            self.buffer.Stop().map_err(|e| e.to_string())?;
            let mut p = std::ptr::null_mut();
            let mut n = 0;
            self.buffer
                .Lock(
                    0,
                    FRAMES * self.stride,
                    &mut p,
                    &mut n,
                    None,
                    None,
                    DSBLOCK_ENTIREBUFFER,
                )
                .map_err(|e| e.to_string())?;
            std::ptr::write_bytes(p, 0, n as usize);
            self.buffer
                .Unlock(p, n, None, 0)
                .map_err(|e| e.to_string())?;
            self.buffer
                .SetCurrentPosition(0)
                .map_err(|e| e.to_string())?;
            self.cursor = 0;
            self.last = Instant::now();
            self.converter.reset();
            self.monitor.reset();
            self.fade = 0.0;
            Ok(())
        }
    }
    pub(super) fn start(&self) -> Result<(), String> {
        unsafe {
            self.buffer
                .Play(0, 0, DSBPLAY_LOOPING)
                .map_err(|e| e.to_string())
        }
    }
    pub(super) fn stop(&self) {
        unsafe {
            let _ = self.buffer.Stop();
        }
    }
    pub(super) fn tick(
        &mut self,
        fifo: &stereo_fifo::StereoFifo,
        t: &RuntimeTelemetry,
        fading: bool,
    ) -> Result<(), String> {
        unsafe {
            let started = Instant::now();
            if fifo.apply_flush_from_consumer() {
                self.clear()?;
                self.start()?;
            }
            // Never replay a wrapped, stale ring after a long manager stall.
            if self.last.elapsed() > Duration::from_millis(180) {
                self.clear()?;
                self.start()?;
            }
            self.last = started;
            let (mut play, mut safe) = (0, 0);
            self.buffer
                .GetCurrentPosition(Some(&mut play), Some(&mut safe))
                .map_err(|e| e.to_string())?;
            let play = play / self.stride;
            let safe = safe / self.stride;
            let distance = |a: u32, b: u32| (b + FRAMES - a) % FRAMES;
            if distance(play, self.cursor) < distance(play, safe)
                || distance(play, self.cursor) > FRAMES / 2
            {
                self.cursor = (safe + 48) % FRAMES;
            }
            let target = (play + LEAD.max(distance(play, safe) + 240)) % FRAMES;
            let frames = distance(self.cursor, target);
            if frames == 0 || frames > FRAMES / 2 {
                return Ok(());
            }
            let (mut p1, mut p2) = (std::ptr::null_mut(), std::ptr::null_mut());
            let (mut n1, mut n2) = (0, 0);
            self.buffer
                .Lock(
                    self.cursor * self.stride,
                    frames * self.stride,
                    &mut p1,
                    &mut n1,
                    Some(&mut p2),
                    Some(&mut n2),
                    0,
                )
                .map_err(|e| e.to_string())?;
            let enabled =
                t.callback_output_enabled.load(Ordering::Acquire) && remote_sync::output_allowed();
            let muted = fading || remote_audio::local_muted();
            let origin = t.callback_consumed_sample_pos.load(Ordering::Relaxed);
            let float = self.float;
            let stride = self.stride;
            let fade = &mut self.fade;
            let monitor = &mut self.monitor;
            let popped = self
                .converter
                .fill(fifo, enabled, frames as usize, |i, frame| {
                    *fade = if muted {
                        (*fade - 1.0 / 240.0).max(0.0)
                    } else {
                        (*fade + 1.0 / 240.0).min(1.0)
                    };
                    let frame = [frame[0] * *fade, frame[1] * *fade];
                    monitor.observe(std::iter::once(frame), origin + i as u64, &t.output);
                    let byte = i * stride as usize;
                    let ptr = if byte < n1 as usize {
                        (p1 as *mut u8).add(byte)
                    } else {
                        (p2 as *mut u8).add(byte - n1 as usize)
                    };
                    for ch in 0..2 {
                        let v = frame[ch].clamp(-1.0, 1.0);
                        if float {
                            std::ptr::write_unaligned((ptr as *mut f32).add(ch), v);
                        } else {
                            std::ptr::write_unaligned(
                                (ptr as *mut i16).add(ch),
                                (v * 32767.0).round() as i16,
                            );
                        }
                    }
                });
            self.buffer
                .Unlock(p1, n1, Some(p2), n2)
                .map_err(|e| e.to_string())?;
            self.cursor = (self.cursor + frames) % FRAMES;
            record_callback(t, started, self.converter.requested_source, popped, enabled);
            Ok(())
        }
    }
    pub(super) fn status(&self, s: &Settings, detail: String) -> Status {
        Status {
            requested: s.clone(),
            actual_id: Some(self.id.clone()),
            actual_name: Some(self.name.clone()),
            mode: Some("directsound".into()),
            sample_rate: Some(48000),
            channels: Some(2),
            buffer_ms: Some(LEAD as f64 / 48.0),
            sample_format: Some(
                if self.float {
                    "32-bit float"
                } else {
                    "16-bit PCM"
                }
                .into(),
            ),
            state: "ready".into(),
            detail,
        }
    }
}
impl Drop for DirectSoundOutput {
    fn drop(&mut self) {
        self.stop();
    }
}
