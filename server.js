#!/usr/bin/env node
// ─── PROCEDURAL MAP GENERATION ───────────────────────────────────────────────
import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { makePRNG } from './public/modules/utls.js';
import { generateMap } from './public/modules/map.js';
import { CFG } from './public/modules/cfg.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const _now = new Date();
const MAP_SEED = parseInt(
  `${String(_now.getDate()).padStart(2,'0')}${String(_now.getMonth()+1).padStart(2,'0')}${_now.getFullYear()}`,
  10
) >>> 0;
const MAP = generateMap(MAP_SEED);

// ─── SPATIAL BOX INDEX ────────────────────────────────────────────────────────
// Pre-indexes map boxes into 20-unit cells so collision checks are O(~15) not O(600+).
const BOX_CELL = 20;
const _boxGrid = new Map();
(function _buildBoxGrid() {
  for (const box of MAP.boxes) {
    const x0 = Math.floor((box.x - box.w / 2 - 1) / BOX_CELL);
    const x1 = Math.floor((box.x + box.w / 2 + 1) / BOX_CELL);
    const z0 = Math.floor((box.z - box.d / 2 - 1) / BOX_CELL);
    const z1 = Math.floor((box.z + box.d / 2 + 1) / BOX_CELL);
    for (let gx = x0; gx <= x1; gx++) {
      for (let gz = z0; gz <= z1; gz++) {
        const k = (gx + 200) * 1000 + (gz + 200); // unique for range ±199
        let arr = _boxGrid.get(k);
        if (!arr) { arr = []; _boxGrid.set(k, arr); }
        arr.push(box);
      }
    }
  }
})();

function nearbyBoxes(x, z) {
  const cx = Math.floor(x / BOX_CELL);
  const cz = Math.floor(z / BOX_CELL);
  const seen = new Set();
  const out  = [];
  for (let gx = cx - 1; gx <= cx + 1; gx++) {
    for (let gz = cz - 1; gz <= cz + 1; gz++) {
      const arr = _boxGrid.get((gx + 200) * 1000 + (gz + 200));
      if (!arr) continue;
      for (const b of arr) {
        if (!seen.has(b)) { seen.add(b); out.push(b); }
      }
    }
  }
  return out;
}

// ─── STATE ────────────────────────────────────────────────────────────────────
const players = new Map();   // id → player
let nextId      = 1;
let matchActive = false;
let matchStart  = 0;
let matchTimer  = null;

// Reconnect grace: disconnected players keep their unit for 15s.
// Token → { playerId, expiresAt, timeout }. Client stores the token and
// sends `rejoin` on a fresh socket to reclaim the same player.
const RECONNECT_GRACE_MS = 15000;
const pendingReconnects = new Map(); // token → { playerId, expiresAt, timeout }
function makeReconnectToken() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function randomSpawn() {
  return { ...MAP.spawns[Math.floor(Math.random() * MAP.spawns.length)] };
}

const VALID_CHARS = ['telepotu', 'chumantr', 'denja', 'mednix', 'tank', 'anchor', 'surge', 'jinx', 'gambler', 'parasite', 'berserker'];

function makePlayer(id, name, character = 'telepotu') {
  const s = randomSpawn();
  // Standardized: every core uses the same RX-11 chassis —
  // 500 max hull, base speed, fixed SUPER/SHIELD costs.
  // Cores differ ONLY by their Q ability effect.
  return {
    id, name,
    character,
    x: s.x, y: s.y, z: s.z,
    yaw: 0, pitch: 0,
    health:      CFG.MAX_HEALTH,
    superActive:   false,
    superEnd:      0,
    shieldActive:  false,
    shieldEnd:     0,
    score:         0,
    alive:         true,
    respawnAt:     0,
    lastHitTime:   0,

    crouching:    false,
    lastMoveTime: Date.now(),
    vy:           0,
    ws:           null,
    // Anti-abuse: rate-limit state
    lastShot:       0,
    lastTeleportAt: 0,
    lastShieldAt:   0,
    // Class ability
    invisible:      false,
    invisibleEnd:   0,
    overdriveActive: false, // denja Q: 2× speed burst
    overdriveEnd:    0,
    bulwarkActive:   false, // tank Q: 50% damage reduction
    bulwarkEnd:      0,
    aegisActive:     false, // anchor Q: free mini-shield
    aegisEnd:        0,
    leechActive:     false, // parasite Q: leech field burst
    leechEnd:        0,
    rageActive:      false, // berserker Q: +50% dmg / +25% speed burst
    rageEnd:         0,
    lastAbilityAt:  0,
    disconnectedAt:  0, // set on ws close; cleared on rejoin
  };
}

