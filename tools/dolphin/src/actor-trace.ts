// Actor tracer: plays a scripted movie from a savestate like trace.ts and, every frame, finds the live actors of some
// types by their vtable in a RAM range and records chosen fields of each, next to the Links' snapshot. Made for Shadow
// Battle's arenas, where orbs, items, bees and bombs come and go (docs/measurements/battle-arenas.md "Battle measurements: arenas,
// orbs and camera").
//   node tools/dolphin/src/actor-trace.ts --savestate ref/save-battle-field-2p.sav --script "600 idle"
//     --ids CRGN,CRTL,LSTI --fields CRGN=230,238,23c --fields CRTL=230,278,288,2b4 --out out/traces/x.json
// Options (the others as trace.ts: --user, --port, --tail, --ports, --disc, --save <frame>:<path>):
//   --ids <IDs> actor types, their vtables from main.dol's spawn switch (tools/dol `spawn`); or ID=<vtable hex>
//   --scan <lo hex>:<hi hex> the RAM range scanned (default 812D8000:81340000, the arena actors' heap)
//   --fields <ID>=<off>[:type],… per type, the fields recorded: offset hex, type u32 (default), s (s32), h (u16),
//     b (u8), f (f32), e.g. `CRTL=230,278,24c:f`; a range `230-260[:type]` is every 4 bytes from 0x230 to 0x25C;
//     `*=…` applies to every type
//   --raw <hexaddr>:<hexlen> fixed ranges recorded every frame as hex strings (e.g. the camera object)
//   --every <n> scan every n-th frame only (default 1)
//   --tele <frame>:<x>:<y> (repeatable; moves all four Links to world px (x, y) after that frame, as trace.ts)
//   --dump-frames (Dolphin frame dump into the user dir's Dump/Frames, as trace.ts)
//   --place <frame>:<ID>:<link>:<dx>:<dy> (repeatable; after that frame, moves the first live actor of type ID to Link
//     <link>'s position + (dx, dy), its three position copies (+0xC, +0x18, +0x24): an enemy put in front of a Link
//     wherever he stands, e.g. to land sword hits on one that keeps away)
// `actor-print.ts <trace>` prints it.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { BATTLE_USER } from "./battle-user.ts";
import { launchDolphin } from "./dolphin.ts";
import { portBits, writeDtm, type PortDevice } from "./dtm.ts";
import { linkActors, MAIN_LOOP_HEAD, readSnapshot, VI_RETRACE_COUNT, type FrameSnapshot } from "./fsa.ts";
import { GdbClient } from "./gdb.ts";
import { HotkeyPipe, saveState } from "./hotkey.ts";
import { parsePorts, parseScript, toPortStates } from "./script.ts";

const POLLS_PER_FRAME = 2;

const { values } = parseArgs({
  options: {
    script: { type: "string" },
    out: { type: "string", default: "out/traces/actors.json" },
    savestate: { type: "string", default: "ref/save-battle-field-2p.sav" },
    disc: { type: "string", default: "disc/Legend of Zelda, The - Four Swords Adventures (USA).rvz" },
    user: { type: "string" },
    port: { type: "string", default: "55123" },
    tail: { type: "string", default: "0" },
    ports: { type: "string" },
    ids: { type: "string", default: "" },
    scan: { type: "string", default: "812D8000:81340000" },
    fields: { type: "string", multiple: true, default: [] },
    raw: { type: "string", multiple: true, default: [] },
    every: { type: "string", default: "1" },
    save: { type: "string", multiple: true, default: [] },
    write: { type: "string", multiple: true, default: [] },
    tele: { type: "string", multiple: true, default: [] },
    place: { type: "string", multiple: true, default: [] },
    "dump-frames": { type: "boolean", default: false },
  },
});
if (!values.script) {
  console.error('usage: actor-trace --script "600 idle" --ids CRGN,CRTL [--fields CRTL=230,278] [--savestate …] [--out …]');
  process.exit(1);
}

export type FieldType = "u32" | "s" | "h" | "b" | "f";
export interface FieldSpec {
  off: number;
  type: FieldType;
}
export interface ActorRecord {
  a: number;
  id: string;
  x: number;
  y: number;
  z: number;
  /** `+<off hex>[:type]` → value, in the order given. */
  v: Record<string, number>;
}
export type ActorFrame = FrameSnapshot & { f: number; input: string; actors?: ActorRecord[]; raw?: string[] };

/** `230` → u32 at 0x230, `24c:f` → f32 at 0x24C, … */
export function parseField(s: string): FieldSpec {
  const m = /^([0-9a-f]+)(?::([shbf]))?$/i.exec(s.trim());
  if (!m) throw new Error(`bad field "${s}" (hex offset, optionally :s :h :b :f)`);
  return { off: parseInt(m[1]!, 16), type: ((m[2] || "u32").toLowerCase() as FieldType) };
}
/** Keys start with "+" so that objects keep them in the order given. */
export const fieldKey = (f: FieldSpec) => `+${f.off.toString(16)}${f.type === "u32" ? "" : `:${f.type}`}`;

