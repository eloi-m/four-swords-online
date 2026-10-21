// GBA-screen areas seen from the side (those whose layers use the side views' background tile type 0x02 or their
// water 0x3B: the stage loader marks them so, props.ts SIDE_VIEW_TYPES): the Links walk left and right, fall where
// there's nothing under them, climb ladders and swim in the water. Measured in Dolphin (docs/measurements/adventure-lake-hylia.md
// "Adventure: swimming, ledges, formations"; Lake Hylia room 6's area 5, under the whirlpool):
// - falling 4 px/tick (the battle side rooms', siderooms.ts SIDE_FALL_SPEED);
// - a ladder (tile type 0x61) is climbed like walking: 1.5 px/tick with the up-walk frames (state 2);
// - in the water (state 75) a Link sinks 0.3 px/tick and the stick moves him 1 px/tick on top of it (0.707 per axis on
//   diagonals): down 1.3, up 0.7; he can't rise out of it (his head stays 12.5 px under the surface) except onto a
//   ladder beside him; frames left 532-535, down and still 540-543, up 548-551 (right assumed 528-531);
// - the sword swings left and right as on the TV (the up and down of the stick don't turn him);
// - walking off a ledge (traced in room 7's area 5): the tick his next step leaves the ground (his anchor over the
//   edge) he moves 3.3 px on and 2.2 down, then 2.4 / 3.1, 2.0 / 4.0, then walking speed on (with the stick) and 4 down;
// - off a ladder sideways (room 7's area 5, halfway down its ladder): he walks off at walking speed and hangs on while
//   his body (±7 px) is still over the ladder's column, then falls 4 px/tick, no arc.
// The followers (traced in room 7's area 5 and room 6's area 5, docs/measurements/adventure-lake-hylia.md "Adventure:
// the followers in a side view"): they have no gravity of their own.
// - On the ground and on ladders they walk the trail as on the TV (formation.ts: 18 px behind, standing when the Link
//   ahead stands); in the water they swim it at up to 1.3 px/tick (the leader's stroke and sinking).
// - Off the ground (the trail walked off a ledge, shot from a cannon) a follower is where the Link ahead was 13 ticks
//   before (the second Link; the third and fourth 12 ticks behind the Link ahead: SIDE_DELAYS), moving at most 6.5
//   px/tick toward it (SIDE_CHASE_SPEED), and keeps on so, landed or not, the spacing forgotten, until he's on that Link:
//   down a ledge the three fall the leader's fall 13, 25 and 37 ticks after him and end stacked on him.
// - The leader in a cannon: they get in with him. From the ground each is put on him (the third Link first, then the
//   second, then the fourth, a tick apart: CANNON_BOARD), dashing at 6.5 px/tick toward him meanwhile; from the air
//   (back in it after a shot) they dash onto him at 6.5 px/tick. In it they stay on him (bobbing with him in the game);
//   shot, they stay in its mouth until the delay brings his flight to them, then fly his path behind him (6 px the first
//   tick in the game, not modelled) and land where he landed.
import { stepLink } from "../actions.ts";
import { velocityAlong } from "../entities.ts";
import { Button, moveAxis, SUBPX, WALK_SPEED, type PlayerState } from "../player.ts";
import { isSolidAt, surfaceAt, type World } from "../world.ts";
import type { AdventureGame } from "./adventure.ts";
import { recordTrail } from "./formation.ts";
import { DIAGONAL, type LinkMotion } from "./motion.ts";

export const SIDE_FALL_SPEED = 4 * SUBPX;
export const SIDE_CLIMB_SPEED = WALK_SPEED;
export const SIDE_SINK = 77; // 0.3 px/tick
export const SIDE_SWIM_SPEED = SUBPX;
/** How far under the surface a swimmer's head stays (px). */
export const SIDE_SWIM_HEAD = 12.5;
/** A follower's swim along the trail, per axis (traced: 1.3 px/tick diving behind the leader). */
export const SIDE_SWIM_FOLLOW_SPEED = SIDE_SWIM_SPEED + SIDE_SINK;
/** Per Link but the last, the ticks the follower behind it off the ground plays it late (traced: 13, 12, 12). */
export const SIDE_DELAYS: readonly number[] = [13, 12, 12];
/** A follower's most per tick off the ground (traced: 6.5 px/tick, the gathering dash's speed). */
export const SIDE_CHASE_SPEED = 1664;
/** Per Link, the ticks after the leader got into a cannon that a follower on the ground is put on him (traced). */
export const CANNON_BOARD: readonly number[] = [0, 1, 0, 2];

