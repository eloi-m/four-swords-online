// Turns trace.ts outputs into the compact measured-positions fixtures used by packages/sim's regression tests.
// Adventure traces (the formation leader, a GameCube pad): per frame the sim button mask the game read, and the
// leader's position (world px), sprite frame and state.
//   node tools/dolphin/src/fixture.ts <out.json> <name>=<trace.json>[@from:to] ...
// With --four, the four Links (the formations, the four-Link switch): per frame and per Link his area or world px,
// sprite frame and state; the inputs are the trace's script (its C-stick formations aren't in the pad).
//   node tools/dolphin/src/fixture.ts --four <out.json> <name>=<trace.json>[@from:to] ...
// Shadow Battle traces (integrated GBAs, docs/measurements/battle-combat.md "Battle measurements: combat"): per frame and per Link in
// the round, the sim button mask of his GBA's keys, his room position, height, sprite frame, state, life and
// invincibility. A trace that recorded the Links' screen (`trace.ts --link 3b4:4`) puts a Link in a side room where the
// sim lays it out (sublayer k at y + k x 512, packages/sim siderooms.ts).
//   node tools/dolphin/src/fixture.ts --battle [--append] <out.json> <name>=<trace.json>[@from:to] ...
// (--append keeps the out file's other cases, replacing those of the same names.)
import { readFileSync, writeFileSync } from "node:fs";
import type { FrameSnapshot } from "./fsa.ts";

// Mirrors @fso/sim Button (kept local so tools don't depend on the sim).
const BUTTON = { Up: 1, Down: 2, Left: 4, Right: 8, Sword: 16, Item: 32, Action: 64 } as const;
const STICK = 36; // PADStatus units: the game starts walking at a normalized tilt between 0.59 and 0.69 (×54)
const PAD_B = 0x200;

export function padButtons(pad: FrameSnapshot["pad"]): number {
  let b = 0;
  if (pad.x >= STICK) b |= BUTTON.Right;
  if (pad.x <= -STICK) b |= BUTTON.Left;
  if (pad.y >= STICK) b |= BUTTON.Up;
  if (pad.y <= -STICK) b |= BUTTON.Down;
  if (pad.buttons & PAD_B) b |= BUTTON.Sword;
  return b;
}

/** A GBA's keys (fsa.ts gbaKeys: A 1, B 2, Right 0x10, Left 0x20, Up 0x40, Down 0x80, R 0x100) as sim buttons: the
 *  D-pad walks, B is the sword, A the item, R the action (docs/measurements/battle-arenas.md "Battle mode in Dolphin"). */
export function gbaButtons(keys: number): number {
  let b = 0;
  if (keys & 0x10) b |= BUTTON.Right;
  if (keys & 0x20) b |= BUTTON.Left;
  if (keys & 0x40) b |= BUTTON.Up;
  if (keys & 0x80) b |= BUTTON.Down;
  if (keys & 0x2) b |= BUTTON.Sword;
  if (keys & 0x1) b |= BUTTON.Item;
  if (keys & 0x100) b |= BUTTON.Action;
  return b;
}

/** The battle savestates' arena (ref/save-battle-<arena>-<n>p.sav) → boss500 room. */
const ARENA_ROOM: Record<string, number> = { field: 0, flames: 1, winds: 2, castle: 3, clouds: 4 };
/** Battle arenas sit at world cell (1, 1): room px = world px - this. */
const ROOM_ORIGIN = { x: 512, y: 384 };
/** The sim's side rooms: sublayer k (screen 7 + k) at y + k x this (packages/sim siderooms.ts SIDE_ROOM_STRIDE). */
const SIDE_ROOM_STRIDE = 512;
/** Link state 1: a Link not in the round (2-3 player games). */
const STATE_ABSENT = 1;

type Trace = { script: string; savestate?: string; frames: (FrameSnapshot & { f: number })[] };

const round = (v: number) => Math.round(v * 1000) / 1000;

function adventureCase(name: string, trace: Trace, frames: Trace["frames"]) {
  const first = frames[0]!.links[0]!;
  return {
    name,
    script: trace.script,
    start: { x: first.x, y: first.y, frame: first.frame },
    // [buttons read this frame, x, y, sprite frame, state] — frame 0 is the starting state (its buttons are ignored)
    frames: frames.map((f) => [padButtons(f.pad), round(f.links[0]!.x), round(f.links[0]!.y), f.links[0]!.frame, f.links[0]!.state]),
  };
}

