# Dolphin: reference captures, tracer, battle mode, main.dol exploration

Index of the docs: [README.md](README.md).

## Reference captures (tools/dolphin, tools/dol)

- `tools/dolphin` — savestate reader (LZ4) and MEM1 extraction; GDB-stub RAM tracer, DTM input movies (below)
- `tools/dol` — main.dol exploration (`node tools/dol/src/cli.ts dis|spawn|draws|live|func|callers|xref|field|float|data`): a small PowerPC decoder, the
  spawn-by-ID switch, draw calls reachable from each actor type, live actors in a MEM1 dump. Its output stays local.
## Dolphin reference captures
- Dolphin 2606: the tools run `$DOLPHIN`, else `/Applications/Dolphin.app` on macOS or `dolphin-emu`. Reference
  data lives in gitignored `ref/`: savestates, and a separate Dolphin user folder `ref/dolphin-user` so the user's own config isn't touched.
- Headless frame dump from a savestate (about 8 s): `perl -e 'alarm 8; exec @ARGV' "$DOLPHIN"
  -u $PWD/ref/dolphin-user -b -e <disc.rvz> -s ref/save-lake-hylia.sav -C Dolphin.Movie.DumpFrames=True
  -C GFX.Settings.DumpFramesAsImages=True -C GFX.Settings.InternalResolution=1 -C GFX.Settings.InternalResolutionFrameDumps=True
  -C Dolphin.Analytics.PermissionAsked=True -C "Dolphin.DSP.Backend=No Audio Output"`. Frames land in `ref/dolphin-user/Dump/Frames/`.
