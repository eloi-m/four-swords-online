// Trace runner: plays a scripted input movie in Dolphin from a savestate and records Link's state every frame through
// the GDB stub (one breakpoint on the main-loop head per frame), as JSON.
//   node tools/dolphin/src/trace.ts --script "30 idle; 60 right; 60 down-right" --out out/trace.json
// (`--script @file` reads the script from a file; syntax in script.ts.) Options: --savestate <sav> (ref/save-lake-hylia.sav) --disc <rvz> --user <dolphin user dir> (ref/dolphin-user)
//   --port <gdb port> (55123) --tail <extra idle frames> (0) --raw <hexaddr>:<hexlen> (repeatable; per-frame bytes
//   go to <out>.<addr>.bin) --dump-frames (Dolphin frame dump into the user dir's Dump/Frames), --dump-audio (its DSP dump, Dump/Audio).
//   --dump <frame>:<hexaddr>:<hexlen> (repeatable; that range once, at that frame, into <out>.f<frame>.<addr>.bin)
//   --write <frame>:<hexaddr>:<hexbytes> (repeatable; pokes RAM at that frame, after it is recorded, e.g. to grant an item)
//   --fill <frame>:<hexaddr>:<hexlen>:<hexbyte> (repeatable; the same with a range set to one byte)
//   --patch <hexpc>:r<n>:<hexbytes> (repeatable; the first time the CPU reaches pc, writes the bytes at the address held
//   in register n, e.g. a file just read from an archive: docs/measurements/adventure-world1.md "Tingle's Tower")
//   --tele <frame>:<x>:<y> (repeatable; moves all four Links to world px (x, y) at that frame, e.g. next to a room edge
//   so that walking on changes rooms the normal way)
// Shadow Battle (docs/measurements/battle-arenas.md "Battle mode in Dolphin"):
//   --ports gba,gba (what ports 1–4 hold: gc, gba = Dolphin's integrated GBA, none; default gc; the savestate's own
//   layout from its .json when it has one). GBA ports need the battle user folder (battle-user.ts), the default then.
//   --boot (start from power-on instead of a savestate; frames count from the first main-loop pass)
//   --save <frame>:<path.sav> (repeatable; saves a state at that frame's breakpoint through the hotkey pipe, with a
//   <path>.json of how it was made; the movie must have ended by then, so the script stops before and --tail covers it)
//   --from <frame> (records snapshots from that frame on only: faster while booting or walking through menus)
//   --link <hexoff>:<hexlen> (repeatable; also records those bytes of every Link each frame, as hex in `links[i].raw`,
//   e.g. --link 35c:c for the push velocity)
//   --watch <from>-<to>:<hexoff>:<hexlen> (repeatable; a write watchpoint on that field of every Link over those frames:
//   each write prints the frame, the Link, pc and lr and goes into the output's `watchHits`; slow, Dolphin single-steps)
//   --break <hexpc> (repeatable; a code breakpoint: each time the CPU gets there, the frame, lr, r3–r10 and the callers
//   go into the output's `breakHits`, e.g. to see who spawns an actor and with what params)
// With --dump-frames the output's `frameDumps` holds, per frame, how many images Dolphin had dumped (framedump_<n>.png is
// the n-th; the game skips presenting frames while it loads, so n drifts from the frame number).
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { BATTLE_USER } from "./battle-user.ts";
import { launchDolphin } from "./dolphin.ts";
import { portBits, writeDtm, type PortDevice } from "./dtm.ts";
import { linkActors, MAIN_LOOP_HEAD, readSnapshot, VI_RETRACE_COUNT, type FrameSnapshot } from "./fsa.ts";
import { GdbClient, hex } from "./gdb.ts";
import { HotkeyPipe, saveState } from "./hotkey.ts";
import { parsePorts, parseScript, toPortStates } from "./script.ts";

// FSA reads the pad twice per frame (SI polling), so every frame consumes two movie inputs per plugged port.
export const POLLS_PER_FRAME = 2;

