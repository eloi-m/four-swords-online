// Jumping off ledges: tile types 0x10-0x13 are cliff edges a Link jumps off northward, southward, westward and
// eastward. Measured in Dolphin (docs/measurements/adventure-lake-hylia.md "Adventure: swimming and ledges"; Lake Hylia room 5's ledge into
// the river, northward, and room 2's westward one; state 56):
// - the half of the tile a Link comes from is solid (walking north into 0x10 he stops with his top sensor at its
//   bottom half; walking west into 0x12, at its right half), and the rest of the cliff beyond is solid too;
// - walking into it, he jumps on the 20th tick in a row that he couldn't make his whole step: that tick he moves 1 px
//   on (through the wall), and his jump aims at the middle of the tile he lands on: the first tile beyond the ledge
//   along the jump that isn't solid, in the row (or column) of his position + 8 px; it takes 27 ticks at (aim -
//   position) / 26 a tick, so he lands one step past the aim, rising 3.25 px/tick at first and falling 0.25 px/tick²
//   (22.75 px up at the top, down on the 27th tick), drawn in the facing's first walk frame;
// - then he stands one tick, pushed out of a wall he landed in (half a px at a time), and walks, or swims if he landed
//   in deep water;
// - the other Links jump where he did, when they get there (traced: the second Link on the trail jumped too).
// A ladder's foot over the water (tile types 0x3C, 0x3D: Tingle's Tower room 0, traced from `w1-boss012-start`) is a
// southward ledge whose jump is a drop: walking down it he stopped with his bottom sensor at its top (y 184.73 under
// the tile at 192), moved 1 px on the 20th blocked tick as above, and the next tick he was at the landing (the middle
// of the first open tile below, y 216) with z the drop + 2 px, so he stays put on the screen; z then grows 2 px/tick
// less 0.17 px/tick² (up to 43 px) and he's down 34 ticks later (state 56, player_sob 16 throughout), stands a tick
// and swims. TODO(measure): whether the southward ledges (0x11) drop the same way (only north and west were traced).
import { Button, SUBPX, type Facing, type PlayerState } from "../player.ts";
import { isSolidAt, type World } from "../world.ts";
import type { AdventureGame } from "./adventure.ts";
import { FULL_STEP, type LinkMotion } from "./motion.ts";
import { TRACED_WATER_STAGES, type AdventureStage, type Area } from "./stage.ts";

/** Ledge tile types and the way they're jumped off. */
export const LEDGES: Readonly<Record<number, readonly [number, number]>> = { 0x10: [0, -1], 0x11: [0, 1], 0x12: [-1, 0], 0x13: [1, 0], 0x3c: [0, 1], 0x3d: [0, 1] };
/** Ledges jumped off as a drop (a ladder's foot over the water, above). */
export const DROP_LEDGES: ReadonlySet<number> = new Set([0x3c, 0x3d]);
/** The drop: z starts at the drop + DROP_HOP, rising DROP_HOP less DROP_GRAVITY a tick (1/256 px; 0.17 px is 43.5). */
export const DROP_HOP = 512;
export const DROP_GRAVITY = 44;
/** Ticks walking into a ledge without a whole step before the jump (it starts on the next). */
export const LEDGE_BLOCKED_TICKS = 19;
export const JUMP_TICKS = 27;
export const JUMP_INIT_STEP = SUBPX; // 1 px on the jump's first tick
export const JUMP_HOP = 832; // 3.25 px/tick up at first
export const JUMP_GRAVITY = 64; // 0.25 px/tick²
/** How far beyond the ledge a landing tile is looked for. TODO(measure): only one tile between was traced. */
export const JUMP_MAX_TILES = 4;

const STEP: Readonly<Record<Facing, readonly [number, number]>> = { right: [1, 0], left: [-1, 0], down: [0, 1], up: [0, -1] };
const HELD: Readonly<Record<Facing, number>> = { up: Button.Up, down: Button.Down, left: Button.Left, right: Button.Right };

