![L-Town — open-source multiplayer browser FPS arena](https://github.com/user-attachments/assets/7c0ea3d7-d7c4-478b-9349-3592064ed552)

# L-Town — Free Open-Source Multiplayer Browser FPS

[![MIT License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](package.json)
[![Docker](https://img.shields.io/badge/docker-ghcr.io%2Fbesoeasy%2Fl--town-blue.svg)](Dockerfile)
[![Three.js](https://img.shields.io/badge/three.js-WebGL-black.svg)](https://threejs.org)
[![WebSockets](https://img.shields.io/badge/multiplayer-WebSockets-orange.svg)](server.js)

A browser-based multiplayer FPS. No download — open a URL and play. Perfect for LAN parties, classrooms, offices, and io-game nights.

Built with Node.js, WebSockets, and Three.js. Self-host in seconds with `npx` or Docker — no accounts, no sign-up.

> Keywords: browser fps, browser game, io game, arena shooter, multiplayer shooter, first-person shooter, self-hosted game, lan party game, three.js fps, websocket multiplayer, html5 fps, open-source game, procedural arena, docker game server.

---

## Features

- Up to 300 players per server — massive browser arena shooter
- Procedurally generated 750×750 arena, regenerates each match
- 11 playable cores with unique abilities (same RX-11 chassis, fair play)
- 10-minute matches, top 3 players win
- No accounts or sign-up required — share a link, friends join instantly
- Self-hosted: runs on LAN, VPS, or Raspberry Pi via Node.js or Docker
- Zero-install play: mobile-friendly lobby, desktop FPS controls

## Quick Start

### Option 1 — npx (recommended)

No clone, no install — just run:

```bash
npx github:besoeasy/l-town
```

Open **http://localhost:30300**

### Option 2 — Docker

```bash
docker run -d -p 30300:30300 --name l-town ghcr.io/besoeasy/l-town:latest
```

Open **http://localhost:30300** — share `http://<your-local-ip>:30300` with anyone on the same network.

### Option 3 — From source

```bash
git clone https://github.com/besoeasy/l-town.git
cd l-town
npm install
npm start
```

Open **http://localhost:30300**

---

## Controls

`WASD` move · `Mouse` aim · `LClick` shoot · `Q` ability · `R` shield · `E` super · `Space` super jump · `C` crouch · `F` scoreboard

## Characters

Every player runs the same RX-11 chassis: 500 hull, base speed, fixed SUPER (50) / SHIELD (80) costs. Cores differ only by their Q ability.

| Core | Ability |
|---|---|
| ⚡ Telepotu | Swap positions with a random enemy (60s) |
| 👻 Chumantr | Go invisible for 10s, can't shoot (30s) |
| 🔥 Denja | Overdrive: 2× speed for 8s (30s) |
| 💊 Mednix | Restore 1–50 hull (20s) |
| 🛡 Tank | Bulwark: −50% damage taken for 8s (35s) |
| ⚓ Anchor | Aegis: 3s full immunity, free (40s) |
| 🌀 Surge | Drain 30 hull from the nearest enemy within 40 units (25s) |
| 💀 Jinx | Passive: Death Curse — killer loses 80 hull when you die |
| 🎲 Gambler | Roll the dice: +200 hull · land on enemy · instant death (45s) |
| 🧫 Parasite | Leech burst: 8 hull/s from enemies within 15 units for 6s (30s) |
| 🔴 Berserker | Rage: +50% damage, +25% speed for 8s (35s) |

## Lore

Deep dive into the world — [lore.md](lore.md)

## License

MIT — see [LICENSE](LICENSE). Free for personal, educational, and commercial self-hosting.