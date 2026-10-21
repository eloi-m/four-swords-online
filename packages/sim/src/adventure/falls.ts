// Waterfalls, played by a scene event at the fall's top and another at its foot (SEV2; traced in Lake Hylia, room 7's
// falls into room 6, docs/measurements/adventure-lake-hylia.md "Adventure: waterfalls"):
// - the top (params' low byte 0; room 7 at (224, 96), the falls' lip): a Link swimming in the water above it (its
//   column, y above its anchor + 16) for FALLS_DELAY ticks goes over, the four at once: each at his own x at the room's
//   bottom (y 368), in the jump pose (state 56, sprite 24), until the stick is pushed down: then the usual room change;
// - the foot (low byte 1; room 6 at (224, 96)): coming in from the top in its column, at the end of the walk-in (y
//   40.25) they drop 80 px into the pool (state 56, sprite 16) and swim 14 ticks later.
// The column is the falls' water, 192 px from the event's x in both rooms. TODO(measure): where it's kept (params?).
import { Button, SUBPX } from "../player.ts";
import { CELL, isSolidAt, ROOM_H, surfaceAt } from "../world.ts";
import type { AdventureGame } from "./adventure.ts";
import { beginDrop, stepJump } from "./ledge.ts";
import type { AdventureStage, Area } from "./stage.ts";

export const FALLS_WIDTH = 192;
export const FALLS_DELAY = 11;
export const FALLS_FOOT = ROOM_H - 16;
export const FALLS_DROP = 80;
export const FALLS_DROP_TICKS = 14;
/** The sprites: going over (the up jump frame), dropping (the down one). */
export const FALLS_FRAME = 24;
export const DROP_FRAME = 16;

const fallsEvent = (area: Area, kind: number) => area.actors.find((a) => a.id === "SEV2" && (a.params & 0xff) === kind);
const inColumn = (ev: { x: number; y: number }, x: number, y: number) => x >= ev.x && x < ev.x + FALLS_WIDTH && y < ev.y + 16;

/**
 * The falls' top, after the Links moved: the leader swimming above the lip long enough goes over with the others.
 * Returns whether they're waiting at its foot (the leader's tick is then the falls' own: Down leaves the room).
 */
export function stepFallsTop(game: AdventureGame, area: Area): void {
  const a = game.adventure, l = game.players[0]!, m = a.links[0]!;
  const ev = fallsEvent(area, 0);
  if (!ev) return; // (Tingle's Tower's falls have none: stepTileFalls)
  if (m.mode !== "swim" || m.side || !inColumn(ev, l.x / SUBPX, l.y / SUBPX)) {
    a.falls = 0;
    return;
  }
  if (++a.falls < FALLS_DELAY) return;
  a.falls = 0;
  game.players.forEach((p, i) => {
    p.y = FALLS_FOOT * SUBPX;
    Object.assign(p, { moving: false, walkTicks: 0, facing: "up" });
    Object.assign(a.links[i]!, { mode: "fall", tick: 0, vx: 0, vy: 0, speed: 0 });
  });
  a.hops = [];
}

/** At the falls' foot (waiting): the Links stand; true once the leader pushes down (the room change may start). */
export function fallsWaiting(game: AdventureGame, buttons: number): boolean {
  const m = game.adventure.links[0]!;
  if (m.mode !== "fall" || m.tick > 0) return false;
  for (const p of game.players) p.held = buttons;
  return (buttons & Button.Down) === 0;
}

/** After a walk into the room from the top: in a falls' foot column, they drop into the water below. */
export function startFallsDrop(game: AdventureGame, area: Area): void {
  const ev = fallsEvent(area, 1), l = game.players[0]!;
  if (!ev || !inColumn(ev, l.x / SUBPX, l.y / SUBPX)) return;
  game.players.forEach((p, i) => {
    p.y += FALLS_DROP * SUBPX;
    Object.assign(p, { moving: false, walkTicks: 0, facing: "down" });
    Object.assign(game.adventure.links[i]!, { mode: "fall", tick: FALLS_DROP_TICKS, vx: 0, vy: 0, speed: 0 });
  });
}

