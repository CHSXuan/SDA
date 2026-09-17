# DirectSound output (Windows)

Settings → Audio output → Access method → DirectSound. Only DirectSound devices are shown in this mode. Choose a device and Apply. Device IDs are saved with the `dsound:` prefix; they never enable WASAPI exclusive mode.

This is a native DirectSound secondary-buffer backend, not a renamed WASAPI option. It consumes the same 48 kHz binaural renderer FIFO, including room, head tracking and headphone processing. It first requests software-mixed float32 stereo, falling back to int16 if unavailable. A 200 ms circular buffer is refilled with a nominal 50 ms lead, respecting the driver's safe write cursor. The displayed lead is not end-to-end latency. Flush/seek clears the ring; buffer/API failures use output-manager recovery and rejected device selections restore the previous output.

DirectSound uses Windows shared audio on current Windows releases. UU/RDP can usually capture this, but their selected capture endpoint must match playback. This does not make ASIO capturable and is not expected to outperform WASAPI. Devices are explicitly selected, rather than silently following a changed default speaker. ASIO4ALL or another exclusive client can still prevent access to the hardware.

Opt-in hardware smoke test: `node apps/native-renderer/test/directsound-output.test.mjs [device-name substring]`. Release the running renderer before this standalone test; it uses silent PCM, verifies advancing render-consumption clocks, rejects an invalid device, and switches back to WASAPI. It does not verify UU's remote sound or audible quality.

Validated locally on Realtek headphones: 48 kHz float32 stereo, PCM clock advancement, stable paused clock, reset to a new sample origin, invalid-device rollback, and return to WASAPI all passed. Web typecheck and production build passed. UU capture has not been verified remotely.
