# macOS 窗口原生模糊适配交接

更新日期：2026-09-17。本文是待实施的 UI 适配方案，尚未在 Mac 实机验证；本次只实现了 Windows 原生材质，不包含 macOS 模糊适配代码。

## 目标与视觉要求

在顶部工具栏及左侧菜单使用 macOS 原生 Vibrancy，让窗口背后的内容经过系统模糊后轻微透出。中央 3D 场景保持实色，保证声场、对象和文字清晰。保留原生红黄绿窗口按钮及已有全屏行为。

用户已反馈初版透明过强。Windows 当前采用浅色 **86% 底色、不透明度**，深色 **88% 底色、不透明度**，仅留下 14% / 12% 的透色空间。Mac 可以先按这组值起步，再根据系统材质实测微调；两个系统的最终透色强度不一定相同。不要再次做成大面积直接透出桌面颜色。

## 当前实现与未完成部分

| 文件 / 入口 | 现状 | Mac 接手工作 |
| --- | --- | --- |
| `apps/desktop/main.cjs`：`createWindow()` | Mac 已有 `titleBarStyle: "hiddenInset"`、`vibrancy: "sidebar"`；但窗口底色仍为不透明 `#171819` | 为启用 Vibrancy 的 Mac 设置透明窗口背景，并补动态回退 |
| 同文件：`windowsBackdropEnabled()`、`updateBackdrop()` | 仅 Windows 11 22H2+ 使用 Acrylic，并检查减少透明度和高对比度设置 | 保留 Windows 分支，另加 Darwin 能力与无障碍处理 |
| 同文件：`sda:window-theme` | 只在 Windows 同步 `nativeTheme.themeSource` | 评估并添加 Darwin 主题同步，确保系统材质与应用深浅色一致 |
| `apps/desktop/preload.cjs` | `--sda-native-backdrop`、`sda:window-backdrop` 只识别 `acrylic` / `none`；主题观察器只在 Windows 启用 | 扩展为 `acrylic` / `vibrancy` / `none`，并启用 Mac 主题观察器 |
| `apps/web/src/workbench.css` | 只有 `html[data-native-backdrop="acrylic"]` 才让 HTML、body、root、app 透明；中央 main 恢复实色 | 将共同样式扩展到明确的 `vibrancy` 状态，材质强度变量改成平台通用名称 |
| 同文件：`data-platform="darwin"` 样式 | 已处理红黄绿按钮、34px 拖动区域、全屏时的顶部及侧栏偏移 | 保留并验证，勿套用 Windows 自绘标题栏的 32px 尺寸 |

仅配置 `vibrancy` 不够：当前 HTML / body / root 的不透明底色也会遮住系统材质。不要只降低工具栏自身的透明度，必须让它下面的容器也透明。

## 建议实现顺序

1. 在主进程明确计算材质状态：Windows 使用现有 `acrylic`；Darwin 在允许透明时使用 `vibrancy`；其余情况为 `none`。不要把 Mac 标成 `acrylic` 来复用 CSS。
2. Mac 窗口保留 `hiddenInset`，以现有 `vibrancy: "sidebar"` 为起点，背景设为 `#00000000`。可显式指定 `visualEffectState: "followWindow"`，让前后台材质遵循系统行为。先使用 Electron API，不需要新增原生模块，也不需要改音频渲染器。
3. 扩展 preload 的状态白名单、启动参数和运行时消息处理，再扩展 CSS 选择器。只让框架容器、顶部栏和左侧栏露出原生材质，`.app > main` 仍使用 `var(--bg)`；弹窗和 MiniPlayer 保持各自已有设计。
4. 在 Darwin 也监听页面 `data-theme` 的变化，将合法的 `light` / `dark` 同步到 `nativeTheme.themeSource`。这是应用外观设置，不应修改用户的 macOS 系统主题。防止重复注册监听器或主题消息循环。
5. 在 `nativeTheme` 的 `updated` 事件检查 `prefersReducedTransparency`，结合 Mac 的增加对比度设置验证回退。禁用时调用 `win.setVibrancy(null)`、恢复实色背景并向页面发送 `none`；恢复时重新启用材质与透明背景。销毁窗口时移除监听器，重载页面后重发当前状态。
6. 处理设置失败的回退：材质不可用时不要继续把 DOM 标成透明材质已启用，避免出现黑底或意外穿透。不要默认添加 `transparent: true`；先验证 Electron 的 Vibrancy 与透明背景配置，以免改变原生窗口行为。

示意配置（不是直接替换整段 `createWindow()` 的完整补丁）：

```js
const useMacVibrancy = process.platform === "darwin"
  && !nativeTheme.prefersReducedTransparency;

const macAppearance = {
  titleBarStyle: "hiddenInset",
  ...(useMacVibrancy ? {
    vibrancy: "sidebar",
    visualEffectState: "followWindow",
    backgroundColor: "#00000000",
  } : {
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#171819" : "#eceeed",
  }),
};
```

## 实机验收

- 浅色、深色分别查看：桌面只能微微透色，菜单小字和禁用控件可辨认；切换主题后材质和文字颜色一致。
- 在颜色鲜艳的桌面或其他窗口上方移动 SDA，确认是真正的窗口背后模糊，而非网页内部的 `backdrop-filter`。
- 聚焦 / 失焦、最小化 / 恢复、调整窗口大小、全屏 / 退出全屏均无黑底、闪白、裁切错误；红黄绿按钮及拖动区域可用。
- 在系统中切换“减少透明度”和“增加对比度”，确认回退及时，关闭后能恢复；测试应用重启及页面重载。
- 中央 3D 场景仍不透桌面，弹窗、下拉框和 MiniPlayer 不被全局透明规则误伤。
- 播放中移动窗口、切主题、打开菜单，不应引入音频中断或明显增加渲染负担。纯视觉适配不要修改 CoreAudio / HRTF / 头追处理。
- 回归 Windows Acrylic 与无原生材质的普通网页，避免扩大选择器后影响移动端。

参考构建流程：`pnpm --filter @sda/web build`，再按 [macOS 移植说明](macos-port.md) 运行或打包桌面端。开发模式和打包产物都应验证；仅浏览器预览无法验收原生材质。

## API 参考

当前项目使用 Electron 43.x，相关选项已对照本地 Electron 类型声明。系统实际效果仍需 Mac 验证。

- [Electron BrowserWindow：窗口配置、Vibrancy](https://www.electronjs.org/docs/latest/api/browser-window)
- [Electron nativeTheme：主题与无障碍状态](https://www.electronjs.org/docs/latest/api/native-theme)
- [Apple NSVisualEffectView：系统材质视图](https://developer.apple.com/documentation/appkit/nsvisualeffectview)

本方案是 macOS 原生磨砂材质适配，不等同于承诺实现新系统 Liquid Glass 的折射效果。