/** A tick of the drop; true while it lasts (then they swim). */
export function stepFallsDrop(game: AdventureGame): boolean {
  const a = game.adventure, m = a.links[0]!;
  if (m.mode !== "fall" || m.tick <= 0) return false;
  if (--m.tick === 0) for (const k of a.links) Object.assign(k, { mode: "swim", tick: 0, speed: 0, dir: -1, side: false });
  else for (const k of a.links.slice(1)) k.tick = m.tick;
  return true;
}

// Tingle's Tower's waterfalls inside a room (no SEV2 there): a row of falls-lip tiles (type 0x3E) over the falls' face
// (solid) and a pool under it, the water above flowing fast toward the lip (swim.ts CURRENT_TILES 0x96). Traced in
// Dolphin (room 3, from `w1-boss012-room3`, the four carried down by the current): the tick the leader's bottom sensor
// reached the lip (y 186.23 over the lip row at 192) the three others dropped, and the leader on the next tick, each
// as off a ladder's foot (ledge.ts's drop: his x kept, at his landing at once with z the drop + 2 px, so he stays put
// on the screen, then 2 px/tick up less 0.17 px/tick², state 56, swimming once down). The landing is the first y from
// his own y + 64 px, 8 px at a time, with his four side sensors in the pool's deep water (the leader y + 64 = 250.23;
// the others, 28, 52 and 73 px behind him, 254.23, 254.16 and 249.01). No wait on the lip, no damage.
export const FALLS_LIP_TYPE = 0x3e;
export const TILE_FALLS_DROP = 64;
export const TILE_FALLS_STEP = 8;
const SENSORS: readonly (readonly [number, number])[] = [[0, -7], [0, 7], [-7, 0], [7, 0]];

/** Where a Link at (x, y) (1/256 px) over a lip lands: the first fitting y in the pool below (1/256 px), or -1. */
function landingBelow(world: Area["world"], x: number, y: number): number {
  const px = Math.floor(x / SUBPX);
  for (let ly = y + TILE_FALLS_DROP * SUBPX; ly < world.heightCells * CELL * SUBPX; ly += TILE_FALLS_STEP * SUBPX) {
    const py = Math.floor(ly / SUBPX);
    if (SENSORS.every(([sx, sy]) => !isSolidAt(world, px + sx, py + sy) && surfaceAt(world, px + sx, py + sy) === "deep")) return ly;
  }
  return -1;
}

/** After the Links moved: the leader's bottom sensor on a lip tile sends the four over (no SEV2 in the area). */
export function stepTileFalls(game: AdventureGame, stage: AdventureStage, area: Area): void {
  const a = game.adventure, l = game.players[0]!, m = a.links[0]!;
  if (fallsEvent(area, 0) || m.mode !== "swim" || m.side) return;
  if (stage.tileTypeAt(area, l.x / SUBPX, l.y / SUBPX + 7) !== FALLS_LIP_TYPE) return;
  const landings = game.players.map((p) => landingBelow(area.world, p.x, p.y));
  if (landings[0]! < 0) return;
  game.players.forEach((p, i) => {
    beginDrop(game, i, p.x, landings[i]! >= 0 ? landings[i]! : landings[0]!);
    Object.assign(p, { moving: false, walkTicks: 0 });
    // The others drop this very tick (they moved before him): their drop's first tick now.
    if (i > 0) stepJump(game, i, area.world);
  });
  // The trails start again where they land (else the followers swam back up the trail through the face: tools/playtest).
  a.trails = game.players.slice(0, -1).map((p, i) => [p.x, a.links[i]!.oy]);
  a.falls = 0;
  a.hops = [];
}
