// Verify generated ADM test files parse correctly through SDA's BWF reader.
import { readBwfMetadata } from '../packages/demux/src/bwf.ts';
import fs from 'node:fs';

for (const path of process.argv.slice(2)) {
  const handle = fs.openSync(path, 'r');
  const size = fs.fstatSync(handle).size;
  const read = async (offset, length) => {
    const buffer = Buffer.alloc(length);
    fs.readSync(handle, buffer, 0, length, offset);
    return new Uint8Array(buffer);
  };
  const metadata = await readBwfMetadata(read, size);
  const events = metadata.adm?.events ?? [];
  const byObject = new Map();
  for (const event of events) {
    if (!byObject.has(event.id)) byObject.set(event.id, []);
    byObject.get(event.id).push(event);
  }
  console.log(`\n${path}:`);
  console.log(`  channels=${metadata.format.channels} labels=[${metadata.labels?.join(',')}] events=${events.length} warnings=${metadata.adm?.warnings?.length ?? 0}`);
  for (const [id, list] of byObject) {
    const positions = list.filter(event => event.pos).map(event => event.pos);
    const radii = positions.map(([x, y, z]) => Math.hypot(x, y, z));
    console.log(`  obj ${id}: events=${list.length} positions=${positions.length} r=${radii.length ? Math.min(...radii).toFixed(2) + '..' + Math.max(...radii).toFixed(2) : '—'} first=${positions[0]?.map(v => v.toFixed(2))} last=${positions.at(-1)?.map(v => v.toFixed(2))}`);
  }
  fs.closeSync(handle);
}
