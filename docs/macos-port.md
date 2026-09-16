# macOS 移植说明

将 SDA 原生渲染器从 Windows 移植到 macOS 的技术记录。本文档面向希望了解跨平台适配细节的开发者。

## 概述

SDA 的 Rust 原生渲染器原本仅支持 Windows WASAPI 输出。移植工作使用 [CPAL](https://github.com/RustAudio/cpal) 作为跨平台音频抽象层，通过 `#[cfg]` 条件编译在同一代码库中保留 Windows WASAPI 和 macOS CoreAudio 两条路径。DSP 管线（HRTF、房间卷积、VBAP、对象混音等）完全平台无关，无需修改。

## 修改文件清单

| 文件 | 改动 |
| --- | --- |
| `apps/native-renderer/Cargo.toml` | `windows` 依赖改为 `[target.'cfg(target_os = "windows")'.dependencies]` 条件编译 |
| `apps/native-renderer/src/output_manager.rs` | `#[cfg(windows)]` 包裹原有 WASAPI 模块；新增 `#[cfg(not(windows))]` CPAL/CoreAudio 模块 |
| `scripts/build-native-renderer.mjs` | 移除 Windows-only 跳过逻辑；跨平台二进制命名与 `chmod 0o755` |
| `apps/desktop/main.cjs` | `bundledNativeRendererPath()` 按 `process.platform` 选择可执行文件名 |
| `apps/desktop/package.json` | macOS 构建配置添加 `extraResources` 以打包原生渲染器 |

## 平台条件编译结构

`output_manager.rs` 采用以下结构：

```rust
// 共享类型（Settings, Endpoint, Status, Request, CONTROL 等）
// ... 所有平台共用 ...

#[cfg(windows)]
mod platform {
    // 原有 WASAPI 实现
    pub fn run(...) { ... }
}

#[cfg(not(windows))]
mod platform {
    // CPAL/CoreAudio 实现
    pub fn run(...) { ... }
}

pub use platform::run;
```

### CPAL 模块关键组件

- **`list_devices()`** — 通过 `cpal::default_host().output_devices()` 枚举输出设备
- **`open_device()`** — 构建 cpal 输出流，回调从 `StereoFifo` 读取数据
- **`run()`** — 主事件循环，处理设备切换、远程音频、重连等

### 回调中 FIFO 刷新确认

cpal 回调必须在检查 `enabled` 状态之前调用 `fifo.apply_flush_from_consumer()`。否则当 `startAt` 触发渲染 epoch 变更时，渲染线程等待 FIFO 刷新确认会形成死锁——回调因 `enabled=false` 直接返回静音，从不调用确认函数。

```rust
// 回调入口
fifo.apply_flush_from_consumer();          // 始终确认刷新
let enabled = telemetry.callback_output_enabled.load(...)
    && remote_sync::output_allowed();
conv.fill(fifo, enabled, frames, write);   // 仅在 enabled 时消费数据
```

## 已知平台差异

| 项目 | Windows | macOS |
| --- | --- | --- |
| 音频 API | WASAPI（共享/独占） | CoreAudio（通过 CPAL） |
| 输出格式 | 32-bit float | 32-bit float |
| 默认采样率 | 48 kHz | 48 kHz（取决于设备） |
| 进程优先级 | `SetPriorityClass` | `uv_os_setpriority`（可能 EACCES） |
| AirPods 头部追踪 | 专用 helper（BLE L2CAP） | 专用 helper（CoreMotion `CMHeadphoneMotionManager`） |

## 构建与运行

参见 README.md「从源码运行」章节的 macOS 部分。

### 环境注意事项

- macOS 上 `ELECTRON_RUN_AS_NODE=1` 会导致 Electron 以纯 Node.js 模式运行，不加载 Electron API。确保该变量未被设置。
- `uv_os_setpriority` 返回 `EACCES` 是 macOS 正常行为（非 root 无法提升进程优先级），不影响功能。
- 首次运行需要 `xattr -cr` 移除 Electron 二进制的隔离属性。
