// The four-Link chain lever (PSWK, "引っ張りスイッチ"-style pull switch: the Cave of No Return's room 11, two of them by
// its north door). Read from main.dol (init 0x803744C4, update 0x80374074, its event 0x80373C38):
// - its handle is a 16 px box round the actor (±8), hanging from the wall; a Link grabs it (the R button: the sim's
//   Action) facing it, his grab point (16 px ahead of him, table 0x8046BD48) in the box;
// - it moves only while four Links hold the chain (0x80238A68 counts the players grabbing it, all facing the same way):
//   it comes down by 0.5 px a tick, but crawls 0.03 px a tick over the first 2 px of every 10 (a notch, a click
//   sound at each), so 0-36 px take ~330 ticks, then 0.5 px a tick to 40; the one holding the handle is put on its x
//   when 2 px or more off it;
// - fewer than four, it goes back up 1.25 px a tick (to 0);
// - pulled to 40 px it's done: 50 ticks, then a 13-step sequence over the Links (table 0x80475070: 1 tick each, the
//   12th 8, then 25), then its switch (params >> 27) turns on: 94 ticks after the pull (vtable +0x30, 0x801F47CC).
// Traced in Dolphin (room 11's east lever, measurements/adventure-world1.md "Room 11's chain levers"), all of the above,
// and playing alone: the leader grabs the handle with R facing it (his grab point no lower than 2 px under the
// handle's middle: from y 41.5 under the east one he grabs it, from 42 not; ±7 px across did) and the C stick's column
// ("long": "line up this way", the room's ghost) has each of the others hold the one ahead, a tick apart. R alone holds
// it, R and Down pull (the leader alone or the others trailing: nothing moves). The four come down with the handle
// (the leader 15 px under it, by 0.5 px steps), step back 7 px the tick after the full pull and hold on, whatever the
// pad, through the sequence (player_sob 220-232) to its switch; then they let go and it goes back up. Down let go
// while a pulled lever is held: it goes back up dragging them along, the leader letting go on its 3rd tick back.
import { Button, SUBPX } from "../player.ts";
import { ownSwitch, setSwitch, switchOn } from "../switches.ts";
import { currentArea, type AdventureGame } from "./adventure.ts";
import { FORMATION_SLOTS } from "./formation.ts";
import type { AdventureStage } from "./stage.ts";

/** The handle's box: ±8 px round where it hangs now. */
export const LEVER_HALF = 8;
/** A Link's grab point: this far ahead of him (main.dol 0x8046BD48). */
export const GRAB_REACH = 16;
/** The grab point may be at most this far under the handle's middle (px; measured: 1.5 grabs, 2 doesn't). */
export const LEVER_GRAB_BELOW = 2;
/** The pull, in hundredths of a px (main.dol's floats: 0.5, 0.03, 1.25 px a tick; 36 and 40 px; a notch of 2 every 10). */
export const LEVER_FULL = 4000;
export const LEVER_FAST_FROM = 3600;
export const LEVER_SPEED = 50;
export const LEVER_NOTCH_SPEED = 3;
export const LEVER_NOTCH = 200;
export const LEVER_NOTCH_EVERY = 1000;
export const LEVER_BACK_SPEED = 125;
/** Ticks from the full pull to its switch (main.dol: 50, then 1 × 11, 8, 25; measured 94). */
export const LEVER_DONE_TICKS = 94;
/** The holders' step back the tick after the full pull (px, measured). */
export const LEVER_DONE_STEP = 7;
/** Down let go while holding a pulled lever: the leader lets go on its this-many-th tick back up (measured). */
export const LEVER_SLIP_TICKS = 3;
/** The holder is put on the handle's x when this many px off it (or more). */
export const LEVER_ALIGN = 2;
/** The Links that must hold it. */
export const LEVER_HOLDERS = 4;
/** A follower holds the one ahead when this close to his place in the column (px). TODO(measure). */
const IN_LINE = 2;

/** A lever of the current area: its actor (index in the room's list), its pull (1/100 px), ticks since done (-1 before),
 *  ticks it has gone back up while held. */
export interface Lever {
  actor: number;
  pull: number;
  done: number;
  back: number;
}

/** The current area's levers (pulled ones whose switch is on stay done). */
export function spawnLevers(game: AdventureGame, stage: AdventureStage): void {
  const a = game.adventure;
  a.levers = currentArea(game, stage)
    .actors.filter((x) => x.id === "PSWK")
    .map((x) => ({ actor: x.index, pull: 0, done: ownSwitch(x.params) && switchOn(game.battle, ownSwitch(x.params)) ? LEVER_DONE_TICKS : -1, back: 0 }));
  a.grab = -1;
}

/** Where a lever's handle hangs now (area px, its middle). */
export function handleAt(game: AdventureGame, stage: AdventureStage, lever: Lever): { x: number; y: number } {
  const actor = currentArea(game, stage).actors.find((x) => x.index === lever.actor)!;
  return { x: actor.x, y: actor.y + Math.floor(lever.pull / 100) };
}

