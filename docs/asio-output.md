# ASIO audio output (Windows)

SDA supports installed 64-bit ASIO drivers, including ASIO4ALL. In Settings → Audio output, select ASIO and the desired driver, then Apply. Nothing installs or changes a hardware driver automatically. Saved endpoint IDs use `asio:<driver name>`; existing WASAPI settings remain compatible.

The ASIO callback reads the same rendered stereo FIFO used by WASAPI. Decoder sessions, object rendering, head tracking and wireless mirror audio are preserved when changing outputs. Render work stays off the device callback. ASIO uses driver outputs 1 and 2, the driver's preferred buffer size, and 48 kHz when supported; otherwise the existing output resampler converts to the driver's default rate. Supported native sample formats are float32, int16 and int32. Driver formats outside CPAL's supported set report a failure and restore the previous endpoint.

Set physical ports and preferred buffer size in the manufacturer's panel / ASIO4ALL settings before applying the device. The displayed buffer is the driver buffer, not end-to-end latency. Start with 256–512 frames; small buffers can underrun under heavy object rendering. ASIO4ALL wraps Windows WDM devices and does not improve decoder throughput or guarantee better performance than WASAPI. Native manufacturer ASIO drivers are generally preferable for interfaces.

Driver enumeration only reads registered names; it does not load every driver. Missing/failed selected drivers do not silently switch to speakers. Opening a replacement output first closes the old FIFO consumer, and a failed switch tries to restore the previous output. Runtime callback errors use the existing bounded output recovery path. ASIO bypasses the Windows shared mixer, so UU/RDP capture and browser-based personal-HRTF calibration should use shared/remote-compatible output.

## Building

Windows builds enable CPAL's `asio` feature plus `asio-sys`. They require a C++ toolchain, LLVM libclang (`LIBCLANG_PATH` if not discoverable), and Steinberg ASIO SDK headers/sources. Set `CPAL_ASIO_DIR` to a local SDK root containing `common/asio.h` and `host/asiodrivers.h`. When unset, asio-sys downloads the SDK from Steinberg on its first build; Cargo `--offline` alone does not prevent this SDK bootstrap. Pre-cache the SDK for fully offline builds. The current SDK offers GPLv3 as an alternative license; SDA's native renderer is GPL-3.0-or-later. The SDK and third-party drivers are not committed or bundled as installers.

macOS/Linux continue using CoreAudio/ALSA without ASIO build dependencies.

The vendored `asio-sys` build fixes Windows GNU C++ name mangling and treats the SDK bookkeeping class as opaque. GNU builds additionally need MinGW on PATH and Clang resource headers matching libclang. For a Python-packaged libclang that omits resource headers, supply them and the MinGW include directory using `BINDGEN_EXTRA_CLANG_ARGS` (`-I<clang-resource-headers> -I<mingw>/include`). A full LLVM installation is preferable. The renderer links the GNU C++ runtime statically.

## Validation

Output manager unit tests and the web TypeScript/build checks pass. The opt-in hardware test `node apps/native-renderer/test/asio-output.test.mjs "ASIO4ALL v2"` checks enumeration, ASIO opening, callbacks, silent rendered PCM sample-clock advancement, failed-driver rollback, and return to WASAPI. Local ASIO4ALL testing used 48 kHz, int32, stereo, 512 frames (10.67 ms driver buffer). This is not an end-to-end latency measurement or an audible sound-quality test. Release an existing renderer/audio client before running the standalone test: two processes contending for the same hardware can prevent callbacks.
