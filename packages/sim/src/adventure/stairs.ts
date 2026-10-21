// The Cave of No Return's way in (boss011 room 12): a door that rises as the Links come (SIBT, "shrine picture"), and
// the spiral staircase behind it (RASN) down to room 6. Measured in Dolphin (docs/measurements/adventure-world1.md "Adventure: the
// Cave of No Return", from the stage's start):
// - the door: the leader walking up toward it, it started rising on the tick he came within 80 px of its line (y 48:
//   at y < 128), 0.2 px/tick; it blocked (him pushing at y 87) until it had risen 24 px (120 ticks), and stops at 40;
// - the staircase: the tick after the leader's y went under 56 (its box: ±40 px round its anchor, 10 above to 8
//   below), the four Links stood in a row on its line 16 px apart (x − 24 … + 24), facing up, the walk cycle going
//   on in place, for 67 ticks; then they're in room 6 at its bottom door (x 328 … 376, y 272), still 29 ticks, then
//   walking up at 0.5 px/tick for 40 ticks (as out of a door), and control returns the tick after.
// From main.dol: SIBT (init 0x80104934, update 0x801045D8): picture (p & 0xF), kind (p >> 8) & 0xF, 2 the door: its
// box ±32 px round (x, its line) blocks until it's 24 px up; RASN (init 0x8028F890, update 0x8028E1EC): kind p & 0xF
// picks its box (4: ±40 × −10…8, walked up into; 5: ±40 × −8…10, walked down into) and the row's facing (4 up, 5
// down); where it leads is in its params, in 16 px steps from each Link's place in the row: x by (p >> 16) & 0x7F
// (negative with bit 23), y by (p >> 8) & 0x7F (negative with bit 15), and 16 px more the way it goes (kind 4 down,
// kind 5 up); the room is the layout's at that spot (state 2, kinds 4 0x8028EC90 and 5 0x8028EEB0). The Cave's
// (0x9A0D84: −416, +208 + 16) lands on room 6's (352, 272), as measured; Hyrule Castle's room 11 (0x80A09005: −512,
// −256 − 16) on room 12's (256, 48). Kind 5's walk out goes down (state 3 adds 0.5 px/tick: assumed the same timeline
// as kind 4's, which was measured). Assumed: it's there once its switch p >> 27 is on (0: always).
import { SUBPX } from "../player.ts";
import { CELL, ROOM_H, ROOM_W, type World } from "../world.ts";
import { actorKey, currentArea, enterArea, type AdventureGame } from "./adventure.ts";
import { heavyLifted } from "./rocks.ts";
import type { AdventureStage, AreaActor } from "./stage.ts";

/** The door's line is this far above its anchor; it starts rising when the leader is this close below it (px). */
export const GATE_LINE = -16;
export const GATE_REACH = 80;
/** Its rise (1/5 px/tick: in fifths), how far until it's walkable and where it stops (px). */
export const GATE_RISE_FIFTHS = 1;
export const GATE_OPEN_AT = 24;
export const GATE_TOP = 40;
export const GATE_HALF = 32;

/** The staircase: its box round the anchor (kind 4; kind 5's is flipped), the row's spacing, and its timeline (ticks). */
export const STAIRS_BOX = { x0: -40, y0: -10, x1: 40, y1: 8 } as const;
const STAIRS_BOX_DOWN = { x0: -40, y0: -8, x1: 40, y1: 10 } as const;
export const STAIRS_ROW = 16;
export const STAIRS_IN_TICKS = 67;
export const STAIRS_STILL_TICKS = 29;
export const STAIRS_OUT_TICKS = 40;
export const STAIRS_TICKS = STAIRS_IN_TICKS + STAIRS_STILL_TICKS + STAIRS_OUT_TICKS;
const STAIRS_SPEED = SUBPX / 2;

/** A trip down a staircase (AdventureState.stairs); `dir` 1 when it goes down the screen (kind 5), −1 up (kind 4). */
export interface StairsTrip {
  tick: number;
  room: number;
  x: number;
  y: number;
  dir: number;
}

const signed7 = (v: number, negative: boolean) => (negative ? -(v & 0x7f) : v & 0x7f);

/** Where a staircase (kind 4 or 5) leads: the room and its row's middle there (room px), or null off the layout. */
export function stairsLeadTo(stage: AdventureStage, room: number, s: AreaActor): { room: number; x: number; y: number; dir: number } | null {
  const dir = (s.params & 15) === 5 ? 1 : -1, cell = stage.cellOf(room);
  if (!cell) return null;
  const wx = cell.cx * ROOM_W + s.x + 16 * signed7(s.params >>> 16, (s.params & 0x800000) !== 0);
  const wy = cell.cy * ROOM_H + s.y + 16 * signed7(s.params >>> 8, (s.params & 0x8000) !== 0) - 16 * dir;
  const cx = Math.floor(wx / ROOM_W), cy = Math.floor(wy / ROOM_H), to = stage.roomAtCell(cx, cy);
  return to < 0 ? null : { room: to, x: wx - cx * ROOM_W, y: wy - cy * ROOM_H, dir };
}

