import http from 'node:http';
import { mkdirSync, appendFileSync } from 'node:fs';
import path from 'node:path';
const port = Number(process.env.SDA_DIAGNOSTICS_PORT || 8765);
const directory = path.resolve(process.env.SDA_DIAGNOSTICS_DIR || 'artifacts/ios-remote-diagnostics');
mkdirSync(directory, { recursive: true });
const privatePeer = address => {
  const ip = (address || '').replace(/^::ffff:/, '');
  if (ip === '::1') return true;
  const parts = ip.split('.');
  if (parts.length !== 4 || parts.some(p => !/^\d+$/.test(p) || Number(p) > 255)) return false;
  const [a, b] = parts.map(Number);
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 100 && b >= 64 && b <= 127);
};
const server = http.createServer((req, res) => {
  if (!privatePeer(req.socket.remoteAddress)) { res.writeHead(403).end(); return; }
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
      for (const key of ['playback', 'playing', 'paused', 'background', 'thermalState', 'engineRunning', 'backgroundTrackingEnabled', 'generation', 'route', 'tracking', 'motion', 'error', 'events']) record[key] = body[key];
      appendFileSync(path.join(directory, new Date().toISOString().slice(0, 10) + '.jsonl'), JSON.stringify(record) + '\n');
      res.writeHead(204).end();
    } catch { res.writeHead(400).end(); }
  });
});
server.requestTimeout = 5000;
server.listen(port, process.env.SDA_DIAGNOSTICS_BIND || '0.0.0.0', () => {
  console.log(`Diagnostics receiver listening on port ${port}, path /diagnostics`);
  console.log('No key required; accepts private LAN/Tailscale IPv4 and loopback peers only.');
  console.log(`Logs: ${directory}`);
});
