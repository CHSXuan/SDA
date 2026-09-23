import {detectLayoutId, type LayoutId} from "@sda/renderer";

/** MPEG-H 360 Reality Audio has an authored below-ear layer. */
export function uses360RaLowerLayer(codec?: string): boolean {
  return ["mpegh", "mha1", "mhm1"].includes(codec ?? "");
}

export function formatAutoLayout(codec?: string): LayoutId | undefined {
  if (uses360RaLowerLayer(codec)) return "360RA-13";
  if (["truehd", "eac3", "ac4", "iamf"].includes(codec ?? "")) return "7.1.4";
  return undefined;
}
export function resolveAutoLayout(labels: readonly string[], hasDynamics: boolean, codec?: string): LayoutId {
  return formatAutoLayout(codec) ?? detectLayoutId(labels, hasDynamics);
}
