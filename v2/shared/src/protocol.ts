// v2 binary protocol — msgpack + per-client delta + interest cull from day 1
import { pack, unpack } from 'msgpackr'
export function encode(msg: unknown): Uint8Array { return pack(msg) }
export function decode<T=unknown>(raw: Uint8Array | string): T {
  if (typeof raw === 'string') return JSON.parse(raw) as T // fallback for JSON
  return unpack(raw as any) as T
}
export function encodeJSON(msg: unknown): string { return JSON.stringify(msg) } // compat
// Delta: only send changed top-level keys — server diffs against last snapshot per client
export function diffSnap(prev: Record<string, unknown> | null, next: Record<string, unknown>): Record<string, unknown> | null {
  if (!prev) return next
  const out: Record<string, unknown> = {}; let changed=false
  for (const [k,v] of Object.entries(next)) if (JSON.stringify(prev[k]) !== JSON.stringify(v)) { out[k]=v; changed=true }
  return changed ? out : null
}
// Interest cull helper (shared)
export function isVisible(self:{x:number,z:number}, other:{x:number,z:number}, radius=120){ const dx=other.x-self.x, dz=other.z-self.z; return dx*dx+dz*dz<=radius*radius }
