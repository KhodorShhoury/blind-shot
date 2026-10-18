# Blind Shot

A real-time 2–4 player browser game. Everyone secretly picks a firing direction, a countdown runs, then **all lasers fire at the same instant**. Last player standing wins.

- **Frontend:** React + TypeScript + Vite, HTML5 Canvas 2D (no game framework, ~85 kB gzipped app code)
- **Backend:** Node.js + Socket.IO, fully server-authoritative
- **Audio:** synthesized with the Web Audio API (no audio files)
- **Practice mode:** runs the *same* engine in the browser against bots — no server needed

## Quick start

Requires Node 20+.

```bash
npm install
npm run dev          # server on :3001 + client on :5173
```

Open <http://localhost:5173>. To test on a phone on the same Wi-Fi, open `http://<your-computer-LAN-IP>:5173` (the client automatically talks to port 3001 on the same host).

Run the two halves separately if you prefer:

```bash
npm run dev:server   # tsx watch, Socket.IO on :3001
npm run dev:client   # Vite on :5173
```

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | server + client with hot reload |
| `npm test` | 49 unit + integration tests (Vitest) |
| `npm run typecheck` | strict TypeScript across shared/server/client |
| `npm run build` | production builds → `server/dist`, `client/dist` |
| `npm start` | run the built server (`node server/dist/index.js`) |

## How the game plays

Blind Shot is a game of nerve and luck. **Nobody can see anybody else.**

1. **Scatter & vanish** – at the start of *every* round the server drops each survivor at a fresh, independent random spot (wall margin + minimum spacing enforced) and hides everyone. You only see yourself.
2. **Aiming (5 s)** – spin your laser through 360° (mouse or touch stick) and choose a direction on instinct. Your aim and preview are private; the preview is a plain line to the wall and knows nothing about opponents. Click / `Space` / LOCK commits; click again to unlock. If everyone locks, the phase ends early after a short grace period.
3. **Lock (0.6 s)** – aims freeze.
4. **Fire (1.5 s)** – the countdown hit zero: every laser fires at the same instant in a straight line to the arena boundary. The server resolves all shots from the same pre-fire snapshot against the secret positions, so a player killed in the volley still fires. Now everyone is revealed and the lasers / hits play out.
5. **Result (2.3 s)** – who hit whom. If nobody was hit, that is a perfectly valid round: everyone is re-scattered and a new countdown starts. Eliminated players stay out until the next match.

One survivor wins; everyone dying in the same volley is a **draw**; a rematch can be voted on after the match.

There is no movement during aiming, no radar, no aim assist, no enemy indicators and no guaranteed hit. Bots are blind too – they only know their own position.

### Secrecy is enforced on the server

`MatchEngine.snapshot(now, forId)` is the only thing sent to clients. During the aiming and lock phases it contains **only the receiving player's own x/y**; opponents' coordinates, aims, shots and eliminations are simply absent. Positions are included only once the volley fires (and only for the players who took part in it). The next round's positions are generated server-side and again withheld until that round's reveal. (Offline practice mode runs the engine in your own browser, so there the "server" is local.)

## Architecture

```
shared/src     Pure TypeScript used by BOTH client and server
  config.ts      every timing, colour, arena size, bot parameter (override with buildConfig)
  geometry.ts    straight laser tracing (thickness, nearest hit), random spawn generation
  engine.ts      MatchEngine – phase state machine, volley resolution, per-player snapshots
  bots.ts        blind bot planning (own position only; difficulty = centre bias / timing)
  protocol.ts    event names, payload types, validators, rate limiter
server/src
  server.ts      HTTP + Socket.IO factory (CORS, /healthz)
  rooms.ts       rooms, lobby, reconnect tokens, host transfer, rematch, rate limiting
  index.ts       entry point (PORT, CLIENT_ORIGIN, graceful shutdown)
client/src
  game/renderer.ts   Canvas renderer (cached background, beams, particles, shake) – outside React
  game/input.ts      mouse/keyboard input     ui/Joystick.tsx  touch stick
  game/audio.ts      Web Audio synth          game/settings.ts localStorage preferences
  game/localSession.ts / net/onlineSession.ts   two interchangeable "sessions"
  ui/*               Menu, Lobby, GameScreen, Victory, HowTo, Settings
```