/** The solid quadrants of a ledge tile in the adventure: the half a Link comes from (TL 1, TR 2, BL 4, BR 8). */
export const LEDGE_MASKS: Readonly<Record<number, number>> = { 0x10: 4 | 8, 0x11: 1 | 2, 0x12: 2 | 8, 0x13: 1 | 4, 0x3c: 1 | 2, 0x3d: 1 | 2 };

/** The ledge tile the Link walks into (his leading side's middle sensor, one px on), if he'd jump it walking this way. */
export function ledgeAhead(stage: AdventureStage, area: Area, p: PlayerState): { tx: number; ty: number; dx: number; dy: number; drop: boolean } | null {
  const [dx, dy] = STEP[p.facing];
  const x = Math.floor(p.x / SUBPX) + dx * 8, y = Math.floor(p.y / SUBPX) + dy * 8;
  const type = stage.tileTypeAt(area, x, y), way = LEDGES[type];
  if (DROP_LEDGES.has(type) && !TRACED_WATER_STAGES.has(stage.index)) return null;
  if (!way || way[0] !== dx || way[1] !== dy) return null;
  return { tx: x >> 4, ty: y >> 4, dx, dy, drop: DROP_LEDGES.has(type) };
}

/** Where a jump off the ledge (tx, ty) lands (area px, the tile's middle), or null when nothing beyond can be landed on. */
export function jumpAim(world: World, p: PlayerState, ledge: { tx: number; ty: number; dx: number; dy: number }): { x: number; y: number } | null {
  const across = ledge.dx ? Math.floor((Math.floor(p.y / SUBPX) + 8) / 16) : Math.floor((Math.floor(p.x / SUBPX) + 8) / 16);
  for (let k = 1; k <= JUMP_MAX_TILES; k++) {
    const tx = ledge.dx ? ledge.tx + ledge.dx * k : across, ty = ledge.dy ? ledge.ty + ledge.dy * k : across;
    const x = tx * 16, y = ty * 16;
    if ([0, 8].every((ox) => [0, 8].every((oy) => !isSolidAt(world, x + ox, y + oy)))) return { x: x + 8, y: y + 8 };
  }
  return null;
}

/** After a walking tick: counts the ticks the Link walked into a ledge without making his whole step. */
export function noteLedge(game: AdventureGame, stage: AdventureStage, area: Area, i: number, x0: number, y0: number, buttons: number): void {
  const m = game.adventure.links[i]!, p = game.players[i]!, f = game.battle.fighters[i]!;
  const [dx, dy] = STEP[p.facing];
  const progress = (p.x - x0) * dx + (p.y - y0) * dy;
  const walking = p.moving && p.action === "none" && f.mode === "active" && f.move === "none" && (buttons & HELD[p.facing]) !== 0;
  m.ledge = walking && progress < FULL_STEP && ledgeAhead(stage, area, p) ? m.ledge + 1 : 0;
}

/** Starts the jump (this tick being its first) when the Link has walked into a ledge long enough. */
export function startJump(game: AdventureGame, stage: AdventureStage, area: Area, world: World, i: number, buttons: number): boolean {
  const m = game.adventure.links[i]!, p = game.players[i]!;
  if (m.ledge < LEDGE_BLOCKED_TICKS || !(buttons & HELD[p.facing])) return false;
  const ledge = ledgeAhead(stage, area, p);
  m.ledge = 0;
  if (!ledge) return false;
  const aim = jumpAim(world, p, ledge);
  if (!aim) return false;
  p.x += ledge.dx * JUMP_INIT_STEP;
  p.y += ledge.dy * JUMP_INIT_STEP;
  const x0 = p.x, y0 = p.y;
  // A drop keeps his x (traced), landing on the row's middle.
  if (ledge.drop) beginDrop(game, i, ledge.dy ? p.x : aim.x * SUBPX, ledge.dx ? p.y : aim.y * SUBPX);
  else beginJump(game, i, aim.x * SUBPX - p.x, aim.y * SUBPX - p.y, JUMP_TICKS - 1);
  p.held = buttons;
  // The others jump from where he did, to where he lands.
  if (i === 0 && game.players.length > 1) {
    const [tx, ty] = ledge.drop ? [m.ox, m.oy] : [x0 + Math.round((m.vx * JUMP_TICKS) / m.span), y0 + Math.round((m.vy * JUMP_TICKS) / m.span)];
    game.adventure.hops.push({ x: x0, y: y0, tx, ty, left: ((1 << game.players.length) - 1) & ~1, ...(ledge.drop ? { drop: true } : {}) });
  }
  return true;
}

