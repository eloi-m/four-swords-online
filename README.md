# Four Swords Online

A fan-made version of **Shadow Battle**, the 2–4 player arena mode of *The Legend of Zelda: Four Swords Adventures*
(GameCube, 2004), that runs in the browser.

- Play on one keyboard (plus gamepads), or **online** with rollback netcode, meaning each browser guesses the others'
  inputs and corrects itself when the real ones arrive, so nobody waits on the network
- Arenas, sprites, HUD, music and sound effects come from the game's own files, which the server hosts next to the pages
- Those files are never in this repo: whoever runs the server extracts them from their own disc
- The code is our own TypeScript, tuned against the original game running in the Dolphin emulator

Also in here: a small slice of the adventure (Lake Hylia), a map viewer, a 2D screen (HUD/menu) viewer and a sound test.

## Legal

- **Unofficial fan project.** Not affiliated with, endorsed, sponsored or approved by Nintendo.
  *The Legend of Zelda* and *Four Swords Adventures* are trademarks of Nintendo, named here only to say which game this
  works with.
- **No Nintendo material in this repository**: no game code, graphics, sound, text or other data, no disc images,
  extracted files, BIOS dumps or screenshots of game assets, and no decompiled code. Our code is written from
  file-format documentation and from observing the game's behavior. The game files the pages load come from the
  operator's own disc (the USA release, G4SE01 revision 0), extracted locally and copied to the server by the deploy,
  never through git or a Docker build context.
- Contributors: keep it that way (see "Contributing").

## Status

- **Shadow Battle, local**: all 10 arenas (5 plus their Dark World variants) with their tilesets, ground overlays,
  static actors, backdrops and hazards; 2–4 Links; hearts, time limit, wins; sword, spin attack, shield, knockback,
  pits; lifting and throwing (Links too), rolling, items from orbs (bow, boomerang, slingshot, bombs, cucco, Epona,
  the Four Sword), bushes, bombs, fire bars, soldiers, bees, Vaati's giant bomb; the game's own J2D HUD; BGM and
  sound effects through our JAudio2 synth. Keys and gamepad buttons are remappable (menu → Controls).
- **Shadow Battle, online**: rooms by code or invite link, 2–4 players (one per browser) plus spectators, rematches,
  GGPO-style rollback over WebRTC data channels with a relay fallback, desync detection, disconnect handling.
- **Free Play, online**: one shared field for up to 8 players who come and go, fighting without losing hearts, until
  the first one there starts a Shadow Battle for everyone on it (up to 8 Links); its results lead back to the field.
- Walking, sword timings, lifting, rolling and more are measured in Dolphin (`docs/measurements.md`); many battle-only
  numbers are still placeholders. What's missing: see `docs/ROADMAP.md`.

**Browsers** (checked by `tools/e2e/src/site.ts` and `site-webkit.ts`, desktop): Chrome and Firefox pass every flow,
including a Chrome-hosted online match joined from Firefox. Safari: its WebKit engine (Playwright's WebKit 26.4
build) passes every flow and plays online against Chrome; Safari itself wasn't automated. Phones and tablets work too,
with on-screen touch controls in landscape (`touch.ts` and `mobile.ts` check them in phone emulation, online play
included), and the game was played on an iPhone (Safari) and an Android phone (Chrome). HTTPS (or `localhost`) is
required.

## Run it locally

Requirements: Node 22 and pnpm (`corepack enable`), a browser, and the game files: extract the disc image once
(USA, G4SE01 rev 0) into `extracted/`. Every dev server and preview serves that folder at `/data/`.

```sh
corepack enable
pnpm install
pnpm --filter @fso/extract extract <disc.rvz> extracted
pnpm site:dev          # the whole site on http://localhost:5191, with a local lobby server for online play
```

Open http://localhost:5191 and pick a mode. To play online on your machine, open Shadow Battle online in two tabs (or
two browsers); to play with others you need the hosted setup (`docs/deploy.md`); sound needs HTTPS or `localhost`.

Production build: `pnpm build:site` → `apps/site/dist/` (static files, no game data), `pnpm site:preview` serves it
with the lobby and the game files. For a server, `pnpm bundle` copies the files the pages load into `out/fso-data/`
(about 41 MB, with a `manifest.json`), to publish at the site's `data/`. Each app also runs on its own
(`pnpm --filter @fso/battle dev`, …; see `docs/apps.md` for ports and deep links).