function fourCase(name: string, trace: Trace, frames: Trace["frames"]) {
  return {
    name,
    script: trace.script,
    savestate: trace.savestate,
    // Per frame (frame 0 the starting state, then one per input of the script), per Link: [x, y, sprite frame, state].
    frames: frames.map((f) => f.links.map((l) => [round(l.x), round(l.y), l.frame, l.state])),
  };
}

/** A Link's position in the sim's room layout: the TV's room px, or a side room's own px below it. */
function roomXY(l: FrameSnapshot["links"][number]): [number, number] {
  const screen = l.raw?.["3b4"] ? parseInt(l.raw["3b4"], 16) : 0;
  if (screen >= 8) return [l.x, l.y + (screen - 7) * SIDE_ROOM_STRIDE];
  return [l.x - ROOM_ORIGIN.x, l.y - ROOM_ORIGIN.y];
}

function battleCase(name: string, trace: Trace, frames: Trace["frames"]) {
  const arena = /save-battle-([a-z]+)-\dp/.exec(trace.savestate ?? "")?.[1];
  if (!arena || !(arena in ARENA_ROOM)) throw new Error(`${name}: not a battle round trace (${trace.savestate})`);
  const players = frames[0]!.links.filter((l) => l.state !== STATE_ABSENT).length;
  return {
    name,
    script: trace.script,
    savestate: trace.savestate,
    room: ARENA_ROOM[arena],
    players,
    // Each Link on the case's first frame: room px, facing (0 right, 1 left, 2 down, 3 up), life.
    // With the item poked into Link +0xC10 when the trace recorded it (`trace.ts --link c10:8`), its level (+0xC14) and
    // the sword's (+0xC18) when it recorded them too (`--link c10:c`).
    start: frames[0]!.links.slice(0, players).map((l) => {
      const raw = l.raw?.["c10"] ?? "";
      const word = (k: number) => parseInt(raw.slice(8 * k, 8 * k + 8), 16);
      return {
        x: roomXY(l)[0],
        y: roomXY(l)[1],
        facing: l.facing,
        life: l.life,
        ...(raw ? { item: word(0) } : {}),
        ...(raw.length >= 24 ? { level: word(1), sword: word(2) } : {}),
      };
    }),
    // Per frame, per Link: [buttons, x, y, z, sprite frame, state, life, invincible] (room px); frame 0 is the start.
    frames: frames.map((f) =>
      f.links.slice(0, players).map((l, i) => [
        gbaButtons(f.gba?.[i] ?? 0),
        round(roomXY(l)[0]),
        round(roomXY(l)[1]),
        round(l.z),
        l.frame,
        l.state,
        l.life,
        l.invincible,
      ]),
    ),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const battle = args[0] === "--battle", four = args[0] === "--four", append = battle && args[1] === "--append";
  const [out, ...specs] = battle || four ? args.slice(append ? 2 : 1) : args;
  if (!out || !specs.length) {
    console.error("usage: fixture [--battle | --four] <out.json> <name>=<trace.json>[@from:to] ...");
    process.exit(1);
  }
  const cases = specs.map((spec) => {
    const [, name, file, from, to] = /^([^=]+)=([^@]+)(?:@(\d+):(\d+))?$/.exec(spec)!;
    const trace = JSON.parse(readFileSync(file!, "utf8")) as Trace;
    const frames = trace.frames.slice(Number(from ?? 0), to === undefined ? undefined : Number(to) + 1);
    return battle ? battleCase(name!, trace, frames) : four ? fourCase(name!, trace, frames) : adventureCase(name!, trace, frames);
  });
  const source = battle
    ? "Dolphin 2606 with integrated GBAs, G4SE01 rev 0, the Shadow Battle round-start savestates (ref/save-battle-*.sav), traced with tools/dolphin/src/trace.ts"
    : four
      ? "Dolphin 2606, G4SE01 rev 0, the case's savestate, traced with tools/dolphin/src/trace.ts"
      : "Dolphin 2606, G4SE01 rev 0, ref/save-lake-hylia.sav (boss010 room 1), traced with tools/dolphin/src/trace.ts";
  const columns = battle ? ["buttons", "x", "y", "z", "spriteFrame", "state", "life", "invincible"] : four ? ["x", "y", "spriteFrame", "state"] : ["buttons", "x", "y", "spriteFrame", "state"];
  if (append) {
    const old = JSON.parse(readFileSync(out, "utf8")) as { cases: typeof cases };
    cases.unshift(...old.cases.filter((c) => !cases.some((n) => n.name === c.name)));
  }
  writeFileSync(out, JSON.stringify({ source, columns, cases }) + "\n");
  console.log(`${cases.length} cases, ${cases.reduce((n, c) => n + c.frames.length, 0)} frames -> ${out}`);
}