**Secrecy:** `MatchEngine.snapshot(now, forId)` only ever contains the requesting player's own aim. Other players' angles are first sent in the `fire` reveal. This is covered by unit and integration tests.

**Network:** aims are sent at ≤30 Hz as volatile messages with a trailing send, a `lock` event forces an exact final angle. Phase changes are the only broadcasts (plus a tiny `lockinfo`), the client renders at 60 fps from local timers.

**Validation:** all payloads are type-checked, names sanitised, room codes normalised, angles bounded, token-bucket rate limits per socket (general / aim / lock), 4 kB max message size, room cap.

**Reconnect:** the server issues a secret token on join. The client keeps it in `sessionStorage`; after a reload or network drop it re-attaches to the same seat and gets its own aim back. A player who is away for 30 s mid-match forfeits at the next round. Disconnected players' aims are auto-locked and they still fire. If the host leaves, ownership moves to the next connected player; empty rooms are deleted.

## Configuration

Client (`client/.env`, see `.env.example`):

| Variable | Meaning |
| --- | --- |
| `VITE_SERVER_URL` | URL of the Socket.IO backend. **Required in production.** Dev default: `http://<host>:3001` |

Server (`server/.env.example`; set as real environment variables on your host):

| Variable | Meaning |
| --- | --- |
| `PORT` | listen port (Render/Railway set this) |
| `CLIENT_ORIGIN` | comma-separated allowed origins, e.g. `https://blind-shot.vercel.app`. Empty = allow any (dev only) |
| `AIM_MS`, `LOCK_MS`, `FIRE_MS`, `RESULT_MS` | optional timing overrides |

Gameplay constants (arena size, spawn margin & spacing, beam width/speed, colours, bot skill) live in `shared/src/config.ts`.

## Deployment

The frontend is static and goes on Vercel. The multiplayer backend holds persistent WebSocket connections, so it **must** run on a long-lived Node host (Render, Railway, Fly.io…). Vercel serverless functions cannot host it.

### 1. Backend → Render (or Railway)

*Render:* New → Blueprint → select this repo (uses `render.yaml`), or create a Web Service manually:
- Build: `npm install && npm run build -w server`
- Start: `npm run start -w server`
- Health check path: `/healthz`
- Env: `CLIENT_ORIGIN=https://<your-vercel-domain>`

*Railway:* New Project → Deploy from repo (uses `railway.json`), add `CLIENT_ORIGIN`, then generate a public domain. A `Dockerfile.server` is also included (`docker build -f Dockerfile.server .`).

Note the public URL, e.g. `https://blind-shot-server.onrender.com`. (Free Render instances sleep when idle – the first connection can take ~30 s.)

### 2. Frontend → Vercel

Import the repo at the **repository root** (`vercel.json` already sets the build command and `client/dist` output). Add the environment variable:

```
VITE_SERVER_URL=https://blind-shot-server.onrender.com
```

Deploy. Finally set `CLIENT_ORIGIN` on the backend to the Vercel domain (and any custom domain) and redeploy it. Invitation links look like `https://<your-site>/?room=ABCDE`.

## Tests

`npm test` runs:

- **geometry** – hits, nearest-target rule, beam thickness, owner immunity, random spawns (bounds, spacing, independence, fairness)
- **engine** – phase flow, early lock, hidden positions & aims, simultaneous volleys, no-hit rounds, four-player loop, same-volley kills, multi-kill, draws, standings, disconnects/forfeit/reconnect, blind bots (own position only), bot-only matches terminate
- **protocol** – validators and rate limiter
- **server integration (real Socket.IO)** – 2/4-player rooms, capacity, host-only start, ready gating, host transfer, room cleanup, full match with secrecy checks, rematch, disconnect + token rejoin, forfeit, malformed/flooded input

## Controls

| | Desktop | Mobile |
| --- | --- | --- |
| Aim | mouse | virtual stick (360°, shows the current direction) |
| Lock / unlock | click or `Space` | LOCK button |

Settings (volume, SFX, reduced motion, particle intensity, touch controls) persist in `localStorage`.
