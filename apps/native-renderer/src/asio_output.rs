//! ASIO callback adapter. Only the explicitly selected driver is initialized.
use super::*;
use cpal::traits::DeviceTrait;
use std::sync::{
    atomic::{AtomicBool, AtomicI32, AtomicU64},
    Mutex,
};

pub(super) fn endpoints() -> Vec<Endpoint> {
    asio_sys::Asio::new()
        .driver_names()
        .into_iter()
        .map(|name| Endpoint {
            id: format!("asio:{name}"),
            name: format!("ASIO · {name}"),
            available: true,
            is_default: false,
            sample_rate: None,
            channels: None,
        })
        .collect()
}

pub(super) struct AsioOutput {
    stream: cpal::platform::AsioStream,
    driver: Arc<asio_sys::Driver>,
    message_id: Option<asio_sys::MessageCallbackId>,
    callbacks: Arc<AtomicU64>,
    last_callback: (u64, Instant),
    failed: Arc<AtomicBool>,
    fading: Arc<AtomicBool>,
    pub(super) rate: u32,
    pub(super) channels: usize,
    frames: usize,
    format: String,
    name: String,
}
impl AsioOutput {
    pub(super) fn open(
        settings: &Settings,
        fifo: Arc<stereo_fifo::StereoFifo>,
        telemetry: Arc<RuntimeTelemetry>,
    ) -> Result<Self, String> {
        let name = settings
            .device_id
            .as_deref()
            .and_then(|id| id.strip_prefix("asio:"))
            .filter(|s| !s.is_empty())
            .ok_or("请选择 ASIO 驱动")?;
        let asio = asio_sys::Asio::new();
        let driver = Arc::new(
            asio.load_driver(name)
                .map_err(|e| format!("ASIO {name}: {e}"))?,
        );
        let device = cpal::platform::AsioDevice {
            driver,
            asio_streams: Arc::new(Mutex::new(asio_sys::AsioStreams {
                input: None,
                output: None,
            })),
            current_buffer_index: Arc::new(AtomicI32::new(-1)),
        };
        let default = device.default_output_config().map_err(|e| e.to_string())?;
        let rate = if device.driver.can_sample_rate(48000.0).unwrap_or(false) {
            48000
        } else {
            default.sample_rate().0
        };
        if remote_audio::receiver() && rate != 48000 {
            return Err("无损远程接收需要 ASIO 驱动支持 48 kHz".into());
        }
        if default.channels() < 2 {
            return Err("ASIO 驱动至少需要两个输出通道".into());
        }
        let config = cpal::StreamConfig {
            channels: 2,
            sample_rate: cpal::SampleRate(rate),
            buffer_size: cpal::BufferSize::Default,
        };
        let failed = Arc::new(AtomicBool::new(false));
        let fading = Arc::new(AtomicBool::new(false));
        let callbacks = Arc::new(AtomicU64::new(0));
        let format = default.sample_format();
        let stream = match format {
            cpal::SampleFormat::F32 => build::<f32>(
                &device,
                &config,
                fifo,
                telemetry,
                failed.clone(),
                fading.clone(),
                callbacks.clone(),
            ),
            cpal::SampleFormat::I16 => build::<i16>(
                &device,
                &config,
                fifo,
                telemetry,
                failed.clone(),
                fading.clone(),
                callbacks.clone(),
            ),
            cpal::SampleFormat::I32 => build::<i32>(
                &device,
                &config,
                fifo,
                telemetry,
                failed.clone(),
                fading.clone(),
                callbacks.clone(),
            ),
            _ => return Err(format!("ASIO 不支持此驱动的采样格式：{format:?}")),
        }?;
        let frames = device
            .asio_streams
            .lock()
            .map_err(|_| "ASIO buffer state unavailable")?
            .output
            .as_ref()
            .map(|s| s.buffer_size.max(0) as usize)
            .unwrap_or(0);
        let reset = failed.clone();
        let message_id = device.driver.add_message_callback(move |message| {
            if matches!(
                message,
                asio_sys::AsioMessageSelectors::kAsioResetRequest
                    | asio_sys::AsioMessageSelectors::kAsioBufferSizeChange
                    | asio_sys::AsioMessageSelectors::kAsioResyncRequest
            ) {
                reset.store(true, Ordering::Release);
            }
        });
        Ok(Self {
            stream,
            driver: device.driver.clone(),
            message_id: Some(message_id),
            callbacks,
            last_callback: (0, Instant::now()),
            failed,
            fading,
            rate,
            channels: 2,
            frames,
            format: format.to_string(),
            name: name.into(),
        })
    }
    pub(super) fn start(&self) -> Result<(), String> {
        self.stream.play().map_err(|e| e.to_string())
    }
    pub(super) fn tick(&mut self) -> Result<(), String> {
        let count = self.callbacks.load(Ordering::Acquire);
        if count != self.last_callback.0 {
            self.last_callback = (count, Instant::now());
        }
        if self.failed.load(Ordering::Acquire)
            || self.last_callback.1.elapsed() > Duration::from_secs(2)
        {
            Err("ASIO 输出中断，请检查驱动及设备".into())
        } else {
            Ok(())
        }
    }
    pub(super) fn drain(&self) {
        self.fading.store(true, Ordering::Release);
        thread::sleep(Duration::from_millis(20));
    }
    pub(super) fn status(&self, requested: &Settings, detail: String) -> Status {
        Status {
            requested: requested.clone(),
            actual_id: requested.device_id.clone(),
            actual_name: Some(self.name.clone()),
            mode: Some("asio".into()),
            sample_rate: Some(self.rate),
            channels: Some(2),
            buffer_ms: Some(self.frames as f64 * 1000.0 / self.rate as f64),
            sample_format: Some(self.format.clone()),
            state: "ready".into(),
            detail,
        }
    }
}
impl Drop for AsioOutput {
    fn drop(&mut self) {
        if let Some(id) = self.message_id.take() {
            self.driver.remove_message_callback(id);
        }
    }
}
fn build<T: cpal::SizedSample + cpal::FromSample<f32>>(
    device: &cpal::platform::AsioDevice,
    config: &cpal::StreamConfig,
    fifo: Arc<stereo_fifo::StereoFifo>,
    telemetry: Arc<RuntimeTelemetry>,
    failed: Arc<AtomicBool>,
    fading: Arc<AtomicBool>,
    callbacks: Arc<AtomicU64>,
) -> Result<cpal::platform::AsioStream, String> {
    let rate = config.sample_rate.0;
    let mut converter = device_output::DeviceOutput::new(rate, STEREO_FIFO_START_FRAMES);
    let mut monitor = output_monitor::OutputMonitor::default();
    let mut fade = 0.0f32;
    let lossless = remote_audio::receiver();
    device
        .build_output_stream(
            config,
            move |data: &mut [T], _| {
                let started = Instant::now();
                callbacks.fetch_add(1, Ordering::Release);
                if fifo.apply_flush_from_consumer() {
                    converter.reset();
                    monitor.reset();
                }
                let enabled = telemetry.callback_output_enabled.load(Ordering::Acquire)
                    && remote_sync::output_allowed();
                let muted = remote_audio::local_muted() || fading.load(Ordering::Acquire);
                let origin = telemetry
                    .callback_consumed_sample_pos
                    .load(Ordering::Relaxed);
                let popped = converter.fill(&fifo, enabled, data.len() / 2, |i, frame| {
                    fade = if lossless && !muted {
                        1.0
                    } else if muted {
                        (fade - 1.0 / (rate as f32 * 0.005)).max(0.0)
                    } else {
                        (fade + 1.0 / (rate as f32 * 0.005)).min(1.0)
                    };
                    let frame = [frame[0] * fade, frame[1] * fade];
                    monitor.observe(
                        std::iter::once(frame),
                        origin + i as u64 * 48000 / rate as u64,
                        &telemetry.output,
                    );
                    data[i * 2] = T::from_sample(frame[0].clamp(-1.0, 1.0));
                    data[i * 2 + 1] = T::from_sample(frame[1].clamp(-1.0, 1.0));
                });
                record_callback(
                    &telemetry,
                    started,
                    converter.requested_source,
                    popped,
                    enabled,
                );
            },
            move |_| {
                failed.store(true, Ordering::Release);
            },
            None,
        )
        .map_err(|e| format!("无法启动 ASIO：{e}"))
}
