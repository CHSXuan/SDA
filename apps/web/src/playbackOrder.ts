export type PlaybackMode = "sequence" | "repeat-all" | "repeat-one";
export const PLAYBACK_MODE_KEY = "sda-playback-mode-v1";
export const PLAYBACK_MODES: readonly PlaybackMode[] = ["sequence", "repeat-all", "repeat-one"];
export const PLAYBACK_MODE_LABELS: Record<PlaybackMode, string> = {
  sequence: "顺序播放", "repeat-all": "列表循环", "repeat-one": "单曲循环",
};
export function readPlaybackMode(): PlaybackMode {
  try {
    const saved = localStorage.getItem(PLAYBACK_MODE_KEY);
    return PLAYBACK_MODES.includes(saved as PlaybackMode) ? saved as PlaybackMode : "sequence";
  } catch { return "sequence"; }
}
export function followingPlaybackMode(mode: PlaybackMode): PlaybackMode {
  return PLAYBACK_MODES[(PLAYBACK_MODES.indexOf(mode) + 1) % PLAYBACK_MODES.length]!;
}
/** Resolve against the live queue; a removed/cleared item must never restart it. */
export function nextPlaylistItemId(items: readonly {id: string}[], currentId: string | null, mode: PlaybackMode): string | null {
  const index = items.findIndex(item => item.id === currentId);
  if (index < 0) return null;
  if (mode === "repeat-one") return items[index]!.id;
  return items[index + 1]?.id ?? (mode === "repeat-all" ? items[0]!.id : null);
}

/** Explicit skips move through the queue even when repeat-one is selected. */
export function adjacentPlaylistItemId(items:readonly {id:string}[],currentId:string|null,direction:1|-1):string|null {
  if(!items.length)return null;
  const index=items.findIndex(item=>item.id===currentId);
  const next=direction===1?(index+1)%items.length:(Math.max(index,0)-1+items.length)%items.length;
  return items[next]!.id;
}