Tests: `pnpm test` (Vitest; tests that need game files read an `extracted/` folder made with
`pnpm --filter @fso/extract extract <disc.rvz>` and skip without it) and `pnpm typecheck`. Browser tests drive
headless Chrome/Firefox (set `CHROME` / `FIREFOX` when they aren't installed in the usual place) against the pages,
which load `extracted/` from the dev or preview server: `node tools/e2e/src/site.ts all` (the whole site; builds and serves it itself), `node tools/e2e/src/perf.ts all`
(frame times), and one script per app in `tools/e2e/src/`.

## Hosting

Static files, the game files next to them (`pnpm bundle`), and one small WebSocket server (the
lobby, `tools/signal`). `docs/deploy.md` walks through a VPS with a domain: Docker Compose with Caddy (automatic HTTPS,
the lobby behind `/signal`), or systemd + any web server, or a static host plus a separate lobby.

## Architecture

A TypeScript monorepo (pnpm workspaces, Vite, Vitest, three.js). Node 22 runs the TypeScript directly (type
stripping), so tools and tests need no build step.

```
browser                                                          node
┌───────────────────────────────── apps/site (one origin) ───┐
│  home ─▶ packages/web (HttpStore: game files from data/)    │   tools/extract, bundle, census, render…
│  apps/battle   local + online Shadow Battle                 │   tools/dolphin  RAM traces from Dolphin
│  apps/game     Lake Hylia slice                             │   tools/e2e      headless browser checks
│  apps/viewer · apps/screens · apps/sound-test               │   tools/signal   lobby + relay (WebSocket)
└──────┬───────────────┬──────────────────┬───────────────────┘          ▲
       │               │                  │                              │ wss://…/signal
 packages/render  packages/sim       packages/net ──────────────────────┘ + WebRTC between players
 three.js: GPU    deterministic      rollback sessions,
 tilemap, sprites, 60 Hz game,       transports, lobby
 J2D screens       1/256 px ints
       │               │
 packages/formats (Yaz0, RARC, tiles, sprites, BTI, J2D…) · packages/disc (RVZ/ISO) · packages/audio (JAudio2 synth)
```

- `packages/disc` reads GameCube disc images (RVZ with zstd, ISO) and their file system, for `tools/extract`.
- `packages/formats` parses the game's files: archives, tile maps and sheets, sprites, textures, J2D screens, tables
  read from `main.dol`. Pure functions, no DOM.
- `packages/sim` is the game: players, collision, combat, items, hazards, rounds. Integer math and serializable state,
  so every machine computes the same frames (a requirement of rollback netcode).
- `packages/net` is the netcode (`docs/netcode.md`): a GGPO-style rollback session over any datagram transport,
  spectators, a lobby client, WebRTC and relay transports.
- `packages/render` draws with three.js: a GPU tilemap that looks tiles up in the game's own 4bpp sheets and palettes,
  sprite atlases, and a J2D screen renderer that emulates the GameCube's TEV stages.
- `packages/audio` plays the game's music and effects: ADPCM decoding, the BMS sequencer and a software synth that runs
  in an AudioWorklet.
- `packages/web` holds the browser-only pieces: the store that loads the game files over HTTP (a manifest, then each
  file under its content hash), and a worker-driven 60 Hz ticker.
- `tools/bundle` prepares those files for a server (`pnpm bundle`) and serves them from `extracted/` in dev.
- `apps/site` builds every app's page into one site (`apps/site/pages.ts`), with the home page.

Docs: `docs/formats.md` (what we know about the game's files), `docs/measurements.md` (Dolphin measurements),
`docs/netcode.md`, `docs/deploy.md`, `docs/ROADMAP.md`, `docs/BACKLOG.md` (what's left); `docs/README.md` is the
index, `docs/apps.md`, `docs/tools.md`, `docs/e2e.md` and `docs/dolphin.md` the day-to-day guide to every app and tool.

## Contributing

- **Never commit game data**: disc images, extracted files, derived caches, screenshots or renders of game assets
  (`disc/`, `extracted/`, `cache/`, `out/`, `ref/` are gitignored; keep your captures there). Never commit
  decompiled code; read disassembly for behavior and write your own code.
- Keep attribution headers on anything ported from other projects, and check their license first (see Credits).
- TypeScript with `.ts` import specifiers and erasable syntax only (no enums, namespaces or constructor parameter
  properties), so Node runs it as is. Binary data through `DataView`, big-endian unless the format says otherwise.
- The sim must stay deterministic: no `Math.random`, `Date.now` or engine-dependent floating point in `packages/sim`;
  run the determinism tests (`pnpm test`) and, for online changes, `tools/e2e/src/battle-online.ts`.
- Measure before tuning: behavior is checked against the game in Dolphin (`tools/dolphin`, `docs/measurements.md`).
  Mark guesses as `TODO(measure)`.
- Before a pull request: `pnpm test`, `pnpm typecheck`, and the browser check of what you touched (`tools/e2e`, with
  the game files in `extracted/`).

## Credits

- [noclip.website](https://github.com/magcius/noclip.website) (MIT): its GameCube and JSystem format code (RARC, Yaz0,
  BTI/GX textures, J3D) is our reference and the planned source for J3D/GX ports. Files ported from it carry its MIT
  notice and attribution; none are vendored at the moment.
- [three.js](https://threejs.org/) (MIT) for rendering; Vite, Vitest, puppeteer-core and playwright-core for building
  and testing.
- [Dolphin](https://dolphin-emu.org/) (GPL-2.0+), used as an external reference tool only (frame dumps, RAM traces
  through its GDB stub, its documented RVZ format); none of its code is included.
- [EFSAdvent / FSALib](https://github.com/Venomalia/EFSAdvent) and the game's modding community, whose notes on the
  file formats guided the research (FSALib has no license, so none of its code or tables is used).
- The FSA decompilation projects, read for function names and boundaries as hints only.

## License

MIT (`LICENSE`), for the code in this repository only. The game, its files and its trademarks belong to Nintendo.
