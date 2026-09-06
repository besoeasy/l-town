// Mulberry32 seeded pseudo-random number generator
export function makePRNG(seed: number) {
  let s = (seed >>> 0) || 1
  return function next(): number {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function getDailySeed(): number {
  const d = new Date()
  const str = `${String(d.getDate()).padStart(2, '0')}${String(d.getMonth() + 1).padStart(2, '0')}${d.getFullYear()}`
  return parseInt(str, 10) >>> 0
}
