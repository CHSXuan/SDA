import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, appendFileSync } from 'node:fs';
import path from 'node:path';
const token = process.env.SDA_DIAGNOSTICS_TOKEN || randomBytes(24).toString('hex');
if (token.length < 16) throw new Error('Token must contain at least 16 characters');
const port = Number(process.env.SDA_DIAGNOSTICS_PORT || 8765);
const directory = path.resolve(process.env.SDA_DIAGNOSTICS_DIR || 'artifacts/ios-remote-diagnostics');
mkdirSync(directory, { recursive: true });
const authorized = value => {
  const a = Buffer.from(value || ''); const b = Buffer.from('Bearer ' + token);
  return a.length === b.length && timingSafeEqual(a, b);
};
const server = http.createServer((req, res) => {
  if (!authorized(req.headers.authorization)) { res.writeHead(401).end(); return; }
  if (req.method !== 'POST' || req.url !== '/diagnostics') { res.writeHead(404).end(); return; }
  let size = 0; const chunks = [];
  req.on('data', chunk => {
    size += chunk.length;
    if (size > 65536) { res.writeHead(413).end(); req.destroy(); return; }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (size > 65536) return;
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (body.schema !== 1 || !Number.isFinite(body.time)) { res.writeHead(400).end(); return; }
      // Whitelist diagnostic fields; never persist arbitrary sender payloads.
      const record = { receivedAt: Date.now(), schema: 1, time: body.time };
      for (const key of ['playback', 'playing', 'paused', 'background', 'generation', 'route', 'tracking', 'motion', 'error', 'events']) record[key] = body[key];
      appendFileSync(path.join(directory, new Date().toISOString().slice(0, 10) + '.jsonl'), JSON.stringify(record) + '\n');
      res.writeHead(204).end();
    } catch { res.writeHead(400).end(); }
  });
});
server.requestTimeout = 5000;
server.listen(port, process.env.SDA_DIAGNOSTICS_BIND || '0.0.0.0', () => {
  console.log(`Diagnostics receiver listening on port ${port}, path /diagnostics`);
  console.log(`Access token: ${token}`);
  console.log(`Logs: ${directory}`);
});
