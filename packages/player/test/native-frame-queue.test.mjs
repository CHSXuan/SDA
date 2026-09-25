import assert from 'node:assert/strict';
import {NativeFrameQueue} from '../src/native-frame-queue.ts';

let releaseActive;
const activeReleased = new Promise(resolve => { releaseActive = resolve; });
let activeStarted;
const activeStartedPromise = new Promise(resolve => { activeStarted = resolve; });
const queue = new NativeFrameQueue();
const calls = [];

const active = queue.submit(async () => {
  calls.push('active');
  activeStarted();
  await activeReleased;
});
const stale = queue.submit(async () => { calls.push('stale'); });
await activeStartedPromise;
queue.invalidatePending();
const reset = queue.submit(async () => { calls.push('reset'); });
releaseActive();
await Promise.all([active, stale, reset]);

assert.deepEqual(calls, ['active', 'reset'], 'seek barrier keeps the active pipe write ordered but drops queued old frames');
console.log('Native frame queue: pending generation is invalidated without reordering the active frame');