// Push a point out of all obstacle AABBs (horizontal only)
function resolveCollision(x, y, z) {
  const bound = MAP.floor.w / 2 - 0.5;
  x = Math.max(-bound, Math.min(bound, x));
  z = Math.max(-bound, Math.min(bound, z));

  // Three passes handles cases where boxes are tightly clustered
  const _boxes = nearbyBoxes(x, z);
  for (let pass = 0; pass < 3; pass++) {
    for (const box of _boxes) {
      const hw   = box.w / 2 + CFG.PLAYER_RADIUS;
      const hd   = box.d / 2 + CFG.PLAYER_RADIUS;
      const bTop = box.y + box.h / 2;
      const bBot = box.y - box.h / 2;
      // Only block horizontally if player feet are actually inside the box's vertical span
      if (y < bTop && y > bBot) {
        if (Math.abs(x - box.x) < hw && Math.abs(z - box.z) < hd) {
          const dxP = (box.x + hw) - x;
          const dxN = x - (box.x - hw);
          const dzP = (box.z + hd) - z;
          const dzN = z - (box.z - hd);
          const mn = Math.min(dxP, dxN, dzP, dzN);
          if      (mn === dxP) x = box.x + hw;
          else if (mn === dxN) x = box.x - hw;
          else if (mn === dzP) z = box.z + hd;
          else                  z = box.z - hd;
        }
      }
    }
  }
  return { x, y, z };
}

// Ray vs axis-aligned box (slab method). Returns entry t or Infinity if no hit.
// box: { x, y, z, w, h, d } where xyz = center, whd = full dimensions.
function rayVsBox(ox, oy, oz, dx, dy, dz, box) {
  const hx = box.w / 2, hy = box.h / 2, hz = box.d / 2;
  let tmin = -Infinity, tmax = Infinity;
  for (const [o, d, c, h] of [[ox, dx, box.x, hx], [oy, dy, box.y, hy], [oz, dz, box.z, hz]]) {
    if (Math.abs(d) < 1e-9) {
      if (o < c - h || o > c + h) return Infinity; // parallel & outside
    } else {
      const t1 = (c - h - o) / d;
      const t2 = (c + h - o) / d;
      tmin = Math.max(tmin, Math.min(t1, t2));
      tmax = Math.min(tmax, Math.max(t1, t2));
      if (tmin > tmax) return Infinity;
    }
  }
  if (tmax < 0) return Infinity; // box behind ray
  return tmin >= 0 ? tmin : 0;
}

// Hitscan ray vs player sphere-capsule; returns closest hit or null
function raycastPlayers(shooterId, ox, oy, oz, dx, dy, dz) {
  let best = null;
  for (const [id, p] of players) {
    if (id === shooterId || !p.alive) continue;
    const py = p.y + CFG.PLAYER_HEIGHT * 0.5;
    const cx = p.x - ox, cy = py - oy, cz = p.z - oz;
    const t = cx * dx + cy * dy + cz * dz;
    if (t < 0 || t > 120) continue;
    const ex = ox + t * dx - p.x;
    const ey = oy + t * dy - py;
    const ez = oz + t * dz - p.z;
    const r2 = ex * ex + ey * ey * 0.4 + ez * ez; // lenient vertical hit
    if (r2 < 0.6 * 0.6 && (!best || t < best.t)) best = { id, t };
  }
  // Reject if any map box blocks the line of sight
  if (best) {
    for (const box of MAP.boxes) {
      const bt = rayVsBox(ox, oy, oz, dx, dy, dz, box);
      if (bt < best.t - 0.1) { best = null; break; }
    }
  }
  return best;
}

function applyDamage(targetId, dmg, shooterId) {
  const p = players.get(targetId);
  if (!p || !p.alive) return;
  // Shield absorbs all damage
  if (p.shieldActive && Date.now() < p.shieldEnd) return;
  // Anchor aegis Q: 3s of full immunity
  if (p.aegisActive && Date.now() < p.aegisEnd) return;
  // Tank bulwark Q: 50% damage reduction while active
  if (p.bulwarkActive && Date.now() < p.bulwarkEnd) dmg *= 0.5;
  p.lastHitTime = Date.now();
  p.health -= dmg;
  // Notify the hit player directly so the client can show a flash
  if (p.ws?.readyState === 1) {
    p.ws.send(JSON.stringify({ type: 'hit', amount: Math.round(dmg) }));
  }
  // Notify the shooter so they get a crosshair hit-marker + damage number
  const shooter = players.get(shooterId);
  if (shooter?.ws?.readyState === 1) {
    shooter.ws.send(JSON.stringify({ type: 'hitConfirm', amount: Math.round(dmg), targetName: p.name, killed: p.health <= 0 }));
  }
  if (p.health <= 0) {
    p.health   = 0;
    p.alive    = false;
    p.respawnAt = Date.now() + CFG.RESPAWN_DELAY;
    const killer = players.get(shooterId);
    if (killer) {
      killer.score++;
      killer.health = Math.min(CFG.MAX_HEALTH, killer.health + CFG.KILL_BONUS_HP);
    }
    broadcast({
      type:        'kill',
      shooterId,
      targetId,
      shooterName: killer?.name ?? '?',
      targetName:  p.name,
    });
    // ── JINX: death curse — punish the killer
    if (p.character === 'jinx' && killer && killer.alive && killer.id !== p.id) {
      const curseDmg = 80;
      killer.health -= curseDmg;
      killer.lastHitTime = Date.now();
      if (killer.ws?.readyState === 1) killer.ws.send(JSON.stringify({ type: 'jinxCurse', amount: curseDmg, fromName: p.name }));
      if (killer.health <= 0) {
        killer.health = 0; killer.alive = false;
        killer.respawnAt = Date.now() + CFG.RESPAWN_DELAY;
        broadcast({ type: 'kill', shooterId: p.id, targetId: killer.id, shooterName: p.name + ' ☠️', targetName: killer.name });
      }
    }
  }
}

