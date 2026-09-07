import { CFG } from './config'
import type { Box, MapData } from './map'
import { groundHeight } from './map'

export function createBoxGrid(map: MapData, BOX_CELL = 20) {
  const grid = new Map<number, Box[]>()
  for (const box of map.boxes) {
    const x0 = Math.floor((box.x - box.w / 2 - 1) / BOX_CELL)
    const x1 = Math.floor((box.x + box.w / 2 + 1) / BOX_CELL)
    const z0 = Math.floor((box.z - box.d / 2 - 1) / BOX_CELL)
    const z1 = Math.floor((box.z + box.d / 2 + 1) / BOX_CELL)
    for (let gx = x0; gx <= x1; gx++) {
      for (let gz = z0; gz <= z1; gz++) {
        const k = (gx + 200) * 1000 + (gz + 200)
        let arr = grid.get(k)
        if (!arr) {
          arr = []
          grid.set(k, arr)
        }
        arr.push(box)
      }
    }
  }

  return {
    grid,
    nearby: (x: number, z: number): Box[] => {
      const cx = Math.floor(x / BOX_CELL)
      const cz = Math.floor(z / BOX_CELL)
      const seen = new Set<Box>()
      const out: Box[] = []
      for (let gx = cx - 1; gx <= cx + 1; gx++) {
        for (let gz = cz - 1; gz <= cz + 1; gz++) {
          const arr = grid.get((gx + 200) * 1000 + (gz + 200))
          if (!arr) continue
          for (const b of arr) {
            if (!seen.has(b)) {
              seen.add(b)
              out.push(b)
            }
          }
        }
      }
      return out
    }
  }
}

export function resolveCollision(
  x: number,
  y: number,
  z: number,
  map: MapData,
  nearby: (x: number, z: number) => Box[]
): { x: number; y: number; z: number } {
  const bound = map.floor.w / 2 - 0.5
  x = Math.max(-bound, Math.min(bound, x))
  z = Math.max(-bound, Math.min(bound, z))

  const boxes = nearby(x, z)
  for (let pass = 0; pass < 3; pass++) {
    for (const box of boxes) {
      const hw = box.w / 2 + CFG.PLAYER_RADIUS
      const hd = box.d / 2 + CFG.PLAYER_RADIUS
      const bTop = box.y + box.h / 2
      const bBot = box.y - box.h / 2
      if (y < bTop && y > bBot && Math.abs(x - box.x) < hw && Math.abs(z - box.z) < hd) {
        const dxP = box.x + hw - x
        const dxN = x - (box.x - hw)
        const dzP = box.z + hd - z
        const dzN = z - (box.z - hd)
        const mn = Math.min(dxP, dxN, dzP, dzN)
        if (mn === dxP) x = box.x + hw
        else if (mn === dxN) x = box.x - hw
        else if (mn === dzP) z = box.z + hd
        else z = box.z - hd
      }
    }
  }
  return { x, y, z }
}

export function rayVsBox(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  box: Box
): number {
  const hx = box.w / 2, hy = box.h / 2, hz = box.d / 2
  let tmin = -Infinity, tmax = Infinity
  for (const [o, d, c, h] of [
    [ox, dx, box.x, hx],
    [oy, dy, box.y, hy],
    [oz, dz, box.z, hz]
  ] as const) {
    if (Math.abs(d) < 1e-9) {
      if (o < c - h || o > c + h) return Infinity
    } else {
      const t1 = (c - h - o) / d
      const t2 = (c + h - o) / d
      tmin = Math.max(tmin, Math.min(t1, t2))
      tmax = Math.min(tmax, Math.max(t1, t2))
      if (tmin > tmax) return Infinity
    }
  }
  if (tmax < 0) return Infinity
  return tmin >= 0 ? tmin : 0
}

export interface PlayerTarget {
  id: number
  x: number
  y: number
  z: number
  alive: boolean
}

export function raycastPlayers(
  shooterId: number,
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  players: PlayerTarget[],
  map: MapData
): { id: number; t: number } | null {
  let best: { id: number; t: number } | null = null
  for (const p of players) {
    if (p.id === shooterId || !p.alive) continue
    const py = p.y + CFG.PLAYER_HEIGHT * 0.5
    const cx = p.x - ox, cy = py - oy, cz = p.z - oz
    const t = cx * dx + cy * dy + cz * dz
    if (t < 0 || t > 140) continue
    const ex = ox + t * dx - p.x
    const ey = oy + t * dy - py
    const ez = oz + t * dz - p.z
    const r2 = ex * ex + ey * ey * 0.4 + ez * ez
    if (r2 < 0.6 * 0.6 && (!best || t < best.t)) {
      best = { id: p.id, t }
    }
  }

  if (best) {
    for (const box of map.boxes) {
      const bt = rayVsBox(ox, oy, oz, dx, dy, dz, box)
      if (bt < best.t - 0.1) {
        best = null
        break
      }
    }
  }

  // Rolling terrain blocks hitscan too: march the ray until the player hit
  if (best) {
    for (let t = 2; t < best.t; t += 2) {
      const px = ox + dx * t
      const pz = oz + dz * t
      if (oy + dy * t < groundHeight(px, pz, map.seed) + 0.2) {
        best = null
        break
      }
    }
  }
  return best
}
