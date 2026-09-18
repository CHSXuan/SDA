# macOS 系统音频与空间码流接入交接

更新：2026-09-18。面向 SDA macOS 接入开发者。状态：Apple 官方文档和当前代码核查完成；未在 Mac 实机编译、安装或验证输入。本文不代表已实现功能。

配套文档：[Windows 接入调研与共同协议](system-atmos-input-research.md)、[macOS 原生输出移植](macos-port.md)。本任务是增加第三方应用音频输入，不是重新实现已有 CoreAudio 输出，也不涉及窗口模糊。

## 结论与范围

**已确认：macOS 15 已支持 HDMI 原始码流直通，不必等到 macOS 26。** 两个版本的 Apple 官方说明均列出 AC-3、E-AC-3 和 E-AC-3 JOC（Atmos）；见文末版本核查和接入验证步骤。尚未确认的是第三方虚拟端点能否接收该输出，以及有无面向这一用途的公开直通 API；不能将这两点与系统本身能否直通混为一谈。

| 目标 | 官方依据及结论 | 建议 |
| --- | --- | --- |
| 捕获指定应用/系统播放声音 | Core Audio Process Tap 可捕获进程或进程组的输出，支持混音和静音原输出 | macOS 14.2+ 优先验证，用于系统 PCM 输入 |
| 给其他应用提供可选择的 SDA 输出设备 | Apple 提供 Audio Server Driver Plug-in 虚拟设备示例 | 需要设备路由或较旧系统时另做 HAL 插件；样例只证明 PCM 设备 |
| 捕获其他应用 Atmos/360RA 原始对象 | 本次查阅未找到通用公开捕获接口 | 不能把 Tap、录屏音频或 AVAudioEnvironmentNode 当成对象入口 |
| 原始压缩码流接入 | 可以设计应用/插件到 SDA 的自有协议，复用 SDA 解码能力 | 保留对象的首选验证路线，不依赖系统已渲染的输出 |
| 系统级 Atmos/MPEG-H 虚拟直通设备 | 格式常量与虚拟设备 API 不足以证明播放器会交付完整码流 | 单列实验，先证明实际协商和接收再宣布支持 |

“系统能播放 Atmos”与“SDA 能从系统取得每个对象”是不同能力。Apple Music 等应用的 Atmos 播放不构成第三方可以取得其原始码流或对象的证据；本次不承诺其兼容性。

## 官方依据

### 1. Core Audio Process Tap

