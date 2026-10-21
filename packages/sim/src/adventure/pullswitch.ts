// Pull switches, read from main.dol:
// - PLSW (init 0x8028A894, update 0x8028A460; Hyrule Castle room 3's two handles in the garden's walls): its box is ±8
//   px round its anchor (the handle's middle), moved down by how far it's out; it's grabbed by a Link whose point 16 px
//   ahead of him (0x8046BD48: ±16 along his facing) is in the box while he holds it (his grab state: here the Action
//   button held, facing it, and pulling: Down). On the pull's first tick the Link is lined up 16 px under it; then
//   each tick he holds it it comes out 0.25 px (to 4 px), then 0.1 px (to 8 px); at 8 px it stays out for good, its
//   switch (the top 5 bits) turns on (a chime, 0x3004B) and the Link lets go. Let go before, it slides back 0.25
//   px/tick. It's out for good at the start when its switch is already on (init).
// - PSWB "four-man pull switch" (update 0x803734B4; Hyrule Castle room 9's big handle, the walkthrough's "a wide
//   formation to pull the big handle"): its grab box is ±32 × ±8 px round its anchor; it moves only while four Links
//   hold it (0x80238A68's count, capped at 4): 0.05 px a tick to 3 px, 0.125 to 11, 0.05 to 14, where it stays out
//   for good (+0x240, the chime 0x3004B, the rumble on the four pads); fewer than four, it slides back 0.25 px a tick.
//   Assumed: its switch (the top 5 bits) turns on there, as PLSW's (the update doesn't set it itself); the Links
//   holding it are the leader and, in a C-stick formation, those of the formation in the box (they act with him).
// TODO(measure): the Link's pull (here he steps back with the handle; the game's own pull state and frames), whether
// holding it without pulling keeps it out (the game's grab check looks at three of the Link's state flags), the
// handles' look (apps draw nothing for them).
import { Button, SUBPX } from "../player.ts";
import { setSwitch, switchOn } from "../switches.ts";
import { currentArea, type AdventureGame } from "./adventure.ts";
import type { AdventureStage, AreaActor } from "./stage.ts";

/** How far a handle is out, in 1/40 px. PLSW: 0.25 px/tick to 4 px, then 0.1 px/tick to 8 px (out for good); both
 *  kinds slide back 0.25 px/tick. */
export const PULL_UNIT = 40;
export const PULL_FULL = 8 * PULL_UNIT;
export const PULL_HALF = 4 * PULL_UNIT;
export const PULL_FAST = 10;
export const PULL_SLOW = 4;
export const PULL_BACK = 10;
/** PSWB: 0.05 px/tick to 3 px, 0.125 to 11, 0.05 to 14 (out for good), with four Links on it. */
export const BIG_PULL_FULL = 14 * PULL_UNIT;
export const BIG_PULL_STEPS: readonly (readonly [number, number])[] = [[3 * PULL_UNIT, 2], [11 * PULL_UNIT, 5], [BIG_PULL_FULL, 2]];
export const BIG_PULL_LINKS = 4;
/** The grab: the Link's point this far ahead of him in the handle's box (±PULL_BOX px; a PSWB ±BIG_PULL_BOX across),
 *  lined up under it when this far off sideways (PLSW). */
export const PULL_REACH = 16;
export const PULL_BOX = 8;
export const BIG_PULL_BOX = 32;
export const PULL_ALIGN = 2;

const isPull = (a: AreaActor) => a.id === "PLSW" || a.id === "PSWB";
const fullOf = (a: AreaActor) => (a.id === "PSWB" ? BIG_PULL_FULL : PULL_FULL);

/** The current area's handles (AdventureState.pulls: actor index, how far out, the tick last pulled; …). */
export function spawnPulls(game: AdventureGame, stage: AdventureStage): void {
  const a = game.adventure;
  a.pulls = [];
  for (const actor of currentArea(game, stage).actors) {
    if (isPull(actor)) a.pulls.push(actor.index, switchOn(game.battle, actor.params >>> 27) ? fullOf(actor) : 0, -1);
  }
}

