// The leader's push (state 13: ../push.ts, shared with Shadow Battle's Links): walking into a wall for 20 ticks
// without getting anywhere, Link leans on it and doesn't move. For the leader only (the followers stop behind him).
// When what he leans on goes (the Cave of No Return's rising door, traced) he walks on the tick after.
import { notePushing, pushingFrame, pushingIdle, stepPushing } from "../push.ts";
import { Button, moveAxis, WALK_SPEED, type Facing } from "../player.ts";
import type { World } from "../world.ts";
import type { AdventureGame } from "./adventure.ts";

export { PUSH_AFTER, PUSH_FRAME_TICKS, PUSH_RELEASE_TICKS } from "../push.ts";

const HELD: Readonly<Record<Facing, number>> = { up: Button.Up, down: Button.Down, left: Button.Left, right: Button.Right };

/** What the leader's push state does this tick, before he steps: true when it takes the tick over (no walking). */
export function stepPush(game: AdventureGame, buttons: number, world?: World): boolean {
  const a = game.adventure, p = game.players[0]!;
  // (A rock being pushed isn't leaned on: rocks.ts moves it and the Links.)
  if (a.push.on && world && buttons & HELD[p.facing] && !a.rocks.some((r) => r.push > 0 || r.state === "moving") && wayFree(p, world)) {
    a.push.on = false;
    a.push.ticks = 0;
    return false;
  }
  return stepPushing(a.push, p, game.battle.fighters[0]!, buttons);
}

/** Whether a walking step the way the leader faces would move him (what he leaned on has gone). */
function wayFree(p: { x: number; y: number; facing: Facing }, world: World): boolean {
  const probe = { x: p.x, y: p.y }, horizontal = p.facing === "left" || p.facing === "right";
  const dir = p.facing === "left" || p.facing === "up" ? -1 : 1;
  moveAxis(probe, world, dir * WALK_SPEED, horizontal ? "x" : "y");
  return horizontal ? probe.x !== p.x : probe.y !== p.y;
}

/** After the leader stepped: counts the ticks he walked without getting anywhere, and starts the push. */
export function notePush(game: AdventureGame, x0: number, y0: number): void {
  notePushing(game.adventure.push, game.players[0]!, game.battle.fighters[0]!, x0, y0);
}

/** The standing tick after a turned push (true: the leader stands this tick; he walks from the next, measured). */
export function pushIdle(game: AdventureGame, buttons: number): boolean {
  return pushingIdle(game.adventure.push, game.players[0]!, buttons);
}

/**
 * Link `i`'s push frame now, or -1 when he isn't pushing: the leader's push; the followers lean with him only on a rock
 * being pushed (the boulder, the blocks: all four push, traced), on his push's clock.
 */
export function pushFrame(game: AdventureGame, i = 0): number {
  const a = game.adventure, p = game.players[i];
  if (!p || (i > 0 && !a.rocks.some((r) => r.push > 0 || r.state === "moving"))) return -1;
  return pushingFrame(a.push, p);
}
