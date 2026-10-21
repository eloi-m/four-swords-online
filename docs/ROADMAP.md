# Four Swords Online: plan draft (up to the local milestone)

## Status (2026-09-28)
What's left: `docs/BACKLOG.md`. Since 2026-09-28 the site serves the game files itself: the disc
import and the OPFS cache described below are gone (the pages load the game files from the server, `tools/bundle`),
phones are supported (touch controls, mobile pages) and CPU opponents exist.

- **Phase 0 (done):**
  - Done: git repo, pnpm workspace, project conventions, Lake Hylia savestate (`ref/save-lake-hylia.sav`).
  - Dolphin: **pinned to 2606** (2609 crashed at boot; savestates are version-specific).
  - `dolphin-tool` isn't in the macOS app, so we wrote our own RVZ + GameCube disc reader (`packages/disc`). It's byte-exact: `main.dol` SHA-1 matches the decomp.
  - Extraction: `tools/extract`.
  - No Ghidra: code questions were answered with our own PowerPC decoder (`tools/dol`) and Dolphin's GDB stub.
- **Phase 1 (done):**
  - `tools/census` catalogs 25,538 entries.
  - Opening stage = `boss010` (1-1 Lake Hylia); battle = `boss500` + `battle1.arc`; graphics in `data.arc`.
  - See `docs/formats.md`.
- **Phase 2 (background graphics done):**
  - Yaz0, RARC, map layout CSV, tile layers, tileset (SCH/SPL/SCL) decoding, and a software renderer.
  - The full Lake Hylia stage renders (`tools/render`).
  - Animated tiles (water etc.): mapping and timing confirmed in Dolphin, GPU tilemap renderer in `packages/render`.
  - Sprites (SOB), BTI textures, J2D screens and fonts: done (see Phase 4 and the J2D section of formats.md).
  - Still to do: BMG message text.