const ladderAt = (world: World, x: number, y: number) => surfaceAt(world, Math.floor(x / SUBPX), Math.floor(y / SUBPX)) === "ladder";
/** On a ladder: his anchor or his feet (his bottom sensor) on a ladder tile, or his body's side over one (traced: he
 *  hangs on stepping off sideways). */
const onLadder = (world: World, p: PlayerState) =>
  ladderAt(world, p.x, p.y) || ladderAt(world, p.x, p.y + FEET) || ladderAt(world, p.x - BODY, p.y) || ladderAt(world, p.x + BODY, p.y);
const BODY = 7 * SUBPX;
/** Walking off a ledge: each tick's (along, down) of the first three (1/256 px, traced: 3.3 / 2.2, 2.4 / 3.1, 2.0 / 4.0). */
export const WALK_OFF: readonly (readonly [number, number])[] = [[845, 563], [614, 794], [512, 1024]];
/** Standing: on something solid, or on a ladder's top (TODO(measure): the game's ladder tops). */
const standing = (world: World, p: PlayerState) => isSolidAt(world, Math.floor(p.x / SUBPX), Math.floor((p.y + FEET) / SUBPX) + 1) || ladderAt(world, p.x, p.y + FEET + SUBPX);
const inWater = (world: World, x: number, y: number) => surfaceAt(world, Math.floor(x), Math.floor(y)) === "deep";
const FEET = 7 * SUBPX;

/** One tick of a Link on his own in a side-view area. */
export function stepSideView(m: LinkMotion, p: PlayerState, buttons: number, world: World): void {
  const x = p.x / SUBPX, y = p.y / SUBPX;
  if (inWater(world, x, y)) {
    sideSwim(m, p, buttons, world);
    return;
  }
  if (m.mode === "swim") {
    m.mode = "walk";
    m.side = false;
  }
  const way = p.action === "none" ? (buttons & Button.Down ? 1 : 0) - (buttons & Button.Up ? 1 : 0) : 0;
  // Climbing: up while his feet are still on the ladder (he ends standing on its top), down onto or along it.
  // Out of the water onto a ladder's foot, his feet still in the water: up it too (traced in Lake Hylia room 6's area 5:
  // standing at the surface, y 92, then climbing).
  const fromWater = ladderAt(world, p.x, p.y) && inWater(world, x, y + FEET / SUBPX);
  const climb = way < 0 ? ladderAt(world, p.x, p.y + FEET - SIDE_CLIMB_SPEED) || fromWater : way > 0 ? onLadder(world, p) || ladderAt(world, p.x, p.y + FEET + SUBPX) : false;
  if (climb) {
    p.facing = way < 0 ? "up" : "down";
    p.moving = true;
    p.walkTicks++;
    p.held = buttons;
    moveAxis(p, world, way * SIDE_CLIMB_SPEED, "y");
    return;
  }
  // Walking off a ledge: the arc's first ticks (WALK_OFF), the stick doing nothing meanwhile (TODO(measure)).
  if (m.air > 0 && m.air <= WALK_OFF.length) {
    const [along, down] = WALK_OFF[m.air - 1]!;
    moveAxis(p, world, (p.facing === "left" ? -1 : 1) * along, "x");
    moveAxis(p, world, down, "y");
    p.walkTicks++;
    m.air = standing(world, p) ? 0 : m.air + 1;
    return;
  }
  const grounded = standing(world, p), x0 = p.x;
  stepLink(p, buttons & ~(Button.Up | Button.Down), world);
  if (onLadder(world, p) || standing(world, p)) {
    m.air = 0;
    return;
  }
  // Off the ground: walked off a ledge (its arc, from where he stood), or falling.
  if (grounded && !m.air && (p.facing === "left" || p.facing === "right") && p.x !== x0) {
    p.x = x0;
    m.air = 1;
    stepSideView(m, p, buttons, world);
    return;
  }
  moveAxis(p, world, SIDE_FALL_SPEED, "y");
  m.air = Math.max(m.air, WALK_OFF.length + 1);
}

