![l-town](https://github.com/user-attachments/assets/7c0ea3d7-d7c4-478b-9349-3592064ed552)

# L-Town

A browser-based multiplayer FPS. No download — open a URL and play.

Built with Node.js, WebSockets, and Three.js.

---

## Features

- Up to 300 players per server
- Procedurally generated 750×750 arena, regenerates each match
- 6 playable characters with unique abilities
- 10-minute matches, top 3 players win
- No accounts or sign-up required

## Quick Start

```bash
git clone https://github.com/besoeasy/l-town.git
cd l-town
npm install
npm start
```

Open **http://localhost:30300**

## LAN Party (Docker)

```bash
docker run -d -p 30300:30300 --name l-town ghcr.io/besoeasy/l-town:latest
```

Share `http://<your-local-ip>:30300` with anyone on the same network.

## Controls

`WASD` move · `Mouse` aim · `LClick` shoot · `Q` ability · `R` shield · `E` super · `Space` super jump · `C` crouch · `F` scoreboard

## Characters

| Character | Ability |
|---|---|
| ⚡ Telepotu | Swap positions with a random enemy (60s) |
| 👻 Chumantr | Go invisible for 10s, can't shoot (30s) |
| 🔥 Denja | Passive: 2× speed, max 75% HP |
| 💊 Mednix | Restore 1–50 HP (20s) |
| 🛡 Tank | Passive: 2× HP, half speed |
| ⚓ Anchor | Passive: SUPER and SHIELD cost 50% less HP |
| 🌀 Surge | Drain 30 HP from the nearest enemy within 40 units (25s) |
| 💀 Jinx | Passive: Death Curse — killer loses 80 HP when you die |
| 🎲 Gambler | Roll the dice: +200 HP · land on enemy · instant death (45s) |
| 🧫 Parasite | Passive: Drain 3 HP/s from every enemy within 15 units |
| 🔴 Berserker | Passive: Speed and damage scale up to 2.5× as HP drops |

## License

MIT