function fireRay(player) {
  const mult = player.superActive ? CFG.SUPER_MULT : 1;
  const yaw = player.yaw, pitch = player.pitch;
  const dx  = -Math.cos(pitch) * Math.sin(yaw);
  const dy  =  Math.sin(pitch);
  const dz  = -Math.cos(pitch) * Math.cos(yaw);
  const ox  = player.x, oy = player.y + CFG.EYE_HEIGHT, oz = player.z;
  const hit = raycastPlayers(player.id, ox, oy, oz, dx, dy, dz);
  if (hit) {
    // Damage falloff: full damage up close, 25% minimum at max range (120 units)
    const distMult = Math.max(0.25, 1 - hit.t / 160);
    // Berserker Q rage: +50% damage while burst is active. Same base damage otherwise.
    const rageMult = (player.character === 'berserker' && player.rageActive && Date.now() < player.rageEnd)
      ? 1.5 : 1;
    applyDamage(hit.id, CFG.DMG_SINGLE * mult * distMult * rageMult, player.id);
  }
}

function processShot(player) {
  if (!player.alive) return;
  if (player.invisible) return; // chumantr can't shoot while cloaked
  if (player.shieldActive && Date.now() < player.shieldEnd) return; // can't shoot while shielded
  if (player.superActive && Date.now() > player.superEnd) player.superActive = false;

  // Rate-limit shots to prevent cheat-spam
  const now = Date.now();
  if (now - player.lastShot < 80) return;
  player.lastShot = now;

  if (player.health <= CFG.SHOT_COST_SINGLE) return; // not enough energy
  player.health -= CFG.SHOT_COST_SINGLE;
  player.lastHitTime = now;
  fireRay(player);
}

function processChargedShot(player, count) {
  if (!player.alive) return;
  if (player.invisible) return;
  if (player.shieldActive && Date.now() < player.shieldEnd) return;
  if (player.superActive && Date.now() > player.superEnd) player.superActive = false;

  const now = Date.now();
  if (now - player.lastShot < 100) return;
  player.lastShot = now;

  const shots     = Math.min(Math.max(1, count | 0), CFG.CHARGE_MAX);
  const totalCost = shots * CFG.SHOT_COST_SINGLE;
  if (player.health <= totalCost) return;
  player.health    -= totalCost;
  player.lastHitTime = now;
  for (let i = 0; i < shots; i++) fireRay(player);
}

// ─── MATCH ────────────────────────────────────────────────────────────────────
function startMatch() {
  matchActive = true;
  matchStart  = Date.now();
  matchTimer  = setTimeout(endMatch, CFG.MATCH_DURATION * 1000);
  broadcast({ type: 'matchStart' });
}

function endMatch() {
  matchActive = false;
  clearTimeout(matchTimer);
  const ranked  = [...players.values()].sort((a, b) => b.score - a.score);
  const winners = ranked.slice(0, 3).map(p => ({ id: p.id, name: p.name, score: p.score }));
  broadcast({ type: 'matchEnd', winners });
}