const { values } = parseArgs({
  options: {
    script: { type: "string" },
    out: { type: "string", default: "out/trace.json" },
    savestate: { type: "string", default: "ref/save-lake-hylia.sav" },
    disc: { type: "string", default: "disc/Legend of Zelda, The - Four Swords Adventures (USA).rvz" },
    user: { type: "string" },
    port: { type: "string", default: "55123" },
    tail: { type: "string", default: "0" },
    ports: { type: "string" },
    boot: { type: "boolean", default: false },
    save: { type: "string", multiple: true, default: [] },
    from: { type: "string", default: "0" },
    raw: { type: "string", multiple: true, default: [] },
    dump: { type: "string", multiple: true, default: [] },
    write: { type: "string", multiple: true, default: [] },
    fill: { type: "string", multiple: true, default: [] },
    patch: { type: "string", multiple: true, default: [] },
    tele: { type: "string", multiple: true, default: [] },
    link: { type: "string", multiple: true, default: [] },
    watch: { type: "string", multiple: true, default: [] },
    break: { type: "string", multiple: true, default: [] },
    "dump-frames": { type: "boolean", default: false },
    "dump-audio": { type: "boolean", default: false },
  },
});
if (!values.script) {
  console.error('usage: trace --script "30 idle; 60 right" [--out out/trace.json] [--savestate …] [--raw addr:len]');
  process.exit(1);
}

const script = values.script.startsWith("@") ? readFileSync(values.script.slice(1), "utf8") : values.script;
const segments = parseScript(script);
const scriptFrames = segments.reduce((n, s) => n + s.frames, 0);
const frames = scriptFrames + Number(values.tail);
const out = resolve(values.out!);
mkdirSync(dirname(out), { recursive: true });
const savestate = values.boot ? null : resolve(values.savestate!);
// A state made by --save knows its port layout.
const stateInfo = savestate && existsSync(`${savestate}.json`) ? (JSON.parse(readFileSync(`${savestate}.json`, "utf8")) as { ports?: PortDevice[] }) : {};
const ports = values.ports ? parsePorts(values.ports) : (stateInfo.ports ?? ["gc"]);
const userDir = resolve(values.user ?? (ports.includes("gba") ? BATTLE_USER : "ref/dolphin-user"));
const saves = values.save!.map((s) => {
  const [f, path] = [s.slice(0, s.indexOf(":")), s.slice(s.indexOf(":") + 1)];
  if (!(Number(f) >= scriptFrames && Number(f) < frames)) throw new Error(`--save ${s}: the frame must be in the tail (${scriptFrames}…${frames - 1})`);
  return { f: Number(f), path: resolve(path) };
});

// Dolphin wants the savestate next to the movie; it also ends playback right after loading a state that wasn't
// recorded with a movie unless `<state>.dtm` exists, so we place a copy of the movie there too. The movie runs a few
// frames past the recording, except when states are saved: then it ends with the script (the states must not carry
// a movie position; the ports read neutral input once it's over).
const movie = join(dirname(out), "trace.dtm");
const movieTail = saves.length ? 0 : Number(values.tail) + 4;
const states = toPortStates([...segments, { frames: movieTail, input: {}, inputs: [{}, {}, {}, {}], label: "tail" }].filter((s) => s.frames), POLLS_PER_FRAME, ports);
writeFileSync(movie, writeDtm(states, { gameId: "G4SE01", fromSaveState: !!savestate, ...portBits(ports) }));
if (savestate) {
  copyFileSync(savestate, `${movie}.sav`);
  copyFileSync(movie, `${movie}.sav.dtm`);
}

const raw = values.raw!.map((r) => r.split(":").map((v) => parseInt(v, 16)) as [number, number]);
const rawBufs = raw.map(([, len]) => new Uint8Array(len * frames));
const dumps = values.dump!.map((d) => d.split(":").map((v, i) => (i === 0 ? Number(v) : parseInt(v, 16))) as [number, number, number]);
const writes = values.write!.map((w) => {
  const [f, addr, bytes] = w.split(":");
  return { f: Number(f), addr: parseInt(addr!, 16), data: Uint8Array.from(bytes!.match(/../g)!.map((b) => parseInt(b, 16))) };
});
// --fill <frame>:<hexaddr>:<hexlen>:<hexbyte>: a range set to one byte (e.g. a texture blanked to test what uses it).
for (const w of values.fill!) {
  const [f, addr, len, byte] = w.split(":");
  writes.push({ f: Number(f), addr: parseInt(addr!, 16), data: new Uint8Array(parseInt(len!, 16)).fill(parseInt(byte!, 16)) });
}
const patches = values.patch!.map((p) => {
  const [pc, reg, bytes] = p.split(":");
  return { pc: parseInt(pc!, 16), reg: Number(reg!.replace(/^r/, "")), data: Uint8Array.from(bytes!.match(/../g)!.map((b) => parseInt(b, 16))) };
});
const linkFields = values.link!.map((l) => l.split(":").map((v) => parseInt(v, 16)) as [number, number]);
const watches = values.watch!.map((w) => {
  const [range, off, len] = w.split(":");
  const [a, b] = range!.split("-").map(Number);
  return { from: a!, to: b ?? a!, off: parseInt(off!, 16), len: parseInt(len!, 16) };
});
const watchHits: { f: number; link: number; off: number; pc: string; lr: string; callers: string[] }[] = [];
const breaks = values.break!.map((b) => parseInt(b, 16));
const breakHits: { f: number; pc: string; lr: string; r: string[]; callers: string[] }[] = [];
const teles = values.tele!.map((t) => t.split(":").map(Number) as [number, number, number]);
const config = values["dump-frames"]
  ? ["Dolphin.Movie.DumpFrames=True", "GFX.Settings.DumpFramesAsImages=True", "GFX.Settings.InternalResolution=1", "GFX.Settings.InternalResolutionFrameDumps=True"]
  : [];
