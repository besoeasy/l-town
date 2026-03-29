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

function randomSpawn() {
  return { ...MAP.spawns[Math.floor(Math.random() * MAP.spawns.length)] };
}

const VALID_CHARS = ['telepotu', 'chumantr', 'denja', 'mednix', 'tank', 'anchor'];

function makePlayer(id, name, character = 'telepotu') {
  const s = randomSpawn();
  const maxHp = character === 'denja' ? CFG.MAX_HEALTH * 0.75
              : character === 'tank'  ? CFG.MAX_HEALTH * 2
              : CFG.MAX_HEALTH;
  return {
    id, name,
    character,
    x: s.x, y: s.y, z: s.z,
    yaw: 0, pitch: 0,
    health:      maxHp,
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
    lastAbilityAt:  0,
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
  // Shield / Anchor absorbs all damage
  if (p.shieldActive && Date.now() < p.shieldEnd) return;
  p.lastHitTime = Date.now();
  p.health -= dmg;
  // Notify the hit player directly so the client can show a flash
  if (p.ws?.readyState === 1) {
    p.ws.send(JSON.stringify({ type: 'hit' }));
  }
  // Notify the shooter so they get a crosshair hit-marker
  const shooter = players.get(shooterId);
  if (shooter?.ws?.readyState === 1) {
    shooter.ws.send(JSON.stringify({ type: 'hitConfirm' }));
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
    applyDamage(hit.id, CFG.DMG_SINGLE * mult * distMult, player.id);
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
    if (!p.alive) {
      if (p.respawnAt > 0 && now >= p.respawnAt) {
        const s = randomSpawn();
        Object.assign(p, {
          x: s.x, y: s.y, z: s.z,
          health: p.character === 'denja' ? CFG.MAX_HEALTH / 2
               : p.character === 'tank'  ? CFG.MAX_HEALTH * 2
               : CFG.MAX_HEALTH,
          superActive: false, superEnd: 0,
          shieldActive: false, shieldEnd: 0,
          invisible: false, invisibleEnd: 0,
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
    if (now - p.lastHitTime > CFG.REGEN_DELAY) {
      const rate   = (p.crouching ? 3 : 1) * dt;
      const regenCap = p.character === 'tank' ? CFG.MAX_HEALTH * 2 : CFG.MAX_HEALTH;
      if (p.health < regenCap) p.health = Math.min(regenCap, p.health + rate);
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
    // Denja: health permanently capped at half max
    if (p.character === 'denja' && p.health > CFG.MAX_HEALTH / 2)
      p.health = CFG.MAX_HEALTH / 2;
    // Tank: health permanently capped at double max
    if (p.character === 'tank' && p.health > CFG.MAX_HEALTH * 2)
      p.health = CFG.MAX_HEALTH * 2;
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
      ws.send(JSON.stringify({
        type:     'welcome',
        playerId: id,
        seed:     MAP_SEED,
        cfg:      CFG,
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
      const denjaMult = player.character === 'denja' ? 2   : 1;
      const tankMult  = player.character === 'tank'  ? 0.5 : 1;
      const speed = (player.crouching ? CFG.CROUCH_SPEED
                  : msg.run          ? CFG.RUN_SPEED
                  : CFG.PLAYER_SPEED) * superMult * airMult * denjaMult * tankMult;
      if (len > 0) {
        mx = (mx / len) * speed * dt;
        mz = (mz / len) * speed * dt;
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
    if (msg.type === 'reload') {
      if (player.alive && !player.isReloading && player.ammo < CFG.MAG_SIZE)
        triggerReload(player);
      return;
    }

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
    if (msg.type === 'super') {
      const superCost = player.character === 'anchor' ? Math.floor(CFG.SUPER_COST * 0.5) : CFG.SUPER_COST;
      if (player.alive && !player.superActive && player.health >= superCost + 1) {
        player.health     -= superCost;
        player.superActive = true;
        player.superEnd    = Date.now() + CFG.SUPER_DURATION;
      }
      return;
    }

    // ── SHIELD ────────────────────────────────────────────────────────────
    if (msg.type === 'shield') {
      const _now = Date.now();
      const shieldCost = player.character === 'anchor' ? Math.floor(CFG.SHIELD_COST * 0.5) : CFG.SHIELD_COST;
      if (player.alive && !player.shieldActive && player.health >= shieldCost + 1
          && _now - player.lastShieldAt >= 15000) { // 15-second cooldown between activations
        player.lastShieldAt = _now;
        player.health      -= shieldCost;
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
      }
      // denja, tank, and anchor have passive abilities — no active effect
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
    players.delete(id);
    if (players.size === 0 && matchActive) {
      clearTimeout(matchTimer);
      matchActive = false;
    }
  });

  ws.on('error', () => { /* swallow */ });
});

const PORT = process.env.PORT ?? (USE_TLS ? 443 : 30300);
server.listen(PORT, '0.0.0.0', () =>
  console.log(`L-Town running → ${USE_TLS ? 'https' : 'http'}://0.0.0.0:${PORT}`)
);
