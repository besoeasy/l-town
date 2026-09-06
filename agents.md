# L-Town — Project Specification & Agent Guidelines

## 1. Project Overview & Vision

**L-Town** is a browser-based, client-side only 3D multiplayer first-person shooter (FPS) and Progressive Web Application (PWA). Built from scratch using **Three.js**, **WebRTC**, and **NOSTR**, it requires zero central backend game servers. Players can open a URL, discover peers via decentralized NOSTR relays, and play directly over ultra-low-latency peer-to-peer data channels.

### Core Architecture Pillars
1. **Client-Side Only**: No game server backend. All game state, physics, rendering, and networking run in the browser.
2. **Three.js Browser PWA**: Fully responsive, hardware-accelerated 3D graphics, offline service worker caching, and installable as a desktop/mobile web app.
3. **WebRTC P2P Multiplayer**: Up to 16 players per match using WebRTC `RTCDataChannel`. The room host (lobby creator) runs the authoritative tick and physics loop, broadcasting state deltas to peers.
4. **NOSTR Discovery & Signaling**:
   - Game discovery via public NOSTR relays (replaceable events, e.g. Kind 30303).
   - Peer signaling (SDP offer/answer and ICE exchange) via NOSTR encrypted messages (NIP-04/NIP-44) or QR code / LAN fallback.
   - Gameplay itself is 100% direct peer-to-peer (`RTCDataChannel`), keeping game latency independent of relays.
5. **Offline & Solo Play**: Single-player trial mode against local bot swarms when offline or playing alone.

---

## 2. Mandatory Agent Workflow Rule

> [!IMPORTANT]
> **PODMAN BUILD & RERUN AFTER EACH EDIT**:
> After making code additions or edits, you **must**:
> 1. Stop all running containers (`podman stop -a`).
> 2. Build the container image: `podman build -t l-town-v2 .`
> 3. Run the updated container: `podman run -d --name l-town-v2 -p 30300:30300 --replace localhost/l-town-v2:latest`
> 4. Verify container status (`podman ps`) and logs (`podman logs l-town-v2`).
>
> *(Note: Node.js and npm are not installed on the host; builds and tests execute inside the container).*

---

## 3. Game Canon & Mechanics (from commit `e392b58b6b4981ece32cff242cbda5a07fceb0f4`)

### 3.1 Canon Lore (3049 — The Remote Age)
* Surface environments are uninhabitable due to solar storms. Humans stay in orbit and operate expendable **RX-11** humanoid nanite chassis on the ground.
* **Standard Chassis**: Fixed by arena charter. Every unit has identical max hull, base movement speed, hitbox, and abilities.
* **Hull = Nanite Census**: Nanite count serves simultaneously as health, ammo, and mass:
  - Firing a single shot deducts **2 Hull**.
  - Super mode overclocks the chassis, multiplying damage by 3x at a cost of **50 Hull**.
  - Shield covers the chassis in a nanite layer absorbing 100% damage for 10s at a cost of **80 Hull**.
  - Super Jump burns crowds of nanites for massive vertical lift (height ~10x regular jump) at a cost of **20 Hull**.
  - Idle/crouch regenerates hull slowly after a 2-second calm period (**3x faster while crouching**).
* **Match Format**: 10-minute trials (600 seconds), 16 players per room, 750×750 arena generated from a daily or room seed, leaderboard tracking top 3 pilots, and dynamic High Value Target (HVT) tracking.

### 3.2 The 11 Atma Cores (`CoreId`)
Each chassis is powered by an Atma Core holding a copied mind-pattern. The core glitch gives its unique **Q Ability**:

| Core ID | Maker | Ability [Q] | Cooldown | Effect |
|---|---|---|---|---|
| `telepotu` | Meridian Transit Cartel | Warp Logistics | 60s | Swaps positions with a random alive enemy |
| `chumantr` | Pale Choir | Stealth Cloak | 30s | Vanishes for 10s; cannot shoot while cloaked |
| `denja` | Kuro Racer Syndicate | Overdrive | 30s | 2× movement speed burst for 8s |
| `mednix` | Helix Med-Corps | Field Repair | 20s | Instantly restores 1–50 Hull |
| `tank` | Bastion Siege Foundry | Bulwark | 35s | 50% damage reduction for 8s |
| `anchor` | Orbital Guard | Aegis | 40s | 3s of full damage immunity with zero hull cost |
| `surge` | Deep Vein Mining Guild | Siphon Field | 25s | Drains 30 Hull from nearest enemy within 40 units |
| `jinx` | Black Lotus AI Lab | Death Curse | Passive | Retaliation overload: killer takes 80 Hull damage on death |
| `gambler` | Vesper Casino-State | Desperate Odds | 45s | 1/3 heal +200 Hull; 1/3 teleport to enemy; 1/3 instant death |
| `parasite` | Green Hive | Leech Burst | 30s | Drains 8 Hull/s from all enemies within 15 units for 6s |
| `berserker` | Red Pit Fighters | Red Rage | 35s | +50% damage and +25% speed for 8s |

