import type {DecodedFrameData, ObjectEvent} from '@sda/core';

/** Skip independent access units, retaining three seconds for decoder warm-up.
 * Stateful codecs without a verified restart point retain their full history. */
export class SeekPacketGate {
  private eligible = false;
  private originMs: number | null = null;
  constructor(private seconds = 0) {}
  configure(container: string, codec: string, rate: number, outputRate?: number): void {
    this.eligible = container === 'mp4' && ['ec-3', 'ac-3', 'alac'].includes(codec)
      && (codec === 'alac' || !outputRate || rate === outputRate) && this.seconds > 3;
  }
  accept(timestampMs: number): boolean {
    if (!this.eligible) return true;
    if (this.originMs !== null) return true;
    if (timestampMs < (this.seconds - 3) * 1000) return false;
    this.originMs = timestampMs;
    return true;
  }
  restoreClock(frame: DecodedFrameData): void {
    if (this.originMs === null) return;
    const offset = Math.round(this.originMs * frame.sampleRate / 1000);
    frame.samplePos += offset;
    frame.events = frame.events.map(event => ({...event, samplePos: event.samplePos + offset}));
  }
  get localDiscardBeforeSeconds(): number {
    return Math.max(0, this.seconds - (this.originMs ?? 0) / 1000 - 0.1);
  }
  setOrigin(timestampMs: number): void { this.originMs = timestampMs; }
}

/** Decode from the beginning to retain codec history, but only emit the target
 * and later samples. This runs after resampling, in the output sample clock. */
export class SeekFrameGate {
  private states = new Map<number,ObjectEvent>();
  private done = false;
  private declarations = new Map<number, {id: number; channel: number}>();
  constructor(private seconds = 0) {}
  remember(frame: DecodedFrameData): void {
    const target = Math.round(this.seconds * frame.sampleRate);
    for (const event of frame.events) if (event.samplePos <= target) this.states.set(event.id,event);
    for (const declaration of frame.objectChannels) this.declarations.set(declaration.id,declaration);
  }
  accept(frame:DecodedFrameData):DecodedFrameData|null {
    if (this.done || this.seconds <= 0) return frame;
    const target = Math.round(this.seconds * frame.sampleRate);
    this.remember(frame);
    const end = frame.samplePos + (frame.channels[0]?.length ?? 0);
    if (end <= target) return null;
    this.done = true;
    const start = Math.max(target,frame.samplePos);
    const objectChannels = [...this.declarations.values()].filter(o => frame.labels?.[o.channel] === `Obj_${o.id}` || !frame.labels);
    const active = new Set(objectChannels.map(o=>o.id));
    const initial = [...this.states.values()].filter(e=>active.has(e.id))
      .map(e=>({...e,samplePos:start,rampDuration:0}));
    this.states.clear();
    return {...frame,samplePos:start,objectChannels,
      channels:frame.channels.map(c=>c.slice(start-frame.samplePos)),
      events:[...initial,...frame.events.filter(e=>e.samplePos>target)]};
  }
}
