
import * as THREE from 'three';
import { makePRNG } from './utls.js';

const SHARED_GEOMETRY = {
  box: new THREE.BoxGeometry(1, 1, 1),
  plane: new THREE.PlaneGeometry(1, 1),
  cylinder: new THREE.CylinderGeometry(0.25, 0.45, 1, 8),
  sphere: new THREE.SphereGeometry(1, 9, 7),
  torus: new THREE.TorusGeometry(1, 0.06, 6, 12),
};

const SHARED_MATERIALS = {
  ground: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0.0 }),
  water: new THREE.MeshStandardMaterial({ color: 0x1a8faa, roughness: 0.15, metalness: 0.3, transparent: true, opacity: 0.82 }),
  path: new THREE.MeshStandardMaterial({ color: 0xd4c8a8, roughness: 0.85, metalness: 0.0 }),
  barrel: new THREE.MeshStandardMaterial({ color: 0x4a3018, roughness: 0.78, metalness: 0.05 }),
  band: new THREE.MeshStandardMaterial({ color: 0x303840, roughness: 0.50, metalness: 0.50 }),
  fencePost: new THREE.MeshStandardMaterial({ color: 0x806040, roughness: 0.88 }),
  fenceRail: new THREE.MeshStandardMaterial({ color: 0x705030, roughness: 0.90 }),
  stem: new THREE.MeshStandardMaterial({ color: 0x388018, roughness: 0.9 }),
  glow: new THREE.MeshStandardMaterial({ color: 0xffe850, transparent: true, opacity: 0.12, depthWrite: false, roughness: 1, metalness: 0 }),
};

