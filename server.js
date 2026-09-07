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

  // API: Nostr debug info
  if (reqPath === '/api/nostr-debug') {
    const subList = [];
    for (const [ws, subs] of nostrSubs) {
      const subEntries = [];
      for (const [subId, filters] of subs) {
        subEntries.push({ subId, filters });
      }
      subList.push({ readyState: ws.readyState, subs: subEntries });
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({
      eventsCount: nostrEvents.length,
      events: nostrEvents.map(e => ({ id: e.id, kind: e.kind, pubkey: e.pubkey, tags: e.tags })),
      clientsCount: nostrSubs.size,
      clients: subList
    }, null, 2));
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

// ── Embedded Lightweight NOSTR Relay (NIP-01) ────────────────────────────────
const nostrEvents = [];
const nostrSubs = new Map(); // ws -> Map(subId -> filter)

function matchNostrFilter(ev, f) {
  if (!ev || !f) return false;
  if (f.ids && !f.ids.includes(ev.id)) return false;
  if (f.authors && !f.authors.includes(ev.pubkey)) return false;
  if (f.kinds && !f.kinds.includes(ev.kind)) return false;
  const tags = Array.isArray(ev.tags) ? ev.tags : [];
  if (f['#t']) {
    const tTags = tags.filter(t => t[0] === 't').map(t => t[1]);
    if (!tTags.some(t => f['#t'].includes(t))) return false;
  }
  if (f['#p']) {
    const pTags = tags.filter(t => t[0] === 'p').map(t => t[1]);
    if (!pTags.some(p => f['#p'].includes(p))) return false;
  }
  return true;
}

function matchAnyFilter(ev, filters) {
  const flist = Array.isArray(filters) ? filters.flat(Infinity) : [filters];
  return flist.some(f => matchNostrFilter(ev, f));
}

function handleNostrConnection(ws) {
  nostrSubs.set(ws, new Map());

  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw.toString());
      const cmd = data[0];

      if (cmd === 'EVENT') {
        const ev = data[1];
        if (ev && ev.id) {
          nostrEvents.push(ev);
          if (nostrEvents.length > 500) nostrEvents.shift();
          ws.send(JSON.stringify(['OK', ev.id, true, '']));

          for (const [subWs, subs] of nostrSubs) {
            if (subWs.readyState === 1) {
              for (const [subId, filters] of subs) {
                if (matchAnyFilter(ev, filters)) {
                  subWs.send(JSON.stringify(['EVENT', subId, ev]));
                }
              }
            }
          }
        }
      } else if (cmd === 'REQ') {
        const subId = data[1];
        const rawFilters = data.length > 2 ? data.slice(2) : [{}];
        const filters = Array.isArray(rawFilters) ? rawFilters.flat(Infinity) : [rawFilters];
        const subs = nostrSubs.get(ws);
        if (subs) subs.set(subId, filters);

        for (const ev of nostrEvents) {
          if (matchAnyFilter(ev, filters)) {
            ws.send(JSON.stringify(['EVENT', subId, ev]));
          }
        }
        ws.send(JSON.stringify(['EOSE', subId]));
      } else if (cmd === 'CLOSE') {
        const subId = data[1];
        const subs = nostrSubs.get(ws);
        if (subs) subs.delete(subId);
      }
    } catch (err) {
      console.warn('NOSTR relay error:', err);
    }
  });

  ws.on('close', () => {
    nostrSubs.delete(ws);
  });
}

// ── LAN WebSocket Signaling Broker ──────────────────────────────────────────
const wss = new WebSocketServer({ server });
let activeHostWs = null;
let activeHostInfo = null;
const peers = new Map(); // peerId -> ws
let nextPeerId = 2;

wss.on('connection', (ws, req) => {
  if (req && req.url && req.url.startsWith('/nostr')) {
    handleNostrConnection(ws);
    return;
  }

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
