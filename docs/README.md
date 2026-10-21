# Four Swords Online: docs index

Browser reimplementation of *Zelda: Four Swords Adventures* (GameCube, **G4SE01 Rev 0** only), aiming at an
online Shadow Battle mode. Status per phase: `ROADMAP.md`. **What's left: `BACKLOG.md`.**

## Ground rules (a deployment serves the game files publicly; the repo holds no Nintendo data)
- Never commit Nintendo data: disc images, extracted files, BIOS dumps, derived caches, screenshots of assets.
  `disc/`, `extracted/`, `cache/`, `out/`, `ref/`, `captures/` are gitignored. The game files reach a server only
  through the deploy (`pnpm bundle` → `out/fso-data/`), never through git or a Docker build context (`.dockerignore`
  is an allowlist).
- Never commit decompiled Nintendo code. Our code is written from format docs and observed behavior.
- Keep attribution headers on anything ported from third-party projects (noclip.website is MIT).

## Docs map (the long notes are split by area)
- `BACKLOG.md` where things stand and what's left, by area; `ROADMAP.md` status per phase.
- `formats.md` index of `formats/*.md` (every format and table); `measurements.md` index of `measurements/*.md`
  (Dolphin measurements).
- `packages.md` (the packages), `apps.md` (the apps, deep links), `tools.md` (tools, deploy), `e2e.md` (every e2e
  script, ports), `dolphin.md` (reference captures, tracer, battle mode in Dolphin, `tools/dolphin`, `tools/dol`).
- `netcode.md`, `deploy.md`, `animations.md`, `ADVENTURE.md` (the Hyrulean Adventure).

## Layout (one line each; details in the doc named)
Packages (`packages.md`):
- `packages/disc` RVZ + ISO reader, GameCube header/FST. `packages/formats` pure parsers for the game files (no DOM/node).
- `packages/sim` deterministic 60 Hz simulation (1/256 px integers; battle in `src/`, the adventure in `src/adventure/`).
- `packages/render` shared three.js pieces (tilemap, sprites, J3D, effects). `packages/input` input as the sim's u16
  button mask, touch controls.
- `packages/web` browser asset store, ticker, theme/art. `packages/audio` JAudio2 in pure TS. `packages/net` rollback
  netcode (`netcode.md`).

Apps (`apps.md`):
- `apps/site` the website (home, `/battle/`, `/online/`, `/adventure/`), `pnpm site:dev` -> http://localhost:5191.
- `apps/battle` Shadow Battle (local, online, free play, CPUs; `pnpm --filter @fso/battle exec vite --port 5181`,
  `pnpm battle:online`).
- `apps/game` the Hyrulean Adventure (5174). `apps/netplay` Lake Hylia online (5184). `apps/viewer` map viewer (5173).
  `apps/screens` J2D screen viewer (5180). `apps/sound-test` BGM/SFX player (5178).

Tools (`tools.md`, `e2e.md`, `dolphin.md`):
- `tools/signal` lobby/signaling server and relay (`pnpm signal`). `tools/extract` disc -> `extracted/`. `tools/bundle`
  the served game files (`pnpm bundle`).
- `tools/capture` F8 captures on the dev servers and their replays (`pnpm -s capture:replay|shot`, `tools.md`
  "Captures and replays (F8)").
- `tools/census`, `tools/render` (PNG renders), `tools/audio` (WAV renders, inventory), `deploy/` (Docker, Caddy;
  `deploy.md`).
- `tools/playtest` adventure checks in node: puzzles played off their route, actors against their drawings
  (`pnpm -s playtest:bent|actors`, `tools.md`).
- `tools/e2e` headless-Chrome/Firefox/WebKit checks, no disc needed (`e2e.md`; `CHROME` / `FIREFOX` point at the
  browsers). `tools/dolphin` savestates, GDB RAM tracer, DTM movies; `tools/dol` main.dol exploration (`dolphin.md`).

## Running
- `pnpm test` (Vitest; real-disc tests read `extracted/` and skip when absent), `pnpm typecheck`.
- `pnpm site:dev` (lobby + dev server, http://localhost:5191), `pnpm build:site`, `pnpm site:preview`; `pnpm bundle`
  builds `out/fso-data/` for a deployment.
- Single app: `pnpm --filter @fso/<name> dev` (ports in `apps.md`). E2E: `node tools/e2e/src/<script>.ts` (`e2e.md`).
- Dolphin reference captures and RAM traces: `dolphin.md`.

## Conventions
- TypeScript run directly by Node 22's type stripping: use `.ts` import specifiers and erasable syntax only
  (no enums, namespaces or constructor parameter properties).
- Binary parsing: `DataView`, big-endian by default (GameCube); FSA's GBA-style graphics are little-endian.
- Tests: Vitest (`pnpm test`). Tests that need real game files read from `extracted/` and skip when absent.
- Game data for local work: your disc image in `disc/` (e.g. `disc/Legend of Zelda, The - Four Swords Adventures
  (USA).rvz`), extracted to `extracted/`, which every dev server and `vite preview` serves at `/data/` (`tools/bundle`).
