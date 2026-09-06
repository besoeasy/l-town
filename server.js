import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, 'dist');
const PORT = Number(process.env.PORT || 30300);

function getLocalIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.webmanifest': 'application/manifest+json',
};

const server = http.createServer((req, res) => {
  let reqPath = req.url ? req.url.split('?')[0] : '/';

  // API: Server info for simple LAN discovery
  if (reqPath === '/api/info') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ localIp: getLocalIp(), port: PORT }));
    return;
  }

  if (reqPath === '/' || !reqPath) reqPath = '/index.html';

  let filePath = path.join(DIST_DIR, reqPath);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(DIST_DIR, 'index.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(500);
      res.end('Server Error');
      return;
    }
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000',
    });
    res.end(content);
  });
});

// ── LAN WebSocket Signaling Broker ──────────────────────────────────────────
const wss = new WebSocketServer({ server });
let activeHostWs = null;
let activeHostInfo = null;
const peers = new Map(); // peerId -> ws
let nextPeerId = 2;

wss.on('connection', (ws) => {
  let myPeerId = null;
  let isHost = false;

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      if (msg.type === 'register_host') {
        isHost = true;
        activeHostWs = ws;
        activeHostInfo = { seed: msg.seed, name: msg.name, core: msg.core };
        ws.send(JSON.stringify({ type: 'host_registered', ok: true }));
      } else if (msg.type === 'peer_offer') {
        if (!activeHostWs || activeHostWs.readyState !== 1) {
          ws.send(JSON.stringify({ type: 'error', message: 'No active LAN host on this address.' }));
          return;
        }
        myPeerId = nextPeerId++;
        peers.set(myPeerId, ws);
        activeHostWs.send(JSON.stringify({
          type: 'peer_offer',
          peerId: myPeerId,
          offer: msg.offer,
          callsign: msg.callsign
        }));
      } else if (msg.type === 'host_answer') {
        const peerWs = peers.get(msg.peerId);
        if (peerWs && peerWs.readyState === 1) {
          peerWs.send(JSON.stringify({
            type: 'host_answer',
            answer: msg.answer,
            seed: activeHostInfo?.seed || 12345
          }));
        }
      } else if (msg.type === 'ice_candidate') {
        if (isHost) {
          const peerWs = peers.get(msg.peerId);
          if (peerWs && peerWs.readyState === 1) {
            peerWs.send(JSON.stringify({ type: 'ice_candidate', candidate: msg.candidate }));
          }
        } else if (activeHostWs && activeHostWs.readyState === 1) {
          activeHostWs.send(JSON.stringify({
            type: 'ice_candidate',
            peerId: myPeerId,
            candidate: msg.candidate
          }));
        }
      }
    } catch (e) {
      console.warn('Signaling error:', e);
    }
  });

  ws.on('close', () => {
    if (isHost && activeHostWs === ws) {
      activeHostWs = null;
      activeHostInfo = null;
      for (const [id, peerWs] of peers) {
        if (peerWs.readyState === 1) {
          peerWs.send(JSON.stringify({ type: 'host_disconnected' }));
        }
      }
      peers.clear();
    } else if (myPeerId) {
      peers.delete(myPeerId);
      if (activeHostWs && activeHostWs.readyState === 1) {
        activeHostWs.send(JSON.stringify({ type: 'peer_disconnected', peerId: myPeerId }));
      }
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`L-Town PWA running at http://0.0.0.0:${PORT}`);
  console.log(`LAN Access available at http://${getLocalIp()}:${PORT}`);
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});