// Out of the water up a ladder's foot (traced in Tingle's Tower room 0, the river under its ladder, from
// `w1-boss012-room0`): swimming up into the foot's solid top half he stops (his top sensor at its middle), and on the
// 20th tick in a row that he couldn't swim up a whole px he jumps out as off a ledge (state 56, 27 ticks, the same
// hop), aiming at the ladder's middle (the line between its 0x3C and 0x3D halves) in the tile above the foot: from
// (313, 207.5) to (320.3, 183.1). He stands a few ticks and walks up the ladder.

/** After a swimming tick: counts the ticks the swimming leader pushed up into a ladder's foot without a whole px up. */
export function noteLadder(game: AdventureGame, stage: AdventureStage, area: Area, y0: number, buttons: number): void {
  const m = game.adventure.links[0]!, p = game.players[0]!;
  const type = stage.tileTypeAt(area, Math.floor(p.x / SUBPX), Math.floor(p.y / SUBPX) - 8);
  const pushing = m.mode === "swim" && buttons & Button.Up && y0 - p.y < SUBPX && DROP_LEDGES.has(type) && TRACED_WATER_STAGES.has(stage.index);
  m.ledge = pushing ? m.ledge + 1 : 0;
}

/** The swimming leader pushed up into a ladder's foot long enough: he jumps out onto it (this tick its first). */
export function startLadderClimb(game: AdventureGame, stage: AdventureStage, area: Area, buttons: number): boolean {
  const m = game.adventure.links[0]!, p = game.players[0]!;
  if (m.ledge < LEDGE_BLOCKED_TICKS || !(buttons & Button.Up)) return false;
  m.ledge = 0;
  const x = Math.floor(p.x / SUBPX), y = Math.floor(p.y / SUBPX) - 8, type = stage.tileTypeAt(area, x, y);
  if (!DROP_LEDGES.has(type)) return false;
  const tx = x >> 4, ty = y >> 4;
  const aim = { x: (type === 0x3c ? tx + 1 : tx) * 16, y: (ty - 1) * 16 + 8 };
  p.y -= JUMP_INIT_STEP;
  const x0 = p.x, y0 = p.y;
  beginJump(game, 0, aim.x * SUBPX - p.x, aim.y * SUBPX - p.y, JUMP_TICKS - 1);
  Object.assign(m, { cx: 0, cy: 0, speed: 0 });
  p.facing = "up";
  p.held = buttons;
  if (game.players.length > 1) {
    const to = [x0 + Math.round((m.vx * JUMP_TICKS) / m.span), y0 + Math.round((m.vy * JUMP_TICKS) / m.span)] as const;
    game.adventure.hops.push({ x: x0, y: y0, tx: to[0], ty: to[1], left: ((1 << game.players.length) - 1) & ~1 });
  }
  return true;
}

/** Starts a jump of (dx, dy) (1/256 px) every `span` ticks from where the Link is. */
function beginJump(game: AdventureGame, i: number, dx: number, dy: number, span: number): void {
  const m = game.adventure.links[i]!, p = game.players[i]!, f = game.battle.fighters[i]!;
  m.mode = "jump";
  m.tick = 0;
  m.vx = dx;
  m.vy = dy;
  m.span = span;
  m.ox = p.x;
  m.oy = p.y;
  m.ledge = 0;
  f.z = 0;
  f.vz = JUMP_HOP;
  p.action = "none";
  p.actionTick = 0;
  // Off the ledge the leader isn't leaning on anything any more (he may have been, held against it).
  if (i === 0) Object.assign(game.adventure.push, { on: false, ticks: 0, release: 0, idle: 0 });
  // Its first tick still shows the walk going on (traced).
  if (p.moving) p.walkTicks++;
}