// ─── TICK ─────────────────────────────────────────────────────────────────────
let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt  = (now - lastTick) / 1000;
  lastTick  = now;
  if (!matchActive) return;

  for (const p of players.values()) {
    // Disconnected units hold position: skip regen/abilities, still vulnerable.
    // Gravity still applies so they don't float if dropped mid-air.
    const holding = !p.ws && p.disconnectedAt > 0;
    if (!p.alive) {
      if (p.respawnAt > 0 && now >= p.respawnAt) {
        const s = randomSpawn();
        Object.assign(p, {
          x: s.x, y: s.y, z: s.z,
          health: Math.floor(CFG.MAX_HEALTH * 0.75),
          superActive: false, superEnd: 0,
          shieldActive: false, shieldEnd: 0,
          invisible: false, invisibleEnd: 0,
          overdriveActive: false, overdriveEnd: 0,
          bulwarkActive: false, bulwarkEnd: 0,
          aegisActive: false, aegisEnd: 0,
          leechActive: false, leechEnd: 0,
          rageActive: false, rageEnd: 0,
          crouching: false, lastMoveTime: Date.now(), vy: 0,
          alive: true, respawnAt: 0,
        });
      }
      continue;
    }

    // Jump / gravity
    const prevY = p.y;
    p.vy -= CFG.GRAVITY * dt;
    p.y  += p.vy * dt;
    // Land on top of boxes when falling
    if (p.vy <= 0) {
      for (const box of nearbyBoxes(p.x, p.z)) {
        const bTop = box.y + box.h / 2;
        const hw   = box.w / 2 + CFG.PLAYER_RADIUS;
        const hd   = box.d / 2 + CFG.PLAYER_RADIUS;
        if (prevY >= bTop - 0.05 && p.y <= bTop &&
            Math.abs(p.x - box.x) < hw && Math.abs(p.z - box.z) < hd) {
          p.y  = bTop;
          p.vy = 0;
          break;
        }
      }
    }
    if (p.y <= 1.6) { p.y = 1.6; p.vy = 0; }

    // Regen (after 3 s of no damage) — 3x when crouching; kill boost stacks
    // Standardized: all cores regen to the same 500 max.
    // Held (disconnected) units don't regen.
    if (!holding && now - p.lastHitTime > CFG.REGEN_DELAY) {
      const rate = (p.crouching ? 3 : 1) * dt;
      if (p.health < CFG.MAX_HEALTH) p.health = Math.min(CFG.MAX_HEALTH, p.health + rate);
    }

    // Auto-crouch after 10 s of no movement
    if (!p.crouching && (now - p.lastMoveTime) >= CFG.AUTO_CROUCH_MS) {
      p.crouching = true;
    }

    // Super timeout
    if (p.superActive && now > p.superEnd) p.superActive = false;
    // Shield timeout
    if (p.shieldActive && now > p.shieldEnd) p.shieldActive = false;
    // Invisible (chumantr) timeout
    if (p.invisible && now > p.invisibleEnd) p.invisible = false;
    // Denja overdrive timeout (Q burst — see classAbility)
    if (p.overdriveActive && now > p.overdriveEnd) p.overdriveActive = false;
    // Tank bulwark timeout (Q shield — see classAbility)
    if (p.bulwarkActive && now > p.bulwarkEnd) p.bulwarkActive = false;
    // Anchor aegis timeout (Q mini-shield — see classAbility)
    if (p.aegisActive && now > p.aegisEnd) p.aegisActive = false;
    // Parasite leech burst timeout (Q — see classAbility)
    if (p.leechActive && now > p.leechEnd) p.leechActive = false;
    // Berserker rage timeout (Q — see classAbility)
    if (p.rageActive && now > p.rageEnd) p.rageActive = false;
    // Parasite Q leech burst: 8 HP/s from enemies within 15u for 6s
    // Held (disconnected) units don't leech.
    if (!holding && p.leechActive && p.alive && now < p.leechEnd) {
      for (const [oid, other] of players) {
        if (oid === p.id || !other.alive) continue;
        const dx = other.x - p.x, dz = other.z - p.z;
        if (Math.sqrt(dx * dx + dz * dz) < 15) {
          const drain = 8 * dt;
          other.health -= drain;
          other.lastHitTime = now;
          p.health = Math.min(p.health + drain, CFG.MAX_HEALTH);
          if (other.health <= 0) {
            other.health = 0; other.alive = false;
            other.respawnAt = now + CFG.RESPAWN_DELAY;
            p.score++;
            p.health = Math.min(CFG.MAX_HEALTH, p.health + CFG.KILL_BONUS_HP);
            broadcast({ type: 'kill', shooterId: p.id, targetId: oid, shooterName: p.name, targetName: other.name });
          }
        }
      }
    }
  }

  // Build full player data once per tick, then send a spatial subset to each player.
  // This reduces network payload by ~20x compared to broadcasting all 300 players.
  const allPlayerData = [...players.values()].map(p => ({
    id: p.id, name: p.name,
    x: p.x, y: p.y, z: p.z, yaw: p.yaw,
    health: p.health,
    superActive: p.superActive, superEnd: p.superEnd,
    shieldActive: p.shieldActive, shieldEnd: p.shieldEnd,
    score: p.score, alive: p.alive, respawnAt: p.respawnAt, crouching: p.crouching,
    character: p.character, invisible: p.invisible, lastAbilityAt: p.lastAbilityAt,
  }));

  const aliveCount = allPlayerData.reduce((n, p) => n + (p.alive ? 1 : 0), 0);
  const hvtId = (() => {
    const alive = allPlayerData.filter(p => p.alive);
    if (alive.length < 2) return null;
    return alive.reduce((best, p) => p.score > best.score ? p : best, alive[0]).id;
  })();

  const leaderboard = [...players.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(p => ({ id: p.id, name: p.name, score: p.score }));

  const stateMsg = JSON.stringify({
    type:              'gameState',
    matchTime:         Math.max(0, CFG.MATCH_DURATION - (now - matchStart) / 1000),
    playerCount:       players.size,
    aliveCount,
    maxPlayers:        CFG.MAX_PLAYERS,
    highValueTargetId: hvtId,
    leaderboard,
    players:           allPlayerData,
  });

  for (const p of players.values()) {
    if (!p.ws || p.ws.readyState !== 1) continue;
    p.ws.send(stateMsg);
  }
}, CFG.TICK_MS);

