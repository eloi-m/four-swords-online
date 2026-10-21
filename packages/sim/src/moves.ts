// The Action and Item buttons on top of walking and the sword (combat.ts calls this for active fighters through
// MoveHook): Action takes the item on the ground in front (orbs.ts), lifts what's in front (carry.ts), or with nothing
// to lift rolls or does an empty lift (roll.ts); Item uses the item in hand (items.ts). Moves in progress run here too
// (a door walk into or out of a side room: siderooms.ts). Presses only count while the sword is idle.
import { stepBoots } from "./boots.ts";
import { stepCarry, tryLift } from "./carry.ts";
import { stepFireRod } from "./firerod.ts";
import { stepHammer } from "./hammer.ts";
import type { MoveHook } from "./combat.ts";
import type { GameState } from "./game.ts";
import { stepItemMove, useItem } from "./items.ts";
import { stepTake, tryTake } from "./orbs.ts";
import { Button } from "./player.ts";
import { pushingIdle, stepPushing } from "./push.ts";
import { startReady, stepRoll } from "./roll.ts";
import { stepCircle, stepInCannon, stepLaunch, stepSideView, stepWarp } from "./siderooms.ts";

/** The move hook for one battle tick. */
export function moveHook(state: GameState): MoveHook {
  return (p, f, buttons, world) => {
    const i = state.players.indexOf(p);
    if (f.move !== "none") {
      return (
        stepWarp(state, i, buttons) ||
        stepCircle(state, i, buttons) ||
        stepInCannon(state, i, buttons) ||
        stepLaunch(state, i, buttons, world) ||
        stepCarry(state, i, buttons, world) ||
        stepRoll(state, i, buttons, world) ||
        stepItemMove(state, i, buttons, world) ||
        stepBoots(state, i, buttons, world) ||
        stepHammer(state, i, buttons) ||
        stepFireRod(state, i, buttons, world) ||
        stepTake(state, i, buttons)
      );
    }
    // Leaning on a wall (push.ts): it takes the tick over while the stick holds it there.
    if (pushingIdle(f.push, p, buttons) || stepPushing(f.push, p, f, buttons)) return true;
    if (p.action === "none") {
      const pressed = buttons & ~p.held;
      // (Flattened by a hammer, the Action button does nothing: hammer.ts.)
      if (pressed & Button.Action && f.flat === 0) {
        if (tryTake(state, i) || tryLift(state, i)) {
          p.held = buttons;
          return true;
        }
        startReady(f); // nothing to lift: a roll or an empty lift, decided in two ticks; this one is ordinary
        return false;
      }
      if (pressed & Button.Item && useItem(state, i)) {
        p.held = buttons;
        return true;
      }
    }
    return stepSideView(state, i, buttons, world); // (in a side-view room: walking, falling, ladders; else nothing)
  };
}
