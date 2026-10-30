// What a Dolphin state holds, read offline from a savestate or a MEM1 dump (ram.ts, `trace.ts --dump
// <frame>:80000000:1800000`): the four Links, every live actor (found by its type's vtable, main.dol's spawn-by-ID
// switch) and the camera.
//   node tools/dolphin/src/live.ts <state.sav|mem1> [--json] [--all]
// (--all keeps the actors that draw nothing: controllers, the GBA screens, leaves.)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decompressYaz0, loadActorTypes, parseRarc } from "@fso/formats";
import { liveActors, MainDol } from "../../dol/src/analysis.ts";
import { CAMERA_ZOOM, LINK, PLAYER_MANAGER_PTR, STAGE_PTR, VIEW_MATRIX } from "./fsa.ts";
import { findMem1, MEM1_BASE, MEM1_SIZE, readSavestate } from "./savestate.ts";

/** Link +0x3B4: the screen he is on (0 the TV, 7 + k a GBA area's sublayer k). */
export const LINK_SCREEN = 0x3b4;

export interface LiveLink {
  x: number;
  y: number;
  z: number;
  state: number;
  screen: number;
  facing: number;
  life: number;
  item: number;
}

export interface LiveActor {
  addr: number;
  /** Its type ID (the IDs that share its vtable, `/`-joined). */
  id: string;
  screen: number;
  x: number;
  y: number;
  /** Fields read for some types (LIVE_FIELDS). */
  fields?: Record<string, number>;
}

/** Fields read from the live actors of some types, by name: offset and kind (f32 or i32). */
export const LIVE_FIELDS: Readonly<Record<string, Readonly<Record<string, readonly [number, "f32" | "i32"]>>>> = {
  // A hovering gem's shuttle (sim pickups.ts HOVER_SHUTTLE): the way, the timer, velocity, target velocity, its place.
  HNRY: {
    dir: [0x98, "i32"], timer: [0x250, "i32"], vx: [0x3c, "f32"], vy: [0x40, "f32"], tvx: [0x28c, "f32"], tvy: [0x290, "f32"],
    homeX: [0x298, "f32"], homeY: [0x29c, "f32"],
  },
  // Shadow Link's state and its ticks (sim shadowlink.ts: his entrance's states 0-14).
  SLK2: { state: [0x248, "i32"], tick: [0x24c, "i32"] },
};

export interface LiveState {
  links: LiveLink[];
  actors: LiveActor[];
  camera: { x: number; y: number; zoom: number } | null;
}

/** Actors that draw nothing (or only on the GBA): left out unless asked for. */
export const UNDRAWN = new Set([
  "LEAF", "RANK", "GBAO", "TBGN", "SWDL", "SWEV", "SEV2", "TINB", "GFBS", "LFGN", "BGMN", "WTSW", "LTEV", "SWNP", "GLWP",
  "ZOOM", "VWMD", "WARP", "DOOR", "SKIL", "FOCS", "PNPC", "KEPO",
]);
/** Above this, the vtable matches are stale copies in the heap's tail, not live actors. */
const LIVE_LIMIT = 0x81400000;

/** The vtable of every actor type the game spawns by ID (some types share one). */
export function actorVtables(extracted: string): Map<number, string[]> {
  const main = new MainDol(readFileSync(join(extracted, "sys/main.dol")));
  const data = parseRarc(decompressYaz0(readFileSync(join(extracted, "files/GC4Sword_usa/data.arc"))));
  const vtables = new Map<number, string[]>();
  for (const id of loadActorTypes(data)?.keys() ?? []) {
    const spawn = main.resolveSpawn(id);
    const vt = spawn ? main.vtableOf(spawn.ctor) : null;
    if (vt) vtables.set(vt, [...(vtables.get(vt) ?? []), id]);
  }
  return vtables;
}

/** MEM1 from a savestate (`.sav`) or a raw dump. */
export function readMem1(path: string, extracted: string): Uint8Array {
  const bytes = readFileSync(path);
  if (!path.endsWith(".sav")) return bytes;
  const dol = readFileSync(join(extracted, "sys/main.dol"));
  // Text section 1 (file offset and load address from the DOL header): 256 bytes of code locate MEM1.
  const textOffset = dol.readUInt32BE(4), textAddress = dol.readUInt32BE(0x48 + 4);
  return findMem1(readSavestate(bytes).payload, dol.subarray(textOffset + 0x1000, textOffset + 0x1100), textAddress + 0x1000);
}

export function readLive(mem1: Uint8Array, vtables: Map<number, string[]>, all = false): LiveState {
  const v = new DataView(mem1.buffer, mem1.byteOffset, mem1.byteLength);
  const inRam = (a: number) => a >= MEM1_BASE && a < MEM1_BASE + MEM1_SIZE;
  const u32 = (a: number) => v.getUint32(a - MEM1_BASE);
  const f32 = (a: number) => v.getFloat32(a - MEM1_BASE);
  const manager = u32(PLAYER_MANAGER_PTR);
  const links: LiveLink[] = [];
  for (let i = 0; inRam(manager) && i < 4; i++) {
    const a = u32(manager + 4 + 4 * i);
    if (!inRam(a)) break;
    links.push({
      x: f32(a + LINK.x), y: f32(a + LINK.y), z: f32(a + LINK.z), state: u32(a + LINK.state), screen: u32(a + LINK_SCREEN),
      facing: u32(a + LINK.facing), life: u32(a + LINK.life), item: u32(a + LINK.item),
    });
  }
  const actors = liveActors(mem1, vtables)
    .filter((a) => a.addr < LIVE_LIMIT && (all || !a.ids.some((id) => UNDRAWN.has(id))))
    .map((a) => {
      const spec = a.ids.map((id) => LIVE_FIELDS[id]).find(Boolean);
      const fields = spec && Object.fromEntries(Object.entries(spec).map(([k, [o, t]]) => [k, t === "f32" ? f32(a.addr + o) : v.getInt32(a.addr + o - MEM1_BASE)]));
      return { addr: a.addr, id: a.ids.join("/"), screen: a.screen, x: a.x, y: a.y, ...(fields ? { fields } : {}) };
    });
  let camera: LiveState["camera"] = null;
  const stage = u32(STAGE_PTR);
  if (inRam(stage) && inRam(u32(stage + 0x24))) {
    camera = { x: -f32(VIEW_MATRIX + 0xc), y: -f32(VIEW_MATRIX + 0x1c), zoom: f32(u32(stage + 0x24) + CAMERA_ZOOM) };
  }
  return { links, actors, camera };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const path = args.find((a) => !a.startsWith("--"));
  if (!path) {
    console.error("usage: live <state.sav|mem1> [--json] [--all]");
    process.exit(1);
  }
  const live = readLive(readMem1(path, "extracted"), actorVtables("extracted"), args.includes("--all"));
  if (args.includes("--json")) console.log(JSON.stringify(live));
  else {
    const c = live.camera;
    console.log(c ? `camera (${c.x.toFixed(1)}, ${c.y.toFixed(1)}) zoom ${c.zoom.toFixed(4)}` : "camera -");
    for (const [i, l] of live.links.entries())
      console.log(`link${i} (${l.x.toFixed(1)}, ${l.y.toFixed(1)}) z ${l.z.toFixed(1)} state ${l.state} screen ${l.screen} facing ${l.facing} life ${l.life} item ${l.item}`);
    for (const a of live.actors) console.log(`${a.addr.toString(16)} ${a.id.padEnd(5)} s${a.screen} (${a.x.toFixed(1)}, ${a.y.toFixed(1)})`);
  }
}
