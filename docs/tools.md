# Tools and deploy (details)

Index of the docs: [README.md](README.md).

- `tools/signal` — lobby/signaling server and datagram relay (own minimal WebSocket, no deps):
  `node tools/signal/src/main.ts [port] [host] [-- command]` (or `pnpm signal`) → ws://localhost:5185. Rooms run match
  after match (rematches); origin allowlist, optional shared token (`LOBBY_TOKEN`, sent as `?token=`; the battle page
  reads it from `<base>data/lobby-token`), rate limits and caps via env (`ALLOWED_ORIGINS`, `TRUST_PROXY`,
  `MAX_ROOMS`…); hosting behind a TLS reverse proxy: `docs/netcode.md` "Hosting". Pages reach it at `<base>signal`
  on their own origin (dev and preview proxy it)
- `deploy/` — `signal.Dockerfile` (the lobby on node:22-alpine), `site.Dockerfile` (the build served by Caddy),
  `docker-compose.yml`, `Caddyfile` (TLS, `/signal` proxy, caching, CSP), `.env.example`; the root `.dockerignore` is
  an allowlist of source folders. Step by step: `docs/deploy.md`. `nginx-fso.conf` serves the site under `/fso/` of an
  existing nginx (`private` headers so a CDN caches nothing): `docs/deploy.md` "Under a sub-path of an existing
  nginx"; `site.ts --url=https://<host>/fso/` checks a deployment from outside.
- `tools/extract` — `pnpm --filter @fso/extract extract <disc> [outDir]` → Dolphin-style `extracted/`
- `tools/bundle` — the game files the pages load, for the web server: `pnpm bundle [extracted] [out/fso-data]
  [--decompress]` copies every disc file but the THP videos and CVS folders, plus `sys/main.dol` (135 files, 40.9 MB),
  and writes `manifest.json` (paths, sizes, SHA-256 prefixes; deterministic); re-runs only rewrite what changed and
  refuse to write inside the repo outside `out/`. `--decompress` stores Yaz0 archives decompressed (86 MB; off: not
  worth it). `@fso/bundle/vite` (`gameData()`, in every app's and the site's Vite config) serves the same
  `<base>data/` URLs in dev and `vite preview` from `extracted/`, or from `FSO_DATA` (another extracted disc or a
  bundle); manifest `no-cache`, hashed files `immutable`
- `tools/census` — catalogs every file (recursing into archives) for format discovery
- `tools/render` — PNG renders (`room.ts`, `ACTORS=1` adds actor sprites, `SUBLAYER=1-7` a GBA side room; `stage.ts`, `textures.ts`, `sprites.ts`), `compare.ts` (fits our render onto a Dolphin frame dump)
  and `swordboxes.ts` (sword hitboxes per player_sob frame, for `packages/sim/src/animations.ts`)
- `tools/audio` — `node tools/audio/src/audio.ts inventory|stages|waves|ast|bms|render` (WAVs into `out/audio/`;
  `render <seq> <s> <port0> dry|muffle`: without the reverb, or muffled after 1 s),
  `capture.ts` (Dolphin DSP audio dump from a savestate into `ref/dolphin-user-audio/`), `compare.ts` (render vs dump)
- `tools/capture` — captures and replays (below): the dev servers' capture endpoint (`vite.ts`, dev only),
  `replay.ts`, `shot.ts`; the browser side is `packages/web/src/capture.ts`, the input logs and replays
  `packages/sim/src/replay.ts` (`adventure/replay.ts`).

## Captures and replays (F8)

