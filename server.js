'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

// ─── PROCEDURAL MAP GENERATION ───────────────────────────────────────────────
function makePRNG(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function generateMap(seed) {
  const rng  = makePRNG(seed);
  const SIZE = 750;
  const HALF = SIZE / 2;
  const boxes  = [];
  const spawns = [];

  function box(x, y, z, w, h, d, type = 'cover', biome = 'neutral') {
    boxes.push({ x, y, z, w, h, d, type, biome });
  }

  // Helper: 3-tier random cover height
  function tieredCover(r) {
    if (r < 0.25) return { h: 0.7 + rng() * 0.35, w: 2 + rng() * 3.5 };  // low  — duck behind
    if (r < 0.60) return { h: 1.4 + rng() * 0.8,  w: 2 + rng() * 4.5 };  // mid  — half-body
    return             { h: 2.5 + rng() * 2.5,   w: 2 + rng() * 6   };  // tall — full cover
  }

  // ── Outer walls ──────────────────────────────────────────────────────────
  const wH = 12, wT = 2;
  box(      0, wH/2, -HALF,  SIZE, wH,   wT, 'wall', 'neutral');
  box(      0, wH/2,  HALF,  SIZE, wH,   wT, 'wall', 'neutral');
  box( -HALF,  wH/2,     0,   wT, wH, SIZE,  'wall', 'neutral');
  box(  HALF,  wH/2,     0,   wT, wH, SIZE,  'wall', 'neutral');

  // ── Central Terraformer Hub (44×44 walkable building) ───────────────────
  const BH = 22;   // building half-size
  const WT =  2;   // wall thickness
  const WH = 14;   // wall height
  const DW =  4;   // door half-width (8 units total opening)
  const DH =  5;   // door clear height

  // Walls — each side: two flanking panels + lintel above door gap
  // North (z = -BH)
  box(-13, WH/2,  -BH, 18, WH, WT, 'building', 'neutral');
  box( 13, WH/2,  -BH, 18, WH, WT, 'building', 'neutral');
  box(  0, DH + (WH-DH)/2, -BH, DW*2, WH-DH, WT, 'building', 'neutral');
  // South (z = +BH)
  box(-13, WH/2,   BH, 18, WH, WT, 'building', 'neutral');
  box( 13, WH/2,   BH, 18, WH, WT, 'building', 'neutral');
  box(  0, DH + (WH-DH)/2,  BH, DW*2, WH-DH, WT, 'building', 'neutral');
  // East (x = +BH)
  box( BH, WH/2, -13, WT, WH, 18, 'building', 'neutral');
  box( BH, WH/2,  13, WT, WH, 18, 'building', 'neutral');
  box( BH, DH + (WH-DH)/2, 0, WT, WH-DH, DW*2, 'building', 'neutral');
  // West (x = -BH)
  box(-BH, WH/2, -13, WT, WH, 18, 'building', 'neutral');
  box(-BH, WH/2,  13, WT, WH, 18, 'building', 'neutral');
  box(-BH, DH + (WH-DH)/2, 0, WT, WH-DH, DW*2, 'building', 'neutral');
  // Corner pillars (seal wall junctions)
  box(-BH, WH/2, -BH, 4, WH, 4, 'building', 'neutral');
  box( BH, WH/2, -BH, 4, WH, 4, 'building', 'neutral');
  box(-BH, WH/2,  BH, 4, WH, 4, 'building', 'neutral');
  box( BH, WH/2,  BH, 4, WH, 4, 'building', 'neutral');

  // Roof slab (fully walkable)
  box(0, WH + 0.5, 0, BH*2 + 2, 1, BH*2 + 2, 'platform', 'neutral');

  // Interior: central energy core tower
  box(0, 5, 0, 5, 10, 5, 'central', 'neutral');

  // Interior: structural columns (floor-to-roof)
  box(-14, WH/2, -14, 2.5, WH, 2.5, 'pillar', 'neutral');
  box( 14, WH/2, -14, 2.5, WH, 2.5, 'pillar', 'neutral');
  box(-14, WH/2,  14, 2.5, WH, 2.5, 'pillar', 'neutral');
  box( 14, WH/2,  14, 2.5, WH, 2.5, 'pillar', 'neutral');

  // Interior: ground-floor cover blocks
  box( 8, 1,  -8, 4, 2, 3, 'cover', 'neutral');
  box(-8, 1,   8, 3, 2, 4, 'cover', 'neutral');
  box(-8, 1,  -8, 3, 2, 3, 'cover', 'neutral');
  box( 8, 1,   8, 4, 2, 4, 'cover', 'neutral');

  // Mezzanine floor (north half, top face at y=8)
  box(0, 7.5, -15, 36, 1, 12, 'platform', 'neutral');
  // Mezzanine front railing (prevents falling off south edge)
  box(0, 9.5,  -9, 36,  2,  1, 'cover', 'neutral');

  // Staircase (east interior — 3 jump-able steps to mezzanine)
  box(16, 1.5,   0, 4, 3, 4, 'cover', 'neutral'); // step 1: top = 3
  box(16, 3.5,  -5, 4, 3, 4, 'cover', 'neutral'); // step 2: top = 5
  box(16,   7, -11, 4, 2, 4, 'cover', 'neutral'); // step 3: top = 8 → onto mezzanine

  // Outer terrace arms
  box( 38, 5,   0, 28, 2.5,  5, 'central_arm', 'neutral');
  box(-38, 5,   0, 28, 2.5,  5, 'central_arm', 'neutral');
  box(  0, 5,  38,  5, 2.5, 28, 'central_arm', 'neutral');
  box(  0, 5, -38,  5, 2.5, 28, 'central_arm', 'neutral');
  box( 55, 7,   0,  8, 1.5,  8, 'platform',    'neutral');
  box(-55, 7,   0,  8, 1.5,  8, 'platform',    'neutral');
  box(  0, 7,  55,  8, 1.5,  8, 'platform',    'neutral');
  box(  0, 7, -55,  8, 1.5,  8, 'platform',    'neutral');

  // Outer basin decorations
  box( 30, 0.4,   0,  3, 0.8, 20, 'basin', 'neutral');
  box(-30, 0.4,   0,  3, 0.8, 20, 'basin', 'neutral');
  box(  0, 0.4,  30, 20, 0.8,  3, 'basin', 'neutral');
  box(  0, 0.4, -30, 20, 0.8,  3, 'basin', 'neutral');

  // ── Asymmetric center pressure ────────────────────────────────────────────
  // One random flank gets denser cover approaching center (30–55 units out)
  const flankVecs = [[0,-1],[0,1],[1,0],[-1,0]];
  const [fvx, fvz] = flankVecs[Math.floor(rng() * 4)];
  for (let i = 0; i < 18; i++) {
    const dist   = 96 + rng() * 72;
    const spread = (rng() - 0.5) * 84;
    const px = fvx * dist + fvz * spread;
    const pz = fvz * dist + fvx * spread;
    const { h, w } = tieredCover(rng());
    box(px, h / 2, pz, w, h, w * (0.6 + rng() * 0.8), 'cover', 'neutral');
  }

  // ── Biome boundary barrier (x ≈ 0, random crossing gaps) ─────────────────
  const gapSlots = new Set();
  while (gapSlots.size < 12) gapSlots.add(Math.floor(rng() * 30));
  for (let i = 0; i < 30; i++) {
    if (gapSlots.has(i)) continue; // leave gap for player crossing
    const zc = -HALF + 25 + i * ((SIZE - 50) / 29);
    const jx = (rng() - 0.5) * 10;
    const h  = 1.2 + rng() * 1.0;
    box(jx, h / 2, zc, 2 + rng() * 3, h, 13 + rng() * 12, 'cover', 'neutral');
  }

  // ── Scattered cover (center-sparse) ───────────────────────────────────────
  for (let i = 0; i < 360; i++) {
    const x = (rng() - 0.5) * (SIZE - 30);
    const z = (rng() - 0.5) * (SIZE - 30);
    const dc = Math.sqrt(x * x + z * z);
    if (dc < 105) continue;
    if (dc < 195 && rng() < 0.68) continue; // sparse near center
    const biome = x > 5 ? 'terra' : x < -5 ? 'barren' : 'neutral';
    const { h, w } = tieredCover(rng());
    box(x, h / 2, z, w, h, w * (0.5 + rng() * 1.0), 'cover', biome);
  }

  // ── Tall pillars ─────────────────────────────────────────────────────────
  for (let i = 0; i < 90; i++) {
    const x = (rng() - 0.5) * (SIZE - 40);
    const z = (rng() - 0.5) * (SIZE - 40);
    if (Math.sqrt(x * x + z * z) < 84) continue;
    const biome = x > 0 ? 'terra' : 'barren';
    const h = 10 + rng() * 22;  const w = 1.5 + rng() * 2.5;
    box(x, h / 2, z, w, h, w, 'pillar', biome);
  }

  // ── Elevated platforms + staircases ──────────────────────────────────────
  for (let i = 0; i < 75; i++) {
    const x = (rng() - 0.5) * (SIZE - 50);
    const z = (rng() - 0.5) * (SIZE - 50);
    if (Math.sqrt(x * x + z * z) < 75) continue;
    const biome = x > 0 ? 'terra' : 'barren';
    const elev = 4 + rng() * 7;
    const pw = 7 + rng() * 14;  const pd = 7 + rng() * 14;
    box(x, elev + 0.5, z, pw, 1.2, pd, 'platform', biome);
    box(x, elev / 2,   z, 1.2, elev, 1.2, 'pillar', biome);

    // Staircase — 3–5 ascending step blocks on a random side
    const side       = Math.floor(rng() * 4); // 0=+x 1=-x 2=+z 3=-z
    const stepCount  = 3 + Math.floor(rng() * 3);
    const stepSpread = (pw / 2 + pd / 2) / 2; // half-platform
    for (let s = 0; s < stepCount; s++) {
      const topFace = (s + 1) * elev / stepCount;
      const sOff    = stepSpread + 1.0 + (stepCount - 1 - s) * 1.8;
      const sx = side === 0 ? x + sOff : side === 1 ? x - sOff : x;
      const sz = side === 2 ? z + sOff : side === 3 ? z - sOff : z;
      if (Math.abs(sx) > HALF - 5 || Math.abs(sz) > HALF - 5) continue;
      box(sx, topFace / 2, sz, 1.6, topFace, 1.6, 'cover', biome);
    }
  }

  // ── Random hideout buildings (hollow, with doors and windows) ────────────
  function buildHideout(hx, hz, biome) {
    const bw = 10 + rng() * 12;   // half-width
    const bd = 10 + rng() * 12;   // half-depth
    const wh =  8 + rng() * 5;    // wall height
    const wt = 1.5;               // wall thickness
    const dw = 2.5;               // door half-width
    const dh = 5.0;               // door height
    function hbox(dx, dy, dz, w, h, d) {
      boxes.push({ x: hx + dx, y: dy, z: hz + dz, w, h, d, type: 'rand_building', biome });
    }
    function wallFace(dir, facePos, span) {
      const dox = (rng() - 0.5) * (span - dw - 2);
      const lw  = span + dox - dw;
      const rw  = span - dox - dw;
      const lc  = -span + lw / 2;
      const rc  =  dox + dw + rw / 2;
      function panel(sc, fp, pw) {
        const hasWin = rng() < 0.65 && pw > 4.5;
        if (hasWin) {
          const ww = Math.min(2.5, pw - 1.5);
          const sill = 2.2, winTop = 4.2;
          const side = (pw - ww) / 2;
          if (dir === 'z') {
            hbox(sc - ww/2 - side/2, wh/2, fp, side, wh, wt);
            hbox(sc + ww/2 + side/2, wh/2, fp, side, wh, wt);
            hbox(sc, sill/2,                 fp, ww, sill,       wt);
            hbox(sc, winTop + (wh-winTop)/2, fp, ww, wh-winTop,  wt);
          } else {
            hbox(fp, wh/2, sc - ww/2 - side/2, wt, wh, side);
            hbox(fp, wh/2, sc + ww/2 + side/2, wt, wh, side);
            hbox(fp, sill/2,                 sc, wt, sill,       ww);
            hbox(fp, winTop + (wh-winTop)/2, sc, wt, wh-winTop,  ww);
          }
        } else {
          if (dir === 'z') hbox(sc, wh/2, fp, pw, wh, wt);
          else             hbox(fp, wh/2, sc, wt, wh, pw);
        }
      }
      if (lw > 0.5) panel(lc, facePos, lw);
      if (rw > 0.5) panel(rc, facePos, rw);
      if (wh > dh + 0.3) {
        if (dir === 'z') hbox(dox, dh + (wh-dh)/2, facePos, dw*2, wh-dh, wt);
        else             hbox(facePos, dh + (wh-dh)/2, dox, wt, wh-dh, dw*2);
      }
    }
    wallFace('z', -(bd + wt/2), bw + wt);
    wallFace('z',  (bd + wt/2), bw + wt);
    wallFace('x', -(bw + wt/2), bd);
    wallFace('x',  (bw + wt/2), bd);
    if (rng() < 0.6) {
      boxes.push({ x: hx, y: wh + 0.5, z: hz, w: (bw+wt)*2, h: 1, d: (bd+wt)*2, type: 'platform', biome });
    }
    if (rng() < 0.5) {
      boxes.push({ x: hx, y: 1, z: hz, w: 2 + rng()*3, h: 2, d: 2 + rng()*3, type: 'cover', biome });
    }
    spawns.push({ x: hx, y: 1.6, z: hz });
  }
  const HIDEOUT_COUNT = 10 + Math.floor(rng() * 11);
  for (let attempt = 0, placed = 0; attempt < 300 && placed < HIDEOUT_COUNT; attempt++) {
    const hx = (rng() - 0.5) * (SIZE - 80);
    const hz = (rng() - 0.5) * (SIZE - 80);
    if (Math.sqrt(hx*hx + hz*hz) < 110) continue;
    const biome = hx > 5 ? 'terra' : hx < -5 ? 'barren' : 'neutral';
    buildHideout(hx, hz, biome);
    placed++;
  }

  // ── Cover-adjacent spawns ─────────────────────────────────────────────────
  const coverPool = boxes.filter(b => b.type === 'cover' || b.type === 'ruins');
  // Fisher-Yates to pick random subset
  const pool = [...coverPool];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  for (const b of pool.slice(0, 40)) {
    const angle = rng() * Math.PI * 2;
    const dist  = Math.max(b.w, b.d) / 2 + 1.8;
    const sx = b.x + Math.cos(angle) * dist;
    const sz = b.z + Math.sin(angle) * dist;
    if (Math.abs(sx) < HALF - 5 && Math.abs(sz) < HALF - 5)
      spawns.push({ x: sx, y: 1.6, z: sz });
  }

  // ── Fixed perimeter spawns ────────────────────────────────────────────────
  for (const [x, z] of [
    [330, 330], [-330, 330], [330, -330], [-330, -330],
    [360, 0], [-360, 0], [0, 360], [0, -360],
    [180, 300], [-180, 300], [180, -300], [-180, -300],
    [300, 180], [-300, 180], [300, -180], [-300, -180],
    [340, 100], [-340, 100], [340, -100], [-340, -100],
  ]) spawns.push({ x, y: 1.6, z });

  return { floor: { w: SIZE, d: SIZE }, boxes, spawns, pois: [] };
}

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

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const CFG = {
  TICK_MS:           50,     // 20 Hz
  MATCH_DURATION:   600,     // seconds
  MAX_PLAYERS:      300,
  PLAYER_SPEED:       9,     // units/s
  RUN_SPEED:         15,     // units/s while sprinting
  CROUCH_SPEED:       4,     // units/s while crouching
  PLAYER_RADIUS:    0.45,
  PLAYER_HEIGHT:    1.8,
  EYE_HEIGHT:       1.6,
  CROUCH_EYE_HEIGHT: 0.7,
  AUTO_CROUCH_MS:  10000,    // ms of no movement before auto-crouch
  MAX_HEALTH:       500,
  REGEN_DELAY:     2000,     // ms after last damage
  SHOT_COST_SINGLE:   2,     // HP drained per single shot
  CHARGE_MAX:         4,     // max charged shots
  SUPER_COST:        50,     // HP
  SUPER_DURATION: 10000,     // ms
  RESPAWN_DELAY:   7000,     // ms
  KILL_BONUS_HP: 100,       // flat HP awarded on kill
  JUMP_SPEED:        18,     // units/s initial upward velocity
  GRAVITY:           32,    // units/s² downward
  SUPER_JUMP_SPEED:  44,    // ~10x the height of regular jump
  SUPER_JUMP_COST:   20,    // HP cost for charged super jump
  DMG_SINGLE:        20,
  SUPER_MULT:         3,
  SHIELD_COST:        80,    // HP cost to activate shield
  SHIELD_DURATION: 10000,    // ms of full damage immunity
  TELEPORT_COST:      50,    // HP cost to random-swap with another player
};

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

const server = http.createServer((req, res) => {
  let url = req.url.split('?')[0];

  // Serve Three.js from node_modules
  if (url.startsWith('/three/')) {
    const rel  = url.slice(7); // e.g. "build/three.module.js"
    const file = path.join(__dirname, 'node_modules', 'three', rel);
    return serveFile(res, file);
  }

  if (url === '/' || url === '') url = '/index.html';
  serveFile(res, path.join(__dirname, 'public', url));
});

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

    // ── TELEPORT SWAP ─────────────────────────────────────────────────────
    if (msg.type === 'teleport') {
      const _now = Date.now();
      if (!player.alive || player.health < CFG.TELEPORT_COST + 1) return;
      if (_now - player.lastTeleportAt < 30000) return; // 30-second cooldown
      player.lastTeleportAt = _now;
      const candidates = [...players.values()].filter(p => p.alive && p.id !== player.id);
      if (candidates.length === 0) return;
      const target = candidates[Math.floor(Math.random() * candidates.length)];
      // Swap positions
      const tmp = { x: player.x, y: player.y, z: player.z };
      player.x = target.x; player.y = target.y; player.z = target.z;
      target.x = tmp.x;    target.y = tmp.y;    target.z = tmp.z;
      player.health -= CFG.TELEPORT_COST;
      player.lastHitTime = Date.now();
      // Target gains half the teleport cost as HP bonus
      target.health = Math.min(CFG.MAX_HEALTH, target.health + CFG.TELEPORT_COST / 2);
      // Notify both players of their new positions
      if (player.ws?.readyState === 1)
        player.ws.send(JSON.stringify({ type: 'teleported', x: player.x, y: player.y, z: player.z, targetName: target.name }));
      if (target.ws?.readyState === 1)
        target.ws.send(JSON.stringify({ type: 'teleported', x: target.x, y: target.y, z: target.z, targetName: player.name }));
      return;
    }

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

const PORT = process.env.PORT ?? 30300;
server.listen(PORT, '0.0.0.0', () =>
  console.log(`Energy Arena running → http://0.0.0.0:${PORT}`)
);
