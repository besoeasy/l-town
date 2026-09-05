import * as THREE from 'three';
import { makePRNG } from './modules/utls.js';
import { generateMap, buildMap } from './modules/map.js';
import { CFG } from './modules/cfg.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }     from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass }      from 'three/addons/postprocessing/OutputPass.js';
import { Sky }             from 'three/addons/objects/Sky.js';

// ─── AUDIO ───────────────────────────────────────────────────────────────────
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function resumeAudio() { if (audioCtx.state === 'suspended') audioCtx.resume(); }

// Load all sound files into decoded AudioBuffers
const SND = {};
(async () => {
  const files = {
    shoot:      '/sounds/single-shot.mp3',
    shootHeavy: '/sounds/heavy-shot.mp3',
    hit:        '/sounds/men-grunt.mp3',
    die:        '/sounds/death.mp3',
    footstep:   '/sounds/single-footstep.mp3',
    super:      '/sounds/super.mp3',
    recharge:   '/sounds/energy-recharge.mp3',
  };
  await Promise.all(Object.entries(files).map(async ([key, url]) => {
    try {
      const res = await fetch(url);
      const buf = await res.arrayBuffer();
      SND[key]  = await audioCtx.decodeAudioData(buf);
    } catch (e) { console.warn('Audio load failed:', url, e); }
  }));
})();

function playBuffer(key, volume = 1.0, playbackRate = 1.0) {
  const buf = SND[key];
  if (!buf) return null;
  resumeAudio();
  const src  = audioCtx.createBufferSource();
  const gain = audioCtx.createGain();
  src.buffer       = buf;
  src.playbackRate.value = playbackRate;
  gain.gain.value  = volume;
  src.connect(gain);
  gain.connect(audioCtx.destination);
  src.start();
  return src;
}

// Footstep loop state
let _footSrc  = null;
let _footLoop = false;
function startFootsteps(running) {
  if (_footLoop) return;
  _footLoop = true;
  const key  = 'footstep';
  const rate = running ? 1.1 : 0.85;
  function step() {
    if (!_footLoop) return;
    playBuffer(key, 0.45, rate);
    const interval = running ? 300 : 480;
    _footSrc = setTimeout(step, interval);
  }
  step();
}
function stopFootsteps() {
  _footLoop = false;
  if (_footSrc) { clearTimeout(_footSrc); _footSrc = null; }
}