function readField(v: DataView, o: number, f: FieldSpec): number {
  const at = o + f.off;
  if (at + 4 > v.byteLength) return NaN;
  switch (f.type) {
    case "s": return v.getInt32(at);
    case "h": return v.getUint16(at);
    case "b": return v.getUint8(at);
    case "f": return v.getFloat32(at);
    default: return v.getUint32(at);
  }
}

// Vtables by type ID, from the spawn switch (tools/dol) unless given.
const vtables = new Map<number, string>();
const want = values.ids!.split(",").map((s) => s.trim()).filter(Boolean);
const lookup = want.filter((s) => !s.includes("="));
for (const s of want.filter((s) => s.includes("="))) vtables.set(parseInt(s.split("=")[1]!, 16), s.split("=")[0]!);
if (lookup.length) {
  const cli = join(dirname(new URL(import.meta.url).pathname), "../../dol/src/cli.ts");
  const out = execFileSync(process.execPath, [cli, "spawn", ...lookup], { encoding: "utf8" });
  for (const line of out.split("\n")) {
    const m = /^(\S+) size \d+ ctor \S+ vtable 0x([0-9a-f]+)/.exec(line);
    if (m) vtables.set(parseInt(m[2]!, 16), m[1]!);
  }
  for (const id of lookup) if (![...vtables.values()].includes(id)) console.error(`warning: no vtable for ${id}`);
}
const fieldsById = new Map<string, FieldSpec[]>();
for (const spec of values.fields!) {
  const [id, list] = [spec.slice(0, spec.indexOf("=")), spec.slice(spec.indexOf("=") + 1)];
  const specs = list.split(",").flatMap((f) => {
    const range = /^([0-9a-f]+)-([0-9a-f]+)(:[shbf])?$/i.exec(f.trim());
    if (!range) return [parseField(f)];
    const [lo, hi] = [parseInt(range[1]!, 16), parseInt(range[2]!, 16)];
    return Array.from({ length: Math.max(0, (hi - lo) >> 2) }, (_, k) => parseField(`${(lo + 4 * k).toString(16)}${range[3] ?? ""}`));
  });
  fieldsById.set(id, [...(fieldsById.get(id) ?? []), ...specs]);
}
const fieldsFor = (id: string) => [...(fieldsById.get("*") ?? []), ...(fieldsById.get(id) ?? [])];
const [scanLo, scanHi] = values.scan!.split(":").map((s) => parseInt(s, 16)) as [number, number];

const script = values.script.startsWith("@") ? readFileSync(values.script.slice(1), "utf8") : values.script;
const segments = parseScript(script);
const scriptFrames = segments.reduce((n, s) => n + s.frames, 0);
const frames = scriptFrames + Number(values.tail);
const out = resolve(values.out!);
mkdirSync(dirname(out), { recursive: true });
const savestate = resolve(values.savestate!);
const stateInfo = existsSync(`${savestate}.json`) ? (JSON.parse(readFileSync(`${savestate}.json`, "utf8")) as { ports?: PortDevice[] }) : {};
const ports = values.ports ? parsePorts(values.ports) : (stateInfo.ports ?? ["gc"]);
const userDir = resolve(values.user ?? (ports.includes("gba") ? BATTLE_USER : "ref/dolphin-user"));
const saves = values.save!.map((s) => {
  const [f, path] = [s.slice(0, s.indexOf(":")), s.slice(s.indexOf(":") + 1)];
  if (!(Number(f) >= scriptFrames && Number(f) < frames)) throw new Error(`--save ${s}: the frame must be in the tail (${scriptFrames}…${frames - 1})`);
  return { f: Number(f), path: resolve(path) };
});
const writes = values.write!.map((w) => {
  const [f, addr, bytes] = w.split(":");
  return { f: Number(f), addr: parseInt(addr!, 16), data: Uint8Array.from(bytes!.match(/../g)!.map((b) => parseInt(b, 16))) };
});
const raw = values.raw!.map((r) => r.split(":").map((v) => parseInt(v, 16)) as [number, number]);
const teles = values.tele!.map((t) => t.split(":").map(Number) as [number, number, number]);
const places = values.place!.map((p) => {
  const [f, id, link, dx, dy] = p.split(":");
  return { f: Number(f), id: id!, link: Number(link), dx: Number(dx), dy: Number(dy) };
});