/** Is Link `i` free, facing up, his point PULL_REACH px ahead in the box round (x, y) (± `across`, ± PULL_BOX)? */
function grabs(game: AdventureGame, i: number, x: number, y: number, across: number): boolean {
  const p = game.players[i]!, f = game.battle.fighters[i]!;
  if (p.facing !== "up" || f.mode !== "active" || f.move !== "none" || p.action !== "none") return false;
  const px = p.x / SUBPX, py = p.y / SUBPX - PULL_REACH;
  return px >= x - across && px < x + across && py >= y - PULL_BOX && py < y + PULL_BOX;
}

const C_STICK = new Set(["wide", "box", "cross", "long"]);

/**
 * The leader holding Action facing up at a handle and pulling (Down): it comes out and he steps back with it (true:
 * the tick is the pull's, he does nothing else). A big handle (PSWB) moves only with four Links on it.
 */
export function pullHandle(game: AdventureGame, stage: AdventureStage, buttons: number): boolean {
  const a = game.adventure, p = game.players[0]!;
  if (!a.pulls.length || !(buttons & Button.Action) || !(buttons & Button.Down) || p.facing !== "up") return false;
  const actors = currentArea(game, stage).actors;
  for (let k = 0; k < a.pulls.length; k += 3) {
    const actor = actors.find((x) => x.index === a.pulls[k]);
    let ext = a.pulls[k + 1]!;
    if (!actor || ext >= fullOf(actor)) continue;
    const hy = actor.y + ext / PULL_UNIT, big = actor.id === "PSWB";
    if (!grabs(game, 0, actor.x, hy, big ? BIG_PULL_BOX : PULL_BOX)) continue;
    if (big) {
      const team = C_STICK.has(a.formation) && !a.away;
      const holding = game.players.filter((_, i) => i === 0 || (team && grabs(game, i, actor.x, hy, BIG_PULL_BOX))).length;
      if (holding < BIG_PULL_LINKS) continue;
      ext = Math.min(BIG_PULL_FULL, ext + BIG_PULL_STEPS.find(([to]) => ext < to)![1]);
    } else {
      ext = Math.min(PULL_FULL, ext + (ext < PULL_HALF ? PULL_FAST : PULL_SLOW));
      if (Math.abs(p.x / SUBPX - actor.x) >= PULL_ALIGN) p.x = actor.x * SUBPX;
    }
    a.pulls[k + 1] = ext;
    a.pulls[k + 2] = game.tick;
    p.y = Math.round((actor.y + ext / PULL_UNIT + PULL_REACH) * SUBPX);
    Object.assign(p, { moving: false, walkTicks: 0, held: buttons });
    if (ext >= fullOf(actor)) {
      setSwitch(game.battle, actor.params >>> 27, true);
      a.ignore |= Button.Action;
    }
    return true;
  }
  return false;
}

/** The handles nobody pulled this tick slide back in (after the leader's step); one out for good stays out. */
export function stepPulls(game: AdventureGame, stage: AdventureStage): void {
  const a = game.adventure;
  if (!a.pulls.length) return;
  const actors = currentArea(game, stage).actors;
  for (let k = 0; k < a.pulls.length; k += 3) {
    const ext = a.pulls[k + 1]!, actor = actors.find((x) => x.index === a.pulls[k]);
    if (actor && ext > 0 && ext < fullOf(actor) && a.pulls[k + 2] !== game.tick) a.pulls[k + 1] = Math.max(0, ext - PULL_BACK);
  }
}

/** How far a handle is out (px), for renderers; -1 when the actor isn't a handle of the current area. */
export function pullOut(game: AdventureGame, actor: number): number {
  const a = game.adventure;
  for (let k = 0; k < a.pulls.length; k += 3) if (a.pulls[k] === actor) return a.pulls[k + 1]! / PULL_UNIT;
  return -1;
}