// ─── HTTP ─────────────────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.mjs':  'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.mp3':  'audio/mpeg',
  '.ogg':  'audio/ogg',
  '.wav':  'audio/wav',
};

function handleRequest(req, res) {
  let url = req.url.split('?')[0];

  // Serve Three.js from node_modules
  if (url.startsWith('/three/')) {
    const rel  = url.slice(7); // e.g. "build/three.module.js"
    const file = path.join(__dirname, 'node_modules', 'three', rel);
    return serveFile(res, file);
  }

  if (url === '/' || url === '') url = '/index.html';
  serveFile(res, path.join(__dirname, 'public', url));
}

const USE_TLS = (process.env.SSL_KEY_PATH && process.env.SSL_CERT_PATH) || (process.env.SSL_KEY && process.env.SSL_CERT);
let server;

if (USE_TLS) {
  let tlsOptions = {};
  try {
    if (process.env.SSL_KEY_PATH && process.env.SSL_CERT_PATH) {
      tlsOptions.key = fs.readFileSync(process.env.SSL_KEY_PATH);
      tlsOptions.cert = fs.readFileSync(process.env.SSL_CERT_PATH);
    } else {
      tlsOptions.key = process.env.SSL_KEY.replace(/\\n/g, '\n');
      tlsOptions.cert = process.env.SSL_CERT.replace(/\\n/g, '\n');
    }
    server = https.createServer(tlsOptions, handleRequest);
  } catch (e) {
    console.error('Failed to load TLS cert/key:', e);
    console.error('Falling back to HTTP.');
    server = http.createServer(handleRequest);
  }
} else {
  server = http.createServer(handleRequest);
}

function serveFile(res, filePath) {
  // Prevent path traversal
  const root = path.resolve(__dirname);
  if (!path.resolve(filePath).startsWith(root)) {
    res.writeHead(403); return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not Found'); }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
    res.end(data);
  });
}

const wss = new WebSocketServer({ server, maxPayload: 4096 });

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(data);
  }
}

