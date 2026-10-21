// Lifting and throwing another Link on a side-view screen (the way across a gap: Hyrule Castle room 1's area 6, whose
// two floor switches sit on ledges either side of a 16 px gap). Measured in Dolphin there (docs/measurements/
// adventure-world1.md "Hyrule Castle: a Link thrown across area 6's gap"):
// - the Action button facing left or right lifts a Link standing 1 or 3 px ahead (one on the very same spot isn't:
//   an empty lift); the lift and the throw then play as Shadow Battle's (carry.ts: the held Link 16 px ahead at z 2,
//   12 px ahead at 10, on the head at 18 then 20; behind him at 17, over him at 19 and 22, then off at 3.3 px/tick
//   from z 18, falling 0.25 px/tick²);
// - the height stays a height (the thrown Link's y doesn't change), so he flies over a gap without falling into it;
//   a wall (a pot) sends him back at half speed (3 ticks at 1.65 px seen); down, he waits where he landed (apart:
//   facing down, frame 451) and the D-pad can hand him the controls.
// TODO(measure): carrying walks at 1.25 px/tick there (the sim walks him as the battle's carry does); whether one
// standing further than 3 px ahead is lifted (16 px assumed, the battle's reach); the throw up or down.
import { flyThrownLinks, LIFT_REACH, liftLink, stepCarry } from "../carry.ts";
import { stopActing } from "../combat.ts";
import { Button, SUBPX } from "../player.ts";
import type { World } from "../world.ts";
import type { AdventureGame } from "./adventure.ts";

/** How far below or above the leader the Link he lifts may stand (px; the battle's hurt box). */
export const SIDE_LIFT_HALF = 7;

/** The moves of a carrier's hands (carry.ts). */
const CARRYING: ReadonlySet<string> = new Set(["lift", "carry", "throw", "slam"]);

/**
 * The leader, walking on a side-view screen, presses the Action button facing left or right with another Link just
 * ahead of him: he lifts him (the lift plays from the next tick). Returns false when there's none.
 */
export function sideLiftLink(game: AdventureGame, buttons: number): boolean {
  const a = game.adventure, b = game.battle, l = game.players[0]!, f = b.fighters[0]!;
  if (!(buttons & ~l.held & Button.Action) || a.away || a.links[0]!.mode !== "walk" || l.action !== "none" || f.move !== "none") return false;
  if (l.facing !== "left" && l.facing !== "right") return false;
  const dir = l.facing === "left" ? -1 : 1;
  const j = game.players.findIndex((q, k) => {
    const g = b.fighters[k]!, ahead = (q.x - l.x) * dir;
    return k > 0 && g.mode === "active" && g.move === "none" && ahead > 0 && ahead <= LIFT_REACH * SUBPX && Math.abs(q.y - l.y) <= SIDE_LIFT_HALF * SUBPX;
  });
  if (j < 0) return false;
  liftLink(game, 0, j);
  l.held = buttons;
  return true;
}

/** The leader's lift, carry and throw on a side-view screen (walking left and right only). False when he holds nothing. */
export function stepSideCarry(game: AdventureGame, buttons: number, view: World): boolean {
  if (!CARRYING.has(game.battle.fighters[0]!.move)) return false;
  stepCarry(game, 0, buttons & ~(Button.Up | Button.Down), view);
  return true;
}

/**
 * Once every Link moved: the thrown Links fly (carry.ts flyThrownLinks; on a side-view screen bouncing off walls), and
 * a follower down since last tick stands again (the leader's own tick does it for him: stepCarry); apart, he waits
 * facing down. Played alone a thrown Link bowls nobody over (THCL comes in multiplayer only: main.dol 0x8029D4A8;
 * measured in Hyrule Castle room 58's area 2, a Link thrown up past another left him unhurt).
 */
export function flyLinks(game: AdventureGame, view: World, sideView: boolean): void {
  game.battle.fighters.forEach((f, i) => {
    if (f.move === "thrown") f.thrower = -1;
    if (i === 0 || f.mode !== "active" || f.move !== "thrown" || f.z !== 0 || f.vz !== 0 || f.moveTick <= 0) return;
    const p = game.players[i]!;
    Object.assign(f, { move: "none", moveTick: 0, thrower: -1 });
    stopActing(p);
    if (game.adventure.formation === "apart") p.facing = "down";
  });
  flyThrownLinks(game, view, sideView);
}
