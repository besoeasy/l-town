# L-Town — Open Source Multiplayer FPS Browser Game

> A free, open-source, browser-based multiplayer first-person shooter built with **Node.js**, **WebSockets**, and **Three.js**. No download required — just open a URL and play instantly.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-brightgreen)](https://nodejs.org)
[![Three.js](https://img.shields.io/badge/Three.js-r179-blue)](https://threejs.org)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED)](Dockerfile)

<video src="extra/record.mp4" controls autoplay loop muted width="100%"></video>

---

## What is L-Town?

**L-Town** is a lightweight, open-source multiplayer FPS game that runs entirely in the browser. Up to **300 players** compete simultaneously on a procedurally generated 3D arena map. The match lasts **10 minutes** — the top 3 players by score claim victory.

There is nothing to install for players. Open the game URL, pick a character, enter a callsign, and start shooting.

---

## Features

- **True multiplayer** — up to 300 concurrent players per server via WebSockets
- **Procedurally generated maps** — every match spawns a unique 750×750 unit arena with 8 named points of interest across two biomes (Terra and Barren)
- **3D first-person gameplay** — rendered in real time with Three.js and WebGL
- **Three playable characters** — each with a unique ability activated by `Q`:
  - ⚡ **Telepotu** — teleport-swap positions with a random enemy (30s cooldown)
  - 👻 **Chumantr** — go invisible for 10 seconds (can't shoot while cloaked, 30s cooldown)
  - 🔥 **Denja** — passive 2× permanent speed boost, health capped at 75%
- **Ability system**:
  - `R` — **Shield**: 10-second full damage immunity
  - `E` — **Super Mode**: boosted speed and damage for 10 seconds
  - `Space (hold)` — **Super Jump**: charged aerial launch
- **Two weapon modes**: Single shot (`1`) and Heavy shot (`2`) — heavy fires both arms
- **Global leaderboard** — top-3 ranking always shows all players, not just nearby ones
- **Spatial audio** — Web Audio API footsteps, gunshots, and hit feedback
- **Client-side prediction** — responsive local movement with server reconciliation
- **No accounts, no sign-up** — pick character, enter callsign, and play
- **Docker ready** — one-command deployment

---

## Tech Stack

| Layer | Technology |
|---|---|
| Server | Node.js + `ws` WebSocket library |
| Rendering | Three.js (WebGL) |
| Transport | WebSocket (binary-efficient JSON messages) |
| Map generation | Seeded procedural PRNG (no external dependencies) |
| Audio | Web Audio API |
| Deployment | Docker / any Node.js host |

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org) v18 or later
- npm (bundled with Node.js)

### Run Locally

```bash
# Clone the repository
git clone https://github.com/besoeasy/l-town.git
cd l-town

# Install dependencies
npm install

# Start the server
npm start
```

Open your browser at **http://localhost:30300** and start playing.

### Play Offline with Family (LAN Party)

The easiest way to host a private game for everyone in your home — no internet required after the pull.

**Step 1 — Pull the pre-built image (one time)**

```bash
docker pull ghcr.io/besoeasy/l-town:latest
```

**Step 2 — Start the server**

```bash
docker run -d -p 30300:30300 --name energy-arena ghcr.io/besoeasy/l-town:latest
```

**Step 3 — Find your local IP**

```bash
# Linux / Mac
hostname -I | awk '{print $1}'

# Windows (PowerShell)
(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notmatch '^127' }).IPAddress
```

**Step 4 — Everyone opens a browser**

- The host machine: **http://localhost:30300**
- Everyone else on the same Wi-Fi or network: **http://\<your-local-IP\>:30300**

That's it. No accounts, no internet, no setup for the players — just share the link and play.

**Stop the server when done**

```bash
docker stop energy-arena && docker rm energy-arena
```

### Build from Source with Docker

```bash
docker build -t energy-arena .
docker run -p 30300:30300 energy-arena
```

---

## Gameplay

### Characters

Choose your character in the lobby before joining:

| Character | Class Ability `Q` | Passive |
|---|---|---|
| ⚡ **Telepotu** | Teleport-swap with a random enemy (costs 50 HP, 30s cooldown) | — |
| 👻 **Chumantr** | Go invisible for 10s — cannot shoot while cloaked (30s cooldown) | — |
| 🔥 **Denja** | No active ability | Permanent 2× movement speed; health capped at 375 HP |

### Controls

| Action | Control |
|---|---|
| Move | `W A S D` |
| Aim / Look | Mouse |
| Shoot | Left Click |
| Single shot | `1` |
| Heavy shot | `2` |
| Toggle weapon mode | `Tab` |
| Class ability | `Q` |
| Shield | `R` |
| Super mode | `E` |
| Crouch | `C` |
| Super Jump | Hold `Space` |
| Scoreboard | `F` |

### Match Rules

- Match duration: **10 minutes**
- Starting health: **500 HP** (375 HP for Denja)
- Win condition: **top 3 players** by kill score at match end
- Respawn: **5-second** countdown after death
- High-value target: the leading player is marked for all opponents
- Shield bubble is visible to all other players when active

---

## Map & Biomes

The arena is **750 × 750 units** and regenerates each match using a seeded PRNG. It features:

- **Terra biome** — lush research facilities, greenhouses, and atmospheric stations
- **Barren biome** — industrial wharfs, foundry cores, and cratered ruins
- **8 named POIs**: Research Facility, Atmospheric Station, Eternal Gardens, Greenhouse Complex, Industrial Wharf, Foundry Core, Production Yard, Dark Cratered Ruins
- Central **Terraformer Hub** — a 44×44 walled building with rooftop access and mezzanine floor
- Tiered cover system: low duck-behind objects, mid half-body walls, and tall full-cover structures

---

## Self-Hosting & Deployment

L-Town is designed to be self-hosted. The server is a single `server.js` file with two dependencies (`ws` and `three`). It can be deployed to any Linux VPS, cloud container, or PaaS that supports Node.js.

```bash
# Production start
NODE_ENV=production npm start
```

For high player counts, deploy behind a reverse proxy (nginx / Caddy) with WebSocket upgrade support.

---

## Project Structure

```
├── server.js          # Game server: map gen, physics, WebSocket tick loop
├── public/
│   ├── index.html     # Game UI shell
│   ├── game.js        # Three.js renderer + client-side prediction
│   ├── style.css      # Lobby and HUD styles
│   └── sounds/        # Audio assets (MP3)
├── package.json
└── Dockerfile
```

---

## Contributing

Contributions are welcome. Open an issue to discuss a feature or bug, then submit a pull request.

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/your-feature`)
3. Commit your changes
4. Open a pull request

---

## License

This project is open source and available under the [MIT License](LICENSE).

---

## Keywords

open source multiplayer FPS, browser FPS game, Three.js multiplayer game, WebSocket shooter, free online FPS, Node.js game server, browser-based shooter, multiplayer arena game, JavaScript 3D shooter, self-hosted multiplayer game, no-download FPS, open source game server