function sideSwim(m: LinkMotion, p: PlayerState, buttons: number, world: World): void {
  m.mode = "swim";
  m.side = true;
  p.held = buttons;
  const dx = (buttons & Button.Right ? 1 : 0) - (buttons & Button.Left ? 1 : 0);
  const dy = (buttons & Button.Down ? 1 : 0) - (buttons & Button.Up ? 1 : 0);
  const unit = dx && dy ? DIAGONAL : SIDE_SWIM_SPEED;
  if (dx) p.facing = dx > 0 ? "right" : "left";
  else if (dy) p.facing = dy > 0 ? "down" : "up";
  moveAxis(p, world, dx * unit, "x");
  let vy = dy * unit + SIDE_SINK;
  if (vy < 0) {
    // Not out of the water upward (TODO(measure): the game's own check).
    const head = (p.y + vy) / SUBPX - SIDE_SWIM_HEAD;
    if (!inWater(world, p.x / SUBPX, head) && !onLadder(world, p)) vy = 0;
  }
  moveAxis(p, world, vy, "y");
  m.tick = (m.tick + 1) % 24;
  p.moving = dx !== 0 || dy !== 0;
}




/** On something solid or a ladder (a follower off both plays the Link ahead's track: stepSideFollower). */
export const footing = (world: World, p: PlayerState) => standing(world, p) || onLadder(world, p);

/** Notes where each Link but the last stands this tick on its track (a side view's, kept SIDE_DELAYS ticks). */
export function recordTracks(game: AdventureGame): void {
  const a = game.adventure;
  for (let k = 0; k < game.players.length - 1; k++) {
    const p = game.players[k]!, t = (a.tracks[k] ??= []);
    t.push(p.x, p.y);
    const n = (SIDE_DELAYS[k] ?? SIDE_DELAYS[SIDE_DELAYS.length - 1]!) * 2;
    if (t.length > n) t.splice(0, t.length - n);
  }
}

/**
 * A trailing follower's tick in a side view, when the leader is in a cannon or the follower is off the ground (true:
 * it moved him; false: he walks or swims the trail).
 */
export function stepSideFollower(game: AdventureGame, i: number, world: World): boolean {
  const a = game.adventure, m = a.links[i]!, p = game.players[i]!, l = game.players[0]!, lm = a.links[0]!;
  if (lm.mode === "cannon") {
    const board = !m.chase && lm.tick >= (CANNON_BOARD[i] ?? 0);
    chaseTo(p, l.x, l.y, board ? Infinity : SIDE_CHASE_SPEED);
    if (p.x === l.x && p.y === l.y) m.chase = true;
    recordTrail(game, i);
    return true;
  }
  if (!m.chase) {
    if (footing(world, p) || inWater(world, p.x / SUBPX, p.y / SUBPX)) return false;
    m.chase = true;
  }
  const t = a.tracks[i - 1], ahead = game.players[i - 1]!;
  if (t?.length) chaseTo(p, t[0]!, t[1]!, SIDE_CHASE_SPEED);
  recordTrail(game, i);
  // On the Link ahead: the trail again, from where they stand.
  if (p.x === ahead.x && p.y === ahead.y) {
    m.chase = false;
    a.trails[i - 1] = [ahead.x, ahead.y];
  }
  return true;
}

/** A follower's move toward (x, y), at most `speed` (1/256 px) along the line, walking left or right. */
function chaseTo(p: PlayerState, x: number, y: number, speed: number): void {
  const dx = x - p.x, dy = y - p.y;
  const [vx, vy] = speed === Infinity || dx * dx + dy * dy <= speed * speed ? [dx, dy] : velocityAlong(dx, dy, speed);
  p.x += vx;
  p.y += vy;
  if (vx) p.facing = vx > 0 ? "right" : "left";
  p.moving = vx !== 0 || vy !== 0;
  p.walkTicks = p.moving ? p.walkTicks + 1 : 0;
}