- [Capturing system audio with Core Audio taps](https://developer.apple.com/documentation/coreaudio/capturing-system-audio-with-core-audio-taps)
- [AudioHardwareCreateProcessTap](https://developer.apple.com/documentation/coreaudio/audiohardwarecreateprocesstap(_:_:))
- [CATapDescription](https://developer.apple.com/documentation/coreaudio/catapdescription)
- [kAudioTapPropertyFormat](https://developer.apple.com/documentation/coreaudio/kaudiotappropertyformat)
- [CATapMuteBehavior](https://developer.apple.com/documentation/coreaudio/catapmutebehavior)

官方示例说明：创建 Tap 后加入 HAL aggregate device，作为输入读取；可指定进程及混音方式，也可静音原应用输出，防止同时听到原声和 SDA 渲染声。

底层 `AudioHardwareCreateProcessTap` 从 macOS 14.2 可用。当前示例下载页的工程要求为 macOS 26 / Xcode 26，而正文仍说明 Tap 功能从 14.2 起使用；开发者应依据各 API availability 对低版本分支处理，不能直接把最新示例整个复制后声称支持 14.2。`CATapDescription` 的更新属性也要逐项核实。

捕获权限说明键为 `NSAudioCaptureUsageDescription`，官方示例说明首次启动含 Tap 的聚合设备录制时系统会请求系统音频录制权限。将权限说明放到实际承载捕获功能的已签名应用中，并验证 Electron 与独立 helper 的权限归属；拒绝、撤销权限时显示明确状态。

Tap 提供进程输出音频流，并非文档化的 Atmos/MPEG-H 对象提取接口。非立体声输入需查询实际 ASBD/布局；不要默认 Tap 保留 7.1.4，更不能从通道数推断存在动态对象。

### 2. HAL 虚拟设备

- [Creating an Audio Server Driver Plug-in](https://developer.apple.com/documentation/coreaudio/creating-an-audio-server-driver-plug-in)
- [Building an Audio Server Plug-in and Driver Extension](https://developer.apple.com/documentation/coreaudio/building-an-audio-server-plug-in-and-driver-extension)

第一份官方样例发布一个虚拟设备，支持 44.1/48 kHz、双通道 32-bit float PCM，以及音量、静音等属性。安装位置为 `/Library/Audio/Plug-Ins/HAL`，官方样例要求重启后用 Audio MIDI Setup 检查。

单纯虚拟路由优先评估 Audio Server Plug-in。第二份样例还涉及 DriverKit 扩展和 entitlement，不应因为存在该样例就强行增加硬件驱动层。不要把样例的本地调试降级安全设置做成产品安装前提；发布签名、安装权限和兼容性由 Mac 端实测确定。

插件回调只搬运有界音频缓冲并提供时钟，不运行 Electron、网络调用、文件解析或 HRTF。SDA 服务断开时行为明确，不能让音频服务进程等待应用恢复。

### 3. 格式标识不等于对象直通

- [Audio Format Identifiers](https://developer.apple.com/documentation/coreaudiotypes/audio-format-identifiers)
- [kAudioFormatEnhancedAC3](https://developer.apple.com/documentation/coreaudiotypes/kaudioformatenhancedac3)
- [kAudioFormat60958AC3](https://developer.apple.com/documentation/coreaudiotypes/kaudioformat60958ac3)
- [kAudioFormatMPEGD_USAC](https://developer.apple.com/documentation/coreaudiotypes/kaudioformatmpegd_usac)

Apple 定义了 Enhanced AC-3 和用于 IEC 60958 的 AC-3 标识。但 AC-3 传输标识不代表通用 DD+ Atmos、TrueHD 或 MAT 2.x 接收能力；需要实查端点可用的物理/虚拟流格式和应用实际选择。

在本次查阅的格式标识页未发现与 Windows `IEC61937_MPEGH_LEVEL*_LC/BL` 对应的 MPEG-H 直通声明。这里的 MPEG-D USAC 和 MPEG-4 AAC Spatial 不能作为 MPEG-H 3D Audio / 360RA 的替代标识。该结论只限定于本次官方资料，不宣称整个 macOS 技术体系绝无 MPEG-H 接入可能。

### 4. 不适合作为对象接收器的 API

- [ScreenCaptureKit channelCount](https://developer.apple.com/documentation/screencapturekit/scstreamconfiguration/channelcount)：官方明确只支持 1 或 2 个捕获音频通道；不作为多声道/对象保真入口。
- [AVAudioEnvironmentNode](https://developer.apple.com/documentation/avfaudio/avaudioenvironmentnode)：用于应用自己的声源空间渲染，不是监听其他应用的 Atmos 对象接口。SDA 已有房间/HRTF 引擎，无需为输入功能替换成它。

## 路线 A：系统 PCM 输入

```text
选定应用 → Core Audio Tap → 私有聚合设备 / IO 回调
         → 有界 PCM 队列 → SDA 声道源 → 房间/HRTF → 物理耳机
```

实施步骤：

1. 在原生 helper 中完成 capability/权限检测，枚举可选进程。UI 显示真实应用名和可用状态；进程重启后重新解析对象 ID，不能永久缓存 PID。
2. 创建私有 Tap，排除 SDA 本身、原生渲染器和捕获 helper。全局捕获与指定进程捕获应明确区分。
3. 查询 Tap 的实际格式，创建聚合设备并配置 Tap list，注册 IOProc 后启动。按照官方示例处理 UUID 与设备生命周期。
4. 回调只复制输入 `AudioBufferList` 和 `AudioTimeStamp` 到预分配队列；控制线程负责解交错、布局映射、重采样和发送。
5. 在 SDA 输出已准备好后才接管原应用声音，优先评估 `mutedWhenTapped` 的实机行为；正常停止、失败、服务崩溃都测试原音恢复。不能只把系统音量拉到零。
6. 输出绑定真实耳机设备，不能再次选择 SDA 虚拟设备或包含自身输出的捕获源。
7. 停止 IO、释放 IOProc、销毁聚合设备和 Tap；每一步可重入，启动中途失败也能回滚。监听设备移除、权限撤销、休眠唤醒和格式变化。

输入/输出可能使用不同硬件时钟。记录 host time、sample time、采样率与 FIFO 水位，先验证聚合设备时钟选择，再确定是否需要缓慢漂移补偿。禁止靠周期性清空缓冲或短暂加速播放掩盖问题，也不要把输入到达位置显示成已播放位置。

若目标是多声道 PCM，另验非 mixdown Tap 或显式多声道 HAL 虚拟设备；首个双声道原型通过不等于多声道支持通过。

## 路线 B：保留 Atmos / DTS:X / 360RA 对象

```text
应用解封装后的原始音频帧 + 配置 + 时间信息
 → SDA 本机输入桥 → 对应解码器
 → 独立声源 PCM + 对象事件 → SDA 原生渲染 → CoreAudio 输出
```

这条路线需要发送端配合，但协议不绑定某个播放器。发送端可以是播放器插件、可扩展媒体引擎、测试发送器；不能用 Tap 的已渲染 PCM 替代原始输入。

- E-AC-3：保留完整访问单元及 JOC/元数据，不先降为 AC-3 或 PCM。
- TrueHD：若发送端提供 elementary stream，可复用现有解码路线；如果给的是 IEC/MAT 传输包，需要对应解包。MAT 2.x 不能一律当 TrueHD。
- DTS:X：保留扩展码流，不能只发送 DTS core。
- MPEG-H：区分 MHAS 和带配置的 raw AU；保留必要配置、profile/level、时间信息。不能用 USAC 枚举假装 MPEG-H，也不能仅发送 M4A 容器字节。
- 已支持编码内容仍需逐样本/事件验证；“标准允许”不意味着 SDA 当前支持该标准所有模式。

共同协议使用 Windows 文档的 Open/Data/Discontinuity/State/Feedback 模型。Mac 可使用本机 Unix domain socket 或共享内存传音频、控制消息单独传输；限制访问权限和包长，二进制音频不要通过高频 JSON 数组发送。该协议目前只是设计，接手时需实现和版本化。

已有源时间戳时保留 timebase；仅有设备帧位置时明确标记，不能伪造影片绝对播放时间。seek/切曲/格式变化递增 epoch，旧队列与对象状态失效，等待新配置和解码器预热后启动。音画同步需由输出消费位置和实际延迟反馈协调，不能靠 UI 轮询进度完成。

## SDA 复用点

| 代码位置 | 可复用内容 / 注意点 |
| --- | --- |
| `packages/core/src/lib.rs` | E-AC-3/TrueHD/DTS 等有状态原始码流解码和帧/对象事件；含 WASM 绑定，若原生复用需明确接口边界 |
| `packages/core/src/mpegh.ts` | `MpeghDecoder`、MHAS 分包、raw AU 配置；当前混合对象/HOA 等不支持模式会显式报错，不能绕过 |
| `packages/core/mpegh/bridge.c` | MPEG-H 底层桥；先复用已验证输出语义，再考虑原生化 |
| `packages/player/src/player.ts` | `NativeRendererSink` 和消费进度/时间线参考；不要强迫系统输入拥有文件时长或可跳转能力 |
| `apps/native-renderer/src/main.rs`、`protocol.rs` | 源配置、PCM、对象事件、暂停/启动/重置；直接码流需先解码，不能写入 PCM 命令 |
| `apps/native-renderer/src/output_manager.rs` | 现有 CoreAudio/CPAL 物理输出，保留 FIFO flush 确认与设备恢复逻辑 |
| `apps/desktop/main.cjs`、`preload.cjs` | helper 生命周期、能力查询、输入选择 UI 的最小桥接；高频音频不放 UI 线程 |

建议单独增加 Mac 捕获 helper 和输入生产者模块，避免把系统捕获、文件解封装、输出设备管理塞进同一个控制循环。第一版可以继续在 worker 复用已有解码器，不要求先重写全部解码栈。

## 给接手开发者的执行顺序

1. 在目标 Mac 记录系统/Xcode/架构，跑通 Apple Tap 示例，记录实际 ASBD、通道数、回调时间和授权结果。
2. 用已知 PCM 输入验证 SDA 房间/双耳渲染、原音静音与停止恢复、无自捕获回授。UI 明确标为 PCM。
3. 若需要可选择的系统输出设备或低版本支持，再独立验证 HAL PCM 插件。不要把驱动安装作为 14.2+ Tap 的前置条件。
4. 并行设计层面预留多格式原始码流协议；实现最小发送器，分别用同一 Atmos、DTS:X、360RA 文件与 SDA 直接播放比较。
5. 对接实际发送应用，记录它交付的是压缩帧、PCM 还是平台渲染结果。未能拿到完整码流的应用不标为对象输入。
6. 只有证明 Mac HAL 非 PCM 协商及实际数据交付后，再扩展系统级编码虚拟接收设备；这一步不能拿 Windows 的 GUID 或驱动数据范围直接照搬。

## 验收清单

- PCM：立体声与每个宣称支持的多声道布局分别验证，不靠波形有声音就判定通过。
- 对象：相同解码配置下，对齐源 PCM、对象 ID/位置/时间和拓扑；包含移动对象、切曲、暂停、连续跳转和中途加入。
- 同步：至少 30 分钟音画同步与队列水位记录；列出输入、解码、DSP、输出各段延迟，区分采样级对比与蓝牙实际听觉延迟。
- 生命周期：权限拒绝/撤销、应用退出、SDA 崩溃、耳机断开、设备切换、睡眠唤醒、helper 重启，不残留永久静音或旧曲音频。
- 物理输出：内置设备、USB、AirPods 分别验证。SDA 双耳结果对照时关闭额外的系统空间化，避免重复处理。
- 系统版本：最低支持版本与当前版本分别测试；新 API 做 availability 检查。测试过 Apple Silicon 不自动等于 Intel 已验证。
- 交付：记录实际支持矩阵、编译/签名/安装/卸载步骤、样本来源及测试结果；未验证的 Atmos MAT/MPEG-H 系统直通单列，不隐藏在“支持空间音频”标签下。

本次只提供文档供接手，不包含 Mac 实机验证，不宣称可以捕获任意应用的原始空间对象。

## 开源项目与社区补查（2026-09-18）

### atmos-control：可参考系统输入，但没有原始对象捕获

[项目 README](https://github.com/yukij3/atmos-control) 明确说明是 PCM spatializer / stereo-surround upmixer，不是 Dolby Atmos decoder。实现 Process Tap 和虚拟设备两条输入路线，以 AUSpatialMixer 输出双耳音频。

已核对 [AtmosDriver.c](https://github.com/yukij3/atmos-control/blob/main/Driver/Sources/AtmosDriver.c)：设备声明为 48 kHz、12 通道 32-bit float PCM，使用 7.1.4 布局及 float 环形缓冲。这证明其输入是多声道 PCM，不是原始压缩码流/对象元数据传输。SDA 可参考其 HAL 设备布局、输入捕获和设备监听思路，继续使用 SDA 自己的解码和渲染，不必替换为 Apple DSP。

README 声称 Apple Music 在对应模式可提供多声道；这仍需 Mac 接手者实测，不能当成任意 Atmos 内容都输出完整 7.1.4 的保证。[社区 issue #1](https://github.com/yukij3/atmos-control/issues/1) 报告 BlackHole 16ch 路线，实际主观确认的是 1～8 通道，明确说高度通道没有同程度验证。不得把它写成完整 7.1.4 实测通过，更不能把固定通道的位置当成原始动态对象位置。

项目的 README、早期 PLAN 和社区报告在版本要求、权限等内容上并不完全一致。优先用现有代码和 Apple 官方定义判断，再在目标系统验证；不要将旧计划中的绝对限制或授权推断照搬成 SDA 技术结论。

### HDMI 直通线索：有外部播放证据，尚无 SDA 接收证据

[mpv issue #15383](https://github.com/mpv-player/mpv/issues/15383) 报告 macOS 15.1.1 下 mpv 的 E-AC-3 HDMI 直通失败；评论者报告同文件用 QuickTime 的直通可工作。这是具体应用/系统/设备组合的社区报告，不证明 macOS 完全不支持 E-AC-3 直通，也不证明 HAL 虚拟设备可以接收相同输出。

[mpv AVFoundation 输出 PR #11955](https://github.com/mpv-player/mpv/pull/11955) 使用 AVSampleBufferAudioRenderer 接入 Apple 空间播放；这属于把应用音频交给 Apple 渲染，方向与从其他应用读取原始对象不同。

因此下一步有价值的 Mac 实验是：查询物理 HDMI 与 SDA 测试 HAL 端点的实际格式，观察支持直通的应用是否愿意选用虚拟端点，并验证收到的究竟是 IEC 编码载荷还是 PCM。在验证前保留“系统编码接收待验证”的标注。本次仍未找到通用 macOS Atmos 对象捕获或 MPEG-H 系统直通接收的已验证开源实现。

## macOS 15 / 26 HDMI 直通核查与接入验证

来源：[Apple《About HDMI Passthrough》，macOS 15 版本](https://support.apple.com/guide/mac-help/about-hdmi-passthrough-mchle3a1461c/15.0/mac/15.0)、[macOS 26 版本](https://support.apple.com/guide/mac-help/about-hdmi-passthrough-mchle3a1461c/26.0/mac/26.0)，以及 [Apple TV 播放设置](https://support.apple.com/guide/tvapp-mac/change-playback-settings-tvdf855a1b/mac)。两份版本化说明都确认下面的功能；这不是 macOS 26 独有能力。

官方原文："Passthrough transmits the original encoded bitstream over HDMI connections." 明确支持 Dolby Digital (AC-3)、Dolby Digital Plus (EAC-3)、Dolby Atmos (EAC-3 JOC)。支持的应用是 Apple Music、QuickTime Player、Apple TV；硬件条件为 Apple silicon Mac 的内置 HDMI 或受支持的 USB-C 转 HDMI 适配器，连接音频接收器。开启 Prefer HDMI Passthrough 并选择 HDMI 输出设备。额外声音继续使用之前的音频输出设置。

这证明：受支持的 macOS 播放链路可以保留 E-AC-3 JOC 原始编码载荷，不能再笼统称“系统应用只交付 PCM”。这份文档没有列出 TrueHD Atmos、DTS:X 或 MPEG-H，因此不能扩展到这些格式。

该页面是功能文档，不是第三方虚拟接收端 API 契约。本次核对 AVPlayer、AVSampleBufferAudioRenderer、Core Audio 文档及相关头文件资料，未定位到一个可直接引用、专供第三方 HAL 虚拟端点接收上述直通的公开 API。因此不能把“macOS 15 支持 HDMI 直通”写成“macOS 15 已开放 SDA 对象捕获 API”。不要臆造 `enableAtmosPassthrough` 等调用，也不要用文件导出 preset 的 passthrough 代替实时设备直通。

下一步验证目标收敛为 **E-AC-3 JOC 原始直通能否路由进自定义 HAL 端点**：先用官方支持的物理 HDMI 路径建立对照，再记录应用向虚拟端点查询的格式、设备传输类型和实际流数据。不得仅把设备名称/transport 标签改成 HDMI 就宣布成功；需要确认原始载荷、JOC 对象解码和连续时间线。若只能向物理 HDMI 输出，则此功能本身仍不能完成“系统播放 → SDA 软件接收”的要求。

### 版本与功能基线

| 项目 | 接手时采用的基线 | 当前确认程度 |
| --- | --- | --- |
| 系统 PCM 捕获 | macOS 14.2+ Process Tap | 官方 API 可用；SDA 接入待实现 |
| Dolby HDMI 原始直通 | macOS 15、Apple silicon、受支持 HDMI 连接 | 官方功能确认，26 同样有文档 |
| 直通进 SDA 虚拟端点 | macOS 15 与 26 分别测试 | 未验证，不是已有功能 |
| 360RA / MPEG-H 系统直通 | 不指定已支持系统版本 | 未找到足以确认的公开接收方案 |

### 给朋友的最小验证任务

1. 先选一份 SDA 可直接解析对象的、可正常访问的 E-AC-3 JOC 测试文件，记录 codec、采样率、对象事件和源音轨数据；不以 Apple Music 的受保护内容作为第一个验证样本。
2. 在 macOS 15 的 Apple silicon Mac 上，用官方列出的支持应用和 HDMI 接收器开启 Prefer HDMI Passthrough，建立播放对照。记录应用版本、系统版本、设备与实际协商格式；功放亮起 Atmos 标识只算路径初步证据。
3. 为测试 HAL 端点加入格式查询、设置及接收诊断，检查应用是否选择它、是否请求非 PCM 格式、是否交付完整编码载荷。标准虚拟 PCM 设备测试通过不算此步骤通过。
4. 若收到编码数据，完成正确解包后与源音轨比较，再输入 SDA 解码器，核对对象 PCM、位置、时间及间断恢复；只看到高频载波或多通道数据不能判定保留对象。
5. 通过后才接 SDA 双耳输出和消费时钟反馈，验证暂停、跳转、切轨及音画同步，再在 macOS 26 重复测试。失败则记录具体失败层：应用路由、格式协商、数据接收、解包或对象解码。

本任务的通过条件是“原始对象可恢复并供 SDA 逐对象 HRTF 使用”。在此之前只进行可行性原型，不按完整系统对象接入功能展开开发，也不把 PCM 方案作为对象方案完成交付。

## Windows / macOS API 对照：双方都需要接收实证

| 操作 | Windows | macOS |
| --- | --- | --- |
| 查询/设置流格式 | WASAPI `IAudioClient::IsFormatSupported`、`Initialize` | `AudioObjectGetPropertyData` / `AudioObjectSetPropertyData`，AudioStream 的可用及当前物理/虚拟格式属性 |
| 提交输出数据 | `IAudioRenderClient` | AudioDevice IOProc / Core Audio 输出路径，具体数据格式须协商 |
| 实现软件接收设备 | 自定义音频驱动，可参考 WaveRT/SysVAD | `AudioServerPlugIn` HAL 虚拟设备 |
| 取得对象 | 完整编码载荷送入 SDA 解码器 | 完整编码载荷送入 SDA 解码器 |

上表不是编码直通兼容性保证，更不是系统对象捕获 API 列表。Windows 有明确的 IEC 编码子格式定义，macOS 有官方确认的 Dolby HDMI 直通功能及通用设备接口；两者都没有在本项目证明“真实播放器 → SDA 虚拟设备 → 完整码流 → 原始对象”。不能据此提前判定 Windows 已可行、macOS 不可行。

Mac 接手者应在目标 SDK 核实 `kAudioStreamPropertyAvailablePhysicalFormats`、`kAudioStreamPropertyPhysicalFormat` 及对应 virtual format 属性的可读/可写性，记录实际 ASBD，不强制套用 Windows 的传输描述结构。改变设备格式只能在用户明确选择测试端点后执行，不能在枚举探测时修改物理设备配置。
