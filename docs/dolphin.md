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
  a whole range, e.g. a texture: see measurements/screens.md "Renderer checks by RAM pokes"), `--patch <pc>:r<n>:<hexbytes>` writes at a register's address the first time the CPU reaches pc (Tingle's Tower's CSV header: measurements/adventure-world1.md), `--tele <frame>:<x>:<y>` moves
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
  from power-on; scripts name players (`20 p1:right+B p2:A`), `--save <frame>:<path>` saves a state. Details in
  `docs/measurements/battle-arenas.md` "Battle mode in Dolphin"; the static readings to confirm in "Battle constants from main.dol".
- How it works: `-C Dolphin.General.GDBPort=<port>` makes Dolphin wait for a GDB client at boot (`gdb.ts`, a minimal
  RSP client: memory read/write, registers, breakpoints, watchpoints); `Dolphin.Interface.DebugModeEnabled=True` makes
  the JIT honour breakpoints. Movies (`dtm.ts`) hold one controller state per SI poll, and FSA polls twice per frame.
  A movie that starts from a savestate needs the state at `<movie>.sav` and, for states not recorded with a movie, a
  copy of the movie at `<movie>.sav.dtm` or Dolphin stops playback on load. Only one tracer at a time per GDB port;
  graphics dump switches only take effect from the user folder's `GFX.ini`, not `-C`.
