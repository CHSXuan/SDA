// Diagnostic: parse the user's ADM BWF like the player does, dump object trajectories.
import { readBwfMetadata } from '../packages/demux/src/bwf.ts';
import fs from 'node:fs';

const path = process.argv[2] ?? 'C:/Users/fengluoxiao/Documents/test01.wav';
const handle = fs.openSync(path, 'r');
const size = fs.fstatSync(handle).size;
const read = async (offset, length) => {
  const buffer = Buffer.alloc(length);
  fs.readSync(handle, buffer, 0, length, offset);
  return new Uint8Array(buffer);
};

const metadata = await readBwfMetadata(read, size);
const events = metadata.adm?.events ?? [];
console.log('labels:', metadata.labels?.join(','));
console.log('warnings:', metadata.adm?.warnings?.slice(0, 5));
console.log('total events:', events.length);

const byObject = new Map();
for (const event of events) {
  if (!byObject.has(event.id)) byObject.set(event.id, []);
  byObject.get(event.id).push(event);
}
console.log('objects with events:', byObject.size);
for (const [id, list] of [...byObject].slice(0, 25)) {
  let minY = Infinity, maxY = -Infinity, jumps = 0, previous = null, withPosition = 0;
  const extras = new Set();
  for (const event of list) {
    const y = event.pos?.[1];
    if (typeof y === 'number' && Number.isFinite(y)) {
      withPosition++;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (previous !== null && Math.abs(y - previous) > 0.15) jumps++;
      previous = y;
    }
    if (event.size && (event.size[0] || event.size[1] || event.size[2])) extras.add('size');
    if (event.distance_m != null) extras.add('distance');
    if (event.anchor && event.anchor !== 'room') extras.add('anchor:' + event.anchor);
  }
  const sample = list.find(event => event.pos);
  console.log(`  ${id}: n=${String(list.length).padStart(5)} withPos=${withPosition} Y=${minY === Infinity ? '—' : minY.toFixed(2) + '..' + maxY.toFixed(2)} jumps=${jumps} extras=[${[...extras]}] sample=${sample ? JSON.stringify(sample.pos.map(v => +v.toFixed(2))) : '—'}`);
}
fs.closeSync(handle);
