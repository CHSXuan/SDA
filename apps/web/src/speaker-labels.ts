import type { VirtualSpeaker } from "@sda/renderer";

export const WIDE_SPEAKERS = ["WideLeft", "WideRight"] as const;
const LABELS: Record<string, readonly [string, string]> = {
  Surround1Left: ["左环绕1", "Surround1Left"],
  Surround1Right: ["右环绕1", "Surround1Right"],
  FrontHeightLeft: ["左前高度", "FrontHeightLeft"],
  FrontHeightRight: ["右前高度", "FrontHeightRight"],
  RearHeightLeft: ["左后高度", "RearHeightLeft"],
  RearHeightRight: ["右后高度", "RearHeightRight"],
  LFE2: ["低音炮2", "LFE2"],
  I_M_L060: ["中层左60°", "M_L060"],
  I_M_R060: ["中层右60°", "M_R060"],
  I_M_000: ["中层正前", "M_000"],
  I_M_L135: ["中层左135°", "M_L135"],
  I_M_R135: ["中层右135°", "M_R135"],
  I_M_L030: ["中层左30°", "M_L030"],
  I_M_R030: ["中层右30°", "M_R030"],
  I_M_180: ["中层正后", "M_180"],
  I_M_L090: ["中层左90°", "M_L090"],
  I_M_R090: ["中层右90°", "M_R090"],
  I_U_L045: ["上层左45°", "U_L045"],
  I_U_R045: ["上层右45°", "U_R045"],
  I_U_000: ["上层正前", "U_000"],
  I_T_000: ["上层正顶", "T_000"],
  I_U_L135: ["上层左135°", "U_L135"],
  I_U_R135: ["上层右135°", "U_R135"],
  I_U_L090: ["上层左90°", "U_L090"],
  I_U_R090: ["上层右90°", "U_R090"],
  I_U_180: ["上层正后", "U_180"],
  I_L_000: ["下层正前", "L_000"],
  I_L_L045: ["下层左45°", "L_L045"],
  I_L_R045: ["下层右45°", "L_R045"],
  UpperFrontLeft: ["左前上", "Ufl"],
  UpperFrontRight: ["右前上", "Ufr"],
  UpperCenter: ["上中置", "Uc"],
  UpperRearLeft: ["左后上", "Url"],
  UpperRearRight: ["右后上", "Urr"],
  LowerFrontLeft: ["左前下", "Lfl"],
  LowerFrontRight: ["右前下", "Lfr"],
  LowerCenter: ["下中置", "Lc"],

  FrontLeft: ["左前", "L"], FrontRight: ["右前", "R"], Center: ["中置", "C"],
  LFE: ["低音炮", "LFE"],
  WideLeft: ["左前宽", "Lw"], WideRight: ["右前宽", "Rw"],
  SurroundLeft: ["左侧环绕", "Ls"], SurroundRight: ["右侧环绕", "Rs"],
  RearLeft: ["左后环绕", "Lrs"], RearRight: ["右后环绕", "Rrs"],
  TopFrontLeft: ["左前顶", "Ltf"], TopFrontRight: ["右前顶", "Rtf"],
  TopMiddleLeft: ["左中顶", "Ltm"], TopMiddleRight: ["右中顶", "Rtm"],
  TopRearLeft: ["左后顶", "Ltr"], TopRearRight: ["右后顶", "Rtr"],
};

export function speakerLabel(name: string): string {
  const label = LABELS[name];
  return label ? `${label[0]} ${label[1]}` : name;
}

export function speakerPosition(speaker: VirtualSpeaker): string {
  if (speaker.isLfe) return "低频效果";
  const az = speaker.azimuth;
  const direction = az === 0 ? "正前方" : `${az > 0 ? "左" : "右"} ${Math.abs(az)}°`;
  return `${direction} · ${speaker.elevation > 0 ? `仰角 ${speaker.elevation}°` : speaker.elevation < 0 ? `俯角 ${-speaker.elevation}°` : "耳平面"}`;
}