// --dump-audio: Dolphin's DSP dump (the user dir's Dump/Audio/<id>_<date>_dspdump.wav), e.g. to hear what an input does.
if (values["dump-audio"]) config.push("Dolphin.DSP.DumpAudio=True");
const proc = launchDolphin({
  userDir,
  disc: resolve(values.disc!),
  movie,
  gdbPort: Number(values.port),
  config,
  log: `${out}.dolphin.log`,
});

const from = Number(values.from);
// The GBA key records follow the ports in order: read as many as there are ports up to the last GBA.
const gbaPorts = ports.lastIndexOf("gba") + 1;
const records: (FrameSnapshot & { f: number; input: string })[] = [];
const dumpDir = join(userDir, "Dump", "Frames");
const frameDumps: number[] = [];
let actors: number[] = [];
try {
  const gdb = await GdbClient.connect(Number(values.port), "127.0.0.1", 60000);
  const pipe = saves.length ? new HotkeyPipe(userDir) : null;
  await gdb.addBreakpoint(MAIN_LOOP_HEAD);
  for (const p of patches) await gdb.addBreakpoint(p.pc);
  for (const b of breaks) await gdb.addBreakpoint(b);
  // The callers: the saved LRs up the stack's back chain (r1).
  const callersOf = async (gprs: number[]) => {
    const callers: string[] = [];
    for (let sp = gprs[1]!, k = 0; k < 6 && sp >= 0x80000000 && sp < 0x81800000; k++) {
      const frame = new DataView((await gdb.readMemory(sp, 8)).buffer);
      sp = frame.getUint32(0);
      if (sp >= 0x80000000 && sp < 0x81800000) callers.push(hex(new DataView((await gdb.readMemory(sp + 4, 4)).buffer).getUint32(0)));
    }
    return callers;
  };
  let frameNow = 0;
  // A stop at a --break's pc is noted; true when it was one.
  const noteBreak = async (pc: number) => {
    if (!breaks.includes(pc)) return false;
    const gprs = await gdb.readGprs();
    const hit = { f: frameNow, pc: hex(pc), lr: hex(await gdb.readRegister(67)), r: gprs.slice(3, 11).map((r) => hex(r)), callers: await callersOf(gprs) };
    breakHits.push(hit);
    console.log(`break: frame ${hit.f} pc ${hit.pc} lr ${hit.lr} r3-r10 ${hit.r.join(" ")} callers ${hit.callers.join(" ")}`);
    return true;
  };
  // A stop at a --patch's pc applies it (once); true when it was one.
  const applyPatch = async (pc: number) => {
    const hit = patches.find((p) => p.pc === pc);
    if (!hit) return false;
    const at = (await gdb.readGprs())[hit.reg]!;
    await gdb.writeMemory(at, hit.data);
    await gdb.removeBreakpoint(hit.pc);
    patches.splice(patches.indexOf(hit), 1);
    console.log(`patched ${hit.data.length} bytes at 0x${at.toString(16)} (r${hit.reg} at 0x${hit.pc.toString(16)})`);
    return true;
  };
  // Runs to the next main-loop pass, applying any --patch reached on the way.
  const nextFrame = async () => {
    for (let pc = (await gdb.continue()).pc; (await applyPatch(pc)) || (await noteBreak(pc)); pc = (await gdb.continue()).pc);
  };
  await nextFrame();
  const labels = segments.flatMap((s) => Array<string>(s.frames).fill(s.label));
  let resumed = false;
  for (let f = 0; f < frames; f++) {
    frameNow = f;
    if (f > 0 && !resumed) {
      // A watchpoint stops the CPU before the next frame's breakpoint: note who wrote, and go on to the frame.
      for (let stop = await gdb.continue(); stop.pc !== MAIN_LOOP_HEAD; stop = await gdb.continue()) {
        if ((await applyPatch(stop.pc)) || (await noteBreak(stop.pc))) continue;
        const lr = await gdb.readRegister(67);
        // The Link written: the first of them a register holds (r3, then r31 down).
        const gprs = await gdb.readGprs();
        const link = [3, ...Array.from({ length: 29 }, (_, i) => 31 - i)].map((r) => actors.indexOf(gprs[r]!)).find((i) => i >= 0) ?? -1;
        const callers = await callersOf(gprs);
        for (const w of watches.filter((w) => f - 1 >= w.from && f - 1 <= w.to)) {
          const hit = { f, link, off: w.off, pc: hex(stop.pc), lr: hex(lr), callers };
          watchHits.push(hit);
          console.log(`watch: frame ${f} Link ${link} +0x${w.off.toString(16)} pc ${hit.pc} lr ${hit.lr} callers ${callers.join(" ")} r26-r31 ${gprs.slice(26).map((r) => hex(r)).join(" ")}`);
        }
      }
    }
    resumed = false;
    if (f >= from) {
      // Battle recreates the Links every round, and there are none before the game has started: look them up each frame.
      const now = await linkActors(gdb);
      if (now.join() !== actors.join()) actors = now;
      records.push({ f, input: labels[f] ?? "tail", ...(await readSnapshot(gdb, actors, gbaPorts, linkFields)) });
    }
    for (let r = 0; r < raw.length; r++) rawBufs[r]!.set(await gdb.readMemory(raw[r]![0], raw[r]![1]), f * raw[r]![1]);
    for (const [df, addr, len] of dumps) if (df === f) writeFileSync(`${out}.f${f}.${addr.toString(16)}.bin`, await gdb.readMemory(addr, len));
    for (const w of writes) if (w.f === f) await gdb.writeMemory(w.addr, w.data);
    for (const w of watches) {
      if (f === w.from) for (const a of actors) await gdb.addWatchpoint(a + w.off, w.len);
      if (f === w.to + 1) for (const a of actors) await gdb.removeWatchpoint(a + w.off, w.len);
    }
    for (const [tf, x, y] of teles) {
      if (tf !== f) continue;
      const pos = new DataView(new ArrayBuffer(8));
      pos.setFloat32(0, x);
      pos.setFloat32(4, y);
      for (const a of actors) await gdb.writeMemory(a + 8, new Uint8Array(pos.buffer));
    }
    for (const s of saves) {
      if (s.f !== f) continue;
      const retrace = new DataView((await gdb.readMemory(VI_RETRACE_COUNT, 4)).buffer).getUint32(0);
      mkdirSync(dirname(s.path), { recursive: true });
      const { movieActive } = await saveState(pipe!, userDir, s.path, async () => {
        await gdb.continue();
        resumed = true;
      });
      if (movieActive) console.error(`warning: ${s.path} was saved while the movie still played (it ended late): make the tail longer`);
      const info = { ports, frame: f, retrace, movieActive, script, from: savestate ? values.savestate : "boot" };
      writeFileSync(`${s.path}.json`, JSON.stringify(info, null, 2) + "\n");
      console.log(`state at frame ${f} -> ${s.path}`);
    }
  }
  pipe?.close();
  gdb.close();
  writeFileSync(
    out,
    JSON.stringify({ script, savestate: savestate ? values.savestate : "boot", ports, pollsPerFrame: POLLS_PER_FRAME, actors, frameDumps, ...(watches.length ? { watchHits } : {}), ...(breaks.length ? { breakHits } : {}), frames: records }),
  );
  raw.forEach(([addr], r) => writeFileSync(`${out}.${addr.toString(16)}.bin`, rawBufs[r]!));
  console.log(`${records.length} frames -> ${out}`);
} finally {
  proc.kill("SIGKILL");
  for (const f of [movie, `${movie}.sav`, `${movie}.sav.dtm`]) rmSync(f, { force: true });
}