// As trace.ts: the movie and the state it starts from side by side (and `<state>.dtm`, or Dolphin stops the movie).
const movie = join(dirname(out), `${Date.now()}-${process.pid}.dtm`);
const movieTail = saves.length ? 0 : Number(values.tail) + 4;
const states = toPortStates([...segments, { frames: movieTail, input: {}, inputs: [{}, {}, {}, {}], label: "tail" }].filter((s) => s.frames), POLLS_PER_FRAME, ports);
writeFileSync(movie, writeDtm(states, { gameId: "G4SE01", fromSaveState: true, ...portBits(ports) }));
copyFileSync(savestate, `${movie}.sav`);
copyFileSync(movie, `${movie}.sav.dtm`);

const config = values["dump-frames"]
  ? ["Dolphin.Movie.DumpFrames=True", "GFX.Settings.DumpFramesAsImages=True", "GFX.Settings.InternalResolution=1", "GFX.Settings.InternalResolutionFrameDumps=True"]
  : [];
const proc = launchDolphin({ userDir, disc: resolve(values.disc!), movie, gdbPort: Number(values.port), config, log: `${out}.dolphin.log` });
const gbaPorts = ports.lastIndexOf("gba") + 1;
const every = Math.max(1, Number(values.every));
const records: ActorFrame[] = [];
let actors: number[] = [];
const started = Date.now();
try {
  const gdb = await GdbClient.connect(Number(values.port), "127.0.0.1", 60000);
  const pipe = saves.length ? new HotkeyPipe(userDir) : null;
  await gdb.addBreakpoint(MAIN_LOOP_HEAD);
  await gdb.continue();
  const labels = segments.flatMap((s) => Array<string>(s.frames).fill(s.label));
  let resumed = false;
  for (let f = 0; f < frames; f++) {
    if (f > 0 && !resumed) await gdb.continue();
    resumed = false;
    const now = await linkActors(gdb);
    if (now.join() !== actors.join()) actors = now;
    const rec: ActorFrame = { f, input: labels[f] ?? "tail", ...(await readSnapshot(gdb, actors, gbaPorts)) };
    if (f % every === 0 && vtables.size) {
      const mem = await gdb.readMemory(scanLo, scanHi - scanLo);
      const v = new DataView(mem.buffer, mem.byteOffset, mem.byteLength);
      rec.actors = [];
      for (let o = 0; o + 0x18 <= mem.length; o += 4) {
        const id = vtables.get(v.getUint32(o));
        if (!id || v.getUint32(o + 4) > 0xff) continue;
        const vals: Record<string, number> = {};
        for (const fs of fieldsFor(id)) vals[fieldKey(fs)] = readField(v, o, fs);
        rec.actors.push({ a: scanLo + o, id, x: v.getFloat32(o + 0xc), y: v.getFloat32(o + 0x10), z: v.getFloat32(o + 0x14), v: vals });
      }
    }
    if (raw.length) rec.raw = [];
    for (const [addr, len] of raw) rec.raw!.push(Buffer.from(await gdb.readMemory(addr, len)).toString("hex"));
    records.push(rec);
    for (const w of writes) if (w.f === f) await gdb.writeMemory(w.addr, w.data);
    for (const [tf, x, y] of teles) {
      if (tf !== f) continue;
      const pos = new DataView(new ArrayBuffer(8));
      pos.setFloat32(0, x);
      pos.setFloat32(4, y);
      for (const a of actors) await gdb.writeMemory(a + 8, new Uint8Array(pos.buffer));
    }
    for (const p of places) {
      const actor = p.f === f ? rec.actors?.find((a) => a.id === p.id) : undefined;
      const link = rec.links[p.link];
      if (!actor || !link) continue;
      const pos = new DataView(new ArrayBuffer(36));
      for (let k = 0; k < 3; k++) {
        pos.setFloat32(k * 12, link.x + p.dx);
        pos.setFloat32(k * 12 + 4, link.y + p.dy);
        pos.setFloat32(k * 12 + 8, actor.z);
      }
      await gdb.writeMemory(actor.a + 0xc, new Uint8Array(pos.buffer));
    }
    for (const s of saves) {
      if (s.f !== f) continue;
      const retrace = new DataView((await gdb.readMemory(VI_RETRACE_COUNT, 4)).buffer).getUint32(0);
      mkdirSync(dirname(s.path), { recursive: true });
      const { movieActive } = await saveState(pipe!, userDir, s.path, async () => {
        await gdb.continue();
        resumed = true;
      });
      if (movieActive) console.error(`warning: ${s.path} was saved while the movie still played: make the tail longer`);
      writeFileSync(`${s.path}.json`, JSON.stringify({ ports, frame: f, retrace, movieActive, script, from: values.savestate }, null, 2) + "\n");
      console.log(`state at frame ${f} -> ${s.path}`);
    }
  }
  pipe?.close();
  gdb.close();
  writeFileSync(out, JSON.stringify({ script, savestate: values.savestate, ports, scan: values.scan, frames: records }));
  console.log(`${records.length} frames -> ${out} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
} finally {
  proc.kill("SIGKILL");
  for (const f of [movie, `${movie}.sav`, `${movie}.sav.dtm`]) rmSync(f, { force: true });
}
