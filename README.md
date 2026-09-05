![l-town](https://github.com/user-attachments/assets/7c0ea3d7-d7c4-478b-9349-3592064ed552)

# L-Town

A browser-based multiplayer FPS. No download — open a URL and play.

Built with Node.js, WebSockets, and Three.js.

---

## Features

- Up to 300 players per server
- Procedurally generated 750×750 arena, regenerates each match
- 11 playable characters with unique abilities
- 10-minute matches, top 3 players win
- No accounts or sign-up required

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

## License

MIT