const MAP_BASE_MATERIALS = {
  wall: new THREE.MeshStandardMaterial({ color: 0x18202a, roughness: 0.9, metalness: 0.05 }),
  house_body: new THREE.MeshStandardMaterial({ color: 0xddd0b8, roughness: 0.82, metalness: 0.0 }),
  house_roof: new THREE.MeshStandardMaterial({ color: 0x8a2818, roughness: 0.75, metalness: 0.0 }),
  house_chimney: new THREE.MeshStandardMaterial({ color: 0x6a3828, roughness: 0.88, metalness: 0.0 }),
  house_door: new THREE.MeshStandardMaterial({ color: 0x4a2808, roughness: 0.70, metalness: 0.05 }),
  house_window: new THREE.MeshStandardMaterial({ color: 0x90c8e0, roughness: 0.15, metalness: 0.1, emissive: 0x6ab8d8, emissiveIntensity: 0.3 }),
  garden: new THREE.MeshStandardMaterial({ color: 0x3a8820, roughness: 0.90, metalness: 0.0 }),
  fountain_base: new THREE.MeshStandardMaterial({ color: 0xb0c0c8, roughness: 0.65, metalness: 0.05 }),
  fountain_rim: new THREE.MeshStandardMaterial({ color: 0x98b0bc, roughness: 0.60, metalness: 0.08 }),
  fountain_pillar: new THREE.MeshStandardMaterial({ color: 0x88a0ac, roughness: 0.60, metalness: 0.08 }),
  bench: new THREE.MeshStandardMaterial({ color: 0x7a5828, roughness: 0.75, metalness: 0.02 }),
  lamp_post: new THREE.MeshStandardMaterial({ color: 0x222e38, roughness: 0.55, metalness: 0.40 }),
  lamp_head: new THREE.MeshStandardMaterial({ color: 0xffe870, roughness: 0.30, metalness: 0.2, emissive: 0xffee40, emissiveIntensity: 1.2 }),
  platform: new THREE.MeshStandardMaterial({ color: 0x7a8e98, roughness: 0.70, metalness: 0.08 }),
  ruins: new THREE.MeshStandardMaterial({ color: 0x6a5848, roughness: 0.92, metalness: 0.0 }),
  building_terra: new THREE.MeshStandardMaterial({ color: 0xdce8f0, roughness: 0.78, metalness: 0.02 }),
  building_bar: new THREE.MeshStandardMaterial({ color: 0xe0c898, roughness: 0.82, metalness: 0.0 }),
  rand_building_terra: new THREE.MeshStandardMaterial({ color: 0xc8d8b0, roughness: 0.80, metalness: 0.0 }),
  rand_building_bar: new THREE.MeshStandardMaterial({ color: 0xd8b880, roughness: 0.82, metalness: 0.0 }),
  pillar_terra: new THREE.MeshStandardMaterial({ color: 0x4a7830, roughness: 0.80, metalness: 0.0 }),
  pillar_barren: new THREE.MeshStandardMaterial({ color: 0x9a6838, roughness: 0.85, metalness: 0.0 }),
  pillar_neutral: new THREE.MeshStandardMaterial({ color: 0x7a8a90, roughness: 0.72, metalness: 0.05 }),
  cover_terra: new THREE.MeshStandardMaterial({ color: 0x608840, roughness: 0.85, metalness: 0.0 }),
  cover_barren: new THREE.MeshStandardMaterial({ color: 0xb08040, roughness: 0.88, metalness: 0.0 }),
  cover_neutral: new THREE.MeshStandardMaterial({ color: 0x6a8090, roughness: 0.78, metalness: 0.05 }),
};








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

  // ── Central house ─────────────────────────────────────────────────────────
  box(0, 5, 0, 18, 10, 14, 'house_body', 'neutral');
  box(0, 11.5, 0, 20, 3, 16, 'house_roof', 'neutral');
  box(5, 14, -3, 2, 5, 2, 'house_chimney', 'neutral');
  box(0, 0.3, 9, 14, 0.6, 4, 'platform', 'neutral');
  box(-5, 2.5, 11, 1, 5, 1, 'pillar', 'neutral');
  box( 5, 2.5, 11, 1, 5, 1, 'pillar', 'neutral');
  box(0, 5.2, 10.5, 13, 0.5, 4, 'platform', 'neutral');
  box(0, 2.5, 7.1, 3, 5, 0.5, 'house_door', 'neutral');
  box(-5, 6, 7.1, 3, 2.5, 0.4, 'house_window', 'neutral');
  box( 5, 6, 7.1, 3, 2.5, 0.4, 'house_window', 'neutral');
  box(-5, 6, -7.1, 3, 2.5, 0.4, 'house_window', 'neutral');
  box( 5, 6, -7.1, 3, 2.5, 0.4, 'house_window', 'neutral');
  box(-9.1, 6, -2, 0.4, 2.5, 3, 'house_window', 'neutral');
  box( 9.1, 6, -2, 0.4, 2.5, 3, 'house_window', 'neutral');
  box(0, 0.3, -10, 16, 0.6, 6, 'platform', 'neutral');
  for (let fx = -6; fx <= 6; fx += 3)
    box(fx, 1.5, 13, 0.5, 3, 0.5, 'cover', 'neutral');
  box(-8, 0.4, 9, 4, 0.8, 2, 'garden', 'neutral');
  box( 8, 0.4, 9, 4, 0.8, 2, 'garden', 'neutral');

  // ── Courtyard walls ───────────────────────────────────────────────────────
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
  box(-BH, WH/2, -BH, 4, WH, 4, 'building', 'neutral');
  box( BH, WH/2, -BH, 4, WH, 4, 'building', 'neutral');
  box(-BH, WH/2,  BH, 4, WH, 4, 'building', 'neutral');
  box( BH, WH/2,  BH, 4, WH, 4, 'building', 'neutral');
  box(0, WH+0.5, 0, BH*2+2, 1, BH*2+2, 'platform', 'neutral');
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

  // ── Paths, lamps, fountain, benches ───────────────────────────────────────
  for (let pz = 15; pz < 80; pz += 10)
    box(0, 0.05, pz, 5, 0.1, 8, 'path', 'neutral');
  for (let pz = -15; pz > -80; pz -= 10)
    box(0, 0.05, pz, 5, 0.1, 8, 'path', 'neutral');
  for (const [lx, lz] of [[-4,30],[4,30],[-4,60],[4,60],[-4,-30],[4,-30],[-4,-60],[4,-60]]) {
    box(lx, 3, lz, 0.4, 6, 0.4, 'lamp_post', 'neutral');
    box(lx, 6.3, lz, 1.5, 0.5, 0.5, 'lamp_head', 'neutral');
  }
  box(0, 0.5, 17, 8, 1, 8, 'fountain_base', 'neutral');
  box(0, 1.2, 17, 6, 0.4, 6, 'fountain_rim', 'neutral');
  box(0, 1.5, 17, 1.5, 3, 1.5, 'fountain_pillar', 'neutral');
  for (const [bx, bz, bw, bd] of [
    [-12,17,5,1.5],[12,17,5,1.5],[-12,-17,5,1.5],[12,-17,5,1.5],
  ]) {
    box(bx, 0.6, bz, bw, 1.2, bd, 'bench', 'neutral');
    box(bx, 1.5, bz - bd*0.3, bw, 1.5, 0.3, 'bench', 'neutral');
  }

  // ── Flank corridor cover ──────────────────────────────────────────────────
  const flankVecs = [[0,-1],[0,1],[1,0],[-1,0]];
  const [fvx, fvz] = flankVecs[Math.floor(rng() * 4)];
  for (let i = 0; i < 18; i++) {
    const dist = 96 + rng() * 72, spread = (rng()-0.5) * 84;
    const px = fvx*dist + fvz*spread, pz = fvz*dist + fvx*spread;
    const { h, w } = tieredCover(rng());
    box(px, h/2, pz, w, h, w*(0.6+rng()*0.8), 'cover', 'neutral');
  }

  const gapSlots = new Set();
  while (gapSlots.size < 12) gapSlots.add(Math.floor(rng() * 30));
  for (let i = 0; i < 30; i++) {
    if (gapSlots.has(i)) continue;
    const zc = -HALF + 25 + i * ((SIZE-50)/29);
    const jx = (rng()-0.5)*10, h = 1.2 + rng()*1.0;
    box(jx, h/2, zc, 2+rng()*3, h, 13+rng()*12, 'cover', 'neutral');
  }

  for (let i = 0; i < 360; i++) {
    const x = (rng()-0.5)*(SIZE-30), z = (rng()-0.5)*(SIZE-30);
    const dc = Math.sqrt(x*x+z*z);
    if (dc < 105) continue;
    if (dc < 195 && rng() < 0.68) continue;
    const biome = x > 5 ? 'terra' : x < -5 ? 'barren' : 'neutral';
    const { h, w } = tieredCover(rng());
    box(x, h/2, z, w, h, w*(0.5+rng()*1.0), 'cover', biome);
  }

  for (let i = 0; i < 90; i++) {
    const x = (rng()-0.5)*(SIZE-40), z = (rng()-0.5)*(SIZE-40);
    if (Math.sqrt(x*x+z*z) < 84) continue;
    const biome = x > 0 ? 'terra' : 'barren';
    const h = 10+rng()*22, w = 1.5+rng()*2.5;
    box(x, h/2, z, w, h, w, 'pillar', biome);
  }

  for (let i = 0; i < 75; i++) {
    const x = (rng()-0.5)*(SIZE-50), z = (rng()-0.5)*(SIZE-50);
    if (Math.sqrt(x*x+z*z) < 75) continue;
    const biome = x > 0 ? 'terra' : 'barren';
    const elev = 4+rng()*7, pw = 7+rng()*14, pd = 7+rng()*14;
    box(x, elev+0.5, z, pw, 1.2, pd, 'platform', biome);
    box(x, elev/2, z, 1.2, elev, 1.2, 'pillar', biome);
    const side = Math.floor(rng()*4), stepCount = 3+Math.floor(rng()*3);
    const stepSpread = (pw/2+pd/2)/2;
    for (let s = 0; s < stepCount; s++) {
      const topFace = (s+1)*elev/stepCount;
      const sOff = stepSpread+1.0+(stepCount-1-s)*1.8;
      const sx = side===0 ? x+sOff : side===1 ? x-sOff : x;
      const sz = side===2 ? z+sOff : side===3 ? z-sOff : z;
      if (Math.abs(sx) > HALF-5 || Math.abs(sz) > HALF-5) continue;
      box(sx, topFace/2, sz, 1.6, topFace, 1.6, 'cover', biome);
    }
  }

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
          const ww = Math.min(2.5,pw-1.5), sill=2.2, winTop=4.2, side=(pw-ww)/2;
          if (dir==='z') {
            hbox(sc-ww/2-side/2,wh/2,fp,side,wh,wt); hbox(sc+ww/2+side/2,wh/2,fp,side,wh,wt);
            hbox(sc,sill/2,fp,ww,sill,wt); hbox(sc,winTop+(wh-winTop)/2,fp,ww,wh-winTop,wt);
          } else {
            hbox(fp,wh/2,sc-ww/2-side/2,wt,wh,side); hbox(fp,wh/2,sc+ww/2+side/2,wt,wh,side);
            hbox(fp,sill/2,sc,wt,sill,ww); hbox(fp,winTop+(wh-winTop)/2,sc,wt,wh-winTop,ww);
          }
        } else {
          if (dir==='z') hbox(sc,wh/2,fp,pw,wh,wt);
          else           hbox(fp,wh/2,sc,wt,wh,pw);
        }
      }
      if (lw > 0.5) panel(lc, facePos, lw);
      if (rw > 0.5) panel(rc, facePos, rw);
      if (wh > dh+0.3) {
        if (dir==='z') hbox(dox,dh+(wh-dh)/2,facePos,dw*2,wh-dh,wt);
        else           hbox(facePos,dh+(wh-dh)/2,dox,wt,wh-dh,dw*2);
      }
    }
    wallFace('z',-(bd+wt/2),bw+wt); wallFace('z',(bd+wt/2),bw+wt);
    wallFace('x',-(bw+wt/2),bd);    wallFace('x',(bw+wt/2),bd);
    if (rng() < 0.6)
      boxes.push({ x:hx, y:wh+0.5, z:hz, w:(bw+wt)*2, h:1, d:(bd+wt)*2, type:'platform', biome });
    if (rng() < 0.5)
      boxes.push({ x:hx, y:1, z:hz, w:2+rng()*3, h:2, d:2+rng()*3, type:'cover', biome });
    spawns.push({ x:hx, y:1.6, z:hz });
  }

  const HIDEOUT_COUNT = 10 + Math.floor(rng() * 11);
  for (let attempt = 0, placed = 0; attempt < 300 && placed < HIDEOUT_COUNT; attempt++) {
    const hx = (rng()-0.5)*(SIZE-80), hz = (rng()-0.5)*(SIZE-80);
    const hideoutDistSq = hx*hx + hz*hz; if (hideoutDistSq < 110*110) continue;
    const biome = hx > 5 ? 'terra' : hx < -5 ? 'barren' : 'neutral';
    buildHideout(hx, hz, biome);
    placed++;
  }

  const coverPool = boxes.filter(b => b.type==='cover' || b.type==='ruins');
  const pool = [...coverPool];
  for (let i = pool.length-1; i > 0; i--) {
    const j = Math.floor(rng()*(i+1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  for (const b of pool.slice(0,40)) {
    const angle = rng()*Math.PI*2, dist = Math.max(b.w,b.d)/2+1.8;
    const sx = b.x+Math.cos(angle)*dist, sz = b.z+Math.sin(angle)*dist;
    if (Math.abs(sx)<HALF-5 && Math.abs(sz)<HALF-5)
      spawns.push({ x:sx, y:1.6, z:sz });
  }
  for (const [x,z] of [
    [330,330],[-330,330],[330,-330],[-330,-330],
    [360,0],[-360,0],[0,360],[0,-360],
    [180,300],[-180,300],[180,-300],[-180,-300],
    [300,180],[-300,180],[300,-180],[-300,-180],
    [340,100],[-340,100],[340,-100],[-340,-100],
  ]) spawns.push({ x, y:1.6, z });

  return { floor:{ w:SIZE, d:SIZE }, boxes, spawns, pois:[] };
}

// ─── MAP BUILD ────────────────────────────────────────────────────────────────

export function buildMap(scene, map) {
  const SIZE = map.floor.w;

  let _s = (map.boxes.length * 31 + map.spawns.length * 97 + 12345) >>> 0;
  function rng() {
    _s = (Math.imul(1664525, _s) + 1013904223) >>> 0;
    return _s / 0x100000000;
  }

  // ── Recommended scene lighting (add in your scene setup) ─────────────────
  // const hemi = new THREE.HemisphereLight(0xb8d4f0, 0x4a5828, 0.6);
  // scene.add(hemi);
  // const sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
  // sun.position.set(120, 200, 80);
  // sun.castShadow = true;
  // sun.shadow.mapSize.set(4096, 4096);
  // sun.shadow.camera.near = 1; sun.shadow.camera.far = 1200;
  // sun.shadow.camera.left = -600; sun.shadow.camera.right = 600;
  // sun.shadow.camera.top = 600; sun.shadow.camera.bottom = -600;
  // sun.shadow.bias = -0.0003;
  // scene.add(sun);
  // const fill = new THREE.DirectionalLight(0x8090c0, 0.4);
  // fill.position.set(-80, 60, -60);
  // scene.add(fill);
  // renderer.shadowMap.enabled = true;
  // renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // renderer.toneMapping = THREE.ACESFilmicToneMapping;
  // renderer.toneMappingExposure = 1.1;
  // renderer.outputColorSpace = THREE.SRGBColorSpace;

  // ── Ground — single plane, biome color via vertex colors ─────────────────
  // One seamless plane avoids all Z-fighting
  const gGeo = new THREE.PlaneGeometry(SIZE + 80, SIZE + 80, 80, 80);
  const gColors = [];
  const pos = gGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i);
    const t = Math.max(0, Math.min(1, (vx + 80) / 160));
    const r = 0.55 * (1-t) + 0.23 * t;
    const g = 0.42 * (1-t) + 0.47 * t;
    const b = 0.23 * (1-t) + 0.13 * t;
    gColors.push(r, g, b);
  }
  gGeo.setAttribute('color', new THREE.Float32BufferAttribute(gColors, 3));
  const ground = new THREE.Mesh(gGeo, SHARED_MATERIALS.ground);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // ── Water ─────────────────────────────────────────────────────────────────
    // ── Water
  for (const [wx, wz, ww, wd] of [
    [ 80,-75,38,26],[ 10,-88,22,16],[ 90, 45,28,20],
    [ 70, 80,24,18],[  0,  0,26,26],[-20, 30,14,10],[40,-40,18,14],
  ]) {
    const w = new THREE.Mesh(SHARED_GEOMETRY.plane, SHARED_MATERIALS.water);
    w.scale.set(ww, wd, 1);
    w.rotation.x = -Math.PI / 2;
    w.position.set(wx, 0.08, wz);
    scene.add(w);
  }


  // ── Path tiles ────────────────────────────────────────────────────────────
    // ── Path tiles
  for (const b of map.boxes.filter(b => b.type === 'path')) {
    const m = new THREE.Mesh(SHARED_GEOMETRY.plane, SHARED_MATERIALS.path);
    m.scale.set(b.w, b.d, 1);
    m.rotation.x = -Math.PI / 2;
    m.position.set(b.x, 0.09, b.z);
    scene.add(m);
  }


  // ── PBR material palette (cached global)
  const M = MAP_BASE_MATERIALS;

  function getMat(b) {
    const t = b.type, bi = b.biome;
    if (M[t]) return M[t];
    if (t === 'building')      return bi === 'terra' ? M.building_terra : M.building_bar;
    if (t === 'rand_building') return bi === 'terra' ? M.rand_building_terra : M.rand_building_bar;
    if (t === 'pillar')        return bi === 'terra' ? M.pillar_terra : bi === 'barren' ? M.pillar_barren : M.pillar_neutral;
    return bi === 'terra' ? M.cover_terra : bi === 'barren' ? M.cover_barren : M.cover_neutral;
  }

  // ── Structural boxes ──────────────────────────────────────────────────────
  for (const b of map.boxes) {
    if (b.type === 'path') continue;
    const mat = getMat(b);
    if (!mat) continue;
        const mesh = new THREE.Mesh(SHARED_GEOMETRY.box, mat);
    mesh.scale.set(b.w, b.h, b.d);
    mesh.position.set(b.x, b.y, b.z);
    mesh.castShadow    = b.type !== 'wall';
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // ── Trees ─────────────────────────────────────────────────────────────────
  const trunkMat  = new THREE.MeshStandardMaterial({ color: 0x5a3818, roughness: 0.92, metalness: 0 });
  const greenMat  = new THREE.MeshStandardMaterial({ color: 0x3a7818, roughness: 0.88, metalness: 0 });
  const darkGreen = new THREE.MeshStandardMaterial({ color: 0x285210, roughness: 0.90, metalness: 0 });
  const cherryMat = new THREE.MeshStandardMaterial({ color: 0xe05890, roughness: 0.80, metalness: 0 });
  const autumnMat = new THREE.MeshStandardMaterial({ color: 0xd06820, roughness: 0.82, metalness: 0 });

  function addTree(tx, tz, type) {
    const th = 2.5 + rng() * 3.5;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.45, th, 8), trunkMat);
    trunk.position.set(tx, th / 2, tz);
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    scene.add(trunk);

    let cm;
    if (type === 'cherry')  cm = cherryMat;
    else if (type === 'autumn') cm = autumnMat;
    else cm = rng() > 0.45 ? greenMat : darkGreen;

    const cs = 1.8 + rng() * 2.2;
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(cs, 9, 7), cm);
    canopy.position.set(tx, th + cs * 0.55, tz);
    canopy.castShadow = true;
    canopy.receiveShadow = true;
    scene.add(canopy);

    if (type === 'cherry') {
      for (const [ox, oy, oz, rs] of [
        [ cs*0.55, cs*0.30,  cs*0.35, 0.72],
        [-cs*0.45, cs*0.38, -cs*0.30, 0.58],
        [ cs*0.20, cs*0.50, -cs*0.45, 0.50],
      ]) {
        const c = new THREE.Mesh(new THREE.SphereGeometry(cs*rs, 8, 6), cherryMat);
        c.position.set(tx+ox, th+cs*0.55+oy-cs*0.55, tz+oz);
        c.castShadow = true;
        scene.add(c);
      }
    }
  }

  for (let i = 0; i < 90; i++) {
    const tx = 18 + rng() * 107;
    const tz = (rng() - 0.5) * (SIZE - 20);
    const treeDistSq = tx*tx + tz*tz; if (treeDistSq < 38*38) continue;
    const type = rng() < 0.35 ? 'cherry' : rng() < 0.2 ? 'autumn' : 'green';
    addTree(tx, tz, type);
  }
  for (let i = 0; i < 22; i++)
    addTree(-50 - rng()*65, (rng()-0.5)*(SIZE-30), 'green');

  // ── Boulders ──────────────────────────────────────────────────────────────
  const bMats = [
    new THREE.MeshStandardMaterial({ color: 0x5a6048, roughness: 0.95, metalness: 0.02 }),
    new THREE.MeshStandardMaterial({ color: 0x786858, roughness: 0.93, metalness: 0.02 }),
    new THREE.MeshStandardMaterial({ color: 0x404830, roughness: 0.96, metalness: 0.00 }),
  ];
  for (let i = 0; i < 70; i++) {
    const bx = (rng()-0.5)*(SIZE-20), bz = (rng()-0.5)*(SIZE-20);
    const boulderDistSq = bx*bx + bz*bz; if (boulderDistSq < 22*22) continue;
    const bs = 0.7 + rng() * 2.2;
        const bm = new THREE.Mesh(SHARED_GEOMETRY.icosa, bMats[Math.floor(rng()*3)]);
    bm.scale.set(bs, bs, bs);
    bm.position.set(bx, bs*0.55, bz);
    bm.rotation.set(rng()*Math.PI, rng()*Math.PI, rng()*Math.PI);
    bm.castShadow = true;
    bm.receiveShadow = true;
    scene.add(bm);
  }

  // ── Crates ────────────────────────────────────────────────────────────────
  const crateColors = [0xb88040, 0xa87030, 0xc89050];
  for (let i = 0; i < 35; i++) {
    const cx = (rng()-0.5)*(SIZE-60), cz = (rng()-0.5)*(SIZE-60);
    const crateDistSq = cx*cx + cz*cz; if (crateDistSq < 90*90) continue;
    const cs2 = 1.2 + rng() * 1.5;
    const cmat = new THREE.MeshStandardMaterial({
      color: crateColors[Math.floor(rng()*3)], roughness: 0.80, metalness: 0.0
    });
    const crate = new THREE.Mesh(SHARED_GEOMETRY.box, cmat);
    crate.scale.set(cs2, cs2, cs2);
    crate.position.set(cx, cs2/2, cz);
    crate.rotation.y = rng() * Math.PI * 0.5;
    crate.castShadow = true;
    crate.receiveShadow = true;
    scene.add(crate);
  }

  // ── Barrels ───────────────────────────────────────────────────────────────
  const barrelMat = new THREE.MeshStandardMaterial({ color: 0x4a3018, roughness: 0.78, metalness: 0.05 });
  const bandMat   = new THREE.MeshStandardMaterial({ color: 0x303840, roughness: 0.50, metalness: 0.50 });
  for (let i = 0; i < 20; i++) {
    const bx = -(40+rng()*100), bz = (rng()-0.5)*(SIZE-80);
    const barrelDistSq = bx*bx + bz*bz; if (barrelDistSq < 80*80) continue;
    const br = 0.6+rng()*0.4, bh = 1.4+rng()*0.6;
        const barrel = new THREE.Mesh(SHARED_GEOMETRY.cylinder, SHARED_MATERIALS.barrel);
    barrel.scale.set(br, bh, br);
    barrel.position.set(bx, bh/2, bz);
    barrel.castShadow = true;
    scene.add(barrel);
    // Metal band rings
    for (const by of [0.25, 0.75]) {
      const band = new THREE.Mesh(SHARED_GEOMETRY.torus, SHARED_MATERIALS.band);
      band.scale.set(br+0.04, br+0.04, 0.06);
      band.rotation.x = Math.PI / 2;
      band.position.set(bx, bh*by, bz);
      scene.add(band);
    }
  }

  // ── Fence (barren border) ─────────────────────────────────────────────────
  const fPostMat = new THREE.MeshStandardMaterial({ color: 0x806040, roughness: 0.88 });
  const fRailMat = new THREE.MeshStandardMaterial({ color: 0x705030, roughness: 0.90 });
  for (let fz = -300; fz < 300; fz += 10) {
    const fx = -120;
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 3, 0.5), fPostMat);
    post.position.set(fx, 1.5, fz);
    post.castShadow = true;
    scene.add(post);
    if (fz < 290) {
      for (const ry of [1.8, 1.0]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, 10), fRailMat);
        rail.position.set(fx, ry, fz+5);
        scene.add(rail);
      }
    }
  }

  // ── Flowers (terra side) ──────────────────────────────────────────────────
  const flowerColors = [0xe02848, 0xe8b010, 0x9828d0, 0xe060a8];
  const stemMat = new THREE.MeshStandardMaterial({ color: 0x388018, roughness: 0.9 });
  for (let i = 0; i < 50; i++) {
    const fx = 30 + rng()*90, fz = (rng()-0.5)*(SIZE-60);
    const flowerDistSq = fx*fx + fz*fz; if (flowerDistSq < 50*50) continue;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.9, 5), stemMat);
    stem.position.set(fx, 0.45, fz);
    scene.add(stem);
    const fc = flowerColors[Math.floor(rng()*4)];
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 6, 5),
      new THREE.MeshStandardMaterial({ color: fc, roughness: 0.7, metalness: 0, emissive: fc, emissiveIntensity: 0.08 })
    );
    head.position.set(fx, 0.95, fz);
    scene.add(head);
  }

  // ── Lamp glow halos ───────────────────────────────────────────────────────
  const glowMat = new THREE.MeshStandardMaterial({
    color: 0xffe850, transparent: true, opacity: 0.12,
    depthWrite: false, roughness: 1, metalness: 0,
  });
  for (const b of map.boxes.filter(b => b.type === 'lamp_head')) {
    const g = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), glowMat);
    g.rotation.x = -Math.PI / 2;
    g.position.set(b.x, 0.1, b.z);
    scene.add(g);
    // Point light per lamp (keep count low — expensive)
    const pl = new THREE.PointLight(0xffe860, 1.8, 22);
    pl.position.set(b.x, b.y + 0.5, b.z);
    scene.add(pl);
  }
}