- RAM traces (Checkpoint B, results in `docs/measurements.md`): `node tools/dolphin/src/trace.ts --script "20 idle; 60 right;
  30 down-right+B" --out out/traces/x.json` plays a scripted input movie from `ref/save-lake-hylia.sav` and records
  the Links (position, sprite frame, walk tick, state), the pad and the camera every frame (~10 s per 1000 frames).
  Script syntax in `tools/dolphin/src/script.ts`; `--raw <hexaddr>:<hexlen>` also dumps RAM ranges per frame,
  `--dump-frames` dumps frames (`--dump-audio` the DSP audio, into the user dir's Dump/Audio), `--script @file` reads the script from a file, `--dump <frame>:<addr>:<len>` saves a
  range once, `--write <frame>:<addr>:<hexbytes>` pokes RAM (e.g. Link +0xC10 = the item; `--fill <frame>:<addr>:<len>:<byte>`
  a whole range, e.g. a texture: see measurements/screens.md "Renderer checks by RAM pokes"), `--patch <pc>:r<n>:<hexbytes>` writes at a register's address the first time the CPU reaches pc (Tingle's Tower's CSV header: measurements/adventure-world1.md), `--break <pc>` notes each time the CPU gets there (frame, lr, r3–r10, the callers: who spawns an actor, with what params), `--tele <frame>:<x>:<y>` moves
  the Links. `R` in scripts presses the analog trigger too (FSA's Action button reads it). `trace-print.ts <trace.json>`
  tabulates a trace; `rawdiff.ts`, `memfind.ts`, `objtrace.ts` analyse raw dumps (spawned actors);
  `actor-trace.ts` records chosen fields of live actors found by vtable each frame (`actor-print.ts` prints them; `--tele`,
  `--write` and `--dump-frames` as trace.ts; `--place <frame>:<ID>:<link>:<dx>:<dy>` puts the first actor of a type
  beside a Link wherever he stands, e.g. an enemy that keeps away in front of a Link's sword);
  `fixture.ts` turns traces into `packages/sim/src/dolphin-traces.json` (the sim's regression fixture; `--battle
  [--append] <out> <name>=<trace>[@from:to]` into `dolphin-battle-traces.json`, `--append` keeping the other cases).
  Addresses live in `tools/dolphin/src/fsa.ts` and `docs/formats/runtime-ram.md` "Runtime (RAM) notes"; how to read FSA's live
  JPA particle emitters out of a savestate's RAM: `docs/formats/jpa.md` "JPA particles"; `emitters.ts <mem1>` lists them (from
  `ram.ts`, or `trace.ts --dump <frame>:80000000:1800000` mid-run).
- Shadow Battle in Dolphin (integrated GBAs, `disc/gba_bios.bin`): `node tools/dolphin/src/battle-user.ts` writes
  `ref/dolphin-user-battle`, `battle-states.ts` rebuilds the round-start savestates `ref/save-battle-<arena>-<n>p.sav`
  from power-on, the Dark World ones (`dark-field` … `dark-clouds`, boss500 rooms 5-9) with the Quest Log's unlock
  bit poked in, each with its recipe and place (`place.ts check` replays them); scripts name players (`20 p1:right+B p2:A`), `--save <frame>:<path>` saves a state. Details in
  `docs/measurements/battle-arenas.md` "Battle mode in Dolphin"; the static readings to confirm in "Battle constants from main.dol".
- How it works: `-C Dolphin.General.GDBPort=<port>` makes Dolphin wait for a GDB client at boot (`gdb.ts`, a minimal
  RSP client: memory read/write, registers, breakpoints, watchpoints); `Dolphin.Interface.DebugModeEnabled=True` makes
  the JIT honour breakpoints. Movies (`dtm.ts`) hold one controller state per SI poll, and FSA polls twice per frame.
  A movie that starts from a savestate needs the state at `<movie>.sav` and, for states not recorded with a movie, a
  copy of the movie at `<movie>.sav.dtm` or Dolphin stops playback on load. Only one tracer at a time per GDB port;
  graphics dump switches only take effect from the user folder's `GFX.ini`, not `-C`.

## Places, comparisons and clips (Dolphin against ours)
- **Recipes.** `trace.ts --save` writes next to each state its recipe `<state>.sav.json`: the parent state (or `boot`),
  the script, the pokes (`tele`, `write`, `fill`, `patch`), the port layout and the frame (`recipe.ts`; older states
  noted some pokes as free text or not at all, and say so). `place.ts` keeps named places in `ref/`:
  `node tools/dolphin/src/place.ts save ref/places/lake-room7.sav --from ref/adv/room5-river.sav --script "5 idle;
  40 right; 20 idle; 160 up; 40 idle; 40 up; 30 idle"` saves the state 10 frames after the script (`--at <frame>`),
  with its `place`: the stage and room (from the leader's cell; on a GBA screen `--room`) or the arena, and the
  Links. `place.ts check <state>` replays the recipe from its parent and compares the Links on its frame with the
  place (exit 1 when they differ: `ref/adv/room9.sav`'s chain, for one, no longer lands where it was saved);
  `build <state> [--parents]` makes it again (missing parents first); `show <state>` prints the recipe and the state
  read offline (`live.ts <state.sav|mem1>`: the Links, the live actors by vtable, the camera).
- **Compare at a place:** `node tools/dolphin/src/compare.ts <state.sav> [--at 0,2,5]` leaves Dolphin and ours idle
  from the place and pairs the live actors at each moment (`diff.ts`: same within ±4 px, moved, missing from ours,
  extra in ours), with the frames side by side at 640 x 480 (`side-t<s>.png`, Dolphin left). Ours: an adventure room
  entered at the leader's spot (`#room`; a GBA area is not supported, it needs the route's state), each Link put on
  Dolphin's spot facing his way with his life, the leader holding his item (the Cave's lamp), the room's switches
  set as Dolphin's (`live.ts`: stage data + 0x178, `docs/formats/battle-arenas.md` "Switches"), and a shuttling
  hovering gem (`HNRY`) given the way, timer and speeds of Dolphin's (`live.ts` reads them: `LIVE_FIELDS`; our
  frames still start it from the room's entry). The frames replay that start (the adventure record's `carry`,
  `links`, `switches`, @fso/sim replay.ts), the room's lights settled (the lamp at its full 100 px). Not carried:
  what else the room's things did (a block pushed stands at its start, a chest opened is shut, an enemy at its
  spawn) and the formation (each follower walks to the Link ahead of him); a battle round state's arena (the Dark World
  ones too: `save-battle-dark-<arena>-<n>p` is boss500 room 5-9) with its props, the Links at Dolphin's starts and control on the same frame
  (the replay record's `start`, @fso/sim replay.ts). Our frames come from the app's dev server, which compare.ts
  starts on port 5560 (`--web-port`) replaying `out/dolphin-compare/captures`. Actors the sim keeps no object for are
  shown at their placed px (`placed`). SWTH floor switches come out 8 px up-left of Dolphin's on both sides (The
  Field, Lake Hylia room 7): a difference of where the position is taken, so far.
- **Clip diff:** `node tools/dolphin/src/clip.ts <state.sav> --script "<script>"` plays the script in Dolphin, feeds
  ours what Dolphin's game read each frame (the GBA keys, or the pad: B sword, A item, R action, the C stick's
  formations) from the same place (ours given what `compare.ts` carries: a hovering gem's shuttle, Shadow Link's
  entrance state a tick on, since a trace's first frame is the game's frame after the state's RAM; a leader walking
  in Dolphin, state 2, walks on in ours), and reports the first frame a Link is more than 1 px off (`--tol`), with a table
  every 10 frames (`--every`) and around it. A battle round state's control frame isn't the same in every state: when
  ours walks off a frame or two late, `--lead` lines it up (8 for Above the Clouds and the Tower of Flames, 9 for The
  Field); `--reuse` keeps Dolphin's side of the last run of the same clip to try ours again; `--links 1` compares the
  leader alone (the others still in the table).
- Output in `out/dolphin-compare/<name>/` (report.md, diff.json or clip.json, the frames); defaults GDB port 2490,
  user folders `ref/dolphin-user-compare` (GBA ports) and `ref/dolphin-user-compare-adventure` (`--user`, `--port`).
  Dolphin's camera is not ours (zoom in the report), and the live reader sees only actors spawned by ID.
