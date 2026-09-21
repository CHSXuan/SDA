import type { StageRow } from "./bridge";

export const stageDefinitions: Record<string, [name: string, category: string, unit: string]> = {
  "decode.loudness": ["音量平衡响度分析", "decode", "frame"],
  "decode.resample": ["转换音频采样率", "decode", "frame"],
  "decode.output_audio": ["解码产出的音频", "decode", "audio"],
  "decode.next_frame": ["取出解码帧", "decode", "audio"],
  "decode.packet_push": ["执行音频解码", "decode", "packet"],
  "decode.queue_wait": ["等待解码任务开始", "decode", "call"],
  "decode.message_including_wait": ["解码任务（含内部等待）", "decode", "call"],
  "decode.to_binaural_callback_estimate": ["解码 → 双耳输出（估算）", "output", "call"],
  "hrtf.object.convolution": ["对象独立双耳卷积", "hrtf", "frame"],
  "hrtf.object.filter_update": ["更新对象方向滤波器", "hrtf", "tap"],
  "hrtf.object.legacy": ["对象布局双耳卷积", "hrtf", "frame"],
  "hrtf.bed_bus": ["声床声道双耳卷积", "hrtf", "frame"],
  "hrtf.reflection_bus": ["房间反射双耳卷积", "hrtf", "frame"],
  "hrtf.bank_prepare": ["准备双耳滤波器组", "hrtf", "channel"],
  "object.routing_and_mix": ["独立对象定位与混音", "routing", "frame"],
  "source.routing_and_mix": ["每路声音定位与混音", "routing", "frame"],
  "pcm.source_ingest": ["声音送入原生队列", "routing", "frame"],
  "pcm.ipc_to_native_ack": ["发送声音 → 原生确认", "routing", "frame"],
  "pcm.scheduled_lead_ms": ["已排队音频的提前量", "routing", "frame"],
  "pcm.to_output_callback_estimate": ["声音入队 → 输出（估算）", "output", "call"],
  "render.block": ["一整块声音的渲染", "output", "frame"],
  "output.callback": ["输出回调统计开销", "output", "frame"],
  "output.callback_work": ["输出回调执行", "output", "frame"],
  "output.underrun_frames": ["输出时缺少的音频", "output", "gap"],
  "room.generate_including_wait": ["生成房间（含等待）", "room", "call"],
  "room.worker_runtime": ["房间计算进程运行", "room", "channel"],
  "room.apply_including_queue": ["应用房间（含排队）", "room", "call"],
  "native.command": ["原生控制指令", "routing", "call"],
  "native.health.fifoFramesAvailable": ["输出缓冲中剩余音频", "output", "gauge"],
  "native.health.callbackMaxMicros": ["输出回调的历史峰值", "output", "gauge"],
  "native.health.renderWaitLockMicros": ["渲染线程等待锁", "output", "gauge"],
  "native.health.controlLockMaxMicros": ["控制线程等待锁峰值", "output", "gauge"],
  "3d.cpu_submit": ["3D 画面 CPU 提交", "3d", "draw"],
  "3d.gpu_elapsed": ["3D 画面 GPU 绘制", "3d", "call"],
  "3d.gpu_batch_elapsed": ["3D GPU 批次耗时（非单帧）", "3d", "call"],
  "3d.frame_interval": ["两次画面更新的间隔", "3d", "call"],
  "3d.triangles": ["3D 绘制三角形数量", "3d", "triangle"],
  "3d.gpu_timer_unavailable": ["显卡不支持绘制计时", "3d", "unavailable"],
  "3d.gpu_disjoint": ["显卡计时本次无效", "3d", "unavailable"],
  "network.native_tx_bytes": ["原生网络发送", "network", "byte"],
  "network.native_rx_bytes": ["原生网络接收", "network", "byte"],
  "network.rtc_tx_bytes": ["WebRTC 发送", "network", "byte"],
  "network.rtc_rx_bytes": ["WebRTC 接收", "network", "byte"],
  "network.chromium_unavailable": ["浏览器网络计数不可用", "network", "unavailable"],
  "renderer.unresponsive": ["主界面没有响应", "3d", "call"],
  "renderer.responsive": ["主界面恢复响应", "3d", "call"],
};

const commands: Record<string, string> = {
  health: "检查运行状态", setPerformance: "性能记录", setHrtf: "切换双耳滤波器",
  setCinema: "应用房间", setLayout: "切换声道布局", setPose: "更新头部位置",
  pcm: "接收音频", pcmBatch: "批量接收音频", reset: "重置播放", setPaused: "暂停或继续",
  setOutputActive: "切换输出", setProgramGain: "调整音量平衡", setObjectHrtf: "切换对象渲染",
  setDirectionalHrtf: "切换实际方向渲染",
};

const channels: Record<string, string> = {
  L: "左前", R: "右前", C: "中置", LFE: "低音", Lss: "左侧", Rss: "右侧", Lrs: "左后", Rrs: "右后",
  Ltf: "左前上", Rtf: "右前上", Ltr: "左后上", Rtr: "右后上", all: "整体", scene: "空间画面",
  stereo: "双耳输出", output: "输出设备", remote: "远程传输", codec: "解码器", drain: "解码器",
  decoder: "解码器", push: "接收数据", open: "打开文件", init: "初始化", flush: "处理剩余数据",
  adm: "ADM 音频", mpegh: "360RA / MPEG-H", truehd: "Dolby TrueHD", eac3: "Dolby Digital Plus",
  ac3: "Dolby Digital", pcm: "PCM 音频", alac: "ALAC 音频", flac: "FLAC 音频", dts: "DTS 音频",
  iamf: "IAMF 音频",
};

export function stageSource(row: Pick<StageRow, "id" | "stage">): string {
  if (row.id?.startsWith("obj:")) return "对象 " + row.id.slice(4).replace(":near-reference", "（近场参考）");
  if (row.id?.startsWith("bed:")) return "声床 " + row.id.slice(4);
  if (row.stage === "native.command") return commands[row.id ?? ""] || "播放控制";
  return channels[row.id ?? ""] || row.id || "整体";
}

export function stageDefinition(stage: string): [string, string, string] {
  if (stage.endsWith(".failed")) return [(stageDefinitions[stage.slice(0, -7)]?.[0] ?? "处理任务") + "失败", "room", "call"];
  return stageDefinitions[stage] ?? ["其他处理", "routing", "call"];
}

const unitNames: Record<string, string> = {
  frame: "帧", gap: "帧缺口", tap: "滤波系数", channel: "声道",
  draw: "绘制调用", triangle: "三角形", packet: "音频包", call: "次",
};

export const categoryLabels: Record<string, string> = {
  all: "全部步骤", decode: "解码", hrtf: "双耳与 HRTF", room: "房间",
  routing: "声音输送", output: "播放输出", "3d": "3D 画面", network: "网络",
};

export { unitNames };