Play on a dev server as usual (`pnpm site:dev` → http://localhost:5191, or one app's own: battle 5181, adventure 5174).
Only dev servers do any of this: `pnpm build:site` and the deployed site hold none of it.

When something looks wrong, press **F8** (Shift+F8 to type a note first; Enter sends, Esc skips the note; on a touch
screen, the small **Capture** button at the top). A toast says `Captured <id>`.

Each capture is a folder `captures/<id>/` (gitignored: it holds the game's graphics; delete it whenever you like):
`frame.png` (the game canvas at that moment), `state.json` (the whole sim state), `replay.json` (the match's or
stage's start and every input since, so the moment replays exactly), `capture.json` (URL, note, summary: tick, Links'
positions, phase, HUD text), and a line in `captures/index.jsonl`. Online matches and menus capture the frame and
state but no replay. Inside a capture's replay, F9 hands the controls back to you from that moment.

Then:
- Reproduce in node: `pnpm -s capture:replay [id|latest] [--at <tick>] [--state <file>]` rebuilds the match or stage
  from `extracted/`, replays the inputs, checks the state hash against the capture's (exit 1 if it differs, with the
  first checkpoint that differs) and writes `replayed-state.json`. A failing test is the same two calls:
  `replayBattle(record, stage, tileTypes)` / `replayAdventure(record, adventureStage)` from `@fso/sim`, then assert on
  `result.state` at the tick of the bug.
- See frames around it: `pnpm -s capture:shot [id|latest] --at 600,640,680` opens the page the capture came from (its
  dev server must be running) at `#replay=<id>&at=<tick>` in headless Chrome and saves `captures/<id>/at-<tick>.png`
  (the real renderer, DOM overlays included). The same URL in a browser shows it frozen there: battle and adventure
  take `#replay=<id|latest>[&at=<tick>]`. The last 90 steps replay at normal speed so effects (sparks) build up;
  a few view-only things on their own clocks (rank labels fading) can still differ from the original frame.

Checked end to end by `node tools/e2e/src/capture.ts` (`docs/e2e.md`).

## Playtest checks (`tools/playtest`: World 1 off its routes)

Two checks for what a scripted route can't see (the route plays one pixel-exact path; small deviations and the
picture are where the 2026-10-10 hand playtest found its bugs), on World 1's four stages (`stage.ts` `STAGES`: Lake
Hylia, the Cave of No Return, Tingle's Tower, Hyrule Castle). Both take stages (`lake`, `cave`, `tingle`, `castle`, or
the ids; all four when none is named). Both need `extracted/`; both run in `pnpm test`
(`tools/playtest/src/*.realdisc.test.ts`, about 50 s together) against their lists of known results.
- `pnpm -s playtest:bent [stage…] [puzzle…] [--captures]` (`bent.ts`, ~35 s for all four): 54 puzzles bent 600
  ways. Lake Hylia's 22 (`PUZZLES` in `bent.ts`: the boulder, the cave's stone and four-Link switch, the key, the
  two-Link rocks, the stumps, the crystal, room 4's switch, the apart switches, the block, the raft, the ambush
  switches…) and the others' 32 (`world1.ts`: the Cave's pots, lamp, candles, movable blocks, `BLCK`s, color blocks,
  floor points, the throw onto room 9's island, room 3's arrows, room 11's hole and chain lever (room 4's Shadow Link
  is left out); Tingle's Tower's bushes, house, ladders, falls, whirlpool, chest, passage; Hyrule Castle's two-Link
  rock, the throw over area 6's gap, the walls' blocks and crystal, the pull switch, the arrow through the door, the
  bombs and cracked walls, the tower's cannons, the big handle, the four crystals' spin, the lane throw, the pot
  switch, room 57's box switches, the floor point, the throne, the cannon columns), each played from its milestone's
  start with its goals bent one way at a time: stopping 1-3 px off the scripted spot each side, letting go mid-push,
  idle 120 ticks, the other formations, coming from another side, leaving the area and coming back halfway. (World 1's
  off spots are `nudge`d: the scripted walk to the spot, then a straight step off it, since the path finder's grid
  doesn't hold the color blocks and some actors' boxes; a swim or a side view's hold builds its own.) After each: the
  milestone still ends, no Link stuck (in a wall 30 ticks, the leader not moving 300 ticks with the stick held, a
  two-Link rock's lifter left behind or the rock carried out of its area: `play.ts`), the puzzle's check, and what the
  puzzles leave (rocks, switches, gear, keys, burnt stumps, blocks, color blocks, the escort…) as the scripted run's.
  `EXPECTED` lists the known results, each classed: "finding" (a sim bug against the game's traced or main.dol rules,
  a capture each), "rule" (a rule only assumed: check it in Dolphin), "route"/"unfair" (the driver or the variant, not
  the puzzle); `SCENARIOS` replays single findings. `--trace "<puzzle> / <variant>" [from] [every]` prints a variant
  tick by tick (`m<n> / scripted`: milestone n of the first stage named as scripted); `--goals [milestone]` lists a
  stage's goals by index (what a puzzle's goal indices point at).
- `pnpm -s playtest:actors [stage…] [--captures] [--census]` (`actors.ts`, ~5 s for all four): every actor of every
  room and area has a drawing when the sim simulates it (pieces resolve, `bti` files in `timg/`, EnemyView cases,
  tiles), every type is simulated or named in `docs/ADVENTURE.md`/`docs/BACKLOG.md`, every sign and villager has
  printable text (or a flow that leads to some, for one to four controllers); every door opened shows something else
  than shut and walkable tiles from inside the room; along the scripted route, the tile swaps and the picture against
  the collision (the color blocks and sliding blocks, sprites over the tiles, left out). `--census` prints each placed
  type, simulated or not, and how apps/game draws it (EnemyView, a pickup, a still sprite, its tile, an effect,
  nothing). `EXPECTED_ACTORS` lists the known findings (the other stages' keys start with the stage's short name).
- `--captures` writes the findings as captures (`findings.ts`: `captures/playtest-<name>/`, replay.json + capture.json
  + state.json, a line in `index.jsonl`; `FSO_CAPTURES` names another captures folder), so
  `pnpm -s capture:replay playtest-<name>` and apps/game's `#replay=playtest-<name>` show them.
