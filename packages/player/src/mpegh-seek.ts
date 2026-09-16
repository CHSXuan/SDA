import type {DemuxedAudioPacket} from '@sda/demux';

/** Inspect complete MHAS packets without entering the stateful decoder. */
function inspect(bytes: Uint8Array): {independent: boolean; descriptors: Map<string, Uint8Array>} | null {
  let bit = 0, independent = false, audioPackets = 0;
  const descriptors = new Map<string, Uint8Array>();
  const read = (n: number): number => {
    if (bit + n > bytes.length * 8) throw Error('incomplete MHAS');
    let value = 0;
    while (n--) value = value * 2 + ((bytes[bit >> 3]! >> (7 - (bit++ & 7))) & 1);
    return value;
  };
  const escaped = (a: number,b: number,c: number): number => {
    let value = read(a);
    if (value === 2 ** a - 1) { const extra = read(b); value += extra; if (extra === 2 ** b - 1) value += read(c); }
    return value;
  };
  try {
    while (bit < bytes.length * 8) {
      const start = bit / 8, type = escaped(3,8,8), label = escaped(2,8,32), length = escaped(11,24,24);
      if (bit % 8 || bit + length * 8 > bytes.length * 8) return null;
      const payload = bit / 8;
      bit += length * 8;
      if (type === 2) {
        if (++audioPackets > 1) return null;
        independent = length > 0 && !!(bytes[payload]! & 0x80);
      }
      else if (type === 1 || type === 3) descriptors.set(`${type}:${label}`,bytes.slice(start,bit / 8));
      else if (type !== 6) return null; // Unknown control packets require full history.
    }
    return {independent,descriptors};
  } catch { return null; }
}

/** MP4 MPEG-H restart: retain descriptors and select an independent audio AU
 * before a three-second preroll. Retain one restart interval. Unknown controls
 * or config changes resume sequential decoding from its saved configuration. */
export class MpeghSeekPackets {
  private codec = '';
  private pending: DemuxedAudioPacket[] = [];
  private bytes = 0;
  private baseTimestampMs = 0;
  private baseDescriptors = new Map<string, Uint8Array>();
  private done = false;
  private descriptors = new Map<string, Uint8Array>();
  originMs = 0;
  constructor(private seconds: number) {}
  configure(container: string,codec: string): void {
    this.codec = container === 'mp4' && ['mha1','mhm1'].includes(codec) && this.seconds > 3 ? codec : '';
  }
  accept(packet: DemuxedAudioPacket): DemuxedAudioPacket[] {
    if (!this.codec || this.done) return [packet];
    this.pending.push(packet);
    this.bytes += packet.frames.reduce((sum,frame)=>sum+frame.length,0);
    const data = packet.frames[0];
    const info = data && packet.frames.length === 1
      ? this.codec === 'mha1' ? {independent: !!(data[0]! & 0x80),descriptors:new Map<string,Uint8Array>()} : inspect(data)
      : null;
    if (!info || this.bytes > 16 * 1024 * 1024) return this.finish();
    for (const [key,value] of info.descriptors) {
      const old = this.descriptors.get(key);
      if (old && (old.length !== value.length || old.some((byte,index)=>byte!==value[index]))) return this.finish();
      this.descriptors.set(key,value);
    }
    const threshold = (this.seconds - 3) * 1000;
    const configured = this.codec === 'mha1' || [...this.descriptors.keys()].some(key=>key.startsWith('1:'));
    if (configured && info.independent && packet.timestampMs <= threshold) {
      // Retain only the latest restart interval, not all compressed audio
      // since sample zero. A long song must not hit the memory cap merely
      // because the requested position is far into the track.
      this.pending = [packet];
      this.bytes = packet.frames.reduce((sum,frame)=>sum+frame.length,0);
      this.baseTimestampMs = packet.timestampMs;
      this.baseDescriptors = new Map(this.descriptors);
    }
    if (packet.timestampMs >= threshold) return this.finish();
    return [];
  }
  flush(): DemuxedAudioPacket[] { return this.finish(); }
  private finish(): DemuxedAudioPacket[] {
    let packets = this.pending;
    if (this.baseTimestampMs > 0 && packets.length) {
      this.originMs = this.baseTimestampMs;
      if (this.codec === 'mhm1') {
        // Config and audio-scene descriptors originally preceding this RAP.
        // If a later packet changes configuration, replay from this saved
        // checkpoint with its original descriptors, then decode the change.
        const prefixes = [...this.baseDescriptors.values()];
        const audio = packets[0]!.frames[0]!;
        const bytes = new Uint8Array(prefixes.reduce((sum,p)=>sum+p.length,0)+audio.length);
        let offset=0;for(const prefix of prefixes){bytes.set(prefix,offset);offset+=prefix.length;}
        bytes.set(audio,offset);
        packets = [{...packets[0]!,frames:[bytes]},...packets.slice(1)];
      }
    }
    this.pending = []; this.descriptors.clear(); this.baseDescriptors.clear(); this.bytes = 0; this.done = true;
    return packets;
  }
}