const gateLine = (a: AreaActor) => a.y + GATE_LINE;
const isGate = (a: AreaActor) => a.id === "SIBT" && ((a.params >>> 8) & 15) === 2;

/** How far a door has risen (px; 0 shut). */
export function gateRise(game: AdventureGame, gate: AreaActor): number {
  const a = game.adventure, key = actorKey(a.room, gate.index);
  for (let i = 0; i < a.gates.length; i += 2) if (a.gates[i] === key) return Math.min(GATE_TOP, ((game.tick - a.gates[i + 1]!) * GATE_RISE_FIFTHS) / 5);
  return 0;
}

/** The current area's doors start rising as the leader comes. */
export function stepGates(game: AdventureGame, stage: AdventureStage): void {
  const a = game.adventure, p = game.players[0]!;
  for (const g of currentArea(game, stage).actors) {
    if (!isGate(g)) continue;
    const key = actorKey(a.room, g.index);
    if (a.gates.some((k, i) => i % 2 === 0 && k === key)) continue;
    if (p.y / SUBPX - gateLine(g) < GATE_REACH) a.gates.push(key, game.tick);
  }
}

/** The world with the doors that haven't risen enough yet. */
export function gateWorld(world: World, game: AdventureGame, stage: AdventureStage): World {
  const shut = currentArea(game, stage).actors.filter((g) => isGate(g) && gateRise(game, g) < GATE_OPEN_AT);
  if (!shut.length) return world;
  const solid = world.solid.slice();
  for (const g of shut) {
    const line = gateLine(g);
    for (let cy = Math.max(0, (line - GATE_HALF) >> 3); cy < Math.min(world.heightCells, (line + GATE_HALF) >> 3); cy++)
      for (let cx = Math.max(0, (g.x - GATE_HALF) >> 3); cx < Math.min(world.widthCells, (g.x + GATE_HALF) >> 3); cx++) solid[cy * world.widthCells + cx] = 1;
  }
  void CELL;
  return { ...world, solid };
}

/** The leader walking into a staircase's box: the trip down starts (true). */
export function startStairs(game: AdventureGame, stage: AdventureStage): boolean {
  const a = game.adventure, p = game.players[0]!, f = game.battle.fighters[0]!;
  if (a.area !== 0 || f.mode !== "active" || !p.moving || heavyLifted(game)) return false;
  const x = p.x / SUBPX, y = p.y / SUBPX;
  for (const s of currentArea(game, stage).actors) {
    const kind = s.params & 15;
    if (s.id !== "RASN" || (kind !== 4 && kind !== 5)) continue;
    // Its switch (p >> 27: room 11's 16, Phantom Ganon gone; the Cave's 0, always there; assumed as PNPC's field).
    const sw = s.params >>> 27;
    if (sw && !((game.battle.switches >>> sw) & 1)) continue;
    const box = kind === 5 ? STAIRS_BOX_DOWN : STAIRS_BOX;
    if (x < s.x + box.x0 || x > s.x + box.x1 || y < s.y + box.y0 || y > s.y + box.y1) continue;
    const to = stairsLeadTo(stage, a.room, s);
    if (!to) continue;
    a.stairs = { tick: 0, ...to };
    const facing = kind === 5 ? "down" : "up";
    game.players.forEach((q, i) => Object.assign(q, { x: (s.x + rowX(i, game.players.length)) * SUBPX, y: s.y * SUBPX, facing, moving: true, action: "none" }));
    return true;
  }
  return false;
}

const rowX = (i: number, n: number) => (i - (n - 1) / 2) * STAIRS_ROW;

/** A tick of the trip down a staircase: the row walking in place, the next room, the walk out. */
export function stepStairs(game: AdventureGame, stage: AdventureStage, inputs: readonly number[]): void {
  const a = game.adventure, s = a.stairs!, t = ++s.tick;
  game.players.forEach((p, i) => {
    p.held = inputs[i] ?? 0;
    p.facing = s.dir > 0 ? "down" : "up";
    p.moving = t <= STAIRS_IN_TICKS || t > STAIRS_IN_TICKS + STAIRS_STILL_TICKS;
    if (p.moving) p.walkTicks++;
  });
  if (t === STAIRS_IN_TICKS) {
    game.players.forEach((p, i) => Object.assign(p, { x: (s.x + rowX(i, game.players.length)) * SUBPX, y: s.y * SUBPX }));
    enterArea(game, stage, s.room, 0, 0, 0);
    a.entryX = s.x;
    a.entryY = s.y + (s.dir * STAIRS_OUT_TICKS * STAIRS_SPEED) / SUBPX;
    a.entryFacing = s.dir > 0 ? "down" : "up";
  } else if (t > STAIRS_IN_TICKS + STAIRS_STILL_TICKS) for (const p of game.players) p.y += s.dir * STAIRS_SPEED;
  if (t >= STAIRS_TICKS) {
    a.stairs = null;
    for (const p of game.players) p.moving = false;
  }
}
