
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

  // ── Boundary walls ────────────────────────────────────────────────────────
  const wH = 12, wT = 2;
  box(      0, wH/2, -HALF,  SIZE, wH,   wT, 'wall', 'neutral');
  box(      0, wH/2,  HALF,  SIZE, wH,   wT, 'wall', 'neutral');
  box( -HALF,  wH/2,     0,   wT, wH, SIZE,  'wall', 'neutral');
  box(  HALF,  wH/2,     0,   wT, wH, SIZE,  'wall', 'neutral');

  // ── Central house building ────────────────────────────────────────────────
  // House body (two-storey)
  box(0, 5, 0, 18, 10, 14, 'house_body', 'neutral');
  // Roof (wedge simulated with a wide flat slab + two side triangles via covers)
  box(0, 11.5, 0, 20, 3, 16, 'house_roof', 'neutral');
  // Chimney
  box(5, 14, -3, 2, 5, 2, 'house_chimney', 'neutral');
  // Front porch platform
  box(0, 0.3, 9, 14, 0.6, 4, 'platform', 'neutral');
  // Porch pillars
  box(-5, 2.5, 11, 1, 5, 1, 'pillar', 'neutral');
  box( 5, 2.5, 11, 1, 5, 1, 'pillar', 'neutral');
  // Porch awning
  box(0, 5.2, 10.5, 13, 0.5, 4, 'platform', 'neutral');
  // Front door
  box(0, 2.5, 7.1, 3, 5, 0.5, 'house_door', 'neutral');
  // Windows (front face)
  box(-5, 6, 7.1, 3, 2.5, 0.4, 'house_window', 'neutral');
  box( 5, 6, 7.1, 3, 2.5, 0.4, 'house_window', 'neutral');
  // Windows (back face)
  box(-5, 6, -7.1, 3, 2.5, 0.4, 'house_window', 'neutral');
  box( 5, 6, -7.1, 3, 2.5, 0.4, 'house_window', 'neutral');
  // Side windows
  box(-9.1, 6, -2, 0.4, 2.5, 3, 'house_window', 'neutral');
  box( 9.1, 6, -2, 0.4, 2.5, 3, 'house_window', 'neutral');
  // Back deck
  box(0, 0.3, -10, 16, 0.6, 6, 'platform', 'neutral');
  // Fence posts around porch
  for (let fx = -6; fx <= 6; fx += 3)
    box(fx, 1.5, 13, 0.5, 3, 0.5, 'cover', 'neutral');
  // Garden flower beds (small low boxes)
  box(-8, 0.4, 9, 4, 0.8, 2, 'garden', 'neutral');
  box( 8, 0.4, 9, 4, 0.8, 2, 'garden', 'neutral');

  // ── Outer courtyard building walls ────────────────────────────────────────
  const BH = 22, WT = 2, WH = 14, DW = 4, DH = 5;
  box(-13, WH/2, -BH, 18, WH, WT, 'building', 'neutral');
  box( 13, WH/2, -BH, 18, WH, WT, 'building', 'neutral');
  box(  0, DH+(WH-DH)/2, -BH, DW*2, WH-DH, WT, 'building', 'neutral');
  box(-13, WH/2,  BH, 18, WH, WT, 'building', 'neutral');
  box( 13, WH/2,  BH, 18, WH, WT, 'building', 'neutral');
  box(  0, DH+(WH-DH)/2, BH, DW*2, WH-DH, WT, 'building', 'neutral');
  box( BH, WH/2, -13, WT, WH, 18, 'building', 'neutral');
  box( BH, WH/2,  13, WT, WH, 18, 'building', 'neutral');
  box( BH, DH+(WH-DH)/2, 0, WT, WH-DH, DW*2, 'building', 'neutral');
  box(-BH, WH/2, -13, WT, WH, 18, 'building', 'neutral');
  box(-BH, WH/2,  13, WT, WH, 18, 'building', 'neutral');
  box(-BH, DH+(WH-DH)/2, 0, WT, WH-DH, DW*2, 'building', 'neutral');
  // Corner pillars
  box(-BH, WH/2, -BH, 4, WH, 4, 'building', 'neutral');
  box( BH, WH/2, -BH, 4, WH, 4, 'building', 'neutral');
  box(-BH, WH/2,  BH, 4, WH, 4, 'building', 'neutral');
  box( BH, WH/2,  BH, 4, WH, 4, 'building', 'neutral');
  // Roof platform on courtyard
  box(0, WH+0.5, 0, BH*2+2, 1, BH*2+2, 'platform', 'neutral');
  // Inner courtyard pillars
  box(-14, WH/2, -14, 2.5, WH, 2.5, 'pillar', 'neutral');
  box( 14, WH/2, -14, 2.5, WH, 2.5, 'pillar', 'neutral');
  box(-14, WH/2,  14, 2.5, WH, 2.5, 'pillar', 'neutral');
  box( 14, WH/2,  14, 2.5, WH, 2.5, 'pillar', 'neutral');

  // ── Near-center cover ─────────────────────────────────────────────────────
  box( 8, 1,  -8, 4, 2, 3, 'cover', 'neutral');
  box(-8, 1,   8, 3, 2, 4, 'cover', 'neutral');
  box(-8, 1,  -8, 3, 2, 3, 'cover', 'neutral');
  box( 8, 1,   8, 4, 2, 4, 'cover', 'neutral');
  box(0, 7.5, -15, 36, 1, 12, 'platform', 'neutral');
  box(0, 9.5,  -9, 36, 2,  1, 'cover', 'neutral');
  box(16, 1.5,  0, 4, 3, 4, 'cover', 'neutral');
  box(16, 3.5, -5, 4, 3, 4, 'cover', 'neutral');
  box(16,   7,-11, 4, 2, 4, 'cover', 'neutral');

  // ── Pathways / road slabs leading to house ────────────────────────────────
  for (let pz = 15; pz < 80; pz += 10)
    box(0, 0.05, pz, 5, 0.1, 8, 'path', 'neutral');
  for (let pz = -15; pz > -80; pz -= 10)
    box(0, 0.05, pz, 5, 0.1, 8, 'path', 'neutral');

  // ── Street lamps along path ───────────────────────────────────────────────
  for (const [lx, lz] of [[-4, 30],[4, 30],[-4, 60],[4, 60],[-4,-30],[4,-30],[-4,-60],[4,-60]]) {
    box(lx, 3, lz, 0.4, 6, 0.4, 'lamp_post', 'neutral');
    box(lx, 6.3, lz, 1.5, 0.5, 0.5, 'lamp_head', 'neutral');
  }

  // ── Fountain at courtyard center-front ───────────────────────────────────
  box(0, 0.5, 17, 8, 1, 8, 'fountain_base', 'neutral');
  box(0, 1.2, 17, 6, 0.4, 6, 'fountain_rim', 'neutral');
  box(0, 1.5, 17, 1.5, 3, 1.5, 'fountain_pillar', 'neutral');

  // ── Benches ───────────────────────────────────────────────────────────────
  for (const [bx, bz, bw, bd] of [
    [-12, 17, 5, 1.5], [12, 17, 5, 1.5],
    [-12,-17, 5, 1.5], [12,-17, 5, 1.5],
  ]) {
    box(bx, 0.6, bz, bw, 1.2, bd, 'bench', 'neutral');
    box(bx, 1.5, bz - bd*0.3, bw, 1.5, 0.3, 'bench', 'neutral');
  }

  // ── Flank corridor cover ──────────────────────────────────────────────────
  const flankVecs = [[0,-1],[0,1],[1,0],[-1,0]];
  const [fvx, fvz] = flankVecs[Math.floor(rng() * 4)];
  for (let i = 0; i < 18; i++) {
    const dist   = 96 + rng() * 72;
    const spread = (rng() - 0.5) * 84;
    const px = fvx * dist + fvz * spread;
    const pz = fvz * dist + fvx * spread;
    const { h, w } = tieredCover(rng());
    box(px, h/2, pz, w, h, w*(0.6+rng()*0.8), 'cover', 'neutral');
  }

  // ── Corridor barriers (z-axis lane) ──────────────────────────────────────
  const gapSlots = new Set();
  while (gapSlots.size < 12) gapSlots.add(Math.floor(rng() * 30));
  for (let i = 0; i < 30; i++) {
    if (gapSlots.has(i)) continue;
    const zc = -HALF + 25 + i * ((SIZE - 50) / 29);
    const jx = (rng() - 0.5) * 10;
    const h  = 1.2 + rng() * 1.0;
    box(jx, h/2, zc, 2+rng()*3, h, 13+rng()*12, 'cover', 'neutral');
  }

  // ── Scattered cover ───────────────────────────────────────────────────────
  for (let i = 0; i < 360; i++) {
    const x = (rng()-0.5)*(SIZE-30), z = (rng()-0.5)*(SIZE-30);
    const dc = Math.sqrt(x*x+z*z);
    if (dc < 105) continue;
    if (dc < 195 && rng() < 0.68) continue;
    const biome = x > 5 ? 'terra' : x < -5 ? 'barren' : 'neutral';
    const { h, w } = tieredCover(rng());
    box(x, h/2, z, w, h, w*(0.5+rng()*1.0), 'cover', biome);
  }

  // ── Tall pillars ──────────────────────────────────────────────────────────
  for (let i = 0; i < 90; i++) {
    const x = (rng()-0.5)*(SIZE-40), z = (rng()-0.5)*(SIZE-40);
    if (Math.sqrt(x*x+z*z) < 84) continue;
    const biome = x > 0 ? 'terra' : 'barren';
    const h = 10+rng()*22, w = 1.5+rng()*2.5;
    box(x, h/2, z, w, h, w, 'pillar', biome);
  }

  // ── Elevated platforms with stairs ───────────────────────────────────────
  for (let i = 0; i < 75; i++) {
    const x = (rng()-0.5)*(SIZE-50), z = (rng()-0.5)*(SIZE-50);
    if (Math.sqrt(x*x+z*z) < 75) continue;
    const biome = x > 0 ? 'terra' : 'barren';
    const elev = 4+rng()*7, pw = 7+rng()*14, pd = 7+rng()*14;
    box(x, elev+0.5, z, pw, 1.2, pd, 'platform', biome);
    box(x, elev/2,   z, 1.2, elev, 1.2, 'pillar', biome);
    const side = Math.floor(rng()*4), stepCount = 3+Math.floor(rng()*3);
    const stepSpread = (pw/2+pd/2)/2;
    for (let s = 0; s < stepCount; s++) {
      const topFace = (s+1)*elev/stepCount;
      const sOff    = stepSpread+1.0+(stepCount-1-s)*1.8;
      const sx = side===0 ? x+sOff : side===1 ? x-sOff : x;
      const sz = side===2 ? z+sOff : side===3 ? z-sOff : z;
      if (Math.abs(sx) > HALF-5 || Math.abs(sz) > HALF-5) continue;
      box(sx, topFace/2, sz, 1.6, topFace, 1.6, 'cover', biome);
    }
  }

  // ── Hideout buildings ─────────────────────────────────────────────────────
  function buildHideout(hx, hz, biome) {
    const bw = 10+rng()*12, bd = 10+rng()*12, wh = 8+rng()*5, wt = 1.5, dw = 2.5, dh = 5.0;
    function hbox(dx, dy, dz, w, h, d) {
      boxes.push({ x: hx+dx, y: dy, z: hz+dz, w, h, d, type: 'rand_building', biome });
    }
    function wallFace(dir, facePos, span) {
      const dox = (rng()-0.5)*(span-dw-2);
      const lw = span+dox-dw, rw = span-dox-dw;
      const lc = -span+lw/2, rc = dox+dw+rw/2;
      function panel(sc, fp, pw) {
        const hasWin = rng() < 0.65 && pw > 4.5;
        if (hasWin) {
          const ww = Math.min(2.5, pw-1.5), sill = 2.2, winTop = 4.2, side = (pw-ww)/2;
          if (dir === 'z') {
            hbox(sc-ww/2-side/2, wh/2, fp, side, wh, wt);
            hbox(sc+ww/2+side/2, wh/2, fp, side, wh, wt);
            hbox(sc, sill/2, fp, ww, sill, wt);
            hbox(sc, winTop+(wh-winTop)/2, fp, ww, wh-winTop, wt);
          } else {
            hbox(fp, wh/2, sc-ww/2-side/2, wt, wh, side);
            hbox(fp, wh/2, sc+ww/2+side/2, wt, wh, side);
            hbox(fp, sill/2, sc, wt, sill, ww);
            hbox(fp, winTop+(wh-winTop)/2, sc, wt, wh-winTop, ww);
          }
        } else {
          if (dir === 'z') hbox(sc, wh/2, fp, pw, wh, wt);
          else             hbox(fp, wh/2, sc, wt, wh, pw);
        }
      }
      if (lw > 0.5) panel(lc, facePos, lw);
      if (rw > 0.5) panel(rc, facePos, rw);
      if (wh > dh+0.3) {
        if (dir === 'z') hbox(dox, dh+(wh-dh)/2, facePos, dw*2, wh-dh, wt);
        else             hbox(facePos, dh+(wh-dh)/2, dox, wt, wh-dh, dw*2);
      }
    }
    wallFace('z', -(bd+wt/2), bw+wt);
    wallFace('z',  (bd+wt/2), bw+wt);
    wallFace('x', -(bw+wt/2), bd);
    wallFace('x',  (bw+wt/2), bd);
    if (rng() < 0.6)
      boxes.push({ x: hx, y: wh+0.5, z: hz, w: (bw+wt)*2, h: 1, d: (bd+wt)*2, type: 'platform', biome });
    if (rng() < 0.5)
      boxes.push({ x: hx, y: 1, z: hz, w: 2+rng()*3, h: 2, d: 2+rng()*3, type: 'cover', biome });
    spawns.push({ x: hx, y: 1.6, z: hz });
  }

  const HIDEOUT_COUNT = 10 + Math.floor(rng() * 11);
  for (let attempt = 0, placed = 0; attempt < 300 && placed < HIDEOUT_COUNT; attempt++) {
    const hx = (rng()-0.5)*(SIZE-80), hz = (rng()-0.5)*(SIZE-80);
    if (Math.sqrt(hx*hx+hz*hz) < 110) continue;
    const biome = hx > 5 ? 'terra' : hx < -5 ? 'barren' : 'neutral';
    buildHideout(hx, hz, biome);
    placed++;
  }

  // ── Spawn points ──────────────────────────────────────────────────────────
  const coverPool = boxes.filter(b => b.type === 'cover' || b.type === 'ruins');
  const pool = [...coverPool];
  for (let i = pool.length-1; i > 0; i--) {
    const j = Math.floor(rng()*(i+1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  for (const b of pool.slice(0, 40)) {
    const angle = rng()*Math.PI*2, dist = Math.max(b.w, b.d)/2+1.8;
    const sx = b.x+Math.cos(angle)*dist, sz = b.z+Math.sin(angle)*dist;
    if (Math.abs(sx) < HALF-5 && Math.abs(sz) < HALF-5)
      spawns.push({ x: sx, y: 1.6, z: sz });
  }
  for (const [x, z] of [
    [330,330],[-330,330],[330,-330],[-330,-330],
    [360,0],[-360,0],[0,360],[0,-360],
    [180,300],[-180,300],[180,-300],[-180,-300],
    [300,180],[-300,180],[300,-180],[-300,-180],
    [340,100],[-340,100],[340,-100],[-340,-100],
  ]) spawns.push({ x, y: 1.6, z });

  return { floor: { w: SIZE, d: SIZE }, boxes, spawns, pois: [] };
}

// ─── MAP BUILD ────────────────────────────────────────────────────────────────

export function buildMap(scene, map) {
  const SIZE = map.floor.w;

  let _s = (map.boxes.length * 31 + map.spawns.length * 97 + 12345) >>> 0;
  function rng() {
    _s = (Math.imul(1664525, _s) + 1013904223) >>> 0;
    return _s / 0x100000000;
  }

  // ── Lighting ─────────────────────────────────────────────────────────────
  // Removed from here — add in your scene setup instead:
  //   scene.add(new THREE.AmbientLight(0xfff5e0, 0.75));
  //   const sun = new THREE.DirectionalLight(0xffe8a0, 1.4);
  //   sun.position.set(80, 120, 60);
  //   sun.castShadow = true;
  //   scene.add(sun);

  // ── Ground (biome split) ──────────────────────────────────────────────────
  // Terra side (+x): lush green
  const groundTerra = new THREE.Mesh(
    new THREE.PlaneGeometry(SIZE / 2 + 60, SIZE + 60),
    new THREE.MeshLambertMaterial({ color: 0x52a828 })
  );
  groundTerra.rotation.x = -Math.PI / 2;
  groundTerra.position.set(SIZE / 4, 0, 0);
  groundTerra.receiveShadow = true;
  scene.add(groundTerra);

  // Barren side (-x): warm sandy brown
  const groundBarren = new THREE.Mesh(
    new THREE.PlaneGeometry(SIZE / 2 + 60, SIZE + 60),
    new THREE.MeshLambertMaterial({ color: 0xb8925a })
  );
  groundBarren.rotation.x = -Math.PI / 2;
  groundBarren.position.set(-SIZE / 4, 0, 0);
  groundBarren.receiveShadow = true;
  scene.add(groundBarren);

  // Neutral strip in the middle
  const groundMid = new THREE.Mesh(
    new THREE.PlaneGeometry(60, SIZE + 60),
    new THREE.MeshLambertMaterial({ color: 0x6aaa38 })
  );
  groundMid.rotation.x = -Math.PI / 2;
  groundMid.position.set(0, 0, 0);
  groundMid.receiveShadow = true;
  scene.add(groundMid);

  // ── Water ─────────────────────────────────────────────────────────────────
  const waterMat = new THREE.MeshLambertMaterial({ color: 0x2ab8d8 });
  for (const [wx, wz, ww, wd] of [
    [ 80, -75, 38, 26], [ 10, -88, 22, 16], [ 90,  45, 28, 20],
    [ 70,  80, 24, 18], [  0,   0, 26, 26], [-20,  30, 14, 10],
    [ 40, -40, 18, 14],
  ]) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(ww, wd), waterMat);
    w.rotation.x = -Math.PI / 2;
    w.position.set(wx, 0.06, wz);
    scene.add(w);
  }

  // ── Cartoon path/road tiles ───────────────────────────────────────────────
  const pathMat = new THREE.MeshLambertMaterial({ color: 0xe8dfc0 });
  for (const box of map.boxes.filter(b => b.type === 'path')) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(box.w, box.d), pathMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(box.x, 0.07, box.z);
    scene.add(m);
  }

  // ── Material palette ──────────────────────────────────────────────────────
  const M = {
    wall:              new THREE.MeshLambertMaterial({ color: 0x1a2530 }),
    // House-specific materials
    house_body:        new THREE.MeshLambertMaterial({ color: 0xfde8c8 }),
    house_roof:        new THREE.MeshLambertMaterial({ color: 0xd44828 }),
    house_chimney:     new THREE.MeshLambertMaterial({ color: 0xb83820 }),
    house_door:        new THREE.MeshLambertMaterial({ color: 0x7a3810 }),
    house_window:      new THREE.MeshLambertMaterial({ color: 0x8ad4f0 }),
    garden:            new THREE.MeshLambertMaterial({ color: 0x58c840 }),
    fountain_base:     new THREE.MeshLambertMaterial({ color: 0xc8d8e0 }),
    fountain_rim:      new THREE.MeshLambertMaterial({ color: 0xa8c0cc }),
    fountain_pillar:   new THREE.MeshLambertMaterial({ color: 0x90aab8 }),
    bench:             new THREE.MeshLambertMaterial({ color: 0xa0702a }),
    lamp_post:         new THREE.MeshLambertMaterial({ color: 0x2a3848 }),
    lamp_head:         new THREE.MeshLambertMaterial({ color: 0xffe880 }),
    path:              null, // handled as flat plane above
    // Structural
    platform:          new THREE.MeshLambertMaterial({ color: 0x90b8c8 }),
    ruins:             new THREE.MeshLambertMaterial({ color: 0x706050 }),
    building_terra:    new THREE.MeshLambertMaterial({ color: 0xe0f0ff }),
    building_bar:      new THREE.MeshLambertMaterial({ color: 0xf0d8b0 }),
    rand_building_terra: new THREE.MeshLambertMaterial({ color: 0xd8e8c0 }),
    rand_building_bar:   new THREE.MeshLambertMaterial({ color: 0xe0c898 }),
    pillar_terra:      new THREE.MeshLambertMaterial({ color: 0x58a840 }),
    pillar_bar:        new THREE.MeshLambertMaterial({ color: 0xc07848 }),
    pillar_neutral:    new THREE.MeshLambertMaterial({ color: 0x90a8b0 }),
    cover_terra:       new THREE.MeshLambertMaterial({ color: 0x78c858 }),
    cover_bar:         new THREE.MeshLambertMaterial({ color: 0xd09858 }),
    cover_neutral:     new THREE.MeshLambertMaterial({ color: 0x90b0c0 }),
  };

  function getMat(b) {
    const t = b.type, bi = b.biome;
    if (M[t])           return M[t];
    if (t === 'building')        return bi === 'terra' ? M.building_terra : M.building_bar;
    if (t === 'rand_building')   return bi === 'terra' ? M.rand_building_terra : M.rand_building_bar;
    if (t === 'pillar')          return bi === 'terra' ? M.pillar_terra : bi === 'barren' ? M.pillar_bar : M.pillar_neutral;
    return bi === 'terra' ? M.cover_terra : bi === 'barren' ? M.cover_bar : M.cover_neutral;
  }

  // Unified dark navy cartoon outline for all objects
  const OUTLINE_COLOR = 0x1a2840;
  function getEdgeOpacity(b) {
    if (b.type === 'wall')  return 0.12;
    if (b.type === 'path')  return 0;
    if (b.type.startsWith('house_')) return 0.9;
    if (b.type === 'garden' || b.type === 'bench') return 0.7;
    if (b.type === 'fountain_base' || b.type === 'fountain_rim' || b.type === 'fountain_pillar') return 0.6;
    if (b.type === 'lamp_post' || b.type === 'lamp_head') return 0.8;
    if (b.type === 'building' || b.type === 'rand_building') return 0.75;
    if (b.type === 'platform') return 0.55;
    if (b.type === 'pillar')   return 0.65;
    return 0.5;
  }

  // ── Drop shadow helper (flat dark disc under objects) ─────────────────────
  const shadowMat = new THREE.MeshLambertMaterial({
    color: 0x000000, transparent: true, opacity: 0.18, depthWrite: false
  });
  function addShadowDisc(x, z, r) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(r * 2, r * 2), shadowMat);
    s.rotation.x = -Math.PI / 2;
    s.position.set(x, 0.04, z);
    scene.add(s);
  }

  // ── Structural boxes ──────────────────────────────────────────────────────
  for (const box of map.boxes) {
    if (box.type === 'path') continue; // already drawn as flat plane

    const mat = getMat(box);
    if (!mat) continue;

    const geo  = new THREE.BoxGeometry(box.w, box.h, box.d);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(box.x, box.y, box.z);
    mesh.castShadow    = box.type !== 'wall';
    mesh.receiveShadow = true;
    scene.add(mesh);

    // Cartoon outline (thick, dark navy)
    const eo = getEdgeOpacity(box);
    if (eo > 0) {
      const el = new THREE.LineSegments(
        new THREE.EdgesGeometry(geo),
        new THREE.LineBasicMaterial({ color: OUTLINE_COLOR, transparent: true, opacity: eo, linewidth: 2 })
      );
      el.position.copy(mesh.position);
      scene.add(el);
    }

    // Drop shadow for tall/medium objects
    if (box.h > 2 && box.type !== 'wall') {
      const r = (Math.max(box.w, box.d) / 2 + box.h * 0.25) * 0.9;
      addShadowDisc(box.x, box.z, r);
    }
  }

  // ── Lamp glow planes (emissive halo on the ground) ─────────────────────── 
  const glowMat = new THREE.MeshLambertMaterial({
    color: 0xffee60, transparent: true, opacity: 0.18, depthWrite: false
  });
  for (const box of map.boxes.filter(b => b.type === 'lamp_head')) {
    const g = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), glowMat);
    g.rotation.x = -Math.PI / 2;
    g.position.set(box.x, 0.08, box.z);
    scene.add(g);
  }

  // ── Trees ─────────────────────────────────────────────────────────────────
  const trunkMat  = new THREE.MeshLambertMaterial({ color: 0x7a4e28 });
  const cherryMat = new THREE.MeshLambertMaterial({ color: 0xf070a8 });
  const greenMat  = new THREE.MeshLambertMaterial({ color: 0x52b030 });
  const darkGreen = new THREE.MeshLambertMaterial({ color: 0x387820 });
  const autumnMat = new THREE.MeshLambertMaterial({ color: 0xe88030 }); // autumn orange trees

  function addTree(tx, tz, type) {
    const th = 2.5 + rng() * 3.5;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.45, th, 7), trunkMat);
    trunk.position.set(tx, th / 2, tz);
    trunk.castShadow = false;
    scene.add(trunk);

    // Trunk outline
    const tel = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.CylinderGeometry(0.25, 0.45, th, 7)),
      new THREE.LineBasicMaterial({ color: OUTLINE_COLOR, transparent: true, opacity: 0.5 })
    );
    tel.position.copy(trunk.position);
    scene.add(tel);

    let cm;
    if (type === 'cherry')  cm = cherryMat;
    else if (type === 'autumn') cm = autumnMat;
    else cm = rng() > 0.45 ? greenMat : darkGreen;

    const cs = 1.8 + rng() * 2.2;
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(cs, 8, 6), cm);
    canopy.position.set(tx, th + cs * 0.55, tz);
    canopy.castShadow = false;
    scene.add(canopy);

    // Canopy outline
    const cel = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.SphereGeometry(cs, 8, 6)),
      new THREE.LineBasicMaterial({ color: OUTLINE_COLOR, transparent: true, opacity: 0.28 })
    );
    cel.position.copy(canopy.position);
    scene.add(cel);

    // Cherry gets extra canopy puffs
    if (type === 'cherry') {
      for (const [ox, oy, oz, rs] of [
        [ cs*0.55, cs*0.30,  cs*0.35, 0.72],
        [-cs*0.45, cs*0.38, -cs*0.30, 0.58],
        [ cs*0.20, cs*0.50, -cs*0.45, 0.50],
      ]) {
        const c = new THREE.Mesh(new THREE.SphereGeometry(cs * rs, 7, 5), cherryMat);
        c.position.set(tx + ox, th + cs * 0.55 + oy - cs * 0.55, tz + oz);
        scene.add(c);
      }
    }

    // Shadow disc under tree
    addShadowDisc(tx, tz, cs * 1.1);
  }

  // Dense trees on terra side (mix of cherry, green, autumn)
  for (let i = 0; i < 90; i++) {
    const tx = 18 + rng() * 107;
    const tz = (rng() - 0.5) * (SIZE - 20);
    if (Math.sqrt(tx * tx + tz * tz) < 38) continue;
    const type = rng() < 0.35 ? 'cherry' : rng() < 0.2 ? 'autumn' : 'green';
    addTree(tx, tz, type);
  }
  // Sparse scrubby trees on barren side
  for (let i = 0; i < 22; i++)
    addTree(-50 - rng() * 65, (rng() - 0.5) * (SIZE - 30), 'green');

  // ── Boulders / rocks ─────────────────────────────────────────────────────
  const bMats = [
    new THREE.MeshLambertMaterial({ color: 0x6a7858 }),
    new THREE.MeshLambertMaterial({ color: 0x887a68 }),
    new THREE.MeshLambertMaterial({ color: 0x4a5838 }),
  ];
  for (let i = 0; i < 70; i++) {
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
    bm.castShadow    = false;
    bm.receiveShadow = true;
    scene.add(bm);
    // Boulder outline
    const bel = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(bs, 0)),
      new THREE.LineBasicMaterial({ color: OUTLINE_COLOR, transparent: true, opacity: 0.35 })
    );
    bel.position.copy(bm.position);
    bel.rotation.copy(bm.rotation);
    scene.add(bel);
  }

  // ── Decorative flower patches (terra side) ────────────────────────────────
  const flowerColors = [0xf04060, 0xf0c020, 0xa040e0, 0xf080c0];
  for (let i = 0; i < 40; i++) {
    const fx = 30 + rng() * 90, fz = (rng() - 0.5) * (SIZE - 60);
    if (Math.sqrt(fx * fx + fz * fz) < 50) continue;
    const fc = flowerColors[Math.floor(rng() * flowerColors.length)];
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 0.8, 4),
      new THREE.MeshLambertMaterial({ color: 0x48a028 })
    );
    stem.position.set(fx, 0.4, fz);
    scene.add(stem);
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 5, 4),
      new THREE.MeshLambertMaterial({ color: fc })
    );
    head.position.set(fx, 0.9, fz);
    scene.add(head);
  }

  // ── Crates scattered around (extra cover props) ───────────────────────────
  const crateColors = [0xd4a050, 0xc09040, 0xe0b868];
  for (let i = 0; i < 35; i++) {
    const cx = (rng() - 0.5) * (SIZE - 60);
    const cz = (rng() - 0.5) * (SIZE - 60);
    if (Math.sqrt(cx * cx + cz * cz) < 90) continue;
    const cs = 1.2 + rng() * 1.5;
    const cmat = new THREE.MeshLambertMaterial({
      color: crateColors[Math.floor(rng() * crateColors.length)]
    });
    const crate = new THREE.Mesh(new THREE.BoxGeometry(cs, cs, cs), cmat);
    crate.position.set(cx, cs / 2, cz);
    crate.rotation.y = rng() * Math.PI * 0.5;
    crate.castShadow = true;
    scene.add(crate);
    const cel = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(cs, cs, cs)),
      new THREE.LineBasicMaterial({ color: OUTLINE_COLOR, transparent: true, opacity: 0.6 })
    );
    cel.position.copy(crate.position);
    cel.rotation.copy(crate.rotation);
    scene.add(cel);
    addShadowDisc(cx, cz, cs * 0.8);
  }

  // ── Barrels (barren side) ─────────────────────────────────────────────────
  const barrelMat = new THREE.MeshLambertMaterial({ color: 0x604828 });
  for (let i = 0; i < 20; i++) {
    const bx = -(40 + rng() * 100), bz = (rng() - 0.5) * (SIZE - 80);
    if (Math.sqrt(bx * bx + bz * bz) < 80) continue;
    const br = 0.6 + rng() * 0.4, bh = 1.4 + rng() * 0.6;
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(br, br, bh, 10), barrelMat);
    barrel.position.set(bx, bh / 2, bz);
    barrel.castShadow = true;
    scene.add(barrel);
    const bel = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.CylinderGeometry(br, br, bh, 10)),
      new THREE.LineBasicMaterial({ color: OUTLINE_COLOR, transparent: true, opacity: 0.55 })
    );
    bel.position.copy(barrel.position);
    scene.add(bel);
  }

  // ── Fence lines (barren side boundary) ───────────────────────────────────
  const fencePostMat = new THREE.MeshLambertMaterial({ color: 0x9a7040 });
  const fenceRailMat = new THREE.MeshLambertMaterial({ color: 0x8a6030 });
  for (let fz = -300; fz < 300; fz += 10) {
    const fx = -120;
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 3, 0.5), fencePostMat);
    post.position.set(fx, 1.5, fz);
    scene.add(post);
    if (fz < 290) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, 10), fenceRailMat);
      rail.position.set(fx, 1.8, fz + 5);
      scene.add(rail);
      const rail2 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, 10), fenceRailMat);
      rail2.position.set(fx, 1.0, fz + 5);
      scene.add(rail2);
    }
  }
}