// Named sound calls used throughout the game
function sndShoot(mode) {
  const key = mode === 'heavy' ? 'shootHeavy' : 'shoot';
  playBuffer(key, 0.7);
}
function sndHit()    { playBuffer('hit',    0.6, 1.0 + (Math.random() - 0.5) * 0.2); }
function sndReload() { /* no audio file */ }
function sndKill()   {
  // Keep the satisfying kill jingle as synthetic (no file provided)
  resumeAudio();
  function t(f1, f2, dur, delay) {
    setTimeout(() => {
      const osc = audioCtx.createOscillator(), g = audioCtx.createGain();
      osc.connect(g); g.connect(audioCtx.destination);
      osc.type = 'square';
      osc.frequency.setValueAtTime(f1, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(f2, audioCtx.currentTime + dur);
      g.gain.setValueAtTime(0.18, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
      osc.start(); osc.stop(audioCtx.currentTime + dur);
    }, delay);
  }
  t(440, 880, 0.07, 0); t(880, 1200, 0.12, 70);
}
function sndDie()    { playBuffer('die', 0.8, 1.0); }
function sndSuper()  { playBuffer('super', 0.8); }
function sndWeaponSwitch() { /* no audio file */ }

// Looping recharge sound — plays while crouching and regenerating
let _rechargeSrc  = null;
let _rechargeLoop = false;
function startRecharge() {
  if (_rechargeLoop) return;
  _rechargeLoop = true;
  function loop() {
    if (!_rechargeLoop || !SND.recharge) return;
    resumeAudio();
    const src  = audioCtx.createBufferSource();
    const gain = audioCtx.createGain();
    src.buffer      = SND.recharge;
    gain.gain.value = 0.45;
    src.connect(gain);
    gain.connect(audioCtx.destination);
    src.onended = loop;
    src.start();
    _rechargeSrc = src;
  }
  loop();
}
function stopRecharge() {
  _rechargeLoop = false;
  if (_rechargeSrc) { try { _rechargeSrc.stop(); } catch {} _rechargeSrc = null; }
}
// ─── WS CONNECTION ────────────────────────────────────────────────────────────
let ws;

let myId        = null;
let mapData     = null;
let cfg         = CFG;
let gameState   = null;
let matchEnded  = false;
let latencyMs   = 0;
let localCharacter = 'telepotu'; // set from character card selection

function connectWS() {
  const proto = (location.protocol === 'https:') ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}`);
  ws.addEventListener('open', () => {
    setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping', ts: Date.now() }));
      }
    }, 3000);
  });
  ws.addEventListener('message', _onWSMessage);
  ws.addEventListener('close', _onWSClose);
}

function safeSend(obj) {
  if (ws && ws.readyState === WebSocket.OPEN)
    ws.send(JSON.stringify(obj));
}
connectWS();

// ─── THREE.JS ─────────────────────────────────────────────────────────────────
let scene, camera, renderer, composer;
let _bloomPass = null;
const cloudMeshes = [];
const playerMeshes  = new Map(); // id → THREE.Group
const playerPrevPos = new Map(); // id → {x,z} for movement detection

// ─── POINTER LOCK & INPUT ─────────────────────────────────────────────────────
let isLocked  = false;
const keys    = { w: false, a: false, s: false, d: false };
let _mouseAccX = 0, _mouseAccY = 0;

// Local player state (client-side prediction)
const localPos   = { x: 0, y: 1.6, z: 0 };
let localYaw     = 0;
let localPitch   = 0;
let isCrouching  = false;
let isChatting   = false;
let localEyeH    = 1.6;   // smoothly lerped
let lastMoveTime = performance.now(); // for auto-crouch
const AUTO_CROUCH_MS = 2000;
let localVy      = 0;     // vertical velocity for client jump prediction
let localGrounded = true;
let spaceDownTime = 0;    // timestamp when space pressed (0 = not held)
const SUPER_JUMP_CHARGE_MS = 450; // hold time to trigger super jump

// ─── CHARGE SHOT STATE ───────────────────────────────────────────────────────
const CHARGE_MAX      = 4;
const CHARGE_TICK_MS  = 300;   // ms per charge pip added while holding right-click
let chargeCount       = 0;
let _chargeInterval   = null;
function startCharging() {
  if (_chargeInterval) return;
  _chargeInterval = setInterval(() => {
    if (chargeCount < CHARGE_MAX) {
      chargeCount++;
      updateChargeHUD();
    }
  }, CHARGE_TICK_MS);
}
function stopCharging() {
  if (_chargeInterval) { clearInterval(_chargeInterval); _chargeInterval = null; }
}
function updateChargeHUD() {
  const el = document.getElementById('chargePips');
  if (!el) return;
  el.innerHTML = Array.from({ length: CHARGE_MAX }, (_, i) =>
    `<span class="charge-pip${i < chargeCount ? ' charged' : ''}"></span>`
  ).join('');
}

// ─── AUDIO ───────────────────────────────────────────────────────────────────
let _audioCtx = null;
function _getAudioCtx() {
  if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return _audioCtx;
}
/**
 * playTone(delay, type, gainVal, duration, startFreq, endFreq)
 * Plays a short synthesised tone via Web Audio.
 */
function playTone(delay, type, gainVal, duration, startFreq, endFreq) {
  try {
    const ctx = _getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(startFreq, ctx.currentTime + delay);
    if (endFreq !== undefined) {
      osc.frequency.linearRampToValueAtTime(endFreq, ctx.currentTime + delay + duration);
    }
    gain.gain.setValueAtTime(gainVal, ctx.currentTime + delay);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + delay + duration);
    osc.start(ctx.currentTime + delay);
    osc.stop(ctx.currentTime + delay + duration + 0.01);
  } catch (e) { /* audio unavailable */ }
}

function setCrouch(state) {
  if (isCrouching === state) return;
  isCrouching = state;
  safeSend({ type: 'crouch', state });
  if (!state) lastMoveTime = performance.now();
}

// Timing
let prevTime      = performance.now();
let lastInputSent = 0;

// ─── THREE.JS INIT ────────────────────────────────────────────────────────────
function initScene() {
  scene = new THREE.Scene();
  // No solid background — procedural Sky mesh handles it
  scene.fog = new THREE.FogExp2(0x7ab0d0, 0.00055); // atmospheric depth haze

  camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 1800);

  const canvas = document.getElementById('canvas');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.85;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  // ── Procedural sky (Preetham atmospheric model) ─────────────────────────────
  const sky = new Sky();
  sky.scale.setScalar(10000);
  scene.add(sky);
  const skyU = sky.material.uniforms;
  skyU['turbidity'].value       = 8;
  skyU['rayleigh'].value        = 2.5;
  skyU['mieCoefficient'].value  = 0.005;
  skyU['mieDirectionalG'].value = 0.82;
  // Afternoon sun direction
  const sunDir = new THREE.Vector3();
  sunDir.setFromSphericalCoords(1,
    THREE.MathUtils.degToRad(85),   // elevation ≈ 5° above horizon — golden hour
    THREE.MathUtils.degToRad(220)); // south-west azimuth
  skyU['sunPosition'].value.copy(sunDir);

  // Sky / ground hemisphere — dim ambient fill
  const hemi = new THREE.HemisphereLight(0xadd0e8, 0x3a5820, 0.4);
  scene.add(hemi);

  // Main sun — soft, not harsh
  const sun = new THREE.DirectionalLight(0xfff5e8, 0.7);
  sun.position.copy(sunDir).multiplyScalar(120);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = -0.0002;
  sun.shadow.camera.near  = 0.5;
  sun.shadow.camera.far   = 900;
  sun.shadow.camera.left  = sun.shadow.camera.bottom = -450;
  sun.shadow.camera.right = sun.shadow.camera.top    =  450;
  scene.add(sun);

  // Subtle fill from opposite side
  const rim = new THREE.DirectionalLight(0x88b4d8, 0.15);
  rim.position.set(-60, 40, 60);
  scene.add(rim);

  // Boreas — large purple planet visible in sky (fog-immune)
  const planet = new THREE.Mesh(
    new THREE.SphereGeometry(70, 24, 24),
    new THREE.MeshLambertMaterial({ color: 0x5a1a8a, fog: false })
  );
  planet.position.set(-240, 130, -400);
  scene.add(planet);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(84, 6, 6, 48),
    new THREE.MeshLambertMaterial({ color: 0x9a40dd, fog: false, transparent: true, opacity: 0.55 })
  );
  ring.position.set(-240, 130, -400);
  ring.rotation.x = Math.PI * 0.28;
  scene.add(ring);

  // ── Animated cloud layer ─────────────────────────────────────────────────────
  const cloudPalette = [0xffffff, 0xf4f4ff, 0xe8eff8];
  for (let i = 0; i < 24; i++) {
    const cw  = 90 + Math.random() * 200;
    const ch  = 22 + Math.random() * 55;
    const cMat = new THREE.MeshLambertMaterial({
      color:       cloudPalette[Math.floor(Math.random() * cloudPalette.length)],
      transparent: true,
      opacity:     0.22 + Math.random() * 0.28,
      depthWrite:  false,
      fog:         false,
    });
    const cMesh = new THREE.Mesh(new THREE.PlaneGeometry(cw, ch), cMat);
    cMesh.position.set(
      (Math.random() - 0.5) * 900,
      85 + Math.random() * 80,
      (Math.random() - 0.5) * 900
    );
    cMesh.rotation.x = -Math.PI / 2;
    cMesh.rotation.z = Math.random() * Math.PI;
    cMesh.userData.driftX = (0.4 + Math.random() * 1.6) * (Math.random() < 0.5 ? 1 : -1);
    cMesh.userData.driftZ = (0.2 + Math.random() * 0.8) * (Math.random() < 0.5 ? 1 : -1);
    scene.add(cMesh);
    cloudMeshes.push(cMesh);
  }

  // ── Post-processing: Bloom ──────────────────────────────────────────────────
  // Replaces plain renderer.render — all emissive elements now physically glow.
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  _bloomPass = new UnrealBloomPass(
    new THREE.Vector2(innerWidth, innerHeight),
    0.45,  // strength  — subtle; only emissive elements get a visible halo
    0.30,  // radius    — tight halo, not a wide fog
    0.55   // threshold — high: only truly bright emissive pixels bloom (visor, reactor, tracers)
  );
  composer.addPass(_bloomPass);
  composer.addPass(new OutputPass());

  window.addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
    if (_bloomPass) _bloomPass.resolution.set(innerWidth, innerHeight);
  });
}


// ─── PROCEDURAL MAP GENERATION (mirrors server.js — seed keeps them in sync) ─
// `generateMap` is provided by `./modules/map.js` and imported at top

// ─── MAP BUILD ────────────────────────────────────────────────────────────────
// function moved to modules/map.js (imported at top as buildMap)

// ─── PLAYER MESHES ────────────────────────────────────────────────────────────
const COLORS = [0x74f0c6, 0xff5a5f, 0xf6bb42, 0x59b8ff, 0xd97ee3,
                0xff9e3d, 0x5affc8, 0xff7eb3, 0xafffae, 0xffffff];

function getPlayerColor(id) { return COLORS[(id - 1) % COLORS.length]; }

function buildHumanoid(color) {
  const group = new THREE.Group();

  // ── Material palette ─────────────────────────────────────────────────────
  const matBase    = new THREE.MeshStandardMaterial({ color: 0x151e28, metalness: 0.88, roughness: 0.14 });
  const matArmor   = new THREE.MeshStandardMaterial({ color: 0x1e2d3e, metalness: 0.82, roughness: 0.20 });
  const matPanel   = new THREE.MeshStandardMaterial({ color: 0x263545, metalness: 0.75, roughness: 0.28 });
  const matDark    = new THREE.MeshStandardMaterial({ color: 0x080c12, metalness: 0.92, roughness: 0.12 });
  const matAccent  = new THREE.MeshStandardMaterial({ color, metalness: 0.65, roughness: 0.22 });
  const matVisor   = new THREE.MeshStandardMaterial({
    color: 0x55ddff, emissive: new THREE.Color(0x009fcc),
    emissiveIntensity: 5.5, metalness: 0.05, roughness: 0.02,
    transparent: true, opacity: 0.94,
  });
  const matGlow    = new THREE.MeshStandardMaterial({
    color, emissive: new THREE.Color(color),
    emissiveIntensity: 4.0, metalness: 0.3, roughness: 0.15,
  });
  const matReactor = new THREE.MeshStandardMaterial({
    color: 0xffffff, emissive: new THREE.Color(color),
    emissiveIntensity: 7, transparent: true, opacity: 0.96,
  });

  function box(w, h, d, ox, oy, oz, m, rx = 0, ry = 0, rz = 0) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(ox, oy, oz);
    mesh.rotation.set(rx, ry, rz);
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  }
  function cyl(rt, rb, h, ox, oy, oz, m, segs = 8, rx = 0, ry = 0, rz = 0) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, segs), m);
    mesh.position.set(ox, oy, oz);
    mesh.rotation.set(rx, ry, rz);
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  }
  function sph(r, ox, oy, oz, m, segs = 10) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, segs, segs), m);
    mesh.position.set(ox, oy, oz);
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  }

  // ══ BOOTS ════════════════════════════════════════════════════════════════
  // Thick armored sole
  box(0.25, 0.07, 0.36, -0.160, 0.035, 0.01, matDark);
  box(0.25, 0.07, 0.36,  0.160, 0.035, 0.01, matDark);
  // Boot body — angular, modern
  box(0.22, 0.24, 0.28, -0.160, 0.155, 0.00, matArmor);
  box(0.22, 0.24, 0.28,  0.160, 0.155, 0.00, matArmor);
  // Angled toe cap (accent)
  box(0.20, 0.13, 0.11, -0.160, 0.100, -0.148, matAccent, -0.18, 0, 0);
  box(0.20, 0.13, 0.11,  0.160, 0.100, -0.148, matAccent, -0.18, 0, 0);
  // Heel spur
  box(0.12, 0.09, 0.06, -0.160, 0.085,  0.170, matPanel);
  box(0.12, 0.09, 0.06,  0.160, 0.085,  0.170, matPanel);
  // Side vent slits
  box(0.045, 0.09, 0.16, -0.224, 0.135, 0.00, matDark);
  box(0.045, 0.09, 0.16,  0.224, 0.135, 0.00, matDark);
  // Boot glow strip along toe
  box(0.030, 0.020, 0.10, -0.160, 0.065, -0.155, matGlow);
  box(0.030, 0.020, 0.10,  0.160, 0.065, -0.155, matGlow);

  // ══ LOWER LEGS (shins) ═══════════════════════════════════════════════════
  const legL = cyl(0.092, 0.102, 0.45, -0.160, 0.430, 0, matArmor, 8);
  const legR = cyl(0.092, 0.102, 0.45,  0.160, 0.430, 0, matArmor, 8);
  group.userData.legL = legL;
  group.userData.legR = legR;
  // Shin front guard (accent color, chamfered look via rotation)
  box(0.135, 0.30, 0.055, -0.160, 0.415, -0.105, matAccent);
  box(0.135, 0.30, 0.055,  0.160, 0.415, -0.105, matAccent);
  // Shin panel inset
  box(0.085, 0.20, 0.040, -0.160, 0.415, -0.128, matBase);
  box(0.085, 0.20, 0.040,  0.160, 0.415, -0.128, matBase);
  // Shin glow stripe
  box(0.038, 0.22, 0.026, -0.160, 0.400, -0.133, matGlow);
  box(0.038, 0.22, 0.026,  0.160, 0.400, -0.133, matGlow);
  // Calf swept fin
  box(0.026, 0.18, 0.13, -0.222, 0.370, 0.065, matPanel, 0, 0, 0.14);
  box(0.026, 0.18, 0.13,  0.222, 0.370, 0.065, matPanel, 0, 0,-0.14);

  // ══ KNEES ════════════════════════════════════════════════════════════════
  cyl(0.118, 0.118, 0.095, -0.160, 0.652, 0, matPanel, 10);
  cyl(0.118, 0.118, 0.095,  0.160, 0.652, 0, matPanel, 10);
  // Knee cap (player accent)
  box(0.145, 0.085, 0.075, -0.160, 0.652, -0.098, matAccent);
  box(0.145, 0.085, 0.075,  0.160, 0.652, -0.098, matAccent);
  // Knee side guards
  box(0.045, 0.045, 0.045, -0.234, 0.652, -0.055, matDark);
  box(0.045, 0.045, 0.045,  0.234, 0.652, -0.055, matDark);
  // Knee glow pip
  box(0.030, 0.030, 0.030, -0.160, 0.652, -0.138, matGlow);
  box(0.030, 0.030, 0.030,  0.160, 0.652, -0.138, matGlow);

  // ══ THIGHS ═══════════════════════════════════════════════════════════════
  cyl(0.120, 0.105, 0.40, -0.160, 0.905, 0, matArmor, 8);
  cyl(0.120, 0.105, 0.40,  0.160, 0.905, 0, matArmor, 8);
  // Thigh front plate (angled, accent)
  box(0.155, 0.26, 0.058, -0.160, 0.910, -0.116, matAccent, -0.10, 0, 0);
  box(0.155, 0.26, 0.058,  0.160, 0.910, -0.116, matAccent, -0.10, 0, 0);
  // Thigh panel inset
  box(0.095, 0.16, 0.042, -0.160, 0.912, -0.140, matBase);
  box(0.095, 0.16, 0.042,  0.160, 0.912, -0.140, matBase);
  // Outer thigh armored pad
  box(0.052, 0.22, 0.18, -0.258, 0.905, 0.00, matPanel);
  box(0.052, 0.22, 0.18,  0.258, 0.905, 0.00, matPanel);
  // Thigh glow strip
  box(0.028, 0.16, 0.026, -0.160, 0.905, -0.145, matGlow);
  box(0.028, 0.16, 0.026,  0.160, 0.905, -0.145, matGlow);

  // ══ PELVIS / WAIST ═══════════════════════════════════════════════════════
  cyl(0.215, 0.235, 0.18, 0, 1.065, 0, matArmor, 8);
  // Belt wrap
  box(0.46, 0.11, 0.28, 0, 1.062, 0, matPanel);
  // Belt buckle glow
  box(0.095, 0.075, 0.075, 0, 1.062, -0.152, matGlow);
  // Hip pods
  box(0.072, 0.130, 0.22, -0.272, 1.062, 0.00, matDark);
  box(0.072, 0.130, 0.22,  0.272, 1.062, 0.00, matDark);
  // Hip glow dots
  box(0.028, 0.055, 0.028, -0.272, 1.090, -0.120, matGlow);
  box(0.028, 0.055, 0.028,  0.272, 1.090, -0.120, matGlow);

  // ══ TORSO ════════════════════════════════════════════════════════════════
  // Core — wide heroic chest tapering to waist
  cyl(0.295, 0.230, 0.64, 0, 1.480, 0, matArmor, 8);
  // Chest front plate — main accent panel
  box(0.445, 0.50, 0.055, 0, 1.490, -0.238, matAccent);
  // Chest inner panel (dark recess)
  box(0.315, 0.345, 0.048, 0, 1.500, -0.260, matBase);
  // Horizontal accent lines (Apex style "chest stripe")
  box(0.360, 0.022, 0.030, 0, 1.340, -0.268, matGlow);
  box(0.360, 0.022, 0.030, 0, 1.640, -0.268, matGlow);
  // Vertical center spine glow
  box(0.030, 0.290, 0.030, 0, 1.490, -0.272, matGlow);
  // Arc reactor — torus + sphere core
  const reactorRing = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.022, 10, 28), matReactor);
  reactorRing.position.set(0, 1.490, -0.280);
  reactorRing.rotation.x = Math.PI / 2;
  group.add(reactorRing);
  group.userData.reactor = reactorRing;
  const reactorCore = new THREE.Mesh(new THREE.SphereGeometry(0.036, 10, 10), matReactor);
  reactorCore.position.set(0, 1.490, -0.292);
  group.add(reactorCore);
  // Back plate
  box(0.460, 0.52, 0.055, 0, 1.480, 0.238, matPanel);
  // Back vent slats (4)
  for (let i = 0; i < 4; i++) box(0.340, 0.026, 0.044, 0, 1.255 + i*0.110, 0.265, matDark);
  // Side torso energy strips
  box(0.030, 0.44, 0.28, -0.298, 1.460, 0, matGlow);
  box(0.030, 0.44, 0.28,  0.298, 1.460, 0, matGlow);
  // Collar ring
  cyl(0.205, 0.290, 0.11, 0, 1.815, 0, matBase, 8);

  // ══ SHOULDER PAULDRONS ═══════════════════════════════════════════════════
  // Sphere cap (Apex signature rounded shoulder)
  sph(0.192, -0.468, 1.698, 0, matAccent, 10);
  sph(0.192,  0.468, 1.698, 0, matAccent, 10);
  // Shoulder cylinder body
  cyl(0.158, 0.135, 0.26, -0.468, 1.610, 0, matAccent, 8);
  cyl(0.158, 0.135, 0.26,  0.468, 1.610, 0, matAccent, 8);
  // Panel inset on shoulder
  box(0.065, 0.14, 0.22, -0.490, 1.672, -0.085, matBase, -0.20, 0, 0);
  box(0.065, 0.14, 0.22,  0.490, 1.672, -0.085, matBase, -0.20, 0, 0);
  // Shoulder glow ring
  const sgL = new THREE.Mesh(new THREE.TorusGeometry(0.128, 0.016, 6, 22), matGlow);
  sgL.position.set(-0.468, 1.600, 0); group.add(sgL);
  const sgR = new THREE.Mesh(new THREE.TorusGeometry(0.128, 0.016, 6, 22), matGlow);
  sgR.position.set( 0.468, 1.600, 0); group.add(sgR);
  // Epaulette spike (swept forward)
  box(0.055, 0.115, 0.24, -0.492, 1.760, -0.095, matDark, -0.28, 0, 0);
  box(0.055, 0.115, 0.24,  0.492, 1.760, -0.095, matDark, -0.28, 0, 0);

  // ══ UPPER ARMS ═══════════════════════════════════════════════════════════
  const armL = cyl(0.095, 0.085, 0.42, -0.468, 1.365, 0, matArmor, 8);
  const armR = cyl(0.095, 0.085, 0.42,  0.468, 1.365, 0, matArmor, 8);
  group.userData.armL = armL;
  group.userData.armR = armR;
  // Arm front plate
  box(0.148, 0.30, 0.045, -0.468, 1.368, -0.105, matPanel);
  box(0.148, 0.30, 0.045,  0.468, 1.368, -0.105, matPanel);
  // Arm glow stripe
  box(0.030, 0.26, 0.030, -0.468, 1.368, -0.120, matGlow);
  box(0.030, 0.26, 0.030,  0.468, 1.368, -0.120, matGlow);

  // ══ ELBOWS ═══════════════════════════════════════════════════════════════
  cyl(0.095, 0.095, 0.070, -0.468, 1.155, 0, matDark, 8);
  cyl(0.095, 0.095, 0.070,  0.468, 1.155, 0, matDark, 8);
  // Elbow spur
  box(0.145, 0.060, 0.060, -0.508, 1.155, 0.025, matPanel);
  box(0.145, 0.060, 0.060,  0.508, 1.155, 0.025, matPanel);

  // ══ FOREARMS ═════════════════════════════════════════════════════════════
  cyl(0.085, 0.074, 0.34, -0.468, 0.970, 0, matPanel, 8);
  cyl(0.085, 0.074, 0.34,  0.468, 0.970, 0, matPanel, 8);
  // Forearm front guard (accent)
  box(0.128, 0.20, 0.048, -0.468, 0.972, -0.098, matAccent);
  box(0.128, 0.20, 0.048,  0.468, 0.972, -0.098, matAccent);

  // ══ GUN GAUNTLET (right arm) ═════════════════════════════════════════════
  const gunGroup = new THREE.Group();
  gunGroup.position.set(0.468, 0.790, -0.140);

  // Gauntlet knuckle housing
  const knuckle = new THREE.Mesh(new THREE.BoxGeometry(0.230, 0.160, 0.320), matBase);
  knuckle.position.set(0, 0, -0.020);
  gunGroup.add(knuckle);
  // Barrel (octagonal)
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.060, 0.072, 0.46, 8), matDark);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0, -0.190);
  gunGroup.add(barrel);
  // Heat sink fins (3)
  for (let i = 0; i < 3; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.188, 0.025, 0.110), matPanel);
    fin.position.set(0, 0.088, -0.145 + i * 0.00);
    gunGroup.add(fin);
  }
  // Muzzle glow ring
  const muzzleRing = new THREE.Mesh(new THREE.TorusGeometry(0.060, 0.013, 6, 18), matGlow);
  muzzleRing.position.set(0, 0, -0.422);
  gunGroup.add(muzzleRing);
  // Top rail
  const topRail = new THREE.Mesh(new THREE.BoxGeometry(0.030, 0.030, 0.42), matPanel);
  topRail.position.set(0, 0.082, -0.168);
  gunGroup.add(topRail);
  // Holographic sight
  const sightBody = new THREE.Mesh(new THREE.BoxGeometry(0.040, 0.048, 0.095), matDark);
  sightBody.position.set(0, 0.114, -0.072);
  gunGroup.add(sightBody);
  const sightLens = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.024, 0.022), matVisor);
  sightLens.position.set(0, 0.114, -0.118);
  gunGroup.add(sightLens);
  // Energy cell (left side, glowing)
  const cellMat = new THREE.MeshStandardMaterial({
    color, emissive: new THREE.Color(color), emissiveIntensity: 4.5, metalness: 0.3, roughness: 0.15,
  });
  const energyCell = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.090, 0.095), cellMat);
  energyCell.position.set(-0.082, 0, -0.078);
  gunGroup.add(energyCell);

  group.add(gunGroup);
  group.userData.gunGroup = gunGroup;

  // ══ NECK ═════════════════════════════════════════════════════════════════
  cyl(0.085, 0.100, 0.150, 0, 1.880, 0, matDark, 8);

  // ══ HELMET ═══════════════════════════════════════════════════════════════
  // Base skull (octagonal)
  cyl(0.228, 0.240, 0.43, 0, 2.120, 0, matBase, 8);
  // Dome cap
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(0.232, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), matBase);
  dome.position.set(0, 2.335, 0);
  dome.castShadow = true;
  group.add(dome);
  // Top helmet accent band (player color)
  box(0.325, 0.028, 0.275, 0, 2.360, 0, matAccent);
  // Brow ridge — overhangs the visor (Apex silhouette)
  box(0.370, 0.055, 0.065, 0, 2.198, -0.240, matAccent);
  // Cheek armor plates (angled, angular — Apex Legends look)
  box(0.065, 0.195, 0.088, -0.248, 2.085, -0.178, matAccent, 0,  0.24, 0);
  box(0.065, 0.195, 0.088,  0.248, 2.085, -0.178, matAccent, 0, -0.24, 0);
  // Visor — wide horizontal band (signature Apex/Farlight style)
  const vis = new THREE.Mesh(new THREE.BoxGeometry(0.345, 0.110, 0.090), matVisor);
  vis.position.set(0, 2.110, -0.246);
  group.add(vis);
  group.userData.visorMesh = vis;
  // Visor side wrap-arounds
  box(0.058, 0.078, 0.080, -0.208, 2.110, -0.238, matVisor);
  box(0.058, 0.078, 0.080,  0.208, 2.110, -0.238, matVisor);
  // Face recess behind visor
  box(0.265, 0.215, 0.045, 0, 2.090, -0.238, matDark);
  // Chin guard (armored)
  box(0.268, 0.095, 0.065, 0, 1.975, -0.228, matPanel);
  // Chin glow slot
  box(0.118, 0.032, 0.044, 0, 1.970, -0.248, matGlow);
  // Ear/temple vents (3 horizontal slats per side)
  for (let i = 0; i < 3; i++) {
    box(0.030, 0.030, 0.115, -0.248, 2.060 + i*0.062,  0.040, matDark);
    box(0.030, 0.030, 0.115,  0.248, 2.060 + i*0.062,  0.040, matDark);
  }
  // Rear helmet panel
  box(0.345, 0.350, 0.055, 0, 2.095, 0.240, matPanel);
  // Mohawk/crest (swept, player color — Farlight style)
  box(0.048, 0.225, 0.120, 0, 2.380, 0.078, matAccent, -0.24, 0, 0);
  // Antenna
  box(0.022, 0.240, 0.022, 0.158, 2.452, 0, matDark);
  cyl(0.022, 0.015, 0.048, 0.158, 2.578, 0, matGlow, 6);

  // ══ BACKPACK / JETPACK ═══════════════════════════════════════════════════
  box(0.385, 0.370, 0.095, 0, 1.488, 0.282, matPanel);
  box(0.305, 0.265, 0.055, 0, 1.488, 0.320, matDark);
  // Thruster nozzles
  cyl(0.048, 0.065, 0.145, -0.118, 1.295, 0.318, matDark, 8);
  cyl(0.048, 0.065, 0.145,  0.118, 1.295, 0.318, matDark, 8);
  // Thruster inner glow
  const tgL = new THREE.Mesh(new THREE.TorusGeometry(0.050, 0.012, 6, 18), matGlow);
  tgL.position.set(-0.118, 1.222, 0.305); group.add(tgL);
  const tgR = new THREE.Mesh(new THREE.TorusGeometry(0.050, 0.012, 6, 18), matGlow);
  tgR.position.set( 0.118, 1.222, 0.305); group.add(tgR);
  // Fin spines (3 swept-back)
  box(0.030, 0.285, 0.095, -0.165, 1.618, 0.285, matAccent, -0.30, 0, 0);
  box(0.030, 0.285, 0.095,  0.000, 1.640, 0.285, matAccent, -0.30, 0, 0);
  box(0.030, 0.285, 0.095,  0.165, 1.618, 0.285, matAccent, -0.30, 0, 0);

  return group;
}




function getOrCreateMesh(id) {
  if (playerMeshes.has(id)) return playerMeshes.get(id);

  const group = buildHumanoid(getPlayerColor(id));

  // Name tag sprite
  const nc   = document.createElement('canvas');
  nc.width = 256; nc.height = 48;
  const nctx = nc.getContext('2d');
  const tex  = new THREE.CanvasTexture(nc);
  const spriteMat = new THREE.SpriteMaterial({ map: tex, depthTest: true, transparent: true });
  const sprite = new THREE.Sprite(spriteMat);
  sprite.position.y = 2.55;
  sprite.scale.set(2.0, 0.38, 1);
  group.userData.nameCvs = nc;
  group.userData.nameCtx = nctx;
  group.userData.nameTex = tex;
  group.userData.nameSprite = sprite;
  group.add(sprite);

  // Target ring (hidden until this player is high-value target)
  const ringGeo = new THREE.TorusGeometry(0.55, 0.07, 8, 32);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xff3300, transparent: true, opacity: 0.9 });
  const ring    = new THREE.Mesh(ringGeo, ringMat);
  ring.position.y = 2.95;
  ring.rotation.x = Math.PI / 2;
  ring.visible    = false;
  group.userData.targetRing = ring;
  group.add(ring);

  // Shield bubble (hidden until shieldActive)
  const shieldGeo = new THREE.SphereGeometry(1.35, 16, 12);
  const shieldMat = new THREE.MeshBasicMaterial({
    color: 0x44ccff, transparent: true, opacity: 0.22,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const shieldBubble = new THREE.Mesh(shieldGeo, shieldMat);
  shieldBubble.position.y = 1.15;
  shieldBubble.visible = false;
  shieldBubble.renderOrder = 10;
  group.userData.shieldBubble = shieldBubble;
  group.add(shieldBubble);

  scene.add(group);
  playerMeshes.set(id, group);
  return group;
}

// ─── VIEWMODEL (first-person gun) ────────────────────────────────────────────
let vmScene, vmCamera, vmGunGroup, vmBarrel, vmCell, vmShieldGroup;
let vmBob       = 0;       // walk bob phase
let vmKick      = 0;       // shoot recoil 0→1 decays

function buildViewmodel() {
  vmScene  = new THREE.Scene();
  vmCamera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.01, 10);

  const plating = new THREE.MeshStandardMaterial({ color: 0x1e2e40, metalness: 0.6, roughness: 0.4 });
  const dark    = new THREE.MeshStandardMaterial({ color: 0x0a1018, metalness: 0.6, roughness: 0.4 });
  const joint   = new THREE.MeshStandardMaterial({ color: 0x101c28, metalness: 0.6, roughness: 0.4 });
  const glow    = new THREE.MeshStandardMaterial({ color: 0x59b8ff, emissive: new THREE.Color(0x1a4466), emissiveIntensity: 3, metalness: 0.6, roughness: 0.4 });
  const accent  = new THREE.MeshStandardMaterial({ color: 0x00ddff, emissive: new THREE.Color(0x006688), emissiveIntensity: 2, metalness: 0.6, roughness: 0.4 });

  vmGunGroup = new THREE.Group();
  vmGunGroup.position.set(0.22, -0.22, -0.44);
  vmGunGroup.rotation.x = 0.18;

  // ── Elbow cap (visible at screen edge) ──────────────────────────────────
  const elbow = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.13, 0.07), dark);
  elbow.position.set(0, 0, 0.27);
  vmGunGroup.add(elbow);

  // ── Forearm main body ───────────────────────────────────────────────────
  const forearm = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.11, 0.36), plating);
  forearm.position.set(0, 0, 0.07);
  vmGunGroup.add(forearm);

  // Top chamfer strip
  const topStrip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.02, 0.34), dark);
  topStrip.position.set(0, 0.065, 0.07);
  vmGunGroup.add(topStrip);

  // Side armour panels
  const panelL = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.075, 0.26), joint);
  panelL.position.set(-0.06, 0.01, 0.07);
  vmGunGroup.add(panelL);
  const panelR = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.075, 0.26), joint);
  panelR.position.set( 0.06, 0.01, 0.07);
  vmGunGroup.add(panelR);

  // Glowing energy stripe (top)
  vmCell = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.014, 0.28), glow);
  vmCell.position.set(0, 0.063, 0.07);
  vmGunGroup.add(vmCell);

  // Secondary side glow lines
  const glowL = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.008, 0.22), accent);
  glowL.position.set(-0.048, 0.04, 0.07);
  vmGunGroup.add(glowL);
  const glowR = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.008, 0.22), accent);
  glowR.position.set( 0.048, 0.04, 0.07);
  vmGunGroup.add(glowR);

  // Mid-forearm segment ring
  const ring = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.115, 0.022), dark);
  ring.position.set(0, 0, -0.055);
  vmGunGroup.add(ring);

  // ── Wrist ───────────────────────────────────────────────────────────────
  const wrist = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.115, 0.06), joint);
  wrist.position.set(0, 0, -0.135);
  vmGunGroup.add(wrist);
  // Wrist accent band
  const wristBand = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.025, 0.062), accent);
  wristBand.position.set(0, 0.05, -0.135);
  vmGunGroup.add(wristBand);

  // ── Palm ────────────────────────────────────────────────────────────────
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.11, 0.13), plating);
  palm.position.set(0, 0.005, -0.235);
  vmGunGroup.add(palm);
  // Palm top plate
  const palmTop = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.018, 0.11), dark);
  palmTop.position.set(0, 0.064, -0.235);
  vmGunGroup.add(palmTop);
  // Knuckle ridge
  const knuckles = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.022, 0.025), joint);
  knuckles.position.set(0, 0.062, -0.263);
  vmGunGroup.add(knuckles);

  // ── Fingers ─────────────────────────────────────────────────────────────
  const fxOffsets = [-0.040, 0, 0.040];
  for (const fx of fxOffsets) {
    // Proximal phalange
    const p1 = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.026, 0.052), plating);
    p1.position.set(fx, 0.005, -0.322);
    vmGunGroup.add(p1);
    // Joint gap
    const jg = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.010, 0.010), dark);
    jg.position.set(fx, 0.005, -0.352);
    vmGunGroup.add(jg);
    // Distal phalange
    const p2 = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.024, 0.040), plating);
    p2.position.set(fx, 0.005, -0.381);
    vmGunGroup.add(p2);
    // Fingertip
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.020, 0.020, 0.012), dark);
    tip.position.set(fx, 0.005, -0.406);
    vmGunGroup.add(tip);
  }

  // ── Palm cannon port ────────────────────────────────────────────────────
  const muzzle = new THREE.Mesh(new THREE.BoxGeometry(0.044, 0.044, 0.022), dark);
  muzzle.position.set(0, -0.012, -0.273);
  vmGunGroup.add(muzzle);
  vmGunGroup.userData.muzzle = muzzle;

  vmBarrel = new THREE.Mesh(new THREE.BoxGeometry(0.030, 0.030, 0.072), joint);
  vmBarrel.position.set(0, -0.012, -0.312);
  vmGunGroup.add(vmBarrel);

  // Glowing cannon ring
  const cannonGlow = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.038, 0.012), accent);
  cannonGlow.position.set(0, -0.012, -0.350);
  vmGunGroup.add(cannonGlow);

  // ── Muzzle flash (shown on shoot, decays quickly) ──────────────────────────
  // Layer 1 — additive soft glow disc
  const _flashMat = new THREE.MeshBasicMaterial({
    color: 0x88ffff, transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const _flashMesh = new THREE.Mesh(new THREE.CircleGeometry(0.10, 16), _flashMat);
  _flashMesh.position.set(0, -0.012, -0.385);
  vmGunGroup.add(_flashMesh);
  vmGunGroup.userData.muzzleFlash = _flashMesh;

  // Layer 2 — two crossed "blade" quads for an energy-star silhouette
  const _bladeMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const _bladeA = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.26), _bladeMat.clone());
  _bladeA.position.set(0, -0.012, -0.392);
  vmGunGroup.add(_bladeA);
  vmGunGroup.userData.muzzleBladeA = _bladeA;
  const _bladeB = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.05), _bladeMat.clone());
  _bladeB.position.set(0, -0.012, -0.392);
  vmGunGroup.add(_bladeB);
  vmGunGroup.userData.muzzleBladeB = _bladeB;

  // Layer 3 — brief dynamic point-light to flash-tint the gun metal
  const _muzzleLight = new THREE.PointLight(0x88ffee, 0, 2.5, 2);
  _muzzleLight.position.set(0, -0.012, -0.40);
  vmGunGroup.add(_muzzleLight);
  vmGunGroup.userData.muzzleLight = _muzzleLight;

  vmScene.add(vmGunGroup);

  // ── Shield (shown when shieldActive) ──────────────────────────────────────
  vmShieldGroup = new THREE.Group();

  const shieldMat = new THREE.MeshBasicMaterial({
    color: 0x00ccff,
    transparent: true,
    opacity: 0.55,
  });
  const shieldFace = new THREE.Mesh(new THREE.PlaneGeometry(0.30, 0.38), shieldMat);
  vmShieldGroup.add(shieldFace);
  vmShieldGroup.userData.face = shieldFace;

  // Thin bright border: four edge strips
  const edgeMat = new THREE.MeshBasicMaterial({ color: 0x55eeff });
  [[-0.155, 0, 0.19, 0.01, 0.38, 0.01],
   [ 0.155, 0, 0.19, 0.01, 0.38, 0.01],
   [0, 0.195, 0, 0.30, 0.01, 0.01],
   [0,-0.195, 0, 0.30, 0.01, 0.01]].forEach(([x, y, z, w, h, d]) => {
    const e = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), edgeMat);
    e.position.set(x, y, z);
    vmShieldGroup.add(e);
  });

  vmShieldGroup.visible = false;
  vmScene.add(vmShieldGroup);

  // Light so the gun isn't black
  const al = new THREE.AmbientLight(0xffffff, 1.5);
  vmScene.add(al);
  const dl = new THREE.DirectionalLight(0x88ccff, 1.0);
  dl.position.set(1, 2, 1);
  vmScene.add(dl);
}

// Call after initScene
let vmBuilt = false;

function ensureViewmodel() {
  if (vmBuilt) return;
  buildViewmodel();
  renderer.autoClear = false;
  vmBuilt = true;
  vmCamera.aspect = innerWidth / innerHeight;
  vmCamera.updateProjectionMatrix();
  window.addEventListener('resize', () => {
    vmCamera.aspect = innerWidth / innerHeight;
    vmCamera.updateProjectionMatrix();
  });
}

// Trigger shoot kick + muzzle flash
function vmShootKick() {
  vmKick = 1.0;
  const flash = vmGunGroup?.userData.muzzleFlash;
  if (flash) {
    flash.material.opacity = 1;
    flash.scale.setScalar(0.65 + Math.random() * 0.7);
    flash.rotation.z = Math.random() * Math.PI * 2;
  }
  // Cross blades — random streak length + spin, give the energy-star read
  const bladeA = vmGunGroup?.userData.muzzleBladeA;
  const bladeB = vmGunGroup?.userData.muzzleBladeB;
  if (bladeA && bladeB) {
    bladeA.material.opacity = 0.95;
    bladeB.material.opacity = 0.95;
    const aSc = 0.6 + Math.random() * 0.8;
    bladeA.scale.set(1, aSc, 1);
    bladeB.scale.set(aSc, 1, 1);
    bladeA.rotation.z = Math.random() * Math.PI;
    bladeB.rotation.z = Math.random() * Math.PI;
  }
  // Brief dynamic muzzle point-light — additive punch on top of the flash quad
  const light = vmGunGroup?.userData.muzzleLight;
  if (light) {
    light.intensity = 6.0;
    light.color.set(0x88ffee);
  }
}

// ─── ENERGY BULLET TRACERS ───────────────────────────────────────────────────
const activeBullets = [];
const _bDir   = new THREE.Vector3();
const _bRight = new THREE.Vector3();
const _bUp    = new THREE.Vector3(0, 1, 0);

// Shared geometry for tracer cores & glow shells — re-used per bullet.
const _tracerCoreGeo = new THREE.CylinderGeometry(0.03, 0.03, 1, 6);
const _tracerGlowGeo = new THREE.CylinderGeometry(0.10, 0.10, 1, 8);

function spawnBullet(mode) {
  if (!camera) return;
  camera.getWorldDirection(_bDir);
  _bRight.crossVectors(_bDir, _bUp).normalize();

  // Start just in front of the camera, offset toward the gun (right + slightly down)
  const origin = camera.position.clone()
    .addScaledVector(_bDir,   0.55)
    .addScaledVector(_bRight, 0.18)
    .addScaledVector(_bUp,   -0.10);

  const isHeavy = mode === 'heavy';
  const color   = isHeavy ? 0xff7700 : 0x00eeff;
  const coreW   = isHeavy ? 0.045  : 0.028;
  const glowW   = isHeavy ? 0.14   : 0.085;
  const length  = isHeavy ? 0.42  : 0.28;
  const speed   = isHeavy ? 85    : 115;
  const life    = 0.55;

  // Core — bright solid bolt (intense, opaque via additive)
  const coreMat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const core = new THREE.Mesh(_tracerCoreGeo, coreMat);
  core.scale.set(coreW, length, coreW);

  // Glow shell — soft halo around the core (additive, fades over life)
  const glowMat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.45,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const glow = new THREE.Mesh(_tracerGlowGeo, glowMat);
  glow.scale.set(glowW, length * 1.05, glowW);

  // Group both under one pivot, oriented along _bDir, then offset by half-length
  // so the rear tip starts at the muzzle and the bolt streams forward.
  const group = new THREE.Group();
  group.add(core);
  group.add(glow);
  group.position.copy(origin);
  // Cylinder's +Y axis — rotate so it aligns with the bullet direction.
  group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), _bDir);
  // Shift along forward by half the length so the bolt tails from the muzzle.
  group.position.addScaledVector(_bDir, length / 2);
  scene.add(group);

  activeBullets.push({
    group, core, glow,
    vel:  _bDir.clone().multiplyScalar(speed),
    life, maxLife: life,
    isHeavy,
  });
}

// ─── BULLET IMPACT EFFECTS ───────────────────────────────────────────────────
const activeImpacts = [];
const _sparkGeo    = new THREE.BoxGeometry(0.04, 0.04, 0.16);

function spawnImpact(pos, color = 0x00eeff) {
  if (!scene) return;
  // Expanding shock ring ( billboarded to the camera )
  const ringGeo = new THREE.RingGeometry(0.02, 0.15, 12);
  const ringMat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.95,
    side: THREE.DoubleSide, depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.position.copy(pos);
  if (camera) ring.lookAt(camera.position);
  scene.add(ring);

  // Central flash — bright additive disc, very short-lived
  const flashGeo = new THREE.CircleGeometry(0.10, 10);
  const flashMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 1.0,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const flash = new THREE.Mesh(flashGeo, flashMat);
  flash.position.copy(pos);
  if (camera) flash.lookAt(camera.position);
  scene.add(flash);

  // Spark fragments — tiny additive boxes hurled outward
  const sparks = [];
  const sparkCount = 5;
  for (let i = 0; i < sparkCount; i++) {
    const sm = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 1,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const s = new THREE.Mesh(_sparkGeo, sm);
    s.position.copy(pos);
    // Random dir on a hemisphere oriented roughly toward the camera (toward viewer)
    const ang = Math.random() * Math.PI * 2;
    const rad = 2.0 + Math.random() * 3.0;
    const dir = new THREE.Vector3(
      Math.cos(ang) * rad,
      (Math.random() - 0.2) * rad,
      Math.sin(ang) * rad,
    );
    scene.add(s);
    sparks.push({ mesh: s, vel: dir });
  }

  activeImpacts.push({
    ring, flash, sparks,
    life: 0.36, maxLife: 0.36,
  });
}

function updateImpacts(dt) {
  for (let i = activeImpacts.length - 1; i >= 0; i--) {
    const im = activeImpacts[i];
    im.life -= dt;
    if (im.life <= 0) {
      scene.remove(im.ring);  im.ring.geometry.dispose();  im.ring.material.dispose();
      scene.remove(im.flash); im.flash.geometry.dispose(); im.flash.material.dispose();
      for (const sp of im.sparks) {
        scene.remove(sp.mesh); sp.mesh.material.dispose();
      }
      activeImpacts.splice(i, 1);
    } else {
      const t = 1 - im.life / im.maxLife;     // 0 → 1
      // Ring expands and fades
      im.ring.material.opacity = 0.95 * (1 - t * t);
      im.ring.scale.setScalar(1 + t * 5);
      // Flash pops out then dies fast (first 30% of life)
      const ft = Math.min(1, t / 0.30);
      im.flash.material.opacity = 1 - ft;
      im.flash.scale.setScalar(1 + ft * 1.6);
      // Sparks fly, slow down, fade
      for (const sp of im.sparks) {
        sp.mesh.position.addScaledVector(sp.vel, dt);
        sp.vel.multiplyScalar(0.86);          // air drag
        sp.vel.y -= 8 * dt;                    // gravity
        sp.mesh.material.opacity = Math.max(0, 1 - t * 1.6);
        // Orient spark along its travel direction
        if (sp.vel.lengthSq() > 0.01) {
          sp.mesh.quaternion.setFromUnitVectors(
            new THREE.Vector3(0, 0, 1),
            sp.vel.clone().normalize(),
          );
        }
      }
    }
  }
}

function updateBullets(dt) {
  for (let i = activeBullets.length - 1; i >= 0; i--) {
    const b = activeBullets[i];
    // Move pivot forward by velocity — the bolt length stays in place behind it
    b.group.position.addScaledVector(b.vel, dt);
    b.life -= dt;
    if (b.life <= 0) {
      spawnImpact(b.group.position.clone(), b.isHeavy ? 0xff7700 : 0x00eeff);
      scene.remove(b.group);
      b.core.material.dispose();
      b.glow.material.dispose();
      activeBullets.splice(i, 1);
    } else {
      // Fade the glow halo as the bolt dies — gives a comet-tail feel
      const k = b.life / b.maxLife;
      b.glow.material.opacity = 0.45 * (0.4 + 0.6 * k);
      // Subtle pulsing core intensity
      b.core.material.opacity = 0.85 + 0.10 * Math.sin(b.life * 30);
    }
  }
}

// Update viewmodel each frame
function updateViewmodel(dt, moving, running, canFire = true, shielding = false) {
  if (!vmBuilt) return;

  const showShield = shielding;
  vmGunGroup.visible    = !showShield && canFire;
  vmShieldGroup.visible = showShield;

  // Walk bob
  if (moving) vmBob += dt * (running ? 14 : 9);
  const bobY = moving ? Math.sin(vmBob) * (running ? 0.022 : 0.012) : 0;
  const bobX = moving ? Math.sin(vmBob * 0.5) * (running ? 0.011 : 0.006) : 0;

  if (!showShield) {
    // Shoot kick (quick forward then back)
    vmKick = Math.max(0, vmKick - dt * 8);
    const kickZ = vmKick * 0.06;
    const kickY = vmKick * -0.025;

    vmGunGroup.position.set(
      0.22 + bobX,
      -0.22 + bobY + kickY,
      -0.44 + kickZ
    );
    vmGunGroup.rotation.x = 0.18;

    // Cell glow pulses when shooting
    vmCell.material.emissiveIntensity = 0.3 + vmKick * 1.5;

    // Decay muzzle flash — disc + two blades + light, all additive on top of the gun
    const _mf = vmGunGroup.userData.muzzleFlash;
    if (_mf) _mf.material.opacity = Math.max(0, _mf.material.opacity - dt * 24);
    const _bA = vmGunGroup.userData.muzzleBladeA;
    const _bB = vmGunGroup.userData.muzzleBladeB;
    if (_bA) _bA.material.opacity = Math.max(0, _bA.material.opacity - dt * 18);
    if (_bB) _bB.material.opacity = Math.max(0, _bB.material.opacity - dt * 18);
    const _ml = vmGunGroup.userData.muzzleLight;
    if (_ml) _ml.intensity = Math.max(0, _ml.intensity - dt * 36);
  } else {
    // Same position/bob as the gun — just replaces it
    vmShieldGroup.position.set(
      0.22 + bobX,
      -0.22 + bobY,
      -0.44
    );
    vmShieldGroup.rotation.set(0, 0, 0);
    // Opacity pulse
    const pulse = 0.45 + 0.15 * Math.sin(performance.now() * 0.005);
    vmShieldGroup.userData.face.material.opacity = pulse;
  }

  // Draw viewmodel on top of scene
  renderer.clearDepth();
  renderer.render(vmScene, vmCamera);
}

function removePlayerMesh(id) {
  const m = playerMeshes.get(id);
  if (m) { scene.remove(m); playerMeshes.delete(id); }
}

function updateNameTag(group, name, isTarget = false) {
  const { nameCvs, nameCtx, nameTex } = group.userData;
  if (group.userData.nameText === name && group.userData.nameTarget === isTarget) return;
  group.userData.nameText = name;
  group.userData.nameTarget = isTarget;

  nameCtx.clearRect(0, 0, 256, 48);
  nameCtx.font      = 'bold 24px sans-serif';
  nameCtx.textAlign = 'center';
  if (isTarget) {
    nameCtx.fillStyle   = 'rgba(200,40,10,0.82)';
    nameCtx.fillRect(10, 4, 236, 36);
    nameCtx.strokeStyle = 'rgba(255,120,0,0.9)';
    nameCtx.lineWidth   = 2;
    nameCtx.strokeRect(10, 4, 236, 36);
    nameCtx.fillStyle   = '#ffe066';
    nameCtx.fillText('🎯 ' + name.slice(0, 12), 128, 30);
  } else {
    nameCtx.fillStyle = 'rgba(0,0,0,0.5)';
    nameCtx.fillRect(20, 6, 216, 32);
    nameCtx.fillStyle = '#edf7fb';
    nameCtx.fillText(name.slice(0, 14), 128, 30);
  }
  nameTex.needsUpdate = true;
}

// ─── RENDER LOOP ─────────────────────────────────────────────────────────────
let _lastHUDUpdate = 0;
function renderLoop() {
  requestAnimationFrame(renderLoop);

  const now = performance.now();
  const dt  = Math.min((now - prevTime) / 1000, 0.1);
  prevTime  = now;

  // Apply accumulated mouse once per frame for smooth, stutter-free rotation
  if (isLocked && (_mouseAccX !== 0 || _mouseAccY !== 0)) {
    const sens = 0.0018;
    localYaw   -= _mouseAccX * sens;
    localPitch  = Math.max(-Math.PI / 2 + 0.01,
                    Math.min(Math.PI / 2 - 0.01, localPitch - _mouseAccY * sens));
    _mouseAccX = 0;
    _mouseAccY = 0;
  }

  const players = gameState?.players ?? [];
  const me = players.find(p => p.id === myId);

  if (isLocked && me && cfg) {
    const moving  = keys.w || keys.s || keys.a || keys.d;
    const running = moving && !isCrouching;

    // Footstep audio
    if (moving) startFootsteps(running);
    else stopFootsteps();

    // Auto-crouch after idle
    if (moving) {
      lastMoveTime = now;
      if (isCrouching) setCrouch(false);
    } else if (!isCrouching && (now - lastMoveTime) >= (cfg?.AUTO_CROUCH_MS ?? CFG.AUTO_CROUCH_MS)) {
      setCrouch(true);
    }

    // Client-side jump physics
    localGrounded = false; // reset each frame; set true by ground/box landing
    const prevLocalY = localPos.y;
    localVy -= 26 * dt;
    localPos.y += localVy * dt;
    // Land on top of boxes when falling
    if (localVy <= 0 && mapData) {
      const pr = cfg.PLAYER_RADIUS ?? CFG.PLAYER_RADIUS;
      for (const box of mapData.boxes) {
        const bTop = box.y + box.h / 2;
        if (prevLocalY >= bTop - 0.05 && localPos.y <= bTop &&
            Math.abs(localPos.x - box.x) < box.w / 2 + pr &&
            Math.abs(localPos.z - box.z) < box.d / 2 + pr) {
          localPos.y  = bTop;
          localVy     = 0;
          localGrounded = true;
          break;
        }
      }
    }
    if (localPos.y <= 1.6) { localPos.y = 1.6; localVy = 0; localGrounded = true; }

    // Jump charge bar while holding space
    if (spaceDownTime > 0 && localGrounded) {
      const charge = Math.min(1, (now - spaceDownTime) / SUPER_JUMP_CHARGE_MS);
      const bar = HUD.jumpChargeFill;
      if (bar) {
        bar.style.width = `${charge * 100}%`;
        bar.style.background = charge >= 1 ? '#ffe040' : '#74f0c6';
        bar.parentElement.style.opacity = '1';
      }
    } else {
      const bar = HUD.jumpChargeFill;
      if (bar) bar.parentElement.style.opacity = '0';
    }

    // Client-side movement prediction
    let mx = 0, mz = 0;
    if (keys.w) { mx -= Math.sin(localYaw); mz -= Math.cos(localYaw); }
    if (keys.s) { mx += Math.sin(localYaw); mz += Math.cos(localYaw); }
    if (keys.a) { mx += Math.sin(localYaw - Math.PI / 2); mz += Math.cos(localYaw - Math.PI / 2); }
    if (keys.d) { mx += Math.sin(localYaw + Math.PI / 2); mz += Math.cos(localYaw + Math.PI / 2); }
    const len = Math.sqrt(mx * mx + mz * mz);
    const isSuperOn = me?.superActive ?? false;
    const inAir = !localGrounded;
    const superMult = isSuperOn ? 1.5 : 1;
    const airMult   = inAir ? 1.2 : 1;
    const denjaMult = localCharacter === 'denja' ? 2   : 1;
    const tankMult  = localCharacter === 'tank'  ? 0.5 : 1;
    const speed = (isCrouching ? (cfg?.CROUCH_SPEED ?? CFG.CROUCH_SPEED)
          : running      ? (cfg?.RUN_SPEED   ?? CFG.RUN_SPEED)
          : (cfg?.PLAYER_SPEED ?? CFG.PLAYER_SPEED)) * superMult * airMult * denjaMult * tankMult;
    if (len > 0) {
      localPos.x += (mx / len) * speed * dt;
      localPos.z += (mz / len) * speed * dt;
    }

    // Client-side horizontal collision (mirrors server resolveCollision)
    if (mapData) {
      const pr = cfg?.PLAYER_RADIUS ?? CFG.PLAYER_RADIUS;
      const bound = (mapData.floor?.w ?? 250) / 2 - 0.5;
      localPos.x = Math.max(-bound, Math.min(bound, localPos.x));
      localPos.z = Math.max(-bound, Math.min(bound, localPos.z));
      for (let pass = 0; pass < 3; pass++) {
        for (const box of mapData.boxes) {
          const hw   = box.w / 2 + pr;
          const hd   = box.d / 2 + pr;
          const bTop = box.y + box.h / 2;
          const bBot = box.y - box.h / 2;
          if (localPos.y < bTop && localPos.y > bBot) {
            if (Math.abs(localPos.x - box.x) < hw && Math.abs(localPos.z - box.z) < hd) {
              const dxP = (box.x + hw) - localPos.x;
              const dxN = localPos.x - (box.x - hw);
              const dzP = (box.z + hd) - localPos.z;
              const dzN = localPos.z - (box.z - hd);
              const mn = Math.min(dxP, dxN, dzP, dzN);
              if      (mn === dxP) localPos.x = box.x + hw;
              else if (mn === dxN) localPos.x = box.x - hw;
              else if (mn === dzP) localPos.z = box.z + hd;
              else                  localPos.z = box.z - hd;
            }
          }
        }
      }
    }

    // Send input at 30 Hz
    if (now - lastInputSent > 33) {
      safeSend({
        type:    'input',
        forward: keys.w, back: keys.s, left: keys.a, right: keys.d,
        run:     running,
        yaw:     localYaw,
        pitch:   localPitch,
        dt:      Math.min(dt * 2, 0.08),
      });
      lastInputSent = now;
    }

    // Apply camera — smoothly lerp eye height for crouch
    const targetEyeH = isCrouching ? (cfg?.CROUCH_EYE_HEIGHT ?? CFG.CROUCH_EYE_HEIGHT) : (cfg?.EYE_HEIGHT ?? CFG.EYE_HEIGHT);
    localEyeH += (targetEyeH - localEyeH) * Math.min(1, dt * 12);
    camera.position.set(localPos.x, localPos.y + localEyeH, localPos.z);
    camera.rotation.order = 'YXZ';
    camera.rotation.y     = localYaw;
    camera.rotation.x     = localPitch;
  }

  // Sync other player meshes from server state
  if (gameState) {
    const seenIds = new Set();
    for (const p of gameState.players) {
      seenIds.add(p.id);
      if (p.id === myId) {
        // Gently correct local position to server truth
        if (p.alive) {
          localPos.x += (p.x - localPos.x) * 0.12;
          localPos.z += (p.z - localPos.z) * 0.12;
          // Gently correct Y — don't fight local jump prediction
          localPos.y += (p.y - localPos.y) * 0.22;
        }
        continue;
      }
      if (!p.alive) { removePlayerMesh(p.id); continue; }
      // Invisible (Chumantr cloak) — hide mesh for all other players
      if (p.invisible) {
        const m = playerMeshes.get(p.id);
        if (m) m.visible = false;
        continue;
      }
      const isTarget = p.id === gameState.highValueTargetId;
      const mesh = getOrCreateMesh(p.id);
      mesh.visible = true;
      const meshY = p.crouching ? p.y - 0.5 : p.y;
      mesh.position.set(p.x, meshY, p.z);
      mesh.scale.y = p.crouching ? 0.65 : 1;
      mesh.rotation.y = -p.yaw;
      // Distance-based LOD: skip walk animation beyond 60 units
      const _distSq = (p.x - localPos.x) ** 2 + (p.z - localPos.z) ** 2;
      // Only animate limbs when player is actually moving
      const _prev  = playerPrevPos.get(p.id);
      const _moved = _prev ? ((p.x - _prev.x) ** 2 + (p.z - _prev.z) ** 2) > 0.0002 : false;
      playerPrevPos.set(p.id, { x: p.x, z: p.z });
      if (_distSq < 3600) {
        if (_moved) {
          const walkPhase = now * 0.006;
          if (mesh.userData.legL) mesh.userData.legL.rotation.x =  Math.sin(walkPhase) * 0.4;
          if (mesh.userData.legR) mesh.userData.legR.rotation.x = -Math.sin(walkPhase) * 0.4;
          if (mesh.userData.armL) mesh.userData.armL.rotation.x = -Math.sin(walkPhase) * 0.3;
          if (mesh.userData.armR) mesh.userData.armR.rotation.x =  Math.sin(walkPhase) * 0.3;
        } else {
          // Smoothly return limbs to neutral when idle
          if (mesh.userData.legL) mesh.userData.legL.rotation.x *= 0.82;
          if (mesh.userData.legR) mesh.userData.legR.rotation.x *= 0.82;
          if (mesh.userData.armL) mesh.userData.armL.rotation.x *= 0.82;
          if (mesh.userData.armR) mesh.userData.armR.rotation.x *= 0.82;
        }
      }

      // Cannon recoil (game feel)
      if (mesh.userData.gunGroup) {
        const recoilBaseZ = -0.12;
        const recoilAmount = Math.sin(now * 0.005 * 5) * 0.01;
        mesh.userData.gunGroup.position.z = recoilBaseZ + recoilAmount;
      }

      // Arc reactor pulse
      if (mesh.userData.reactor) {
        const reactorPulse = 4 + 2.5 * Math.sin(now * 0.0035);
        mesh.userData.reactor.material.emissiveIntensity = reactorPulse;
      }

      // Target ring spin + visibility
      if (mesh.userData.targetRing) {
        const ring = mesh.userData.targetRing;
        ring.visible = isTarget;
        if (isTarget) {
          ring.rotation.z += 0.04;
          ring.material.depthTest = false;
          ring.material.depthWrite = false;
          ring.renderOrder = 999;
          // Pulse scale
          const pulse = 1 + 0.18 * Math.sin(now * 0.004);
          ring.scale.set(pulse, pulse, 1);
        } else {
          ring.material.depthTest = true;
          ring.renderOrder = 0;
        }
      }
      // Name tag: targets always visible through walls at full opacity; others fade by distance
      if (mesh.userData.nameSprite) {
        if (isTarget) {
          mesh.userData.nameSprite.material.depthTest = false;
          mesh.userData.nameSprite.renderOrder = 999;
          mesh.userData.nameSprite.material.opacity = 1;
          mesh.userData.nameSprite.visible = true;
        } else {
          mesh.userData.nameSprite.material.depthTest = true;
          mesh.userData.nameSprite.renderOrder = 0;
          const dist = Math.sqrt(_distSq);
          const FADE_START = 18, FADE_END = 35;
          const alpha = Math.max(0, 1 - (dist - FADE_START) / (FADE_END - FADE_START));
          mesh.userData.nameSprite.material.opacity = alpha;
          mesh.userData.nameSprite.visible = alpha > 0.01;
        }
      }
      updateNameTag(mesh, p.name, isTarget);
      // Shield bubble visibility + pulse
      if (mesh.userData.shieldBubble) {
        const sb = mesh.userData.shieldBubble;
        sb.visible = !!p.shieldActive;
        if (p.shieldActive) {
          const pulse = 0.18 + 0.08 * Math.sin(now * 0.006);
          sb.material.opacity = pulse;
          sb.scale.setScalar(1 + 0.06 * Math.sin(now * 0.004));
        }
      }
    }
    // Remove stale meshes
    for (const [id] of playerMeshes) {
      if (!seenIds.has(id)) removePlayerMesh(id);
    }
  }

  // Drift clouds
  for (const c of cloudMeshes) {
    c.position.x += c.userData.driftX * dt;
    c.position.z += c.userData.driftZ * dt;
    // Wrap around the arena so clouds are always present
    if (c.position.x >  500) c.position.x = -500;
    if (c.position.x < -500) c.position.x =  500;
    if (c.position.z >  500) c.position.z = -500;
    if (c.position.z < -500) c.position.z =  500;
  }

  // Render via post-processing composer (bloom on all emissive elements)
  if (composer) composer.render();
  else renderer.render(scene, camera);

  updateBullets(dt);
  updateImpacts(dt);

  // Viewmodel on top
  if (vmBuilt && me) {
    const moving   = keys.w || keys.s || keys.a || keys.d;
    const isRun    = moving && !isCrouching;
    const shotCost = cfg?.SHOT_COST_SINGLE ?? CFG.SHOT_COST_SINGLE;
    const canFire  = me.health > shotCost;
    const shielding = !!me.shieldActive;
    updateViewmodel(dt, moving && isLocked, isRun && isLocked, canFire, shielding);
  }

  // Throttle HUD DOM updates to 10 Hz (reduces DOM churn under high player counts)
  if (now - _lastHUDUpdate > 100) {
    updateHUD();
    _lastHUDUpdate = now;
  }
}

// ─── HUD UPDATE ───────────────────────────────────────────────────────────────
const HUD = {
  hpFill: null, healthVal: null, respawnOverlay: null, respawnCount: null,
  myScore: null, matchTimer: null, playerCount: null, aliveCount: null,
  ammoLine: null, cloakOverlay: null, targetBadge: null, targetArrow: null, targetDist: null, jumpChargeFill: null,
  superHUD: null, superLabel: null, superBarFill: null, superOverlay: null,
  shieldHUD: null, shieldLabel: null, shieldBarFill: null, shieldOverlay: null,
  classIcon: null, className: null, classCD: null, classFill: null,
  crouchOverlay: null, crouchHUD: null, killBoostOverlay: null, killBoostHUD: null,
  teleportFlash: null, hitFlash: null, hpBar: null, killBoostMult: null, killBoostTimer: null,
};

function ensureHUDElements() {
  if (HUD.hpFill) return;
  HUD.hpFill = document.getElementById('hpFill');
  HUD.healthVal = document.getElementById('healthVal');
  HUD.respawnOverlay = document.getElementById('respawnOverlay');
  HUD.respawnCount = document.getElementById('respawnCount');
  HUD.myScore = document.getElementById('myScore');
  HUD.matchTimer = document.getElementById('matchTimer');
  HUD.playerCount = document.getElementById('playerCount');
  HUD.aliveCount = document.getElementById('aliveCount');
  HUD.ammoLine = document.getElementById('ammoLine');
  HUD.cloakOverlay = document.getElementById('cloakOverlay');
  HUD.targetBadge = document.getElementById('targetBadge');
  HUD.jumpChargeFill = document.getElementById('jumpChargeFill');
  HUD.targetArrow = document.getElementById('targetArrow');
  HUD.targetDist = document.getElementById('targetDist');
  HUD.superHUD = document.getElementById('superHUD');
  HUD.superLabel = document.getElementById('superLabel');
  HUD.superBarFill = document.getElementById('superBarFill');
  HUD.superOverlay = document.getElementById('superOverlay');
  HUD.shieldHUD = document.getElementById('shieldHUD');
  HUD.shieldLabel = document.getElementById('shieldLabel');
  HUD.shieldBarFill = document.getElementById('shieldBarFill');
  HUD.shieldOverlay = document.getElementById('shieldOverlay');
  HUD.classIcon = document.getElementById('classAbilityIcon');
  HUD.className = document.getElementById('classAbilityName');
  HUD.classCD = document.getElementById('classAbilityCD');
  HUD.classFill = document.getElementById('classAbilityCDFill');
  HUD.crouchOverlay = document.getElementById('crouchOverlay');
  HUD.crouchHUD = document.getElementById('crouchHUD');
  HUD.killBoostOverlay = document.getElementById('killBoostOverlay');
  HUD.killBoostHUD = document.getElementById('killBoostHUD');
  HUD.teleportFlash = document.getElementById('teleportFlash');
  HUD.hitFlash = document.getElementById('hitFlash');
  HUD.hpBar = document.getElementById('hpBar');
  HUD.killBoostMult = document.getElementById('killBoostMult');
  HUD.killBoostTimer = document.getElementById('killBoostTimer');
}

let prevHealth = 200;
let prevSuperActive = false;
let prevSuperReady  = false;
let prevShieldReady = false;
let prevClassReady  = false;
let _toastTimer = null;
function showAbilityToast(msg) {
  const el = document.getElementById('abilityToast');
  if (!el) return;
  if (_toastTimer) { clearTimeout(_toastTimer); el.classList.remove('show'); void el.offsetWidth; }
  el.textContent = msg;
  el.classList.add('show');
  _toastTimer = setTimeout(() => { el.classList.remove('show'); _toastTimer = null; }, 3000);
}
function updateHUD() {
  if (!gameState || !myId) return;
  ensureHUDElements();

  const me = gameState.players.find(p => p.id === myId);
  if (!me) return;

  // HP bar
  const pct = Math.max(0, me.health / (cfg?.MAX_HEALTH ?? CFG.MAX_HEALTH) * 100);
  if (HUD.hpFill) HUD.hpFill.style.width = `${pct}%`;
  if (HUD.healthVal) {
    HUD.healthVal.textContent = Math.ceil(me.health);
    HUD.healthVal.className = me.health < 60 ? 'low' : '';
  }

  // Hit flash + sound when HP drops (ignore super activation cost)
  // flash/sound now driven by server 'hit' message — not HP polling
  if (!me.alive && prevHealth > 0) sndDie();
  // Recharge sound: play while crouching and health is actively regenerating
  const isRecharging = me.alive && me.crouching && me.health < (cfg?.MAX_HEALTH ?? CFG.MAX_HEALTH);
  if (isRecharging) startRecharge(); else stopRecharge();
  prevHealth = me.alive ? me.health : 0;
  prevSuperActive = me.superActive;

  // Respawn countdown overlay
  if (HUD.respawnOverlay && HUD.respawnCount) {
    if (!me.alive && me.respawnAt > 0) {
      const secsLeft = Math.ceil((me.respawnAt - Date.now()) / 1000);
      HUD.respawnCount.textContent = Math.max(0, secsLeft);
      HUD.respawnOverlay.classList.add('show');
    } else {
      HUD.respawnOverlay.classList.remove('show');
    }
  }

  // Score
  if (HUD.myScore) HUD.myScore.textContent = `Score: ${me.score}`;

  // Timer
  const t   = Math.max(0, gameState.matchTime);
  const min = Math.floor(t / 60);
  const sec = Math.floor(t % 60);
  if (HUD.matchTimer) HUD.matchTimer.textContent = `${min}:${String(sec).padStart(2, '0')}`;

  // Player count — use server-provided count (spatial snapshot omits distant players)
  const total = gameState.playerCount ?? gameState.players.length;
  const maxP  = cfg?.MAX_PLAYERS ?? CFG.MAX_PLAYERS;
  if (HUD.playerCount) HUD.playerCount.textContent = `${total}/${maxP} players`;

  // Alive count
  const alive = gameState.aliveCount ?? gameState.players.filter(p => p.alive).length;
  if (HUD.aliveCount) HUD.aliveCount.textContent = `${alive} alive`;

  // Energy (health = ammo)
  const shotCost = cfg?.SHOT_COST_SINGLE ?? 2;
  const canFire  = me.health > shotCost;
  if (HUD.ammoLine) {
    HUD.ammoLine.className = canFire ? '' : 'low';
    HUD.ammoLine.textContent = canFire ? '−2 energy / shot' : '⚡  LOW ENERGY';
  }

  // Charge pips
  updateChargeHUD();

  // Top-3 leaderboard (use server-computed global ranking; fall back to local sort)
  const sorted = gameState.leaderboard ?? [...gameState.players].sort((a, b) => b.score - a.score).slice(0, 3);
  const lbEl = document.getElementById('leaderboard');
  lbEl.innerHTML = sorted.map((p, i) => {
    const cls = p.id === myId ? 'lb-row lb-me' : i === 0 ? 'lb-row lb-first' : 'lb-row';
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉';
    const name = p.name.length > 12 ? p.name.slice(0, 11) + '…' : p.name;
    return `<div class="${cls}"><span class="lb-rank">${medal}</span><span class="lb-name">${name}</span><span class="lb-score">${p.score}</span></div>`;
  }).join('');

  // Target arrow removed — element no longer in DOM, skip

  // Crouch indicator
  if (HUD.crouchHUD && HUD.crouchOverlay) {
    if (me.crouching) {
      HUD.crouchHUD.className = 'visible';
      HUD.crouchOverlay.classList.add('active');
    } else {
      HUD.crouchHUD.className = '';
      HUD.crouchOverlay.classList.remove('active');
    }
  }

  // Kill boost HUD — now just a brief flash on kill (handled in ws message handler)
  // No persistent banner needed

  // High-value target HUD badge + directional arrow
  const hvt = gameState.highValueTargetId
    ? gameState.players.find(p => p.id === gameState.highValueTargetId)
    : null;
  if (HUD.targetBadge && HUD.targetArrow && HUD.targetDist) {
    if (hvt && hvt.id !== myId) {
      const dx   = hvt.x - localPos.x;
      const dz   = hvt.z - localPos.z;
      const dist = Math.round(Math.sqrt(dx * dx + dz * dz));
      HUD.targetBadge.textContent = `🎯 TARGET  ${hvt.name.slice(0, 14)}  ·  ${dist}m`;
      HUD.targetBadge.classList.add('active');
      HUD.targetBadge.classList.remove('self');
      // Directional arrow — project target world pos to screen
      const hvtVec = new THREE.Vector3(hvt.x, hvt.y + 1.6, hvt.z);
      hvtVec.project(camera);
      const onScreen = hvtVec.z < 1 && Math.abs(hvtVec.x) < 1 && Math.abs(hvtVec.y) < 1;
      if (!onScreen) {
        const ax = hvtVec.x, ay = -hvtVec.y;
        const angle = Math.atan2(ay, ax);
        const margin = 40;
        const hw = window.innerWidth / 2;
        const hh = window.innerHeight / 2;
        const cosA = Math.cos(angle), sinA = Math.sin(angle);
        const tx = cosA === 0 ? Infinity : (cosA > 0 ? hw - margin : -hw + margin) / cosA;
        const ty = sinA === 0 ? Infinity : (sinA > 0 ? hh - margin : -hh + margin) / sinA;
        const t  = Math.min(Math.abs(tx), Math.abs(ty));
        const ex = hw + cosA * t;
        const ey = hh + sinA * t;
        HUD.targetArrow.style.left = `${ex}px`;
        HUD.targetArrow.style.top  = `${ey}px`;
        HUD.targetArrow.style.transform = 'translate(-50%, -50%)';
        HUD.targetDist.textContent = `🎯 ${dist}m`;
        HUD.targetArrow.classList.add('active');
      } else {
        HUD.targetArrow.classList.remove('active');
      }
    } else if (hvt && hvt.id === myId) {
      HUD.targetBadge.textContent = '🎯 YOU ARE THE TARGET';
      HUD.targetBadge.classList.add('active', 'self');
      HUD.targetArrow.classList.remove('active');
    } else {
      HUD.targetBadge.className = 'target-badge';
      HUD.targetArrow.classList.remove('active');
    }
  }

  // Super mode HUD
  const superDuration = cfg?.SUPER_DURATION ?? 10000;
  const superCost     = cfg?.SUPER_COST ?? 50;

  const superReady = !me.superActive && me.health >= superCost + 1;
  if (!prevSuperReady && superReady) showAbilityToast('⚡  SUPER READY  [E]');
  prevSuperReady = superReady;

  if (HUD.superHUD && HUD.superLabel && HUD.superBarFill && HUD.superOverlay) {
    if (me.superActive) {
      const left    = Math.max(0, me.superEnd - Date.now());
      const pctLeft = (left / superDuration) * 100;
      HUD.superHUD.className = 'visible super-active';
      HUD.superLabel.textContent = `⚡ SUPER  ${(left / 1000).toFixed(1)}s`;
      HUD.superBarFill.style.width = `${pctLeft}%`;
      HUD.superOverlay.classList.add('active');
    } else if (superReady) {
      HUD.superHUD.className = 'visible super-ready';
      HUD.superLabel.textContent = '[E]  SUPER READY';
      HUD.superBarFill.style.width = '100%';
      HUD.superOverlay.classList.remove('active');
    } else {
      HUD.superHUD.className = '';
      HUD.superOverlay.classList.remove('active');
    }
  }

  // Shield HUD
  const shieldDuration = cfg?.SHIELD_DURATION ?? 10000;
  const shieldCost     = cfg?.SHIELD_COST ?? 80;

  const shieldReady = !me.shieldActive && me.health >= shieldCost + 1;
  if (!prevShieldReady && shieldReady) showAbilityToast('🛡  SHIELD READY  [R]');
  prevShieldReady = shieldReady;

  if (HUD.shieldHUD && HUD.shieldLabel && HUD.shieldBarFill && HUD.shieldOverlay) {
    if (me.shieldActive) {
      const left = Math.max(0, me.shieldEnd - Date.now());
      const pctLeft = (left / shieldDuration) * 100;
      HUD.shieldHUD.className = 'visible';
      HUD.shieldLabel.textContent = `🛡 SHIELD  ${(left / 1000).toFixed(1)}s`;
      HUD.shieldBarFill.style.width = `${pctLeft}%`;
      HUD.shieldOverlay.classList.add('active');
      HUD.shieldLabel.style.fontSize = '15px';
      HUD.shieldLabel.style.opacity = '';
      HUD.shieldLabel.style.textShadow = '';
    } else if (shieldReady) {
      HUD.shieldHUD.className = 'visible';
      HUD.shieldLabel.textContent = '[R]  SHIELD READY';
      HUD.shieldBarFill.style.width = '100%';
      HUD.shieldOverlay.classList.remove('active');
      HUD.shieldLabel.style.fontSize = '13px';
      HUD.shieldLabel.style.opacity = '0.6';
      HUD.shieldLabel.style.textShadow = 'none';
    } else {
      HUD.shieldHUD.className = '';
      HUD.shieldOverlay.classList.remove('active');
    }
  }

  // Cloak overlay (chumantr)
  document.getElementById('cloakOverlay').classList.toggle('active', !!me.invisible);

  // Class ability HUD
  const char = me.character ?? localCharacter;
  const CHAR_LABEL = { telepotu: '⚡ WARP', chumantr: '👻 CLOAK', denja: '🔥 2× SPEED', mednix: '💊 SURGE', tank: '🛡 PASSIVE', anchor: '⚓ IMMUNITY', surge: '🌀 DRAIN', jinx: '💀 CURSE', gambler: '🎲 ALL IN', parasite: '🧫 DRAIN AURA', berserker: '🔴 RAGE' };
  const CHAR_CD = { telepotu: 60000, chumantr: 30000, denja: -1, mednix: 20000, tank: -1, anchor: -1, surge: 25000, jinx: -1, gambler: 45000, parasite: -1, berserker: -1 };
  const cd = CHAR_CD[char] ?? 30000;

  if (HUD.classIcon && HUD.className && HUD.classCD && HUD.classFill) {
    HUD.classIcon.textContent = { denja:'🔥', chumantr:'👻', mednix:'💊', tank:'🛡', anchor:'⚓', surge:'🌀', jinx:'💀', gambler:'🎲', parasite:'🧫', berserker:'🔴' }[char] ?? '⚡';
    HUD.className.textContent = `[Q] ${CHAR_LABEL[char] ?? char.toUpperCase()}`;
    if (cd < 0) {
      HUD.classCD.textContent = 'PASSIVE';
      HUD.classFill.style.width = '100%';
      HUD.classFill.style.background = '#ff6644';
      prevClassReady = true;
    } else {
      const elapsed = Date.now() - (me.lastAbilityAt ?? 0);
      const ready = elapsed >= cd;
      const pct = Math.min(100, (elapsed / cd) * 100);
      if (!prevClassReady && ready) showAbilityToast(`${HUD.classIcon.textContent}  ABILITY READY  [Q]`);
      prevClassReady = ready;
      HUD.classCD.textContent = ready ? 'READY' : `${Math.ceil((cd - elapsed) / 1000)}s`;
      HUD.classCD.style.color = ready ? 'var(--accent)' : 'var(--muted)';
      HUD.classFill.style.width = `${pct}%`;
      HUD.classFill.style.background = ready ? 'var(--accent)' : '#4488aa';
    }
  }
}

// ─── SCOREBOARD ───────────────────────────────────────────────────────────────
function showScoreboard() {
  if (!gameState) return;
  const overlay = document.getElementById('scoreboardOverlay');
  const list    = document.getElementById('scoreboardList');
  const title   = document.getElementById('scoreboardTitle');
  const maxP    = cfg?.MAX_PLAYERS ?? 50;
  title.textContent = `SCOREBOARD  ·  ${gameState.playerCount ?? gameState.players.length}/${maxP} PLAYERS`;
  const sorted = [...gameState.players].sort((a, b) => b.score - a.score);
  list.innerHTML = `<div class="sb-header">
    <span></span><span>PLAYER</span><span style="text-align:right">KILLS</span><span style="text-align:right">HP</span>
  </div>` + sorted.map((p, i) => {
    const classes = ['sb-row', p.id === myId ? 'sb-me' : '', !p.alive ? 'sb-dead' : ''].filter(Boolean).join(' ');
    const name = p.name.length > 20 ? p.name.slice(0, 19) + '\u2026' : p.name;
    const hp   = p.alive ? Math.ceil(p.health) : '\u2620';
    return `<div class="${classes}">
      <span class="sb-rank">${i + 1}</span>
      <span class="sb-name">${name}</span>
      <span class="sb-score">${p.score}</span>
      <span class="sb-hp">${hp}</span>
    </div>`;
  }).join('');
  overlay.classList.add('show');
}

function hideScoreboard() {
  document.getElementById('scoreboardOverlay').classList.remove('show');
}

// ─── CHAT ─────────────────────────────────────────────────────────────────────
function openChat() {
  if (!myId || matchEnded) return;
  isChatting = true;
  // Release keys that might be held so player doesn't keep moving
  keys.w = keys.a = keys.s = keys.d = false;
  unlockPointer();
  const wrap  = document.getElementById('chatWrap');
  const input = document.getElementById('chatInput');
  wrap.classList.add('show');
  input.value = '';
  input.focus();
}

function closeChat() {
  isChatting = false;
  document.getElementById('chatWrap').classList.remove('show');
  document.getElementById('chatInput').blur();
  if (!matchEnded) lockPointer();
}

function sendChat() {
  const text = document.getElementById('chatInput').value.trim();
  if (text) safeSend({ type: 'chat', text });
  closeChat();
}

document.getElementById('chatInput').addEventListener('keydown', e => {
  if (e.key === 'Enter')  { e.stopPropagation(); sendChat(); }
  if (e.key === 'Escape') { e.stopPropagation(); closeChat(); }
});


function addKillFeed(text, mine) {
  const feed = document.getElementById('killFeed');
  const el   = document.createElement('div');
  el.className   = mine ? 'kf-item kf-mine' : 'kf-item';
  el.textContent = text;
  feed.appendChild(el);
  // Fade and remove after 4 s
  setTimeout(() => { el.style.opacity = '0'; }, 3500);
  setTimeout(() => { el.remove(); }, 4000);
}

// ─── WS MESSAGES ─────────────────────────────────────────────────────────────
function _onWSMessage(e) {
  const msg = JSON.parse(e.data);

  if (msg.type === 'hitConfirm') {
    const ch = document.getElementById('crosshair');
    if (ch) {
      ch.classList.add('hit');
      // Two-stage pop: snap big, then settle back — already hits .hit via CSS for color.
      ch.style.transform = 'translate(-50%, -50%) scale(1.55)';
      setTimeout(() => { ch.style.transform = ''; }, 90);
      setTimeout(() => ch.classList.remove('hit'), 160);
    }
    return;
  }

  if (msg.type === 'chatMsg') {
    const feed = document.getElementById('killFeed');
    const el   = document.createElement('div');
    el.className = 'kf-item kf-chat';
    el.innerHTML = `<span class="kf-chat-name">${msg.name}</span>: ${msg.text}`;
    feed.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; }, 7000);
    setTimeout(() => { el.remove(); }, 7500);
    return;
  }

  if (msg.type === 'pong') {
    latencyMs = Date.now() - msg.ts;
    const el = document.getElementById('pingDisplay');
    if (el) {
      el.textContent = `${latencyMs}ms`;
      el.className = latencyMs > 150 ? 'ping-high' : latencyMs > 80 ? 'ping-mid' : 'ping-ok';
    }
    return;
  }

  if (msg.type === 'welcome') {
    myId    = msg.playerId;
    mapData = generateMap(msg.seed);
    cfg     = { ...CFG, ...msg.cfg };
    buildMap(scene, mapData);
    showGame();
    return;
  }

  if (msg.type === 'gameState') {
    gameState = msg;
    // updateHUD is throttled to 10 Hz in the render loop
    return;
  }

  if (msg.type === 'teleported') {
    // Snap local position to new coords
    localPos.x = msg.x;
    localPos.y = msg.y;
    localPos.z = msg.z;
    // Flash effect
    const tf = document.getElementById('teleportFlash');
    tf.classList.add('show');
    setTimeout(() => tf.classList.remove('show'), 180);
    // Kill feed
    addKillFeed(`⟳ Teleport: swapped with ${msg.targetName}`, true);
    return;
  }

  if (msg.type === 'hit') {
    sndHit();
    const flash = document.getElementById('hitFlash');
    flash.classList.add('show');
    setTimeout(() => flash.classList.remove('show'), 150);
    document.getElementById('hpBar').classList.add('hurt');
    setTimeout(() => document.getElementById('hpBar').classList.remove('hurt'), 300);
    return;
  }

  if (msg.type === 'kill') {
    const mine = msg.shooterId === myId;
    if (mine) {
      sndKill();
      // Brief green flash + +100 HP banner
      const kbFlash = document.getElementById('killBoostOverlay');
      kbFlash.style.transition = 'none';
      kbFlash.style.boxShadow = 'inset 0 0 180px 60px rgba(60,255,140,0.55)';
      kbFlash.style.opacity = '1';
      setTimeout(() => { kbFlash.style.transition = 'opacity 0.4s'; kbFlash.style.boxShadow = ''; }, 200);
      const hud = document.getElementById('killBoostHUD');
      document.getElementById('killBoostMult').textContent = '+100 HP';
      document.getElementById('killBoostTimer').textContent = '';
      hud.classList.add('active');
      setTimeout(() => hud.classList.remove('active'), 1800);
    }
    const _kt   = gameState?.players.find(p => p.id === msg.targetId);
    const _kdist = _kt ? Math.round(Math.sqrt((_kt.x - localPos.x) ** 2 + (_kt.z - localPos.z) ** 2)) : null;
    const _dtag  = _kdist !== null ? ` · ${_kdist}m` : '';
    addKillFeed(`${msg.shooterName} ☠ ${msg.targetName}${_dtag}${mine ? '  +100hp' : ''}`, mine);
    return;
  }

  if (msg.type === 'surgeDrain') {
    addKillFeed(`🌀 Drained ${msg.amount} HP from ${msg.targetName}`, true);
    // Brief teal flash to signal successful drain
    const flash = document.getElementById('hitFlash');
    flash.style.background = 'rgba(0,220,180,0.28)';
    flash.classList.add('show');
    setTimeout(() => { flash.classList.remove('show'); flash.style.background = ''; }, 200);
    return;
  }

  if (msg.type === 'gamblerResult') {
    if (msg.result === 'heal') {
      addKillFeed('🎲 LUCKY! +200 HP', true);
      const flash = document.getElementById('hitFlash');
      flash.style.background = 'rgba(80,255,120,0.35)';
      flash.classList.add('show');
      setTimeout(() => { flash.classList.remove('show'); flash.style.background = ''; }, 300);
    } else if (msg.result === 'teleport') {
      localPos.x = msg.x; localPos.y = msg.y; localPos.z = msg.z;
      addKillFeed(`🎲 WILD! Landed on ${msg.targetName}`, true);
      const tf = document.getElementById('teleportFlash');
      tf.classList.add('show');
      setTimeout(() => tf.classList.remove('show'), 180);
    } else if (msg.result === 'death') {
      addKillFeed('🎲 DOOM. You gambled and lost.', true);
    }
    return;
  }

  if (msg.type === 'jinxCurse') {
    addKillFeed(`💀 CURSED by ${msg.fromName} −${msg.amount} HP`, true);
    const flash = document.getElementById('hitFlash');
    flash.style.background = 'rgba(160,0,200,0.4)';
    flash.classList.add('show');
    setTimeout(() => { flash.classList.remove('show'); flash.style.background = ''; }, 400);
    return;
  }

  if (msg.type === 'matchEnd') {
    matchEnded = true;
    unlockPointer();
    showEndScreen(msg.winners);
    return;
  }

  if (msg.type === 'error') {
    alert(msg.reason ?? 'Server error');
  }
}

function _onWSClose() {
  if (!matchEnded)
    addKillFeed('Disconnected from server.', false);
}

// ─── POINTER LOCK ─────────────────────────────────────────────────────────────
function lockPointer() {
  if (!matchEnded) {
    document.body.requestPointerLock()?.catch?.(() => {});
  }
}

function unlockPointer() {
  document.exitPointerLock?.();
}

document.addEventListener('pointerlockchange', () => {
  isLocked = document.pointerLockElement === document.body;
  if (myId && !isChatting) {
    document.getElementById('lockPrompt').style.display = isLocked ? 'none' : 'flex';
  }
  if (isChatting) document.getElementById('lockPrompt').style.display = 'none';
});

document.addEventListener('mousemove', e => {
  if (!isLocked) return;
  // Clamp per-event delta to avoid the single large spike on lock acquisition
  _mouseAccX += Math.max(-80, Math.min(80, e.movementX));
  _mouseAccY += Math.max(-80, Math.min(80, e.movementY));
});

// ─── KEYBOARD ────────────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.repeat) return;
  if (isChatting) return;
  const k = e.key.toLowerCase();
  if (k === 'enter' && isLocked && myId && !matchEnded) { e.preventDefault(); openChat(); return; }
  if (k === 'w') keys.w = true;
  if (k === 'a') keys.a = true;
  if (k === 's') keys.s = true;
  if (k === 'd') keys.d = true;
  // 'r' does nothing — energy weapon has no reload
  if (k === 'e' && isLocked) { resumeAudio(); sndSuper(); safeSend({ type: 'super' }); }
  if (k === 'r' && isLocked) { resumeAudio(); safeSend({ type: 'shield' }); }
  if (k === 'q' && isLocked) {
    resumeAudio();
    safeSend({ type: 'classAbility' });
  }
  if (k === ' ' || k === 'spacebar') {
    e.preventDefault();
    if (isLocked && localGrounded && !isCrouching && spaceDownTime === 0)
      spaceDownTime = performance.now();
    return;
  }
  if (k === 'c' || k === 'control') setCrouch(!isCrouching);
  if (k === 'tab') {
    e.preventDefault();
    showScoreboard();
  }
  if (k === 'f') { e.preventDefault(); showScoreboard(); }
});

document.addEventListener('keyup', e => {
  const k = e.key.toLowerCase();
  if (k === 'w') keys.w = false;
  if (k === 'a') keys.a = false;
  if (k === 's') keys.s = false;
  if (k === 'd') keys.d = false;
  if (k === 'f' || k === 'tab') hideScoreboard();
  if ((k === ' ' || k === 'spacebar') && isLocked) {
    if (spaceDownTime > 0 && localGrounded && !isCrouching) {
      const held = performance.now() - spaceDownTime;
      if (held >= SUPER_JUMP_CHARGE_MS) {
        const me = gameState?.players.find(p => p.id === myId);
        if (me && me.health > (cfg?.SUPER_JUMP_COST ?? CFG.SUPER_JUMP_COST)) {
          localVy = 44; localGrounded = false;
          safeSend({ type: 'jump_super' });
          playTone(0, 'sine', 0.18, 0.28, 220, 880); // super jump sound
        } else {
          // Not enough HP — do a regular jump anyway
          localVy = 14; localGrounded = false;
          safeSend({ type: 'jump' });
        }
      } else {
        localVy = 14; localGrounded = false;
        safeSend({ type: 'jump' });
      }
    }
    spaceDownTime = 0;
    const bar = document.getElementById('jumpChargeFill');
    if (bar) bar.parentElement.style.opacity = '0';
  }
});

// ─── MOUSE CLICK (shoot + lock) ──────────────────────────────────────────────
document.addEventListener('mousedown', e => {
  if (e.button === 2) {
    // Right-click: start charging
    if (!gameStarted || !isLocked) return;
    startCharging();
    return;
  }
  if (e.button !== 0) return;
  resumeAudio();
  if (!gameStarted) return;
  if (!isLocked) { lockPointer(); return; }
  const me = gameState?.players.find(p => p.id === myId);
  if (me?.shieldActive) return;
  const shotCost = cfg?.SHOT_COST_SINGLE ?? 2;
  if ((me?.health ?? 0) <= shotCost) return;
  if (chargeCount > 0) {
    // Release charged burst
    const shots = chargeCount;
    chargeCount = 0;
    updateChargeHUD();
    for (let i = 0; i < shots; i++) {
      setTimeout(() => { sndShoot('single'); vmShootKick(); spawnBullet('single'); }, i * 60);
    }
    safeSend({ type: 'chargedShoot', count: shots });
  } else {
    // Normal single shot
    sndShoot('single');
    vmShootKick();
    spawnBullet('single');
    safeSend({ type: 'shoot' });
  }
});

document.addEventListener('mouseup', e => {
  if (e.button === 2) stopCharging();
});

document.addEventListener('contextmenu', e => e.preventDefault());

// ─── LOBBY ────────────────────────────────────────────────────────────────────
let gameStarted = false;

document.getElementById('joinBtn').addEventListener('click', () => {
  const name = document.getElementById('nameInput').value.trim() || 'Anonymous';
  // Start Three.js and request pointer lock now, while the user gesture is active.
  // This avoids the SecurityError that occurs when requestPointerLock() is called
  // from an async WebSocket message handler (no user gesture present).
  if (!gameStarted) {
    gameStarted = true;
    initScene();
    ensureViewmodel();
    renderLoop();
  }
  lockPointer();
  const doJoin = () => ws.send(JSON.stringify({ type: 'join', name, character: localCharacter }));
  if (ws.readyState === WebSocket.OPEN) {
    doJoin();
  } else if (ws.readyState === WebSocket.CONNECTING) {
    ws.addEventListener('open', doJoin, { once: true });
  } else {
    connectWS();
    ws.addEventListener('open', doJoin, { once: true });
  }
});

// Character card selection
document.querySelectorAll('.char-card').forEach(card => {
  card.addEventListener('click', () => {
    document.querySelectorAll('.char-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    localCharacter = card.dataset.char;
  });
});

document.getElementById('nameInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('joinBtn').click();
});

// ─── SCREEN TRANSITIONS ──────────────────────────────────────────────────────
function showGame() {
  document.getElementById('lobby').style.display = 'none';
  document.getElementById('hud').classList.add('visible');
  // Show lock prompt only if pointer isn't already locked (it was requested on button click)
  document.getElementById('lockPrompt').style.display = isLocked ? 'none' : 'flex';
}

function showEndScreen(winners) {
  document.getElementById('endScreen').style.display = 'flex';
  const medals = ['🥇', '🥈', '🥉'];
  document.getElementById('winnerList').innerHTML = winners.map((w, i) =>
    `<div class="winner-row">
       <span class="medal">${medals[i] ?? ''}</span>
       <span class="winner-name">${w.name}</span>
       <span class="winner-score">${w.score} kill${w.score !== 1 ? 's' : ''}</span>
     </div>`
  ).join('');
}

document.getElementById('replayBtn').addEventListener('click', () => {
  location.reload();
});
