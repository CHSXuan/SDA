# SDA local changes to asio-sys 0.2.6

Upstream: https://github.com/RustAudio/cpal/ (asio-sys crate 0.2.6), Apache-2.0.
Changes to build.rs and the C wrapper/binding declarations:
- Pass Cargo TARGET explicitly to libclang so Windows GNU does not inherit MSVC mangled names.
- Treat AsioDrivers as opaque. Its C++ base-class tail-padding reuse cannot be represented by bindgen's Rust fields on MinGW; no Rust code accesses this bookkeeping class.
- Leave C++ runtime linking to the renderer on GNU Windows, including ASIO archive rebuilds; its build.rs links the runtime statically.
- Regenerate bindings when the build script runs, avoiding reuse after a target/Clang configuration change.

The proprietary/GPL-dual-licensed Steinberg SDK is not included in this directory.

- Rebuild the ASIO archive when the build script runs, so C wrapper changes cannot leave stale symbols.
- Expose `show_control_panel` (ASIOControlPanel) for the currently loaded driver, including bindgen/stub declarations and helper rebuild tracking.
- Expose `ASIOGetLatencies` so teardown can feed enough silence through the downstream driver queue before stopping ASIO.
- Clear both driver output buffers after allocation and before ASIOStart. CPAL starts the driver before enabling its callback; without this, recycled driver memory can replay previous audio. Query each output channel's PCM storage width, preserve input buffers, reject invalid pointers/non-PCM formats, and dispose allocations on initialization failure. Memory regression tests cover both halves, all PCM widths and boundary guards.
