// The cannons of side-view areas (CNON; traced in Lake Hylia room 7's area 5, docs/measurements/adventure-lake-hylia.md "Adventure:
// cannons and side-view doors"): a leader falling onto one gets in, the Item button (the pad's A) shoots him up, and he
// can be steered left and right while he flies, onto a ledge or into the next cannon, or through a door in the area's
// top edge. The followers walk his trail meanwhile.
// - In: falling (4 px/tick) within 11 px of its anchor sideways and below CANNON_RIDE px over it, he is in it the
//   next tick, 16 px over its anchor (state 76, sprite 976; the game bobs him 4.5 px down and back over 18 ticks: not
//   modelled).
// - The shot (state 77, sprite 176): the press's tick still in it, then 13 px up the first tick, 0.25 px/tick less each
//   tick, falling at most 6 px/tick (a 345 px climb). Left or right moves him 0.8 px the first tick, 0.1 px/tick more
//   each tick, up to 1.6 px/tick. Landing on something he stands again the tick after.
import { Button, moveAxis, SUBPX, type Facing } from "../player.ts";
import { isSolidAt, type World } from "../world.ts";
import type { AdventureGame } from "./adventure.ts";
import type { Area, AreaActor } from "./stage.ts";

export const CANNON_RIDE = 16;
export const CANNON_CATCH = 11;
export const SHOT_SPEED = 13 * SUBPX;
export const SHOT_SLOWING = SUBPX / 4;
export const SHOT_FALL_MAX = 6 * SUBPX;
export const SHOT_STEER_START = 205; // 0.8 px/tick
export const SHOT_STEER_STEP = 26; // 0.1 px/tick per tick
export const SHOT_STEER_MAX = 410; // 1.6 px/tick
/** The sprites: in a cannon, shot. */
export const CANNON_FRAME = 976;
export const SHOT_FRAME = 176;

const FEET = 7 * SUBPX;

export const areaCannons = (area: Area): AreaActor[] => area.actors.filter((a) => a.id === "CNON");

/**
 * The leader in a cannon or shot from one, a tick (true when it took the tick over). In a cannon he waits for the Item
 * button; shot he flies, steered, until he lands on something (then he walks again) or falls into a cannon.
 */
export function stepCannon(game: AdventureGame, area: Area, buttons: number, world: World): boolean {
  const a = game.adventure, m = a.links[0]!, p = game.players[0]!;
  if (m.mode === "cannon") {
    const pressed = buttons & ~p.held;
    p.held = buttons;
    p.moving = false;
    m.tick++;
    if (pressed & Button.Item) Object.assign(m, { mode: "shot", tick: 0, vx: 0, vy: -SHOT_SPEED });
    return true;
  }
  if (m.mode !== "shot") return false;
  p.held = buttons;
  p.moving = false;
  m.tick++;
  const dx = (buttons & Button.Right ? 1 : 0) - (buttons & Button.Left ? 1 : 0);
  if (!dx) m.vx = 0; // TODO(measure): letting go
  else if (Math.sign(m.vx) !== dx) m.vx = dx * SHOT_STEER_START;
  else m.vx = dx * Math.min(SHOT_STEER_MAX, Math.abs(m.vx) + SHOT_STEER_STEP);
  if (dx) p.facing = (dx > 0 ? "right" : "left") as Facing;
  moveAxis(p, world, m.vx, "x");
  const y0 = p.y;
  moveAxis(p, world, m.vy, "y");
  const landed = m.vy > 0 && p.y - y0 < m.vy;
  if (m.vy < 0 && p.y === y0) m.vy = 0; // (a ceiling: TODO(measure))
  m.vy = Math.min(SHOT_FALL_MAX, m.vy + SHOT_SLOWING);
  if (catchInCannon(game, area, y0)) return true;
  if (landed || (m.vy > 0 && isSolidAt(world, Math.floor(p.x / SUBPX), Math.floor((p.y + FEET) / SUBPX) + 1))) Object.assign(m, { mode: "walk", tick: 0, vx: 0, vy: 0 });
  return true;
}

/** A leader who fell this tick (from y0) onto a cannon gets in it. */
export function catchInCannon(game: AdventureGame, area: Area, y0: number): boolean {
  const m = game.adventure.links[0]!, p = game.players[0]!;
  if (p.y <= y0) return false;
  for (const c of areaCannons(area)) {
    const cx = c.x * SUBPX, cy = c.y * SUBPX;
    if (Math.abs(p.x - cx) > CANNON_CATCH * SUBPX || p.y < cy - CANNON_RIDE * SUBPX || p.y > cy) continue;
    Object.assign(m, { mode: "cannon", tick: 0, vx: 0, vy: 0 });
    Object.assign(p, { x: cx, y: cy - CANNON_RIDE * SUBPX, moving: false, walkTicks: 0 });
    return true;
  }
  return false;
}
