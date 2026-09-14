import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const main = readFileSync(new URL('../main.cjs', import.meta.url), 'utf8');
const start = main.indexOf('ipcMain.handle("sda:native-renderer-speaker-mutes"');
const end = main.indexOf('ipcMain.handle("sda:native-renderer-lfe-muted"', start);
let handler;
const sent = [];
vm.runInNewContext(main.slice(start, end), {
  ipcMain: { handle: (_, fn) => { handler = fn; } },
  nativeRendererCommandAck: async command => { sent.push(command); return true; },
});
const layouts = readFileSync(new URL('../../../packages/renderer/src/layouts.ts', import.meta.url), 'utf8');
const block = layouts.split('export const LAYOUT_22_2: VirtualSpeaker[] = [')[1].split('];')[0];
const names = [...block.matchAll(/name: "([^"]+)"/g)].map(match => match[1]);
assert.equal(names.length, 24);
for (const name of names) {
  assert.equal(await handler(null, [name], []), true, `mute ${name}`);
  assert.deepEqual(Array.from(sent.at(-1).names), [name]);
  const others = names.filter(other => other !== name);
  assert.equal(await handler(null, others, []), true, `solo ${name}`);
  assert.deepEqual(Array.from(sent.at(-1).names), others);
}
assert.equal(await handler(null, [], names), true, 'full-layout focus');
assert.equal(await handler(null, [], []), true, 'clear');
assert.equal(await handler(null, ['FrontLeft'], 'FrontRight'), true, 'legacy');
for(const name of ['Surround1Left','Surround1Right','FrontHeightLeft','FrontHeightRight','RearHeightLeft','RearHeightRight']) { assert.equal(await handler(null,[name],[]),true); assert.equal(await handler(null,[],[name]),true); }
const expanded = Array.from({ length: 256 }, (_, i) => `Speaker_${i}`);
assert.equal(await handler(null, expanded, []), true, 'expanded mute list');
assert.deepEqual(Array.from(sent.at(-1).names), expanded);
assert.equal(await handler(null, [], expanded), true, 'expanded focus list');
assert.deepEqual(Array.from(sent.at(-1).focus), expanded);
const count = sent.length;
for (const invalid of [['bad/name'], [null], 'LFE']) {
  assert.equal(await handler(null, invalid, []), false);
  if (typeof invalid !== 'string') assert.equal(await handler(null, [], invalid), false);
}
assert.equal(sent.length, count);
console.log('22.2 speaker IPC: every mute/solo, focus, clear, legacy and validation passed');