/** Starts a drop (a jump with span 0: from the next tick he's at (tx, ty), 1/256 px, falling from above it). */
export function beginDrop(game: AdventureGame, i: number, tx: number, ty: number): void {
  beginJump(game, i, 0, 0, 0);
  const m = game.adventure.links[i]!;
  m.ox = tx;
  m.oy = ty;
}

/** A follower at the place the leader jumped from jumps too, to where he landed. */
export function followHop(game: AdventureGame, i: number): boolean {
  const p = game.players[i]!, hops = game.adventure.hops;
  const h = hops.find((h) => h.left & (1 << i) && Math.abs(p.x - h.x) <= 3 * SUBPX && Math.abs(p.y - h.y) <= 3 * SUBPX);
  if (!h) return false;
  h.left &= ~(1 << i);
  if (!h.left) hops.splice(hops.indexOf(h), 1);
  if (h.drop) beginDrop(game, i, h.tx, h.ty);
  else beginJump(game, i, h.tx - p.x, h.ty - p.y, JUMP_TICKS);
  // Trail points the jump passes over are dropped (the follower lands on the leader's landing spot).
  const t = game.adventure.trails[i - 1];
  if (t) {
    let k = 0;
    while (t.length - k > 2 && Math.abs(t[k]! - h.tx) + Math.abs(t[k + 1]! - h.ty) > 2 * SUBPX) k += 2;
    t.splice(0, k);
  }
  return true;
}

/** One tick of a jump or of the landing after it; returns true while it lasts. */
export function stepJump(game: AdventureGame, i: number, world: World): boolean {
  const m = game.adventure.links[i]!, p = game.players[i]!, f = game.battle.fighters[i]!;
  if (m.mode === "land") {
    // Standing (the battle code's turn tick does that), out of any wall he landed in.
    m.mode = "walk";
    pushOut(p, world);
    // A follower who jumped before the Link ahead landed still has that Link's points in the air on his trail
    // (followHop found no landing to drop them to): they go now, up to the point nearest where he landed.
    const t = i > 0 ? game.adventure.trails[i - 1] : undefined, far = (k: number) => Math.abs(t![k]! - p.x) + Math.abs(t![k + 1]! - p.y);
    if (t) t.splice(0, t.reduce((best, _, k) => (k % 2 === 0 && far(k) < far(best) ? k : best), 0));
    return false;
  }
  if (m.mode !== "jump") return false;
  m.tick++;
  if (m.span === 0) {
    // A drop: at the landing, z from the drop's height (beginDrop).
    if (m.tick === 1) {
      f.z = m.oy - p.y + DROP_HOP;
      f.vz = DROP_HOP - DROP_GRAVITY;
      p.x = m.ox;
      p.y = m.oy;
    } else {
      f.z += f.vz;
      f.vz -= DROP_GRAVITY;
    }
    if (f.z <= 0) land(m, p, f);
    return true;
  }
  p.x = m.ox + Math.round((m.vx * m.tick) / m.span);
  p.y = m.oy + Math.round((m.vy * m.tick) / m.span);
  f.z += f.vz;
  f.vz -= JUMP_GRAVITY;
  if (m.tick >= JUMP_TICKS) land(m, p, f);
  return true;
}

function land(m: LinkMotion, p: PlayerState, f: { z: number; vz: number }): void {
  f.z = 0;
  f.vz = 0;
  m.mode = "land";
  m.tick = 0;
  p.moving = false;
  p.walkTicks = 0;
}

/** Out of any wall a side sensor landed in, half a px at a time (traced: 1 px out of the wall beside room 2's ledge). */
function pushOut(p: PlayerState, world: World): void {
  const sides: readonly [number, number, number, number][] = [[-7, 0, 1, 0], [7, 0, -1, 0], [0, -7, 0, 1], [0, 7, 0, -1]];
  for (const [sx, sy, ax, ay] of sides) {
    for (let n = 0; n < 16 && isSolidAt(world, Math.floor(p.x / SUBPX) + sx, Math.floor(p.y / SUBPX) + sy); n++) {
      p.x += (ax * SUBPX) / 2;
      p.y += (ay * SUBPX) / 2;
    }
  }
}

/** Whether a tile type is a ledge. */
export const isLedge = (type: number) => type in LEDGES;
