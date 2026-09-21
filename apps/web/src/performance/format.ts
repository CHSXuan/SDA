import type { StageRow } from "./bridge";
import { stageDefinition, stageSource, unitNames } from "./stages";
import type { PeakRecord } from "./bridge";

export const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
export const num = (v: unknown, n = 2) => (finite(v) ? (v as number).toFixed(n) : "未测得");
export const ms = (v: unknown) => (finite(v) ? `${num(v)} ms` : "未测得");
export const size = (v: unknown) =>
  !finite(v) ? "未测得" : (v as number) >= 1048576 ? `${num((v as number) / 1048576)} MB` : `${num((v as number) / 1024)} KB`;

export function work(row: StageRow, unit: string): string {
  const v = row.units;
  if (unit === "byte") return size(v);
  if (unit === "audio") return `${num(v)} 秒音频`;
  if (unit === "unavailable") return "不可用";
  if (unit === "gauge") return "状态采样";
  return `${num(v, 0)} ${unitNames[unit] ?? "次"}`;
}

export function songTime(seconds: number): string {
  if (!finite(seconds)) return "未测得";
  const minutes = Math.floor(seconds / 60);
  return `${minutes} 分 ${String(Math.floor(seconds % 60)).padStart(2, "0")} 秒`;
}

const peakNames: Record<string, string> = {
  cpu: "CPU（单核基准）", memory: "内存", rx: "网络接收", tx: "网络发送",
  read: "读取速度", write: "写入速度", decode: "解码产出", hrtf: "对象双耳计算",
  room: "房间应用", latency: "解码到双耳输出", gaps: "音频缺口", "3d": "3D 绘制",
};

export function peakName(record: PeakRecord): string {
  return record.detail
    ? `${stageDefinition(record.detail.stage)[0]} · ${stageSource({ stage: record.detail.stage, id: record.detail.id })}`
    : peakNames[record.key] ?? "处理峰值";
}

export function peakAmount(record: PeakRecord): string {
  if (record.key.startsWith("work:") && record.detail) {
    return work({ units: record.value } as StageRow, stageDefinition(record.detail.stage)[2]);
  }
  if (record.key === "cpu") return `${num(record.value)}%（100% = 一个核心）`;
  if (["memory", "rx", "tx", "read", "write"].includes(record.key)) return size(record.value) + (record.key === "memory" ? "" : " / 秒");
  if (record.key === "decode") return `${num(record.value)} 秒音频 / 秒`;
  if (record.key === "gaps") return ms(record.value / 48);
  return ms(record.value);
}