wss.on('connection', ws => {
  // Reject connections over capacity immediately (joined + buffered pre-join)
  if (wss.clients.size > CFG.MAX_PLAYERS + 20) {
    ws.close();
    return;
  }

  const id = nextId++;
  let joined = false;
  let player = null;

  // Drop this connection if they never join within 8 seconds
  const _joinTimer = setTimeout(() => { if (!joined) ws.close(); }, 8000);

  ws.on('message', raw => {
    // Per-connection rate limit: max 120 messages per second
    const _now = Date.now();
    if (!ws._msgsReset || _now >= ws._msgsReset) {
      ws._msgs = 0;
      ws._msgsReset = _now + 1000;
    }
    if (++ws._msgs > 120) return; // drop excess — prevents DoS

    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // ── JOIN ──────────────────────────────────────────────────────────────
    if (msg.type === 'join' && !joined) {
      if (players.size >= CFG.MAX_PLAYERS) {
        ws.send(JSON.stringify({ type: 'error', reason: 'Server full' }));
        return ws.close();
      }
      const name = String(msg.name ?? `Player${id}`)
        .slice(0, 20)
        .replace(/[<>&"']/g, '');
      const character = VALID_CHARS.includes(msg.character) ? msg.character : 'telepotu';
      player = makePlayer(id, name, character);
      player.ws = ws;
      players.set(id, player);
      joined = true;
      clearTimeout(_joinTimer);
      if (!matchActive) startMatch();
      const reconnectToken = makeReconnectToken();
      pendingReconnects.set(reconnectToken, { playerId: id, expiresAt: 0, timeout: null });
      ws.send(JSON.stringify({
        type:     'welcome',
        playerId: id,
        seed:     MAP_SEED,
        cfg:      CFG,
        reconnectToken,
        graceMs:  RECONNECT_GRACE_MS,
      }));
      return;
    }

    // ── REJOIN (after a brief disconnect, reclaim the same unit) ──────────
    if (msg.type === 'rejoin' && !joined) {
      const entry = pendingReconnects.get(String(msg.token ?? ''));
      if (!entry) {
        ws.send(JSON.stringify({ type: 'error', reason: 'Reconnect expired — please rejoin' }));
        return ws.close();
      }
      const existing = players.get(entry.playerId);
      if (!existing) {
        pendingReconnects.delete(String(msg.token ?? ''));
        ws.send(JSON.stringify({ type: 'error', reason: 'Reconnect expired — please rejoin' }));
        return ws.close();
      }
      clearTimeout(entry.timeout);
      pendingReconnects.delete(String(msg.token ?? ''));
      player = existing;
      player.ws = ws;
      player.disconnectedAt = 0;
      joined = true;
      clearTimeout(_joinTimer);
      const reconnectToken = makeReconnectToken();
      pendingReconnects.set(reconnectToken, { playerId: player.id, expiresAt: 0, timeout: null });
      ws.send(JSON.stringify({
        type:     'welcome',
        playerId: player.id,
        seed:     MAP_SEED,
        cfg:      CFG,
        reconnectToken,
        graceMs:  RECONNECT_GRACE_MS,
        rejoined: true,
        x: player.x, y: player.y, z: player.z,
      }));
      return;
    }

    if (!joined || !player) return;

    // ── INPUT ─────────────────────────────────────────────────────────────
    if (msg.type === 'input') {
      if (!player.alive || !matchActive) return;
      const dt  = Math.max(0, Math.min(0.1, msg.dt ?? 0.05));
      const yaw = (typeof msg.yaw   === 'number' && isFinite(msg.yaw))   ? msg.yaw   : player.yaw;
      const pit = (typeof msg.pitch === 'number' && isFinite(msg.pitch)) ? msg.pitch : player.pitch;
      player.yaw   = yaw;
      player.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pit));

      let mx = 0, mz = 0;
      if (msg.forward) { mx -= Math.sin(yaw);          mz -= Math.cos(yaw); }
      if (msg.back)    { mx += Math.sin(yaw);          mz += Math.cos(yaw); }
      if (msg.left)    { mx += Math.sin(yaw - Math.PI / 2); mz += Math.cos(yaw - Math.PI / 2); }
      if (msg.right)   { mx += Math.sin(yaw + Math.PI / 2); mz += Math.cos(yaw + Math.PI / 2); }
      const len = Math.sqrt(mx * mx + mz * mz);
      const inAir = player.y > 1.65 && !nearbyBoxes(player.x, player.z).some(box => {
        const bTop = box.y + box.h / 2;
        return Math.abs(player.y - bTop) < 0.15 &&
               Math.abs(player.x - box.x) < box.w / 2 + CFG.PLAYER_RADIUS &&
               Math.abs(player.z - box.z) < box.d / 2 + CFG.PLAYER_RADIUS;
      });
      const superMult = player.superActive ? 1.5 : 1;
      const airMult   = inAir ? 1.2 : 1;
      // Standardized: same base speed for all cores.
      // Denja Q grants a temporary 2× overdrive burst; berserker Q grants
      // +25% speed for 8s. No permanent speed modifiers anywhere.
      const denjaMult = player.overdriveActive && Date.now() < player.overdriveEnd ? 2 : 1;
      const berserkMult = (player.character === 'berserker' && player.rageActive && Date.now() < player.rageEnd)
        ? 1.25 : 1;
      const speed = (player.crouching ? CFG.CROUCH_SPEED
                  : msg.run          ? CFG.RUN_SPEED
                  : CFG.PLAYER_SPEED) * superMult * airMult * denjaMult * berserkMult;
      if (len > 0) {
        mx = (mx / len) * speed * dt;
        mz = (mz / len) * speed * dt;
        // Anti-speedhack: clamp per-tick displacement to max legitimate speed
        const maxSpeed = CFG.RUN_SPEED * 1.5 * 1.2 * 2 * 1.25; // 67.5 u/s — covers super+air+denja+berserker
        const maxDist = maxSpeed * dt + 1e-6;
        const dist = Math.hypot(mx, mz);
        if (dist > maxDist) { const s = maxDist / dist; mx *= s; mz *= s; }
        player.lastMoveTime = Date.now();
        player.crouching    = false; // moving cancels auto-crouch
      }
      const r = resolveCollision(player.x + mx, player.y, player.z + mz);
      player.x = r.x; player.y = r.y; player.z = r.z;
      return;
    }

    // ── SHOOT ─────────────────────────────────────────────────────────────
    if (msg.type === 'shoot') {
      processShot(player);
      return;
    }

    if (msg.type === 'chargedShoot') {
      processChargedShot(player, msg.count);
      return;
    }

    // ── RELOAD ────────────────────────────────────────────────────────────
    // Energy weapon has no reload — handler kept for compat, no-op (was crash: triggerReload undefined)
    if (msg.type === 'reload') return;

    // ── CROUCH ────────────────────────────────────────────────────────────
    if (msg.type === 'crouch') {
      if (player.alive) {
        player.crouching    = !!msg.state;
        if (!player.crouching) player.lastMoveTime = Date.now(); // reset auto-crouch timer
      }
      return;
    }

    // ── JUMP ──────────────────────────────────────────────────────────────
    if (msg.type === 'jump') {
      const canJump = player.y <= 1.65 || nearbyBoxes(player.x, player.z).some(box => {
        const bTop = box.y + box.h / 2;
        return Math.abs(player.y - bTop) < 0.15 &&
               Math.abs(player.x - box.x) < box.w / 2 + CFG.PLAYER_RADIUS &&
               Math.abs(player.z - box.z) < box.d / 2 + CFG.PLAYER_RADIUS;
      });
      if (player.alive && canJump && !player.crouching)
        player.vy = CFG.JUMP_SPEED;
      return;
    }

    // ── SUPER JUMP ────────────────────────────────────────────────────────
    if (msg.type === 'jump_super') {
      const canSuperJump = player.y <= 1.65 || nearbyBoxes(player.x, player.z).some(box => {
        const bTop = box.y + box.h / 2;
        return Math.abs(player.y - bTop) < 0.15 &&
               Math.abs(player.x - box.x) < box.w / 2 + CFG.PLAYER_RADIUS &&
               Math.abs(player.z - box.z) < box.d / 2 + CFG.PLAYER_RADIUS;
      });
      if (player.alive && canSuperJump && !player.crouching
          && player.health > CFG.SUPER_JUMP_COST) {
        player.health -= CFG.SUPER_JUMP_COST;
        player.lastHitTime = Date.now(); // triggers regen delay
        player.vy = CFG.SUPER_JUMP_SPEED;
      }
      return;
    }

    // ── SUPER ─────────────────────────────────────────────────────────────
    // Standardized: fixed 50 hull cost for every core.
    if (msg.type === 'super') {
      if (player.alive && !player.superActive && player.health >= CFG.SUPER_COST + 1) {
        player.health     -= CFG.SUPER_COST;
        player.superActive = true;
        player.superEnd    = Date.now() + CFG.SUPER_DURATION;
      }
      return;
    }

    // ── SHIELD ────────────────────────────────────────────────────────────
    // Standardized: fixed 80 hull cost for every core.
    if (msg.type === 'shield') {
      const _now = Date.now();
      if (player.alive && !player.shieldActive && player.health >= CFG.SHIELD_COST + 1
          && _now - player.lastShieldAt >= 15000) { // 15-second cooldown between activations
        player.lastShieldAt = _now;
        player.health      -= CFG.SHIELD_COST;
        player.shieldActive = true;
        player.shieldEnd    = Date.now() + CFG.SHIELD_DURATION;
        player.lastHitTime  = Date.now(); // pause regen during shield cost
      }
      return;
    }

    // ── CLASS ABILITY (Q key) ─────────────────────────────────────────────
    if (msg.type === 'classAbility') {
      const _now = Date.now();
      if (!player.alive || !matchActive) return;
      if (player.character === 'telepotu') {
        if (_now - player.lastAbilityAt < 60000) return;
        player.lastAbilityAt = _now;
        const candidates = [...players.values()].filter(p => p.alive && p.id !== player.id);
        if (candidates.length === 0) return;
        const target = candidates[Math.floor(Math.random() * candidates.length)];
        const tmp = { x: player.x, y: player.y, z: player.z };
        player.x = target.x; player.y = target.y; player.z = target.z;
        target.x = tmp.x;    target.y = tmp.y;    target.z = tmp.z;
        if (player.ws?.readyState === 1)
          player.ws.send(JSON.stringify({ type: 'teleported', x: player.x, y: player.y, z: player.z, targetName: target.name }));
        if (target.ws?.readyState === 1)
          target.ws.send(JSON.stringify({ type: 'teleported', x: target.x, y: target.y, z: target.z, targetName: player.name }));
      } else if (player.character === 'chumantr') {
        if (_now - player.lastAbilityAt < 30000) return;
        player.lastAbilityAt = _now;
        player.invisible    = true;
        player.invisibleEnd = _now + 10000;
      } else if (player.character === 'mednix') {
        if (_now - player.lastAbilityAt < 20000) return;
        player.lastAbilityAt = _now;
        const restore = Math.floor(Math.random() * 50) + 1;
        player.health = Math.min(player.health + restore, CFG.MAX_HEALTH);
      } else if (player.character === 'surge') {
        if (_now - player.lastAbilityAt < 25000) return;
        // Find nearest alive enemy within 40 units
        let nearest = null, nearestDist = Infinity;
        for (const [id, p] of players) {
          if (id === player.id || !p.alive) continue;
          const dx = p.x - player.x, dz = p.z - player.z;
          const dist = Math.sqrt(dx * dx + dz * dz);
          if (dist < 40 && dist < nearestDist) { nearest = p; nearestDist = dist; }
        }
        if (!nearest) return; // no target in range — don't consume cooldown
        player.lastAbilityAt = _now;
        const drain = Math.min(30, nearest.health - 1); // never kill with drain
        nearest.health -= drain;
        nearest.lastHitTime = _now;
        player.health = Math.min(player.health + drain, CFG.MAX_HEALTH);
        // Notify drained enemy
        if (nearest.ws?.readyState === 1)
          nearest.ws.send(JSON.stringify({ type: 'hit' }));
        // Notify surge player of drain amount
        if (player.ws?.readyState === 1)
          player.ws.send(JSON.stringify({ type: 'surgeDrain', amount: drain, targetName: nearest.name }));
      } else if (player.character === 'gambler') {
        if (_now - player.lastAbilityAt < 45000) return;
        player.lastAbilityAt = _now;
        const roll = Math.random();
        if (roll < 0.333) {
          // Lucky: +200 HP
          player.health = Math.min(player.health + 200, CFG.MAX_HEALTH);
          if (player.ws?.readyState === 1) player.ws.send(JSON.stringify({ type: 'gamblerResult', result: 'heal', amount: 200 }));
        } else if (roll < 0.666) {
          // Wild: teleport onto a random enemy
          const alive = [...players.values()].filter(p => p.alive && p.id !== player.id);
          if (alive.length > 0) {
            const target = alive[Math.floor(Math.random() * alive.length)];
            player.x = target.x; player.y = target.y; player.z = target.z;
            if (player.ws?.readyState === 1) player.ws.send(JSON.stringify({ type: 'gamblerResult', result: 'teleport', x: player.x, y: player.y, z: player.z, targetName: target.name }));
          }
        } else {
          // Doom: instant death — no kill credit awarded
          player.health = 0; player.alive = false;
          player.respawnAt = _now + CFG.RESPAWN_DELAY;
          if (player.ws?.readyState === 1) player.ws.send(JSON.stringify({ type: 'gamblerResult', result: 'death' }));
          broadcast({ type: 'kill', shooterId: player.id, targetId: player.id, shooterName: '🎲 GAMBLE', targetName: player.name });
        }
      } else if (player.character === 'denja') {
        // OVERDRIVE [Q]: 2× speed burst for 8s. Same hull, same costs — pure tempo.
        if (_now - player.lastAbilityAt < 30000) return;
        player.lastAbilityAt = _now;
        player.overdriveActive = true;
        player.overdriveEnd    = _now + 8000;
      } else if (player.character === 'tank') {
        // BULWARK [Q]: 50% damage reduction for 8s. Same 500 hull — timed defense.
        if (_now - player.lastAbilityAt < 35000) return;
        player.lastAbilityAt = _now;
        player.bulwarkActive = true;
        player.bulwarkEnd    = _now + 8000;
      } else if (player.character === 'anchor') {
        // AEGIS [Q]: 3s of full damage immunity, zero hull cost.
        // Same SUPER/SHIELD prices as everyone — this free mini-shield is the perk.
        if (_now - player.lastAbilityAt < 40000) return;
        player.lastAbilityAt = _now;
        player.aegisActive = true;
        player.aegisEnd    = _now + 3000;
      } else if (player.character === 'parasite') {
        // LEECH BURST [Q]: drain 8 hull/s from enemies within 15u for 6s.
        if (_now - player.lastAbilityAt < 30000) return;
        player.lastAbilityAt = _now;
        player.leechActive = true;
        player.leechEnd    = _now + 6000;
      } else if (player.character === 'berserker') {
        // RAGE [Q]: 8s of +50% damage and +25% speed. Passive rage removed —
        // same base stats, this burst is the payoff.
        if (_now - player.lastAbilityAt < 35000) return;
        player.lastAbilityAt = _now;
        player.rageActive = true;
        player.rageEnd    = _now + 8000;
      }
      // jinx has a passive death curse — no active Q effect
      return;
    }

    // Teleport swap removed — use `classAbility` (Q key) which enforces Telepotu-only behavior.

    // ── PING ──────────────────────────────────────────────────────────────
    if (msg.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong', ts: msg.ts }));
      return;
    }

    // ── CHAT ──────────────────────────────────────────────────────────────
    if (msg.type === 'chat') {
      const text = String(msg.text ?? '')
        .slice(0, 120)
        .replace(/[<>&"']/g, c => ({ '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;' }[c]));
      if (!text) return;
      broadcast({ type: 'chatMsg', name: player.name, text });
      return;
    }
  });

  ws.on('close', () => {
    clearTimeout(_joinTimer);
    // Reconnect grace: keep the unit for 15s so a brief disconnect isn't death.
    // The unit holds position (frozen, no input) and can be reclaimed via `rejoin`.
    if (joined && player && players.has(player.id)) {
      player.ws = null;
      player.disconnectedAt = Date.now();
      // Find the token issued for this player and arm its expiry
      for (const [tok, entry] of pendingReconnects) {
        if (entry.playerId === player.id && !entry.timeout) {
          entry.expiresAt = Date.now() + RECONNECT_GRACE_MS;
          entry.timeout = setTimeout(() => {
            pendingReconnects.delete(tok);
            players.delete(player.id);
            if (players.size === 0 && matchActive) {
              clearTimeout(matchTimer);
              matchActive = false;
            }
          }, RECONNECT_GRACE_MS);
          break;
        }
      }
    } else {
      players.delete(id);
      if (players.size === 0 && matchActive) {
        clearTimeout(matchTimer);
        matchActive = false;
      }
    }
  });

  ws.on('error', () => { /* swallow */ });
});

const PORT = process.env.PORT ?? (USE_TLS ? 443 : 30300);
server.listen(PORT, '0.0.0.0', () =>
  console.log(`L-Town running → ${USE_TLS ? 'https' : 'http'}://0.0.0.0:${PORT}`)
);
