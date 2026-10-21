# Packages (details)

Index of the docs: [README.md](README.md).

- `packages/disc` — RVZ + ISO reader, GameCube header/FST (`@fso/disc`, node helpers in `@fso/disc/node`)
- `packages/formats` — pure parsers for game files (Yaz0, RARC, tiles, sprites, BTI, tile types, actor graphics, J3D models and
  animations in `j3d/`, effect placements in `fsa/effects.ts`, JPA particles in `jpa/` (data.arc's `particle.jpc`,
  JPAC2-10) with the game's effect placement and what actors spawn in `fsa/particles.ts`, J2D screens/fonts/BMG messages in `j2d/` (screen animations in `j2d/anim.ts`: .bck/.btk/.brk/.bpk
  bound to a screen's panes by id and materials by name; `bmg.ts` parses
  the message files with their tags, `BMG_TAGS`, `battleMessages()` = Shadow Battle's texts by id…), no DOM/node deps
- `packages/sim` — deterministic 60 Hz game simulation (1/256 px integers, serializable state; no DOM/three deps);
  the Hyrulean Adventure in `src/adventure/` (`@fso/sim/adventure`: the current room or GBA-screen area run as a battle
  arena, the stage's state around it; formation and the C stick's formations, push, swimming, ledges, side views
  (ladders, cannons, walking off a ledge), rocks and the raft, items, keys carried, the Links apart (and leaving an
  area alone), enemies (`enemies.ts`, `foes.ts`: Octoroks, Keese, Tektites, Stalfos, Buzz Blobs, Poes, Mozos, rats,
  sand crabs, Armos; `soldiers.ts`: sword soldiers (patrols, the chase, the attack slots: they keep off a Link until
  one is struck), bow soldiers, captains and their groups; `walkers.ts`: snakes, Zols, PAMEs; `waterfoes.ts`: river
  Zoras and their fireballs, the side views' fish; `hinox.ts`; `wizzrobe.ts`: Wizzrobes, their spells, the Stalfos they
  raise), what two-Link rocks hold (`rocks.ts` heldUnderRocks), enemy generators and kill counters (`generators.ts`:
  `GENE`, `GEN3`, `SKIL`), drops (enemyparam.csv's `dasu` classes, bushes) and the kill streak's falling gems (`SCRE`),
  pickups and gem rains, the switch machinery, doors, chests, the goal;
  `playedAlone`: the solo variant of rooms numbered 50 and up; signs and people talking, items got (`dialogue.ts`); the
  Cave of No Return's lamp (`lamp.ts`), rising door and staircase (`stairs.ts`), movable tiles, points and rings of fire
  (`tileblocks.ts`), color blocks (`colorblocks.ts`); `drive.ts` a scripted player, `lakehylia.ts` Lake
  Hylia's route for it, from the start to the stage clear, `cavenoreturn.ts` the Cave of No Return's, to its room 3,
  `tingletower.ts` Tingle's Tower's, to its clear, `hyrulecastle.ts` Hyrule Castle's first rooms and the fight with
  Phantom Ganon (`phantomganon.ts`, his AI from main.dol);
  docs/ADVENTURE.md);
  `pnpm --filter @fso/sim bench` times 4 bot Links on every real arena (step, clone, hash, an 8-frame rollback), then
  4 CPU Links (the AI's cost per tick, and the rollback with it)
- `packages/render` — shared three.js pieces: GPU tilemap (`tilemap.ts`: room layers, animated tiles via `setTick`,
  runtime palettes, ground overlay), collision overlay, sprite atlas/mesh (`SpriteMesh`: a frame at a size about its
  anchor and an opacity), static actor sprites (`actorsprites.ts`), J3D
  (`j3d/`: `J3dModel` with GX TEV shaders ported from noclip, driven by a 60 Hz tick; `StageEffects` = a stage's
  waterfalls/rainbows/filters + cloud shadows; `EnvModelInstance` = camera-following lava/clouds; `CloudShadows`);
  JPA particles (`jpa/`: `JpaEmitter`, the simulation ported from noclip, one seeded generator per emitter, stepped
  per 60 Hz tick; `JpaRenderer`, one instanced draw per effect kind, drawn through FSA's y-down TV view; `JpaEffects`,
  effects keyed by entity and start tick, so a rollback replays or drops them; `stageParticles`, what a stage's actors
  keep up);
  `pixelRatio()` (the device's, capped at 2) for the full-window canvases; J2D screens (`screen.ts`: `ScreenView`, GX TEV
  shaders with indirect stages,
  `setText(tag, text | BmgMessage, { page, colors })`; `screentext.ts`: J2DPrint-style text layout with BMG colors,
  picture characters and arrows, tested in node; `screenanim.ts`: `ScreenAnimator`, a screen's animations on an explicit
  60 Hz tick: play/stop/seek, loop modes, several at once)
- `packages/input` — every player's input as the sim's u16 button mask per tick (`@fso/input`, plain logic tested in
  node): keyboard layouts and gamepads (`LocalInput`; `bindings.ts`: Shadow Battle's remappable bindings in
  localStorage `fso.battle.controls`, the Lake Hylia pages' fixed keys), other sources merged into a player
  (`ButtonSource`, `attach`), and the on-screen touch controls' logic: `TouchPad` (every finger by pointer id, taps
  latched until the next tick), `stickButtons` (8 directions past 0.6 of the radius, the game's 0.59–0.69 tilt),
  `layoutControls` (the letterbox margins beside the 608×448 frame when they have room, else over its corners; safe
  area), settings in localStorage `fso.touch`. `@fso/input/touch` = `TouchControls`, the DOM overlay (Pointer Events,
  `touch-action: none`, `touch.css`, a pause button, `navigator.vibrate` where it exists); shown on touch screens
  (`pointer: coarse` or a first touch), `#touch=on|off|auto` overrides
- `packages/web` — browser-only: the asset store, shared by the apps: `openServerStore()` → `HttpStore` (the game files
  over HTTP from `<base>data/`: `manifest.json` fetched once per page, then each file as `<path>?v=<content hash>`, so
  the HTTP cache keeps it; the format is `protocol.ts`, also read by `tools/bundle`); `startTicker` (60 Hz from a
  worker timer, so net matches keep ticking in hidden tabs); the site's look: `theme.css` (`@fso/web/theme.css`:
  tokens, the night-sky gradient, gold-framed `.frame` panels, buttons and fields, Cinzel from
  `@fontsource-variable/cinzel`, OFL, bundled because the CSP allows no font server) and `art.ts` (`GameArt`,
  `showArt`: the game's own menu textures, i.e. the title logo and sky, the Shadow Battle plate, the Link icons,
  decoded at runtime from the served archives into blob URLs for `img[data-art]` / `[data-art-bg]`; pages look right
  without them); `@fso/web/audio` (`SynthAudio`: the games' audio player, the @fso/audio `SynthMixer` in an
  AudioWorklet, BGM and sound effects by name, volume and mute kept in localStorage; apps/battle and apps/game decide
  what plays)
- `packages/audio` — JAudio2 (pure TS): AFC/AST decoders, BAA/WSYS/IBNK/BST parsers, BMS disassembler,
  sequencer and software synth (runs in node and in an AudioWorklet), `SynthMixer` (BGM + a pool of sound effects);
  `pnpm --filter @fso/audio bench` times the battle mixer per 128-frame AudioWorklet quantum
- `packages/net` — rollback netcode (`docs/netcode.md`): GGPO-style `RollbackSession` over any datagram `Transport`
  (a game is `{ clone, step, hash }`; the sim's is `cloneGame`/`stepGame`/`hashGame`), spectators, lobby client,
  WebRTC/relay transports, `startNetMatch()`. `@fso/net/testing`: simulated network + `runMatch` harness + toy game.
  `pnpm --filter @fso/net bench` measures rollbacks of the real sim
