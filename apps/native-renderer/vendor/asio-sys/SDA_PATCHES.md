# SDA local changes to asio-sys 0.2.6

Upstream: https://github.com/RustAudio/cpal/ (asio-sys crate 0.2.6), Apache-2.0.
Only build.rs is modified:
- Pass Cargo TARGET explicitly to libclang so Windows GNU does not inherit MSVC mangled names.
- Treat AsioDrivers as opaque. Its C++ base-class tail-padding reuse cannot be represented by bindgen's Rust fields on MinGW; no Rust code accesses this bookkeeping class.
- Leave C++ runtime linking to the renderer on GNU Windows, including when reusing a cached ASIO archive; its build.rs links the runtime statically.
- Regenerate bindings when the build script runs, avoiding reuse after a target/Clang configuration change.

The proprietary/GPL-dual-licensed Steinberg SDK is not included in this directory.
