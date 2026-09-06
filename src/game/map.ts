import { makePRNG } from './prng'

export interface Box {
  x: number
  y: number
  z: number
  w: number
  h: number
  d: number
  type: string
  biome: string
}

export interface Spawn {
  x: number
  y: number
  z: number
}

export interface MapData {
  floor: { w: number; d: number }
  boxes: Box[]
  spawns: Spawn[]
  pois: any[]
}

export function generateMap(seed: number): MapData {
  const rng = makePRNG(seed)
  const SIZE = 750
  const HALF = SIZE / 2
  const boxes: Box[] = []
  const spawns: Spawn[] = []

  function box(x: number, y: number, z: number, w: number, h: number, d: number, type = 'cover', biome = 'neutral') {
    boxes.push({ x, y, z, w, h, d, type, biome })
  }

  function tieredCover(r: number) {
    if (r < 0.25) return { h: 0.7 + rng() * 0.35, w: 2 + rng() * 3.5 }
    if (r < 0.60) return { h: 1.4 + rng() * 0.8, w: 2 + rng() * 4.5 }
    return { h: 2.5 + rng() * 2.5, w: 2 + rng() * 6 }
  }

  // Outer perimeter boundary walls
  const wH = 12
  const wT = 2
  box(0, wH / 2, -HALF, SIZE, wH, wT, 'wall', 'neutral')
  box(0, wH / 2, HALF, SIZE, wH, wT, 'wall', 'neutral')
  box(-HALF, wH / 2, 0, wT, wH, SIZE, 'wall', 'neutral')
  box(HALF, wH / 2, 0, wT, wH, SIZE, 'wall', 'neutral')

  // 5-Floor Central Meridian Hub / Office Building
  const FLOORS = 5
  const FH = 3.8
  const BLDG_H = FLOORS * FH
  box(0, BLDG_H / 2, 0, 20, BLDG_H, 15, 'house_body', 'neutral')
  box(0, BLDG_H / 2, 7.6, 16, BLDG_H, 0.4, 'house_window', 'neutral')
  box(0, BLDG_H / 2, -7.6, 16, BLDG_H, 0.4, 'house_window', 'neutral')

  for (let f = 0; f < FLOORS; f++) {
    const wy = (f + 0.55) * FH
    box(-10.2, wy, -1, 0.3, FH * 0.58, 5.5, 'house_window', 'neutral')
    box(-10.2, wy, 5, 0.3, FH * 0.58, 4.0, 'house_window', 'neutral')
    box(10.2, wy, -1, 0.3, FH * 0.58, 5.5, 'house_window', 'neutral')
    box(10.2, wy, 5, 0.3, FH * 0.58, 4.0, 'house_window', 'neutral')
  }
  for (let f = 1; f <= FLOORS; f++) {
    box(0, f * FH, 0, 21, 0.35, 16, 'platform', 'neutral')
  }
  box(0, BLDG_H + 0.65, 0, 22, 1.3, 17, 'wall', 'neutral')
  box(-5, BLDG_H + 1.6, -1, 5, 1.8, 3.5, 'cover', 'neutral')
  box(5, BLDG_H + 1.6, -1, 5, 1.8, 3.5, 'cover', 'neutral')
  box(0, BLDG_H + 1.3, 4, 3, 1.4, 2.5, 'house_chimney', 'neutral')

  // Entrance & plaza platforms
  box(0, 0.05, 10.5, 16, 0.1, 5, 'path', 'neutral')
  box(0, FH - 0.1, 10.8, 16, 0.35, 4.8, 'platform', 'neutral')
  box(-3.2, FH * 0.42, 7.7, 3.0, FH * 0.78, 0.3, 'house_door', 'neutral')
  box(3.2, FH * 0.42, 7.7, 3.0, FH * 0.78, 0.3, 'house_door', 'neutral')
  for (const px of [-5.5, 0, 5.5]) {
    box(px, FH / 2, 13, 0.7, FH, 0.7, 'pillar', 'neutral')
  }
  box(0, 0.3, -11, 16, 0.6, 7, 'platform', 'neutral')
  box(-9, 0.45, 11, 4, 0.9, 2.5, 'garden', 'neutral')
  box(9, 0.45, 11, 4, 0.9, 2.5, 'garden', 'neutral')

  // Courtyard & surrounding fortifications
  const BH = 22, WT = 2, WH = 14, DW = 4, DH = 5
  box(-13, WH / 2, -BH, 18, WH, WT, 'building', 'neutral')
  box(13, WH / 2, -BH, 18, WH, WT, 'building', 'neutral')
  box(0, DH + (WH - DH) / 2, -BH, DW * 2, WH - DH, WT, 'building', 'neutral')

  box(-13, WH / 2, BH, 18, WH, WT, 'building', 'neutral')
  box(13, WH / 2, BH, 18, WH, WT, 'building', 'neutral')
  box(0, DH + (WH - DH) / 2, BH, DW * 2, WH - DH, WT, 'building', 'neutral')

  box(BH, WH / 2, -13, WT, WH, 18, 'building', 'neutral')
  box(BH, WH / 2, 13, WT, WH, 18, 'building', 'neutral')
  box(BH, DH + (WH - DH) / 2, 0, WT, WH - DH, DW * 2, 'building', 'neutral')

  box(-BH, WH / 2, -13, WT, WH, 18, 'building', 'neutral')
  box(-BH, WH / 2, 13, WT, WH, 18, 'building', 'neutral')
  box(-BH, DH + (WH - DH) / 2, 0, WT, WH - DH, DW * 2, 'building', 'neutral')

  // Corner towers
  box(-BH, WH / 2, -BH, 4, WH, 4, 'building', 'neutral')
  box(BH, WH / 2, -BH, 4, WH, 4, 'building', 'neutral')
  box(-BH, WH / 2, BH, 4, WH, 4, 'building', 'neutral')
  box(BH, WH / 2, BH, 4, WH, 4, 'building', 'neutral')

  box(0, WH + 0.5, 0, BH * 2 + 2, 1, BH * 2 + 2, 'platform', 'neutral')
  box(-14, WH / 2, -14, 2.5, WH, 2.5, 'pillar', 'neutral')
  box(14, WH / 2, -14, 2.5, WH, 2.5, 'pillar', 'neutral')
  box(-14, WH / 2, 14, 2.5, WH, 2.5, 'pillar', 'neutral')
  box(14, WH / 2, 14, 2.5, WH, 2.5, 'pillar', 'neutral')

  // Central tactical cover
  box(8, 1, -8, 4, 2, 3, 'cover', 'neutral')
  box(-8, 1, 8, 3, 2, 4, 'cover', 'neutral')
  box(-8, 1, -8, 3, 2, 3, 'cover', 'neutral')
  box(8, 1, 8, 4, 2, 4, 'cover', 'neutral')
  box(0, 7.5, -15, 36, 1, 12, 'platform', 'neutral')
  box(0, 9.5, -9, 36, 2, 1, 'cover', 'neutral')
  box(16, 1.5, 0, 4, 3, 4, 'cover', 'neutral')
  box(16, 3.5, -5, 4, 3, 4, 'cover', 'neutral')
  box(16, 7, -11, 4, 2, 4, 'cover', 'neutral')

  // Roads & markings
  box(0, 0.05, 45, 6.5, 0.1, 70, 'path', 'neutral')
  box(0, 0.05, -45, 6.5, 0.1, 70, 'path', 'neutral')
  for (let pz = 17; pz < 82; pz += 5) box(0, 0.1, pz, 0.28, 0.015, 2.2, 'road_marking', 'neutral')
  for (let pz = -17; pz > -82; pz -= 5) box(0, 0.1, pz, 0.28, 0.015, 2.2, 'road_marking', 'neutral')
  for (const side of [-1, 1]) {
    box(side * 3.6, 0.12, 45, 0.5, 0.24, 70, 'platform', 'neutral')
    box(side * 3.6, 0.12, -45, 0.5, 0.24, 70, 'platform', 'neutral')
  }

  // Streetlamps & bollards
  for (const [lx, lz, arm] of [
    [-4, 30, 1], [4, 30, -1], [-4, 57, 1], [4, 57, -1],
    [-4, -30, 1], [4, -30, -1], [-4, -57, 1], [4, -57, -1]
  ] as const) {
    box(lx, 5.1, lz, 0.28, 10.2, 0.28, 'lamp_post', 'neutral')
    box(lx + arm * 1.3, 9.75, lz, 2.6, 0.22, 0.22, 'lamp_post', 'neutral')
    box(lx + arm * 2.5, 9.48, lz, 0.9, 0.45, 0.70, 'lamp_head', 'neutral')
  }
  for (const pz of [22, 32, 42, 52, 62, 72, -22, -32, -42, -52, -62, -72] as const) {
    box(-4.6, 0.55, pz, 0.38, 1.1, 0.38, 'bollard', 'neutral')
    box(4.6, 0.55, pz, 0.38, 1.1, 0.38, 'bollard', 'neutral')
  }

  // Plaza fountain & benches
  box(0, 0.5, 17, 8, 1, 8, 'fountain_base', 'neutral')
  box(0, 1.2, 17, 6, 0.4, 6, 'fountain_rim', 'neutral')
  box(0, 1.5, 17, 1.5, 3, 1.5, 'fountain_pillar', 'neutral')
  for (const [bx, bz, bw, bd] of [
    [-12, 17, 5, 1.5], [12, 17, 5, 1.5], [-12, -17, 5, 1.5], [12, -17, 5, 1.5]
  ] as const) {
    box(bx, 0.6, bz, bw, 1.2, bd, 'bench', 'neutral')
    box(bx, 1.5, bz - bd * 0.3, bw, 1.5, 0.3, 'bench', 'neutral')
  }

  // Procedural scatter over the 750x750 perimeter
  for (let i = 0; i < 360; i++) {
    const x = (rng() - 0.5) * (SIZE - 30)
    const z = (rng() - 0.5) * (SIZE - 30)
    const dc = Math.sqrt(x * x + z * z)
    if (dc < 105) continue
    if (dc < 195 && rng() < 0.68) continue
    const biome = x > 5 ? 'terra' : x < -5 ? 'barren' : 'neutral'
    const { h, w } = tieredCover(rng())
    box(x, h / 2, z, w, h, w * (0.5 + rng() * 1.0), 'cover', biome)
  }
  for (let i = 0; i < 90; i++) {
    const x = (rng() - 0.5) * (SIZE - 40)
    const z = (rng() - 0.5) * (SIZE - 40)
    if (Math.sqrt(x * x + z * z) < 84) continue
    const biome = x > 0 ? 'terra' : 'barren'
    const h = 10 + rng() * 22, w = 1.5 + rng() * 2.5
    box(x, h / 2, z, w, h, w, 'pillar', biome)
  }
  for (let i = 0; i < 75; i++) {
    const x = (rng() - 0.5) * (SIZE - 50)
    const z = (rng() - 0.5) * (SIZE - 50)
    if (Math.sqrt(x * x + z * z) < 75) continue
    const biome = x > 0 ? 'terra' : 'barren'
    const elev = 4 + rng() * 7, pw = 7 + rng() * 14, pd = 7 + rng() * 14
    box(x, elev + 0.5, z, pw, 1.2, pd, 'platform', biome)
    box(x, elev / 2, z, 1.2, elev, 1.2, 'pillar', biome)
  }

  // Hideouts
  function buildHideout(hx: number, hz: number, biome: string) {
    const bw = 10 + rng() * 12, bd = 10 + rng() * 12, wh = 8 + rng() * 5, wt = 1.5, dw = 2.5, dh = 5.0
    function hbox(dx: number, dy: number, dz: number, w: number, h: number, d: number) {
      boxes.push({ x: hx + dx, y: dy, z: hz + dz, w, h, d, type: 'rand_building', biome })
    }
    function wallFace(dir: string, facePos: number, span: number) {
      const dox = (rng() - 0.5) * (span - dw - 2)
      const lw = span + dox - dw, rw = span - dox - dw
      const lc = -span + lw / 2, rc = dox + dw + rw / 2
      function panel(sc: number, fp: number, pw: number) {
        const hasWin = rng() < 0.65 && pw > 4.5
        if (hasWin) {
          const ww = Math.min(2.5, pw - 1.5), sill = 2.2, winTop = 4.2, side = (pw - ww) / 2
          if (dir === 'z') {
            hbox(sc - ww / 2 - side / 2, wh / 2, fp, side, wh, wt)
            hbox(sc + ww / 2 + side / 2, wh / 2, fp, side, wh, wt)
            hbox(sc, sill / 2, fp, ww, sill, wt)
            hbox(sc, winTop + (wh - winTop) / 2, fp, ww, wh - winTop, wt)
          } else {
            hbox(fp, wh / 2, sc - ww / 2 - side / 2, wt, wh, side)
            hbox(fp, wh / 2, sc + ww / 2 + side / 2, wt, wh, side)
            hbox(fp, sill / 2, sc, wt, sill, ww)
            hbox(fp, winTop + (wh - winTop) / 2, sc, wt, wh - winTop, ww)
          }
        } else {
          if (dir === 'z') hbox(sc, wh / 2, fp, pw, wh, wt)
          else hbox(fp, wh / 2, sc, wt, wh, pw)
        }
      }
      if (lw > 0.5) panel(lc, facePos, lw)
      if (rw > 0.5) panel(rc, facePos, rw)
      if (wh > dh + 0.3) {
        if (dir === 'z') hbox(dox, dh + (wh - dh) / 2, facePos, dw * 2, wh - dh, wt)
        else hbox(facePos, dh + (wh - dh) / 2, dox, wt, wh - dh, dw * 2)
      }
    }
    wallFace('z', -(bd + wt / 2), bw + wt)
    wallFace('z', (bd + wt / 2), bw + wt)
    wallFace('x', -(bw + wt / 2), bd)
    wallFace('x', (bw + wt / 2), bd)
    if (rng() < 0.6) boxes.push({ x: hx, y: wh + 0.5, z: hz, w: (bw + wt) * 2, h: 1, d: (bd + wt) * 2, type: 'platform', biome })
    if (rng() < 0.5) boxes.push({ x: hx, y: 1, z: hz, w: 2 + rng() * 3, h: 2, d: 2 + rng() * 3, type: 'cover', biome })
    spawns.push({ x: hx, y: 1.6, z: hz })
  }

  const HIDEOUT_COUNT = 10 + Math.floor(rng() * 11)
  for (let attempt = 0, placed = 0; attempt < 300 && placed < HIDEOUT_COUNT; attempt++) {
    const hx = (rng() - 0.5) * (SIZE - 80), hz = (rng() - 0.5) * (SIZE - 80)
    if (hx * hx + hz * hz < 110 * 110) continue
    const biome = hx > 5 ? 'terra' : hx < -5 ? 'barren' : 'neutral'
    buildHideout(hx, hz, biome)
    placed++
  }

  // Spawns around cover
  const coverPool = boxes.filter(b => b.type === 'cover' || b.type === 'ruins')
  for (let i = 0; i < Math.min(30, coverPool.length); i++) {
    const b = coverPool[i]
    spawns.push({ x: b.x + 3, y: 1.6, z: b.z + 3 })
  }

  // Canonical outpost spawns
  for (const [x, z] of [
    [330, 330], [-330, 330], [330, -330], [-330, -330],
    [360, 0], [-360, 0], [0, 360], [0, -360],
    [180, 300], [-180, 300], [180, -300], [-180, -300],
    [0, 50], [0, -50], [50, 0], [-50, 0]
  ] as const) {
    spawns.push({ x, y: 1.6, z })
  }

  return {
    floor: { w: SIZE, d: SIZE },
    boxes,
    spawns,
    pois: []
  }
}