- **Phase 3 (viewer done):**
  - `apps/viewer`: drop a `.rvz`/`.iso` into the browser. It's read locally in a worker (1–2 s) and cached in OPFS,
    so it survives reloads.
  - three.js stage map: pan/zoom, base/top/GBA sublayers, TV/GBA/Dark World palettes, room grid, tile inspector,
    deep links.
  - Ground overlay shader (`filterN.bti`, fitted blend).
  - Browser smoke test: `tools/e2e`.
  - 3D effects toggle: J3D models (BMD + BTK/BRK/BCK, GX TEV shaders ported from noclip) placed as the game places
    them (Lake Hylia waterfalls, rainbows and morning light, read from RAM; the waterfalls checked against Dolphin
    frames), battle lava and drifting clouds (the environment manager's drawer in main.dol) and the cloud shadows
    (main.dol drawer, 99.9 % of pixels agree with Dolphin).
  - Still to do: RVZ files that use bzip2/LZMA compression (rare), the river-bed layer under water, JPA particles.
- **Phase 4 (in progress):**
  - Sprites solved: SOB, sheet layout, TV palettes and player colors, confirmed with Dolphin texture dumps.
  - Tile collision: the game's tile-type table is read from main.dol (0x8046CB88), and a collision overlay is in the viewer.
  - Savestate → RAM tool.
  - **Playable slice:** `apps/game`. Link walks around Lake Hylia with the game's own collision, 8-frame walk
    cycles, corner sliding, a camera clamped to each room and a scroll between rooms. Keyboard and gamepad.
  - Checkpoint B (walking): a GDB-stub RAM tracer plays scripted DTM input movies in Dolphin (`tools/dolphin`). Speed,
    start latency, walk animation, the octagon collision sensors, corner sliding, room changes and the camera pan
    are measured (`docs/measurements.md`), and `packages/sim` replays 5 Dolphin traces within 0.075 px. Sword
    timings are measured and applied (swing, stab, lunge, charge, spin). Not modeled yet: the push state, surfaces,
    the held sword hitting walls, the formation followers.
- **Release (one website, `apps/site`):**
  - `pnpm build:site`: the home page and every app page (Shadow Battle local and online, Lake Hylia, map viewer,
    screen viewer, sound test) in one static build on one origin, so the disc is imported once (home page) and every
    page reads the same OPFS cache; the apps stay standalone. Legal disclaimer, browser checks, a home link on every
    page. `README.md` for the public repo.
  - Deployment (`docs/deploy.md`, `deploy/`): Dockerfiles for the lobby and the site, docker-compose with Caddy
    (automatic TLS, `/signal` WebSocket proxy, caching headers, CSP; no COOP/COEP needed). Checked end to end with
    the real Caddyfile on local HTTPS.
  - Browsers (`tools/e2e/src/site.ts`, `site-webkit.ts`): Chrome 153 and Firefox 156 pass every flow (import, all
    arenas, audio, tools, online over WebRTC and over the relay), a Chrome–Firefox match stays bit-identical; WebKit
    26.4 (Playwright's build, standing in for Safari, whose driver needs admin rights) passes too and plays online
    against Chrome. Firefox needed only a shader-warning fix (unused varyings in the J2D TEV shaders).
  - Performance (`tools/e2e/src/perf.ts`, `pnpm --filter @fso/sim bench`, `pnpm --filter @fso/audio bench`): 4 bot
    Links on every arena at 3024×1890 px hold 60 fps in Chrome and Firefox on the M1 Pro with ~1–2 ms of main-thread
    CPU and ~1.5 ms of GPU per frame; a sim step costs 3–7 µs, an 8-frame rollback ≤ 0.11 ms, the synth ~36 µs per
    4 ms audio quantum. Fixed: the HUD's per-frame matrix updates (render CPU −10–15 %), and online the per-frame
    state hash kept only for tests (net tick ~400–530 → ~130–260 µs on the Tower of Flames). Left: ~90–140 draw calls
    a frame (68 for the HUD's panes, one per sprite) are most of the remaining CPU; batching them is the next step if
    slower machines need it.
  - Keys and gamepad buttons are remappable per keyboard layout (battle menu → Controls).
  - Not yet: Safari itself automated, mobile/touch, a license for the code.
- **Online (ahead of schedule, see `docs/netcode.md`):**
  - Rollback netcode in `packages/net` (prediction, rollback, time sync, desync hashes, disconnects, spectators),
    tested over a simulated bad network with the real sim: every peer ends bit-identical.
  - Signaling/lobby server with a relay (`tools/signal`), WebRTC data channels, and the `apps/netplay` demo (two
    Links in two tabs), checked in headless Chrome.
  - **Online Shadow Battle** in `apps/battle` (menu → Play online, `pnpm battle:online`): rooms by code or invite link
    with the host's settings (arena, player limit, hearts, time, wins, input delay), 2–4 players (one Link per
    browser) plus spectators joining any time, rematches and back-to-room without re-creating the room, departed
    players' Links removed at the same frame everywhere, banners for waiting/left/desync, a netplay stats overlay
    (`` ` ``). Lobby server: rematches, shared settings, roles, origin allowlist, rate limits and caps; hosting notes in
    `docs/netcode.md`. Checked in headless Chrome (`tools/e2e/src/battle-online.ts`): a knockout to "P1 wins" with a
    mid-match spectator, 4 players under 60±30 ms / 10% loss, disconnects mid-round, identical hashes on every frame.
- **Checkpoint A (structural match reached):**
  - boss010 room 1 lines up with a Dolphin frame dump at 2.14× camera zoom.
  - With the ground overlay the mean luma difference drops from 27.6 to 18.8, and to 9.95 with the cloud shadows (both
    confirmed by Dolphin RAM pokes). The rest is sprites and HUD.
- **Phase 5 (started: local Shadow Battle prototype):**
  - `apps/battle`: 2–4 local players (two keyboard layouts, then gamepads) on any of the 10 `boss500` rooms, each drawn
    with its own tileset and ground overlay; menu with 2/4/6 hearts, time limit and wins; round and results screens.
  - Rules in the sim (`battle.ts`, `combat.ts`, `arena.ts`), all in `GameState.battle` and advanced by `stepGame`:
    sword and spin hits on a body hurtbox, damage in quarter hearts, 8-way knockback stopped by walls, invincibility
    blinking, frontal shield blocks, pits (a heart, then back to the start), death, last Link standing wins a star,
    first to N stars wins; time-out goes to the most hearts. Deterministic, including through a JSON snapshot.
  - Every number (damage, knockback, i-frames, countdown, camera zoom…) is a `TODO(measure)` placeholder.
  - Look and sound (from the disc, see `docs/formats.md`):
    - The game's J2D HUD `main_bat.blo` over the 608×448 TV frame, driven like main.dol's battle HUD: hearts with
      3/4, 1/2 and 1/4 textures and the empty-heart dot (checked in Dolphin on the adventure HUD, which shares the
      code), portraits, empty item boxes, unused corners hidden, the 60 % fade of a player out of hearts.
    - The arenas' static actors (bombs, flames, soldiers, crystal balls, magic circles, bees; not the player starts)
      y-sorted with the Links, and The Field's closed trick floor.
    - Backdrops behind the transparent tiles, read from the environment manager's code: Tower of Winds' sky and wall,
      Above the Clouds' distant Hyrule and three drifting cloud layers.
    - BGM per arena (`JA_BGM_BATTLE_ZAKO`, `JA_BGM_BOSS` above the clouds), a fanfare per round won, the results theme,
      and rollback-safe sound-effect cues (sword, spin, charge, hit, shield, pit, death, countdown) on a pool of synths;
      mute and volume.
  - Moves, items and hazards (`packages/sim` carry.ts, roll.ts, items.ts, orbs.ts, bombs.ts, projectiles.ts,
    hazards.ts, timeup.ts, on plain entities in `GameState.battle`; drawn by `apps/battle/src/entities.ts`):
    - Measured in Dolphin in adventure mode and applied to every Link (`docs/measurements.md`): lifting (bushes, bombs,
      orbs and, in battle, other Links), carrying, throwing and slamming, the roll and the empty lift, the knockback's
      any-angle slide and hop until landing, the invincibility blink, bombs (13 px ahead, 300-tick fuse, ±16 px blast,
      thrown with a bounce), the bow, the boomerang and the slingshot.
    - From the arena data and `enemyparam.csv` damages, with placeholder timings: item orbs from `CRGN` (the item picked
      by a seeded generator in the state), heart pickups, the cucco, Epona and the Four Sword; the Tower of Flames' socket
      bombs; The Field's bees; Hyrule Castle's sword soldiers and magic circles (10 s on the castle's dark side, a side
      room); Vaati's giant bomb at time-out (`rules.vaatiBomb`, on by default), which knocks out every Link (no
      shelter: measured).
    - The arenas' switch network, read from main.dol (`switches.ts`, `panels.ts`, docs/formats/battle-arenas.md "Switches"): the 32
      switches in the state and the logic actors in list order (OR gates, all-four monitors, delayed chains, random
      pickers and cycles, timers, spawners, crystals lit by blasts). The Tower of Flames' and Tower of Winds' switches
      hide under pots (lift one, stand on the switch); the fire pit's jets follow them through OR gates (the two pointing
      away from that corner, while someone stands there); the eternal flames wait for a side-room switch; The Field's
      trick floor follows the switch under its bush; Above the Clouds' colored panels cycle P1-P4 every 120 frames and
      drop anyone of another color; its fire bars take their speed, length and balls from the params; orb generators
      and magic circles obey their switches (random pickers, timers); Hyrule Castle's generators send more soldiers.
  - The Dark World look (`lights.ts`, `lighting.ts`): each room's `LTEV` sets a tint and an ambient level (10 in the
    Dark World, 200 and warm in the Tower of Flames); the light pass multiplies the frame by tint × min(1, light circles
    + ambient): each Link carries an 85 px light (the smaller field of view), flames, jets, fireballs and lit crystals
    theirs; Links are tinted but not darkened. Checked in Dolphin by poking the adventure's light.
  - Cloud shadows over The Field and Hyrule Castle (`cloudshadow.ts`), the ground overlay as a plain multiply (both
    confirmed by Dolphin RAM pokes; the Checkpoint A frame now within 9.95 mean luma), sprite shadows (a Link's own
    frame squashed, kage_sob ellipses under bombs, items and bees) and sprites growing with their height (`shadows.ts`).
    - Deterministic through rollback: long bot matches with every mechanic replay identically and through a JSON
      snapshot, and 3 peers stay bit-identical over a lossy simulated network (online ONLINE_VERSION 2 carries the arena
      props and the lobby's seed). Controls: K / `.` action, L / `/` item.
  - The GBA-screen side rooms (`siderooms.ts`: doors, holes, side-view rooms, cannons, the castle's dark side), whose
    switches drive the eternal flames, the Dark World's bomb drops, the lava stripes and the fire bars' turn; each
    player inside gets a GBA inset.
  - Not yet: the Tower of Winds' gallery (its gates) and so the giant-bomb Shadow Link, bombchus (the castle soldiers SLR2, SLR3 and SLR4: done), the orbs' item masks, hammer/boots impacts (`DOSN`), the
    battle-only numbers (sword and thrown-Link damage and knockback, holds and escapes, orb contents), the HUD's item
    box, JPA particles (flames, fireballs), the lake's river-bed effect, J2D text for the banners, and a Dolphin
    comparison of battle mode itself (it needs emulated GBAs). The sound-effect choices are by name, not from the
    game's calls. (The J3D backdrops, `yougan` lava and `nagarekumo` clouds, are drawn: `backdrop.ts`.)

## Context
- **Goal:** play the Shadow Battle mode of *Zelda: Four Swords Adventures* (GameCube, 2004) in a browser, and eventually against other people online.
- **Local goal (this plan):** the game runs locally in the browser from the original assets, with local multiplayer.
- **Your choices:**
  1. Build a small slice of the start of the adventure (a few maps, assets, Link walking) first, to check we're on the right track. Battle mode comes after.
  2. Fidelity: it should *feel identical*. The code is our own TypeScript, tuned against Dolphin.
  3. Public release, bring-your-own-disc: we ship code only, and each player's disc image is read in their own browser.
- **Starting point:** `Legend of Zelda, The - Four Swords Adventures (USA).rvz`, game ID **G4SE01 Rev 0** (NTSC-U, 60 Hz). The header shows it's **NKit v1**-processed. NKit leaves the file system intact, so extraction works; no NKit restore is needed. Machine: M1 Pro, macOS 14.7, node 22, python3, brew.

## What the research found
- **No shortcut exists.**
  - The two FSA decomps (EverydaySimpleDev/FSA-Decomp, sh1ftmaker/fsa-decomp) are at about 0% matching progress. They do target G4SE01, our exact version, so their symbol and split files can serve as hints (function names and boundaries) in Ghidra.
  - noclip.website doesn't support FSA.
  - In-browser Dolphin (wasm-dolphin) is a research prototype, and FSA multiplayer would need a GameCube plus 4 emulated GBAs at full speed.
  - → **Approach: a clean TypeScript reimplementation driven by the original assets.** Dolphin serves as the reference to compare against.
- **The engine is 2D tiles in GBA-native formats, with JSystem 3D on top.** Documented by EFSAdvent/FSALib (C#, actively maintained):
  - Stages are `bossNNN.arc` (Yaz0/RARC archives) in a `Boss` folder: `GC4Sword_usa/Boss` according to a US mod guide, `GC4Sword/Boss` in FSALib. Shared resources are in `data.arc`.
  - Rooms sit on a 10×10 grid (`map/*.csv`). Each room's tile layers (`szs/M###`) are 32×32 u16 grids, with layers 1-x below and 2-x above the player.
  - Actor lists are in `bin/B###` (4-character IDs).
  - GBA-style graphics: SCH 4bpp tiles, SCL RGB555 palettes, SOB OAM-style sprites.
  - J3D models, BTI textures and J2D screens are used for effects and UI.
- **Code we can reuse:** noclip (MIT) already has TypeScript for Yaz0, RARC (`JKRArchive.ts`), BTI/GX texture decoding, J3D and GX shader generation.
- **Battle mode:**
  - The arena file is `boss500`: 10 rooms, which are 5 arenas plus their Dark World variants (Field, Tower of Flames, Tower of Winds, Hyrule Castle, Above the Clouds).
  - 2–4 Links, last one standing wins, 3 hearts each (measured). Options: Vaati at time-out (he knocks everyone out; measured, no bomb), Powerful Items, a handicap.
  - Items come out of orbs (Bow, Slingshot, Cucco, Carrot/Epona, Four Sword…). Force Gems exist in battle.
  - Moves: throw other Links, roll, charged spin.
  - When a player enters a house, a cave or a Moon Gate, their play moves to their own GBA screen.
- **Dolphin as reference:** battle mode needs every player on an emulated GBA, which means Dolphin's integrated mGBA and your own GBA BIOS dump. The single-player adventure start plays on a normal controller, so the vertical slice can be measured without GBAs.

## Target architecture
TypeScript monorepo (pnpm workspaces, Vite, Vitest):
```
packages/formats   pure TS parsers (Yaz0, RARC, SCH/SCL/SOB/SPL, map CSV, M### layers, B### actors, BTI, BMG, later J3D/audio); run in node and the browser
packages/disc      GameCube disc/FST reader (ISO/GCM first, RVZ later); normalizes assets into a cache (OPFS in the browser, a folder in node)
packages/sim       deterministic fixed-60Hz game simulation (actors, tile collision, Link, items, rules); no render/DOM deps
packages/render    three.js: tile layers via an index-texture + palette-texture shader, instanced sprite quads, zooming orthographic camera, later post-FX/J3D
apps/viewer        asset and map browser (debug tool)
apps/game          the playable build
tools/             extraction/census scripts, Ghidra scripts, Dolphin trace helpers
docs/formats.md    format notes, kept up to date as we learn
```
**Ground rules:**
- Never commit disc images, extracted files or BIOS dumps: `.gitignore` covers `disc/`, `extracted/` and `cache/`.
- Never commit decompiled Nintendo code.
- Keep noclip attribution on vendored files. Check FSALib's license before porting it; if it isn't compatible, use it only as a reference.
- Keep the simulation separate from rendering and input, with serializable state, from day one. It costs little now and is required later for rollback netcode.

## Phases

### Phase 0: tooling and workspace
- `git init`, `.gitignore`, the project conventions, and a copy of this plan as `docs/ROADMAP.md`.
- Install:
  - `brew install --cask dolphin`: emulator, debugger, memory watch. `dolphin-tool` should be inside `Dolphin.app/Contents/MacOS/`; if not, use the GUI's "Convert File…".
  - `brew install ghidra`, then Ghidra-GameCube-Loader. The loader must match the Ghidra version and may need a rebuild.
  - Optional: `dtk` (decomp-toolkit) for DOL analysis, and the .NET SDK to run EFSAdvent/FSALib as an oracle to compare our parsers against.
- Convert the disc: `dolphin-tool convert -i <rvz> -o disc/G4SE01.iso -f iso`.
- Extract it: `dolphin-tool extract -i disc/G4SE01.iso -o extracted/`.
- Import the decomp's symbols/splits (G4SE01 Rev 0) into Ghidra as labels only. Treat them as hints, since many are machine-generated.
- Boot the game in Dolphin and make reference savestates: the opening of the adventure, plus battle mode if a GBA BIOS is available.

### Phase 1: disc census
- `tools/census`: walk `extracted/`, identify every file by its magic bytes (Yaz0, RARC, BTI, J3D, BMG, AW…), and unpack archives recursively.
  - Output: `catalog.json` plus a report of counts and sizes by type.
- Identify the opening adventure stage's `bossNNN.arc` (cross-check with EFSAdvent and Dolphin), `data.arc`, and `boss500`.
- Start `docs/formats.md`.

### Phase 2: format parsers (TypeScript, tested)
In the order the slice needs them:
1. Yaz0 and RARC: port from noclip.
2. SCL palettes, SCH 4bpp character pages, SPL/MAP 16×16 tiles, M### tile layers (4 quadrants of 16×16), map CSVs, B### actor lists: from the FSALib docs/code.
3. SOB sprite layouts (shape, size, flip).
4. BTI (HUD/UI) and BMG text.
5. Later: J3D and particles (noclip), and audio (unknown format, needs reverse engineering).

Tests (Vitest):
- Run against the real `extracted/` files and skip automatically when they're absent, so CI stays asset-free.
- Golden PNG snapshots of decoded tiles and sprites, compared with EFSAdvent's output.

### Phase 3: asset and map viewer (browser)
- `apps/viewer`:
  - browse archives, textures, palettes, tile sheets and sprite frames
  - render a whole stage (every room on the grid) with toggles for the below/above layers and the environment variants
  - show actor markers from the B### lists
- Rendering: one mesh per tile layer, with a shader that looks each tile index up in the palette (GBA style). Nearest-neighbor filtering, pixel-exact orthographic camera, integer scaling.
- Start with ISO loading in the browser (drag and drop → Web Worker → OPFS cache). This proves the bring-your-own-disc path early.
- **Checkpoint A (are we on track?):** one room from the opening, side by side with a Dolphin screenshot of the same room at 1× internal resolution with filtering off. Tiles and palettes should match pixel for pixel.

### Phase 4: vertical slice (opening of the adventure)
- Scope: the first few rooms of the first stage with one Link.
  - Walk in 8 directions, sword swing, tile collision, room transitions and camera, cut bushes/lift pots, rupees.
  - Keyboard + Gamepad API input.
- Reverse engineering. The data doesn't contain these (collision attributes, animation timings, speeds live in the code), so:
  - Dolphin debugger and memory search to find Link's actor struct (position, velocity, state).
  - Frame-advance measurements of walk speed, acceleration, sword timing and knockback.
  - Ghidra (GC loader, `main.dol` + RELs) to find the per-tile collision table and the animation tables.
  - Record reference traces: a Dolphin input movie (`.dtm`) plus Link's position every frame from memory watch.
- `packages/sim` replays the same inputs, and a regression test compares its traces with the Dolphin ones.
- **Checkpoint B:** the same input sequence in Dolphin and in the browser produces matching position traces (within a small tolerance), and it feels right side by side.

### Phase 5: local battle mode (the local goal)
Status: prototype playable in `apps/battle` (see Status above).
- Load the `boss500` arenas: 5 at first, then the Dark World variants.
- Battle rules:
  - 2–4 Links, 2/4/6 hearts, time limit, Vaati's giant bomb, win stars.
  - Throwing Links, roll, charged spin, pits and falling off edges.
  - Orbs with items: start with the Bow and Slingshot, then Cucco, Carrot/Epona and the Four Sword.
  - Stage hazards and switches, one arena at a time: Field → Clouds → Flames → Winds → Castle.
- Local multiplayer on one machine: keyboard plus gamepads.
  - The GBA-screen areas (houses, caves, Moon Gate) show as a per-player inset view. Online, each player simply has their own screen.
- Minimal menus: player and handicap setup, stage select, results.
- More reverse engineering: item and orb spawn logic, damage values, hazard timings, the same way as in Phase 4, in Dolphin with emulated GBAs.
- **Checkpoint C (local goal):** 4 local players play full matches on every arena in the browser, and it feels like the original.

### Later (not detailed here; the architecture already allows for it)
- Online: rollback over WebRTC data channels (netplayjs, or our own GGPO-style code) using the deterministic sim, plus a signaling server and lobby.
- RVZ loading in the browser (zstd/LZMA decoders in WASM; format documented in Dolphin's `docs/WiaAndRvz.md`).
- Audio (JAudio reverse engineering), J3D effects via noclip's GX shader generation, more of adventure mode.

## Main risks
- **Behavior lives in the code, not the data:** collision, physics and animation timings. This is the biggest reverse-engineering cost; we cover it by measuring in Dolphin.
- **Decomp symbols are unreliable:** the decomps are early and partly machine-generated, so names can be wrong. We verify anything we rely on in Dolphin.
- **3D and effects fidelity** with three.js: start approximate, and port noclip's GX shader generation if needed.
- **Scope creep:** keep the vertical slice tiny. Its only job is to validate the pipeline.

## Verification
- **Phase 0:** the game boots in Dolphin, and `extracted/` contains `Boss/boss*.arc`.
- **Phases 1–2:** `pnpm test` passes the parser tests on the real files, and the census report accounts for every file.
- **Checkpoint A:** a pixel-diff script compares the viewer's render with the Dolphin screenshot.
- **Checkpoint B:** the trace-comparison test (Dolphin `.dtm` + memory log vs the sim replay) passes within tolerance.
- **Checkpoint C:** manual 4-player sessions in Chrome and Safari at a steady 60 fps.