/** Whether the leader's grab point (GRAB_REACH ahead of him) is in a lever's box (no lower than LEVER_GRAB_BELOW under
 *  its middle). */
function grabbing(game: AdventureGame, stage: AdventureStage, lever: Lever): boolean {
  const p = game.players[0]!, h = handleAt(game, stage, lever);
  const ahead = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[p.facing];
  const gx = p.x / SUBPX + ahead[0]! * GRAB_REACH, gy = p.y / SUBPX + ahead[1]! * GRAB_REACH;
  return gx >= h.x - LEVER_HALF && gx < h.x + LEVER_HALF && gy >= h.y - LEVER_HALF && gy < h.y + LEVER_GRAB_BELOW;
}

/** Whether a lever is between its full pull and its switch (its holders can't let go). */
const settling = (lever: Lever | undefined) => !!lever && lever.done >= 0 && lever.done < LEVER_DONE_TICKS;

/**
 * The leader and a lever: Action pressed with his grab point on a handle grabs it; while Action is held he holds it
 * (standing, the stick doesn't walk him), and from the full pull to its switch whatever the pad. Returns true while
 * he holds one (his tick is then this).
 */
export function holdLever(game: AdventureGame, stage: AdventureStage, buttons: number): boolean {
  const a = game.adventure, p = game.players[0]!, f = game.battle.fighters[0]!;
  if (!a.levers?.length) return false;
  if (a.grab >= 0 && !(buttons & Button.Action) && !settling(a.levers[a.grab])) a.grab = -1;
  if (a.grab < 0) {
    if (!(buttons & ~p.held & Button.Action) || f.mode !== "active" || f.move !== "none" || p.action !== "none") return false;
    const k = a.levers.findIndex((l) => grabbing(game, stage, l));
    if (k < 0) return false;
    a.grab = k;
  }
  if (f.invincible > 0) f.invincible--;
  p.held = buttons;
  p.moving = false;
  p.walkTicks = 0;
  return true;
}

/** How many Links hold lever `k` now: the leader on its handle, the others in the column behind him (all facing it). */
export function leverHolders(game: AdventureGame, k: number): number {
  const a = game.adventure;
  if (a.grab !== k) return 0;
  const l = game.players[0]!;
  let n = 1;
  if (a.formation !== "long" || a.away) return n;
  for (let i = 1; i < game.players.length; i++) {
    const p = game.players[i]!, [ox, oy] = FORMATION_SLOTS.long[i - 1]!;
    if (Math.abs(p.x - (l.x + ox * SUBPX)) > IN_LINE * SUBPX || Math.abs(p.y - (l.y + oy * SUBPX)) > IN_LINE * SUBPX || p.facing !== l.facing) break;
    n++;
  }
  return n;
}

/** The area's levers, one tick (after the Links moved): pulled, going back, done and their switches. */
export function stepLevers(game: AdventureGame, stage: AdventureStage, buttons: number): void {
  const a = game.adventure;
  if (!a.levers?.length) return;
  const l = game.players[0]!;
  a.levers.forEach((lever, k) => {
    const actor = currentArea(game, stage).actors.find((x) => x.index === lever.actor)!;
    const held = a.grab === k, before = lever.pull;
    if (settling(lever)) {
      lever.pull = LEVER_FULL;
      // The holders step back the tick after the full pull; with its switch they let go (measured: 2 ticks after).
      if (held && lever.done === 0) l.y += LEVER_DONE_STEP * SUBPX;
      if (++lever.done === LEVER_DONE_TICKS) {
        setSwitch(game.battle, ownSwitch(actor.params), true);
        if (held) a.grab = -1;
      }
      return;
    }
    if (leverHolders(game, k) >= LEVER_HOLDERS && buttons & Button.Down) {
      const h = handleAt(game, stage, lever);
      if (Math.abs(l.x / SUBPX - h.x) >= LEVER_ALIGN) l.x = h.x * SUBPX;
      if (lever.pull >= LEVER_FAST_FROM) lever.pull = Math.min(LEVER_FULL, lever.pull + LEVER_SPEED);
      else lever.pull += lever.pull % LEVER_NOTCH_EVERY < LEVER_NOTCH ? LEVER_NOTCH_SPEED : LEVER_SPEED;
      if (lever.pull >= LEVER_FULL && lever.done < 0) lever.done = 0;
      lever.back = 0;
    } else {
      lever.pull = Math.max(0, lever.pull - LEVER_BACK_SPEED);
      // Held while it goes back up: the leader lets go on its 3rd tick.
      lever.back = held && lever.pull < before ? lever.back + 1 : 0;
      if (lever.back >= LEVER_SLIP_TICKS) {
        a.grab = -1;
        lever.back = 0;
      }
    }
    // The one holding the handle moves with it (dragged back up too).
    if (held) l.y += Math.round((lever.pull * SUBPX) / 100) - Math.round((before * SUBPX) / 100);
  });
}