### 3.3 Movement & Combat Configuration (`CFG`)
- `TICK_MS`: 50ms (20 Hz simulation rate)
- `MATCH_DURATION`: 600s
- `MAX_PLAYERS`: 16 (P2P WebRTC room limit)
- `MAX_HEALTH`: 500 Hull
- `REGEN_DELAY`: 2000ms
- `REGEN_RATE`: 2 nanites/s base (6 nanites/s while crouching)
- `PLAYER_SPEED`: 9 units/s (Run: 15 units/s, Crouch: 4 units/s)
- `PLAYER_RADIUS`: 0.45, `PLAYER_HEIGHT`: 2.3, `EYE_HEIGHT`: 1.95, `CROUCH_EYE_HEIGHT`: 0.85
- `JUMP_SPEED`: 18 units/s, `GRAVITY`: 32 units/s²
- `SUPER_JUMP_SPEED`: 44 units/s, `SUPER_JUMP_COST`: 20 Hull
- `DMG_SINGLE`: 20 base damage (scaled by distance falloff, min 25% at 120 units)
- `SUPER_MULT`: 3× damage multiplier AND 2× movement speed multiplier (10s duration, -50 Hull cost)
- `HUD_INDICATORS`: Q, E, R, C buttons feature animated perimeter SVG and linear border lines indicating real-time seconds remaining or charge progress.
- `RECONNECT_GRACE_MS`: 15000ms

### 3.4 750×750 Procedural Arena (`map_pure.ts`)
- Pure, deterministic procedural map generation driven by PRNG seed (no Three.js dependency in core generator).
- Includes outer perimeter walls (`wH=12`, `SIZE=750`), 5-story central Meridian office/hub with windows and platforms, hideouts, multi-tiered cover, elevated platforms, pillars, lamps, bollards, and 40+ spawn points.
- Spatial Grid index (`BOX_CELL = 20`) for collision checks and raycasting.

---

## 4. Networking Architecture (WebRTC + NOSTR)

```
                       ┌───────────────────────────────┐
                       │     NOSTR Relay Network       │
                       │  (damus.io, nos.lol, primal)  │
                       └───────┬───────────────▲───────┘
            Discovery (Kind 30303)│               │ SDP Signaling (NIP-04/44)
                               ▼               │
    ┌──────────────────────────┴───────────────┴──────────────────────────┐
    │                                                                     │
    ▼                                                                     ▼
┌─────────────────────────┐     Direct WebRTC DataChannel     ┌─────────────────────────┐
│       Host Peer         │◄─────────────────────────────────►│       Client Peer       │
│  - Authoritative 20Hz   │           (<1-30ms RTT)           │  - Client prediction    │
│  - Physics & Collisions │                                   │  - Interpolation        │
│  - State Broadcast      │                                   │  - Sends inputs         │
└─────────────────────────┘                                   └─────────────────────────┘
```

1. **Lobby & Discovery**:
   - Host generates a random room ID and publishes room info (name, seed, core, player count, host pubkey) to NOSTR relays.
   - Clients subscribe to tag `#t: l-town` to list available rooms sorted by freshness and latency.
2. **WebRTC P2P Signaling via NOSTR**:
   - Joining peer sends SDP offer via encrypted direct message to Host pubkey.
   - Host receives offer, sets remote description, generates SDP answer, and returns it via encrypted DM.
   - ICE candidates exchanged until `RTCDataChannel` (`label: 'game'`) opens.
3. **P2P Gameplay (`game` DataChannel)**:
   - Client sends inputs (movement, aim yaw/pitch, actions) at 20–60Hz.
   - Host runs authoritative simulation (sweep AABB collisions, raycasts, cooldowns, abilities, match timer).
   - Host broadcasts snapshot/delta updates at 20Hz (`TICK_MS = 50`).
4. **Local LAN Mode (Simplified Host Address)**:
   - Host clicks **"HOST LAN MATCH"**; local IP is detected (e.g. `192.168.1.50:30300`).
   - Clients click **"JOIN LAN (PASTE ADDRESS)"** (pre-filled with `window.location.host` or custom IP).
   - Local WebSocket broker transparently negotiates the WebRTC offer/answer in <50ms, connecting peers directly without copying manual tokens. An air-gapped QR mode remains available as fallback.

---

## 5. Technology Stack & Project Structure

- **Language**: TypeScript (ES modules).
- **3D Engine**: Three.js (`InstancedMesh`, `Sky`, `UnrealBloomPass`, `EffectComposer`).
- **Networking**: WebRTC (`RTCDataChannel`), `nostr-tools`.
- **Audio**: Web Audio API (or Howler.js).
- **Bundler / Server**: Vite for development and client build; lightweight static server in production container.
- **Container**: Podman / Docker (Node 22-Alpine image, port 30300).



