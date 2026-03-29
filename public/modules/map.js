import * as THREE from 'three';
import { makePRNG } from './utls.js';

export function generateMap(seed) {
  const rng  = makePRNG(seed);
  const SIZE = 750;
  const HALF = SIZE / 2;
  const boxes  = [];
  const spawns = [];

  function box(x, y, z, w, h, d, type = 'cover', biome = 'neutral') {
    boxes.push({ x, y, z, w, h, d, type, biome });
  }

  function tieredCover(r) {
    if (r < 0.25) return { h: 0.7 + rng() * 0.35, w: 2 + rng() * 3.5 };
    if (r < 0.60) return { h: 1.4 + rng() * 0.8,  w: 2 + rng() * 4.5 };
    return             { h: 2.5 + rng() * 2.5,   w: 2 + rng() * 6   };
  }

  const wH = 12, wT = 2;
  box(      0, wH/2, -HALF,  SIZE, wH,   wT, 'wall', 'neutral');
  box(      0, wH/2,  HALF,  SIZE, wH,   wT, 'wall', 'neutral');
  box( -HALF,  wH/2,     0,   wT, wH, SIZE,  'wall', 'neutral');
  box(  HALF,  wH/2,     0,   wT, wH, SIZE,  'wall', 'neutral');

  const BH = 22;   // building half-size
  const WT =  2;   // wall thickness
  const WH = 14;   // wall height
  const DW =  4;   // door half-width (8 units total opening)
  const DH =  5;   // door clear height

  box(-13, WH/2,  -BH, 18, WH, WT, 'building', 'neutral');
  box( 13, WH/2,  -BH, 18, WH, WT, 'building', 'neutral');
  box(  0, DH + (WH-DH)/2, -BH, DW*2, WH-DH, WT, 'building', 'neutral');
  box(-13, WH/2,   BH, 18, WH, WT, 'building', 'neutral');
  box( 13, WH/2,   BH, 18, WH, WT, 'building', 'neutral');
  box(  0, DH + (WH-DH)/2,  BH, DW*2, WH-DH, WT, 'building', 'neutral');
  box( BH, WH/2, -13, WT, WH, 18, 'building', 'neutral');
  box( BH, WH/2,  13, WT, WH, 18, 'building', 'neutral');
  box( BH, DH + (WH-DH)/2, 0, WT, WH-DH, DW*2, 'building', 'neutral');
  box(-BH, WH/2, -13, WT, WH, 18, 'building', 'neutral');
  box(-BH, WH/2,  13, WT, WH, 18, 'building', 'neutral');
  box(-BH, DH + (WH-DH)/2, 0, WT, WH-DH, DW*2, 'building', 'neutral');
  box(-BH, WH/2, -BH, 4, WH, 4, 'building', 'neutral');
  box( BH, WH/2, -BH, 4, WH, 4, 'building', 'neutral');
  box(-BH, WH/2,  BH, 4, WH, 4, 'building', 'neutral');
  box( BH, WH/2,  BH, 4, WH, 4, 'building', 'neutral');
  box(0, WH + 0.5, 0, BH*2 + 2, 1, BH*2 + 2, 'platform', 'neutral');
  box(0, 5, 0, 5, 10, 5, 'central', 'neutral');
  box(-14, WH/2, -14, 2.5, WH, 2.5, 'pillar', 'neutral');
  box( 14, WH/2, -14, 2.5, WH, 2.5, 'pillar', 'neutral');
  box(-14, WH/2,  14, 2.5, WH, 2.5, 'pillar', 'neutral');
  box( 14, WH/2,  14, 2.5, WH, 2.5, 'pillar', 'neutral');
  box( 8, 1,  -8, 4, 2, 3, 'cover', 'neutral');
  box(-8, 1,   8, 3, 2, 4, 'cover', 'neutral');
  box(-8, 1,  -8, 3, 2, 3, 'cover', 'neutral');
  box( 8, 1,   8, 4, 2, 4, 'cover', 'neutral');
  box(0, 7.5, -15, 36, 1, 12, 'platform', 'neutral');
  box(0, 9.5,  -9, 36,  2,  1, 'cover', 'neutral');
  box(16, 1.5,   0, 4, 3, 4, 'cover', 'neutral');
  box(16, 3.5,  -5, 4, 3, 4, 'cover', 'neutral');
  box(16,   7, -11, 4, 2, 4, 'cover', 'neutral');

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

  const gapSlots = new Set();
  while (gapSlots.size < 12) gapSlots.add(Math.floor(rng() * 30));
  for (let i = 0; i < 30; i++) {
    if (gapSlots.has(i)) continue;
    const zc = -HALF + 25 + i * ((SIZE - 50) / 29);
    const jx = (rng() - 0.5) * 10;
    const h  = 1.2 + rng() * 1.0;
    box(jx, h / 2, zc, 2 + rng() * 3, h, 13 + rng() * 12, 'cover', 'neutral');
  }

  for (let i = 0; i < 360; i++) {
    const x = (rng() - 0.5) * (SIZE - 30);
    const z = (rng() - 0.5) * (SIZE - 30);
    const dc = Math.sqrt(x * x + z * z);
    if (dc < 105) continue;
    if (dc < 195 && rng() < 0.68) continue;
    const biome = x > 5 ? 'terra' : x < -5 ? 'barren' : 'neutral';
    const { h, w } = tieredCover(rng());
    box(x, h / 2, z, w, h, w * (0.5 + rng() * 1.0), 'cover', biome);
  }

  for (let i = 0; i < 90; i++) {
    const x = (rng() - 0.5) * (SIZE - 40);
    const z = (rng() - 0.5) * (SIZE - 40);
    if (Math.sqrt(x * x + z * z) < 84) continue;
    const biome = x > 0 ? 'terra' : 'barren';
    const h = 10 + rng() * 22;
    const w = 1.5 + rng() * 2.5;
    box(x, h / 2, z, w, h, w, 'pillar', biome);
  }

  for (let i = 0; i < 75; i++) {
    const x = (rng() - 0.5) * (SIZE - 50);
    const z = (rng() - 0.5) * (SIZE - 50);
    if (Math.sqrt(x * x + z * z) < 75) continue;
    const biome = x > 0 ? 'terra' : 'barren';
    const elev = 4 + rng() * 7;
    const pw = 7 + rng() * 14;
    const pd = 7 + rng() * 14;
    box(x, elev + 0.5, z, pw, 1.2, pd, 'platform', biome);
    box(x, elev / 2,   z, 1.2, elev, 1.2, 'pillar', biome);
    const side      = Math.floor(rng() * 4);
    const stepCount = 3 + Math.floor(rng() * 3);
    const stepSpread = (pw / 2 + pd / 2) / 2;
    for (let s = 0; s < stepCount; s++) {
      const topFace = (s + 1) * elev / stepCount;
      const sOff    = stepSpread + 1.0 + (stepCount - 1 - s) * 1.8;
      const sx = side === 0 ? x + sOff : side === 1 ? x - sOff : x;
      const sz = side === 2 ? z + sOff : side === 3 ? z - sOff : z;
      if (Math.abs(sx) > HALF - 5 || Math.abs(sz) > HALF - 5) continue;
      box(sx, topFace / 2, sz, 1.6, topFace, 1.6, 'cover', biome);
    }
  }

  function buildHideout(hx, hz, biome) {
    const bw = 10 + rng() * 12;
    const bd = 10 + rng() * 12;
    const wh =  8 + rng() * 5;
    const wt = 1.5;
    const dw = 2.5;
    const dh = 5.0;
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

  const coverPool = boxes.filter(b => b.type === 'cover' || b.type === 'ruins');
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

  for (const [x, z] of [
    [330, 330], [-330, 330], [330, -330], [-330, -330],
    [360, 0], [-360, 0], [0, 360], [0, -360],
    [180, 300], [-180, 300], [180, -300], [-180, -300],
    [300, 180], [-300, 180], [300, -180], [-300, -180],
    [340, 100], [-340, 100], [340, -100], [-340, -100],
  ]) spawns.push({ x, y: 1.6, z });

  return { floor: { w: SIZE, d: SIZE }, boxes, spawns, pois: [] };
}

// ─── MAP BUILD (moved from public/game.js) ───────────────────────────────────

export function buildMap(scene, map) {
  const SIZE = map.floor.w;

  // Seeded RNG from map signature so all clients place decoratives identically
  let _s = (map.boxes.length * 31 + map.spawns.length * 97 + 12345) >>> 0;
  function rng() {
    _s = (Math.imul(1664525, _s) + 1013904223) >>> 0;
    return _s / 0x100000000;
  }

  // ── Bright green ground ───────────────────────────────────────────────────
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(SIZE + 60, SIZE + 60),
    new THREE.MeshLambertMaterial({ color: 0x2d5a18 })
  );
  ground.rotation.x    = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // ── Teal water planes ─────────────────────────────────────────────────────
  const waterMat = new THREE.MeshLambertMaterial({ color: 0x0e8a8a });
  for (const [wx, wz, ww, wd] of [
    [ 80, -75, 38, 26],
    [ 10, -88, 22, 16],
    [ 90,  45, 28, 20],
    [ 70,  80, 24, 18],
    [  0,   0, 26, 26],
    [-20,  30, 14, 10],
    [ 40, -40, 18, 14],
  ]) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(ww, wd), waterMat);
    w.rotation.x = -Math.PI / 2;
    w.position.set(wx, 0.06, wz);
    scene.add(w);
  }

  // ── Structural boxes ──────────────────────────────────────────────────────
  const M = {
    wall:           new THREE.MeshLambertMaterial({ color: 0x0e1418 }),
    central:        new THREE.MeshLambertMaterial({ color: 0x90a8b8, emissive: 0x102030 }),
    central_arm:    new THREE.MeshLambertMaterial({ color: 0x80a0b0, emissive: 0x081820 }),
    basin:          new THREE.MeshLambertMaterial({ color: 0x0e88bb, emissive: 0x003456 }),
    greenhouse:     new THREE.MeshLambertMaterial({ color: 0x5a9858 }),
    platform:       new THREE.MeshLambertMaterial({ color: 0x8098a0 }),
    ruins:          new THREE.MeshLambertMaterial({ color: 0x706050 }),
    building_terra: new THREE.MeshLambertMaterial({ color: 0xc8dce4 }),
    building_bar:        new THREE.MeshLambertMaterial({ color: 0x907868 }),
    rand_building_terra: new THREE.MeshLambertMaterial({ color: 0xd4c8a8 }),
    rand_building_bar:   new THREE.MeshLambertMaterial({ color: 0x7a6858 }),
    pillar_terra:   new THREE.MeshLambertMaterial({ color: 0x527040 }),
    pillar_bar:     new THREE.MeshLambertMaterial({ color: 0x604838 }),
    cover_terra:    new THREE.MeshLambertMaterial({ color: 0xa0b890 }),
    cover_bar:      new THREE.MeshLambertMaterial({ color: 0x807060 }),
    cover_neutral:  new THREE.MeshLambertMaterial({ color: 0x8898a0 }),
  };

  function getMat(b) {
    const t = b.type, bi = b.biome;
    if (t === 'wall')        return M.wall;
    if (t === 'central')     return M.central;
    if (t === 'central_arm') return M.central_arm;
    if (t === 'basin')       return M.basin;
    if (t === 'greenhouse')  return M.greenhouse;
    if (t === 'platform')    return M.platform;
    if (t === 'ruins')       return M.ruins;
    if (t === 'building')       return bi === 'terra' ? M.building_terra      : M.building_bar;
    if (t === 'rand_building') return bi === 'terra' ? M.rand_building_terra : M.rand_building_bar;
    if (t === 'pillar')      return bi === 'terra' ? M.pillar_terra   : M.pillar_bar;
    return bi === 'terra' ? M.cover_terra : bi === 'barren' ? M.cover_bar : M.cover_neutral;
  }

  function edgeStyle(b) {
    const t = b.type, bi = b.biome;
    if (t === 'central' || t === 'central_arm') return [0x44ddff, 0.80];
    if (t === 'basin')                          return [0x22aaff, 0.90];
    if (t === 'greenhouse')                     return [0x88ffaa, 0.55];
    if (t === 'wall')                           return [0x334455, 0.06];
    if (t === 'building' && bi === 'terra')     return [0x88ddff, 0.44];
    if (t === 'building' && bi === 'barren')       return [0xddbb88, 0.36];
    if (t === 'rand_building' && bi === 'terra')  return [0xaaccaa, 0.35];
    if (t === 'rand_building' && bi === 'barren') return [0xccaa88, 0.30];
    if (t === 'rand_building')                    return [0xaabbcc, 0.30];
    if (t === 'ruins')                          return [0xaa8866, 0.28];
    if (t === 'platform')                       return [0x99ccdd, 0.38];
    if (t === 'pillar'   && bi === 'terra')     return [0x88cc66, 0.24];
    if (t === 'pillar'   && bi === 'barren')    return [0xaa8855, 0.20];
    if (bi === 'terra')                         return [0x88dd88, 0.22];
    if (bi === 'barren')                        return [0xbb9977, 0.18];
    return [0x99bbcc, 0.22];
  }

  for (const box of map.boxes) {
    const geo  = new THREE.BoxGeometry(box.w, box.h, box.d);
    const mesh = new THREE.Mesh(geo, getMat(box));
    mesh.position.set(box.x, box.y, box.z);
    mesh.castShadow    = box.type !== 'wall';
    mesh.receiveShadow = true;
    scene.add(mesh);
    const [ec, eo] = edgeStyle(box);
    const el = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: ec, transparent: true, opacity: eo })
    );
    el.position.copy(mesh.position);
    scene.add(el);
  }

  // ── Trees ─────────────────────────────────────────────────────────────────
  const trunkMat  = new THREE.MeshLambertMaterial({ color: 0x5c3d1e });
  const cherryMat = new THREE.MeshLambertMaterial({ color: 0xee88bb });
  const greenMat  = new THREE.MeshLambertMaterial({ color: 0x4a8a28 });
  const darkGreen = new THREE.MeshLambertMaterial({ color: 0x2a5818 });

  function addTree(tx, tz, type) {
    const th = 2.5 + rng() * 3.5;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.38, th, 6), trunkMat);
    trunk.position.set(tx, th / 2, tz);
    trunk.castShadow = false; // decorative — skip shadow map
    scene.add(trunk);
    const cm = type === 'cherry' ? cherryMat : (rng() > 0.45 ? greenMat : darkGreen);
    const cs = 1.8 + rng() * 2.0;
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(cs, 7, 5), cm);
    canopy.position.set(tx, th + cs * 0.55, tz);
    canopy.castShadow = false;
    scene.add(canopy);
    if (type === 'cherry') {
      const c2 = new THREE.Mesh(new THREE.SphereGeometry(cs * 0.72, 6, 4), cherryMat);
      c2.position.set(tx + cs * 0.55, th + cs * 0.30, tz + cs * 0.35);
      scene.add(c2);
      const c3 = new THREE.Mesh(new THREE.SphereGeometry(cs * 0.58, 6, 4), cherryMat);
      c3.position.set(tx - cs * 0.45, th + cs * 0.38, tz - cs * 0.30);
      scene.add(c3);
    }
  }

  // Dense trees on terraformed (+x) side
  for (let i = 0; i < 80; i++) {
    const tx = 18 + rng() * 107;
    const tz = (rng() - 0.5) * (SIZE - 20);
    if (Math.sqrt(tx * tx + tz * tz) < 38) continue;
    addTree(tx, tz, rng() < 0.40 ? 'cherry' : 'green');
  }
  // Sparse trees on barren (-x) side
  for (let i = 0; i < 18; i++)
    addTree(-50 - rng() * 65, (rng() - 0.5) * (SIZE - 30), 'green');
  // ── Moss / rock boulders ──────────────────────────────────────────────────
  const bMats = [
    new THREE.MeshLambertMaterial({ color: 0x4a5838 }),
    new THREE.MeshLambertMaterial({ color: 0x686050 }),
    new THREE.MeshLambertMaterial({ color: 0x384428 }),
  ];
  for (let i = 0; i < 60; i++) {
    const bx = (rng() - 0.5) * (SIZE - 20);
    const bz = (rng() - 0.5) * (SIZE - 20);
    if (Math.sqrt(bx * bx + bz * bz) < 22) continue;
    const bs = 0.7 + rng() * 2.2;
    const bm = new THREE.Mesh(
      new THREE.IcosahedronGeometry(bs, 0),
      bMats[Math.floor(rng() * bMats.length)]
    );
    bm.position.set(bx, bs * 0.55, bz);
    bm.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
    bm.castShadow    = false; // decorative — skip shadow map
    bm.receiveShadow = true;
    scene.add(bm);
  }
}
