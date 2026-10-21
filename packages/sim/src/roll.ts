// Rolling, and the empty lift. Measured in Dolphin (docs/measurements/battle-combat.md): an Action press with nothing liftable in
// front is decided two ticks later (P+2): still walking, Link rolls; otherwise he does an empty lift. Both play from P+3
// for 21 ticks, then one idle tick (none when the stick still points the way he rolled: he walks on, traced in battle).
// The roll goes along the facing it started with (4 directions, even from a diagonal walk) at 2 px/tick, plus 1 px/tick
// along the stick (0.7071 per axis on diagonals): 3 px/tick with the stick held along (63 px in all), 1 against it.
// Into a wall he stops like walking and plays the roll out in place. Action during a roll is ignored. In Shadow Battle a
// roll into another Link neither hurts nor stuns him: the Links' pushes (combat.ts separateLinks) move him along while
// slowing the roll (traced).
import { stepLink } from "./actions.ts";
import type { Fighter } from "./combat.ts";
import { stopActing } from "./combat.ts";
import { FACING_STEP } from "./entities.ts";
import type { GameState } from "./game.ts";
import { EMPTY_LIFT, ROLL, sumTicks } from "./moveframes.ts";
import { Button, moveAxis } from "./player.ts";
import type { World } from "./world.ts";

export const ROLL_TICKS = sumTicks(ROLL.ticks); // 21 (measured)
export const EMPTY_LIFT_TICKS = sumTicks(EMPTY_LIFT.ticks); // 21 (measured)
export const ROLL_DECIDE_TICKS = 2; // the roll or empty lift is decided on P+2 (measured)
export const ROLL_SPEED = 512; // 2 px/tick along the roll (measured)
export const ROLL_STEER = 256; // + 1 px/tick along the stick (measured)
export const ROLL_STEER_DIAGONAL = 181; // 0.7071 px per axis

/** Action with nothing to lift: wait (walking on) to see whether it's a roll. */
export function startReady(f: Fighter): void {
  f.move = "ready";
  f.moveTick = 0;
}

/** The ready ticks, the roll and the empty lift. Returns false for other moves, and for the ready ticks' walking. */
export function stepRoll(state: GameState, i: number, buttons: number, world: World): boolean {
  const b = state.battle!, p = state.players[i]!, f = b.fighters[i]!;
  switch (f.move) {
    case "ready": {
      if (++f.moveTick < ROLL_DECIDE_TICKS) return false; // an ordinary tick
      stepLink(p, buttons, world);
      f.moveTick = -1; // the roll or empty lift shows from the next tick
      if (p.action !== "none") f.move = "none"; // the sword took over
      else if (p.moving) {
        const [sx, sy] = FACING_STEP[p.facing];
        stopActing(p);
        f.move = "roll";
        f.flyX = sx * ROLL_SPEED;
        f.flyY = sy * ROLL_SPEED;
      } else {
        stopActing(p);
        f.move = "emptyLift";
      }
      return true;
    }
    case "emptyLift":
      p.held = buttons;
      if (++f.moveTick >= EMPTY_LIFT_TICKS) end(f);
      return true;
    case "roll":
      if (++f.moveTick >= ROLL_TICKS) {
        end(f);
        // Still holding the way he rolled, Link walks on at once (traced in battle); otherwise an idle tick first.
        const [sx, sy] = FACING_STEP[p.facing];
        const along = (sx > 0 && buttons & Button.Right) || (sx < 0 && buttons & Button.Left) || (sy > 0 && buttons & Button.Down) || (sy < 0 && buttons & Button.Up);
        if (along) {
          p.moving = true;
          return false; // walks this tick (stepLink)
        }
        p.held = buttons;
        return true;
      }
      p.held = buttons;
      roll(state, i, buttons, world);
      return true;
    default:
      return false;
  }
}

function end(f: Fighter): void {
  f.move = "none";
  f.moveTick = 0;
  f.flyX = f.flyY = 0;
}

function roll(state: GameState, i: number, buttons: number, world: World): void {
  const p = state.players[i]!, f = state.battle!.fighters[i]!;
  const dx = (buttons & Button.Right ? 1 : 0) - (buttons & Button.Left ? 1 : 0);
  const dy = (buttons & Button.Down ? 1 : 0) - (buttons & Button.Up ? 1 : 0);
  const steer = dx && dy ? ROLL_STEER_DIAGONAL : ROLL_STEER;
  const vx = f.flyX + dx * steer, vy = f.flyY + dy * steer;
  const straight = vx === 0 || vy === 0;
  moveAxis(p, world, vx, "x", straight);
  moveAxis(p, world, vy, "y", straight);
}
