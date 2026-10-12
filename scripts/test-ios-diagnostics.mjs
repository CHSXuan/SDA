import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
const token = 'diagnostics-test-token-123456';
const child = spawn(process.execPath, ['scripts/diagnostics-receiver.mjs'], {
  env: { ...process.env, SDA_DIAGNOSTICS_TOKEN: token, SDA_DIAGNOSTICS_PORT: '18765', SDA_DIAGNOSTICS_BIND: '127.0.0.1', SDA_DIAGNOSTICS_DIR: 'tmp/diagnostics-test' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
try {
  await new Promise((resolve, reject) => {
    child.once('error', reject); child.once('exit', code => reject(new Error('Receiver exited: ' + code)));
    child.stdout.once('data', resolve);
  });
  const url = 'http://127.0.0.1:18765/diagnostics';
  assert.equal((await fetch(url, { method: 'POST' })).status, 401);
  assert.equal((await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: '{}' })).status, 400);
  assert.equal((await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: JSON.stringify({ schema: 1, time: 123, route: 'KU100' }) })).status, 204);
  const source = readFileSync('apps/mobile/modules/sda-core/ios/RemoteDiagnostics.swift', 'utf8');
  assert.match(source, /task == nil/);
  assert.match(source, /self.task\?\.cancel/);
  assert.match(source, /index\+1 < urls.count/);
  console.log('Diagnostics receiver authentication, payload validation and native backpressure contracts passed.');
} finally { child.kill(); }
