// Binary-lite protocol: JSON + per-client delta, msgpack-ready hook
// v1 used JSON full broadcast; v2 does delta+interest cull. Wire is JSON for simplicity, msgpack swappable.
export function encode(msg: unknown): string { return JSON.stringify(msg) }
export function decode<T=unknown>(raw: string): T { return JSON.parse(raw) as T }
// Delta: only send changed fields — server will diff against last snapshot per client
export function diffSnap(prev: Record<string, unknown> | null, next: Record<string, unknown>): Record<string, unknown> | null {
  if (!prev) return next
  const out: Record<string, unknown> = {}
  let changed = false
  for (const [k,v] of Object.entries(next)) if (prev[k] !== v) { out[k]=v; changed=true }
  return changed ? out : null
}
