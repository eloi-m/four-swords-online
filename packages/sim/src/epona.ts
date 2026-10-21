// Epona, an item orb's carrot (traced in battle, docs/measurements/battle-combat.md "Items, levels and the Four Sword"): the carrot
// (NNJN) lies where the orb broke and a Link who walks into it is on Epona at once (state 11): he mounts for 56 ticks
// (850-853, 7 each, twice round), then she gallops on and on the way he faces, the stick only steering (4 ways, at
// once): 3 px/tick for 7 ticks, 2.8, 2.6, 2.4, 2.2, then 2 for 8, round again (moveframes.ts rideFrame: base, base+1,
// base+2 by facing). Into a wall she turns back and stands 16 ticks. 360 ticks in all, then he stands. She takes him
// through doors too. No invincibility counter showed while riding, and a stab at the rider did nothing (traced: he
// can't be hit). A Link she gallops into is trampled (traced, state 16): 2 life, 60 invincibility, shoved on along her
// way 6 px a tick on the ground until he's been stopped 3 ticks with her off him, then bounced back 2 px a tick with a
// 4.0 hop (33 ticks up).
import type { GameState } from "./game.ts";
import { hurtbox, hurtFighter, SHOVE_SPEED, stopActing, vulnerable, type Fighter } from "./combat.ts";
import { boxesOverlap, FACING_STEP, velocityAlong } from "./entities.ts";
import { Button, moveAxis, nextFacing, type PlayerState } from "./player.ts";
import type { World } from "./world.ts";

export const EPONA_TICKS = 360;
export const EPONA_MOUNT_TICKS = 56; // (moveframes.ts RIDE.mountFor)
export const EPONA_GALLOP = [768, 768, 768, 768, 768, 768, 768, 717, 666, 614, 563, 512, 512, 512, 512, 512, 512, 512, 512] as const;
export const EPONA_BUMP_TICKS = 16;
export const EPONA_SPEED = EPONA_GALLOP[0];
export const TRAMPLE_DAMAGE = 2; // traced

/** The gallop's speed `t` ticks into it (EPONA_GALLOP's 19-tick round). */
export const gallopSpeed = (t: number): number => EPONA_GALLOP[t % EPONA_GALLOP.length]!;

/** A carrot touched: on Epona, her mount first. While riding, `escape` counts her stand after a wall down. */
export function startRide(p: PlayerState, f: Fighter): void {
  stopActing(p);
  f.move = "ride";
  f.moveTick = 0;
  f.itemTimer = EPONA_TICKS;
  f.escape = 0;
}

/** One tick on Epona (the move hook's, items.ts). */
export function stepRide(p: PlayerState, f: Fighter, buttons: number, world: World): void {
  p.held = buttons;
  f.moveTick++;
  if (--f.itemTimer <= 0) {
    f.move = "none";
    f.moveTick = 0;
    f.escape = 0;
    p.moving = false;
    return;
  }
  // The stick turns her at once (a diagonal keeps a facing it holds).
  if (buttons & (Button.Up | Button.Down | Button.Left | Button.Right)) p.facing = nextFacing(p.facing, buttons);
  p.moving = f.moveTick >= EPONA_MOUNT_TICKS && f.escape === 0;
  if (f.escape > 0) f.escape--;
  if (!p.moving) return;
  const [sx, sy] = FACING_STEP[p.facing];
  const speed = gallopSpeed(f.moveTick - EPONA_MOUNT_TICKS), x0 = p.x, y0 = p.y;
  moveAxis(p, world, sx * speed, "x", true);
  moveAxis(p, world, sy * speed, "y", true);
  if ((sx && p.x === x0) || (sy && p.y === y0)) {
    // A wall: she turns back and stands (traced).
    p.facing = sx > 0 ? "left" : sx < 0 ? "right" : sy > 0 ? "up" : "down";
    f.escape = EPONA_BUMP_TICKS;
    p.moving = false;
  }
}

/** Epona runs over the Links in her way (after everyone moved). */
export function trample(state: GameState, i: number): void {
  const b = state.battle!, p = state.players[i]!;
  if (!p.moving) return;
  const box = hurtbox(p);
  b.fighters.forEach((g, j) => {
    if (j === i || !boxesOverlap(box, hurtbox(state.players[j]!))) return;
    if (g.shove && g.mode === "hurt") g.shove = 1; // she's on him: he stays shoved (combat.ts stepFighter)
    if (!vulnerable(g)) return;
    const q = state.players[j]!;
    const hit = hurtFighter(q, g, j, TRAMPLE_DAMAGE, p.x, p.y, { attacker: i, cause: "epona" });
    if (!hit) return;
    b.hits.push(hit);
    // Shoved along, then bounced off what stops him (combat.ts stepFighter).
    [g.pushX, g.pushY] = velocityAlong(q.x - p.x, q.y - p.y, SHOVE_SPEED);
    if (!g.pushX && !g.pushY) [g.pushX, g.pushY] = FACING_STEP[p.facing].map((s) => s * SHOVE_SPEED) as [number, number];
    [g.vz, g.shove] = [0, 1];
  });
}
