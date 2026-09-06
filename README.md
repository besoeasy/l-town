# L-Town v2 — Rebuilt from Scratch

Inspired by `lore.md` canon: **3049, Remote Age — humans in orbit, RX-11 nanite swarms on the ground.**

Rebuild addresses all `v1@1.0.6` audit fixes from scratch.

## Canon → Code

* **RX-11 chassis** (`lore.md:15`) → single `shared/cfg.ts` `CHASSIS` — same hull/speed/costs for all, only `Atma Core` differs. No upgrades, fixed by arena charter.
* **Hull as nanite census** (`lore.md:23`) → hull = ammo + health. Every shot/jump/shield deducts, regen only when idle/crouch (`+3×`). Mednix/Surge/Parasite steal.
* **Atma Core = soul** (`lore.md:30`) → 11 cores, same body, glitch ability = mind-pattern copy error.
* **Makers → Cores** (`lore.md:40`) → 11 `CoreId` with `Q` burst, no passive except Jinx.
* **L-Town Protocol** (`lore.md:55`) → `750×750` daily seed, Meridian hub, 10-min trials, top-3 win.
* **Operators = amateurs** (`lore.md:64`) → anon `callsign`, no auth, reconnect grace.

## v2 Architecture (scratch)

```
v2/
  shared/   cfg.ts, map.ts (seed), protocol.ts (msgpack-lite binary), types.ts
  server/   ecs.ts, physics.ts (rapier stub + AABB sweep), net.ts (uWS-style, per-IP limit, crypto UUID)
  client/   Vite + TS + Three + InstancedMesh + worker + howler
```

* **ECS** `bitecs` stub — `Position, Velocity, Hull, Core` components.
* **Physics** server authoritative, sweep AABB, no client trust.
* **Net** binary `msgpack` delta + `120u` interest cull + per-IP bucket + `crypto.randomUUID` reconnect.
* **Render** `InstancedMesh` per material from day 1, `EffectComposer` optional.
* **Build** `Dockerfile` `node:22-alpine` `npm ci` `USER node` `HEALTHCHECK`.

## Quick Start

```bash
cd v2
npm install
npm run dev      # client :5173 + server :30300
# or
npm start        # prod server serves client/dist
```

## Scripts

* `npm run dev` — vite + tsx watch
* `npm run build` — tsc + vite build
* `npm run start` — node server/dist/index.js
