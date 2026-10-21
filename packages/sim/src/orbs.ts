// Item orbs and items on the ground, from the CRGN "crystal ball generators" (main.dol: init 0x801296FC, update
// 0x80129598, spawn 0x80129200; docs/measurements/battle-constants.md "Battle constants from main.dol", and measured in Dolphin: "Battle
// measurements: arenas, orbs and camera"). A generator's kind is params & 15:
// - 1: a CRTL crystal ball (an orb). In multiplayer its content comes from a roulette table (0x80471784, the one for
//   multiplayer battles, CRTL +0x288 = 4 measured): carrot, cucco, bombchus, cucco, bombchus, cucco, bombchus, one entry
//   at random, drawn when a Link lifts it (the roulette: apps/battle entities.ts). An orb can be lifted and thrown like
//   a pot (CRTL has the thrown-object stats: atcp 2, atcn 8); breaking it (sword, explosion, a throw) releases its
//   content, which the first Link to touch it takes. Nobody lifting it for 900 frames makes it go away (CRTL +0x278,
//   counted down only while it lies there, from its first frame: it's gone on its 900th).
// - 2: an item lying on the ground (LSTI), one of the items in the generator's mask (params bits 5-15, tables
//   0x80465000/58); it goes away after 600 frames (LSTI +0x254, from its first frame too), blinking for the last 120.
// - 3: a carrot on the ground; 0: a crystal ball holding one of the mask's items (neither is in a battle room).
// The generator counts to 600 frames (300 for kind 2), from 150 at the round's start, and from 0 once what it made is
// gone (broken, picked up or timed out), only while its switch (params >> 27, if any) is on (hazards.ts stepRespawns).
// Measured in every TV arena: the first orb 450 frames into the round (kind 2's item: 150), the next ones 900 + 600 /
// 600 + 300 frames apart when nobody takes them, and gated generators counting from the tick their switch came on.
// Items and contents the sim doesn't have (Roc's Feather, the lamp, the shovel) are left out of the draws; the
// roulette's bombchus run out of the orb when it breaks (bombchus.ts).
// Traced in battle (docs/measurements/battle-combat.md "Items, levels and the Four Sword"):
// - an orb appears 10 px up and drops (0.1 px/tick²), bounces once (0.82 px/tick up) drifting 0.41 px/tick (about 6 px)
//   in some direction, and lies still on its second landing;
// - a generator's item pops up from 13 px (2.7 px/tick up, 0.3 px/tick² down, 23 ticks) but on a side-view screen; a
//   Link standing there pushes it off his body (half the overlap a tick: on its first tick and once it's down);
// - its level is 2 one time in five (CRGN 0x80129444; the lamp never), 1 otherwise; level 2 shows the HUD's L2 badge;
// - a Link takes it with the Action button (R), not by touching it: facing it 13 px away, R took it at once (LSTI gone
//   the next tick), he stood 9 ticks, held it up (234 ×4, 235, 236), got it 45 ticks after the press with 60
//   invincibility ticks blinking at once, and was free two ticks later;
// - the Four Sword isn't held: taking it makes his sword level 2 (Link +0xC18; +2 power, combat.ts) for the rest of the
//   round (still 2 1100 ticks later), his item unchanged.
// An orb's content lying where it broke (a carrot, a cucco, a heart) is still taken by touching it (not traced).
import type { BattleState } from "./battle.ts";
import { HEART, hurtbox, makeInvincible, onGround, stopActing, type Fighter } from "./combat.ts";
import { boxAround, boxesOverlap, FACING_STEP, isRemoved, pointInBox, randomInt, removeEntity, setPhase, spawnEntity, type Entity, type ItemKind } from "./entities.ts";
import type { GameState } from "./game.ts";
import type { Prop } from "./props.ts";
import { BOMBCHU_KIND, BOMBCHU_SPEED, spawnBombchu } from "./bombchus.ts";
import { spawnCucco } from "./cucco.ts";
import { startRide } from "./epona.ts";
import { askMessage, MESSAGE } from "./messages.ts";
import { nextFacing, SUBPX } from "./player.ts";
import { screenAt, sideViewAt } from "./siderooms.ts";

export const ORB_TICKS = 600; // CRGN kinds 0, 1, 3: frames to the next orb
export const ORB_SHORT_TICKS = 300; // CRGN kind 2
/** CRGN's init starts its counter at 150, so the first orb (or item) comes 150 frames early. */
export const ORB_HEAD_START = 150;
export const ORB_FIRST_TICKS = ORB_TICKS - ORB_HEAD_START; // the first orb of a kind-1 generator
export const ORB_RESPAWN_TICKS = ORB_TICKS; // …and its next one, after the last one went away
/**
 * An orb nobody picked up goes away after this long (CRTL +0x278, multiplayer only). The count includes the frame it
 * appears on (it's already 899 then), so it lies there 899 ticks: spawned before stepPickups counts, like the game.
 */
export const ORB_LIFETIME = 900;

/** The generator's kind: params & 15. */
export const generatorKind = (prop: Prop) => prop.params & 15;
/** Frames a generator waits for its next orb or item. */
export const orbDelay = (prop: Prop) => (generatorKind(prop) === 2 ? ORB_SHORT_TICKS : ORB_TICKS);
/** …and for its first, from the round's start. */
export const orbFirstDelay = (prop: Prop) => orbDelay(prop) - ORB_HEAD_START;

/** An item left on the ground by a kind-2 generator stays this long (LSTI mode 3, multiplayer). */
export const PICKUP_TICKS = 600;
export const PICKUP_BLINK_TICKS = 120; // …blinking for the last ticks (LSTI: its alpha pulses while ≤ 120; renderers)
/** A generator's item is level 2 one time in this many (CRGN 0x80129444: a random 0…1 ≥ 0.8). */
export const LEVEL2_ODDS = 5;
/** The item's pop (1/256 px, per tick): from 13 px, 2.7 up, 0.3 a tick² down (traced). */
export const PICKUP_POP = { z: 13 * SUBPX, vz: 691, gravity: 77 } as const;
/** The orb's drop: from 10 px falling 0.1 a tick², a bounce at 0.82 drifting 0.41 px/tick (traced). */
export const ORB_DROP = { z: 10 * SUBPX, gravity: 26, bounce: 210, drift: 106 } as const;
/** Taking an item off the ground (the "take" move, from the tick after the press): the item on its 45th tick, free on
 *  its 47th (traced). */
export const TAKE_GIVE_TICK = 44;
export const TAKE_TICKS = 46;
/** The point 16 px in front (carry.ts LIFT_REACH) must be on the item's ±7 px. */
const TAKE_HALF = 7;
const TAKE_REACH = 16;

/**
 * The game's item numbers (Link +0xC10; LSTI draws `enemy_both2` 64 + item): 1 Pegasus Boots, 2 lamp, 3 boomerang,
 * 4 bow, 5 hammer, 6 Fire Rod, 7 Roc's Feather, 8 bombs, 9 shovel, 10 slingshot, 11 the Four Sword. The sim's own
 * kinds for the ones it has.
 */
export const GAME_ITEMS: Readonly<Record<number, ItemKind>> = { 1: "boots", 3: "boomerang", 4: "bow", 5: "hammer", 6: "fireRod", 8: "bomb", 10: "slingshot", 11: "fourSword" };
/** CRGN params bit 5 + k selects game item MASK_ITEMS[k] (tables 0x80465000 and 0x80465058). */
export const MASK_ITEMS = [10, 3, 4, 8, 6, 5, 7, 1, 9, 2, 11] as const;
/** The multiplayer roulette (0x804717F4): 2 carrot, 3 cucco, 5 bombchus. */
export const ROULETTE = [2, 3, 5, 3, 5, 3, 5] as const;
const ROULETTE_ITEMS: Readonly<Record<number, ItemKind>> = { 2: "carrot", 3: "cucco", 5: "bombchu" };

/** The items a generator's mask selects, as the sim has them (in the game's order; an empty mask: the slingshot). */
export function maskItems(params: number): ItemKind[] {
  const picked = MASK_ITEMS.filter((_, k) => (params >>> (5 + k)) & 1);
  return (picked.length ? picked : [10]).flatMap((n) => GAME_ITEMS[n] ?? []);
}

/** What a kind-1 orb can hold: the roulette's entries the sim has, each as often as in the table. */
export const ORB_ITEMS: readonly ItemKind[] = ROULETTE.flatMap((n) => ROULETTE_ITEMS[n] ?? []);

export const ORB_HALF = 7; // orb and pickup touch boxes, half size in px
const PICKUP_HALF = 6;

const pick = (b: BattleState, items: readonly ItemKind[]): ItemKind | "" => (items.length ? items[randomInt(b, items.length)]! : "");

/** What generator prop `home` makes now: an orb, or an item on the ground (kind 2, kind 3). */
export function spawnFromGenerator(b: BattleState, home: number): Entity | null {
  const prop = b.props.actors[home]!;
  const x = prop.x * 256, y = prop.y * 256;
  switch (generatorKind(prop)) {
    case 2: {
      const item = pick(b, maskItems(prop.params));
      if (item) return popItem(b, spawnEntity(b, "pickup", x, y, { home, item, timer: PICKUP_TICKS, param: randomInt(b, LEVEL2_ODDS) === 0 ? 2 : 1 }));
      b.respawn[home] = orbDelay(prop); // only items the sim doesn't have: nothing this time
      return null;
    }
    case 3:
      return popItem(b, spawnEntity(b, "pickup", x, y, { home, item: "carrot", timer: PICKUP_TICKS, param: 1 }));
    case 0:
      return dropOrb(b, spawnEntity(b, "orb", x, y, { home, item: pick(b, maskItems(prop.params)), timer: ORB_LIFETIME }));
    default:
      return spawnOrb(b, home);
  }
}

/** A new orb at generator prop `home`. */
export function spawnOrb(b: BattleState, home: number): Entity {
  const prop = b.props.actors[home]!;
  return dropOrb(b, spawnEntity(b, "orb", prop.x * 256, prop.y * 256, { home, item: pick(b, ORB_ITEMS), timer: ORB_LIFETIME }));
}

/** An item from a generator pops up (on a side-view screen it just lies there), pushed off a Link standing there. */
function popItem(b: BattleState, e: Entity): Entity {
  if (!sideViewAt(b, e.y)) Object.assign(e, { phase: "drop", z: PICKUP_POP.z, vz: PICKUP_POP.vz });
  return e;
}

/** A new orb drops into place (not on a side-view screen). `param` counts its landings. */
function dropOrb(b: BattleState, e: Entity): Entity {
  if (!sideViewAt(b, e.y)) Object.assign(e, { phase: "drop", z: ORB_DROP.z });
  return e;
}

/** Sixteen directions for the orb's drift (unit vectors × 256). */
const DRIFT = [
  [256, 0], [237, 98], [181, 181], [98, 237], [0, 256], [-98, 237], [-181, 181], [-237, 98],
  [-256, 0], [-237, -98], [-181, -181], [-98, -237], [0, -256], [98, -237], [181, -181], [237, -98],
] as const;

/** One tick of an orb dropping or an item popping up; they're taken, lifted and pushed only once down. */
function stepDrop(b: BattleState, e: Entity): void {
  if (e.kind === "pickup") {
    e.z += e.vz;
    e.vz -= PICKUP_POP.gravity;
    if (e.z <= 0) [e.z, e.vz] = [0, 0];
    if (e.z === 0) setPhase(e, "rest");
    return;
  }
  e.vz -= ORB_DROP.gravity;
  e.z += e.vz;
  e.x += e.vx;
  e.y += e.vy;
  if (e.z > 0) return;
  if (e.param === 0) {
    // The bounce, drifting.
    e.param = 1;
    e.vz = ORB_DROP.bounce;
    const [dx, dy] = DRIFT[randomInt(b, DRIFT.length)]!;
    e.vx = Math.trunc((dx * ORB_DROP.drift) / 256);
    e.vy = Math.trunc((dy * ORB_DROP.drift) / 256);
    return;
  }
  Object.assign(e, { z: 0, vz: 0, vx: 0, vy: 0, param: 0 });
  setPhase(e, "rest");
}

/** Bodies an item on the ground is pushed off: ±7 px each (traced: it ends 14 px from the Link). */
const PUSH_OFF = 14 * SUBPX;
/** An item lying on a Link's body moves off it by half the overlap, rounded up to a whole px (traced: 7, then 4, 2, 1). */
function pushOff(state: GameState, e: Entity): void {
  const b = state.battle!;
  state.players.forEach((p, i) => {
    const f = b.fighters[i]!;
    if (f.hearts <= 0 || !onGround(f)) return;
    const dx = e.x - p.x, dy = e.y - p.y;
    if (Math.abs(dx) >= PUSH_OFF || Math.abs(dy) >= PUSH_OFF) return;
    const overX = PUSH_OFF - Math.abs(dx), overY = PUSH_OFF - Math.abs(dy);
    const step = (over: number) => Math.ceil(over / 2 / SUBPX) * SUBPX;
    // Along the axis it overlaps least; straight up from a Link on its spot (traced).
    if (overY <= overX) e.y += dy > 0 ? step(overY) : -step(overY);
    else e.x += dx > 0 ? step(overX) : -step(overX);
  });
}

/**
 * CRGN (update 0x80129598), one tick: `b.respawn[k]` > 0 counts down to its next orb or item (only while its switch,
 * params >> 27, is on), 0 watches the one it made. Once that's gone it counts again from its full delay. The game
 * updates it before what it made, so it notices a loss on the next frame: here what went this tick is still in the
 * entity list (marked removed until the arena's sweep), so it notices on the next tick too, and the next one comes
 * delay + 1 ticks after (measured: an item taken on frame F, the generator restarts on F + 1, the next item on F + 301).
 */
export function stepOrbGenerator(b: BattleState, k: number, prop: Prop, gateOn: boolean): void {
  if (b.respawn[k] === 0) {
    if (!b.entities.some((e) => e.home === k && (e.kind === "orb" || e.kind === "pickup"))) b.respawn[k] = orbDelay(prop);
    return;
  }
  if (gateOn && --b.respawn[k]! === 0) spawnFromGenerator(b, k);
}

/**
 * Breaks an orb (flying at (vx, vy) when it broke: a throw): its item drops where it was (its generator notices it's
 * gone); bombchus run out of it instead (CRTL 0x80320374, its bombchu branch 0x803208C0): on the ground one along the
 * throw, and two more fanning out (x0.7 along, x0.7 across) from a throw straight along an axis; in side view one
 * along the throw, or either way at 2.5 px/tick. TODO(measure): an orb broken where it lay (by a sword or a blast: the
 * game's only break when thrown or dropped) lets out one at a random angle here.
 */
export function breakOrb(b: BattleState, e: Entity, vx = 0, vy = 0): void {
  removeEntity(e);
  spawnEntity(b, "debris", e.x, e.y, { param: 2, timer: 16 });
  if (e.item === "bombchu") {
    const owner = e.owner;
    if (sideViewAt(b, e.y)) spawnBombchu(b, e.x, e.y, BOMBCHU_KIND.orb, vx || (randomInt(b, 2) ? BOMBCHU_SPEED : -BOMBCHU_SPEED), 0, owner);
    else if (!vx && !vy) spawnBombchu(b, e.x, e.y, BOMBCHU_KIND.anyway, undefined, undefined, owner);
    else {
      spawnBombchu(b, e.x, e.y, BOMBCHU_KIND.orb, vx, vy, owner);
      const s = (v: number) => Math.trunc((v * 7) / 10);
      if (!vx) for (const side of [1, -1]) spawnBombchu(b, e.x, e.y, BOMBCHU_KIND.fan, side * s(vy), s(vy), owner);
      else if (!vy) for (const side of [1, -1]) spawnBombchu(b, e.x, e.y, BOMBCHU_KIND.fan, s(vx), side * s(vx), owner);
    }
  } else if (e.item === "cucco") {
    // Out it flies on the way the orb flew, after a rival (items.ts stepCucco; traced).
    spawnCucco(b, e.x, e.y, e.owner, vx, vy);
  } else if (e.item) spawnEntity(b, "pickup", e.x, e.y, { item: e.item, timer: PICKUP_TICKS });
}

/**
 * Gives a fighter an item at a level (replacing the one he had); a heart heals one heart at once instead, the Four Sword
 * levels his sword up.
 */
export function giveItem(f: Fighter, item: ItemKind, b?: BattleState, level = 1): void {
  if (item === "heart") {
    f.hearts = Math.min(b ? b.rules.hearts * HEART : f.hearts + HEART, f.hearts + HEART);
    return;
  }
  if (item === "fourSword") {
    f.swordLevel = 2;
    return;
  }
  f.item = item;
  f.itemLevel = level;
  f.itemTimer = 0;
}

/** An item a Link takes with the Action button (a generator's: its level in `param`), not by touching it. */
export const takenByHand = (e: Entity) => e.kind === "pickup" && e.param > 0;

/** The item on the ground Link `i` would take with the Action button, if any. */
export function takeTarget(state: GameState, i: number): Entity | undefined {
  const b = state.battle!, p = state.players[i]!;
  const [sx, sy] = FACING_STEP[p.facing];
  const x = Math.floor(p.x / SUBPX) + sx * TAKE_REACH, y = Math.floor(p.y / SUBPX) + sy * TAKE_REACH;
  return b.entities.find((e) => takenByHand(e) && e.phase === "rest" && !isRemoved(e) && pointInBox(x, y, boxAround(e.x, e.y, TAKE_HALF, TAKE_HALF)));
}

/** The Action button with an item in front: it's his (gone at once), and the "take" move plays. */
export function tryTake(state: GameState, i: number): boolean {
  const e = takeTarget(state, i);
  if (!e) return false;
  const b = state.battle!, f = b.fighters[i]!;
  removeEntity(e);
  stopActing(state.players[i]!);
  f.move = "take";
  f.moveTick = -1;
  f.carryEntity = 0;
  // (The item rides in the move: its kind's index and level, given on TAKE_GIVE_TICK.)
  f.shot = TAKEN.indexOf(e.item as ItemKind) * 4 + e.param;
  return true;
}
const TAKEN: readonly ItemKind[] = ["bomb", "bow", "boomerang", "slingshot", "cucco", "carrot", "fourSword", "heart"];

/** The "take" move: frozen, the item his on TAKE_GIVE_TICK, free after TAKE_TICKS (then turned as the stick says). */
export function stepTake(state: GameState, i: number, buttons: number): boolean {
  const b = state.battle!, p = state.players[i]!, f = b.fighters[i]!;
  if (f.move !== "take") return false;
  p.held = buttons;
  f.moveTick++;
  if (f.moveTick === TAKE_GIVE_TICK) {
    const item = TAKEN[f.shot >> 2];
    if (item) giveItem(f, item, b, f.shot & 3 || 1);
    makeInvincible(f, TAKE_INVINCIBLE, 0);
  } else if (f.moveTick >= TAKE_TICKS) {
    f.move = "none";
    f.moveTick = 0;
    f.shot = -1;
    p.facing = nextFacing(p.facing, buttons);
  }
  return true;
}
/** The invincibility on getting it: 60, blinking at once, the count starting the tick after (traced). */
const TAKE_INVINCIBLE = 61;

/** Below this height a popping item is pushed off a Link already (traced: at 3.1 px, not at 6.7). */
const PUSH_HEIGHT = 4 * SUBPX;

/**
 * Orbs drop into place, and nobody lifting them makes them time out; items pop up, time out, and are pushed off the
 * Links standing on them; an orb's content lying there is taken by the first Link on the ground to touch it (their
 * generators notice by themselves). Runs after the generators, so a new orb or item counts its first tick.
 */
export function stepPickups(state: GameState): void {
  const b = state.battle!;
  for (const e of b.entities) {
    if (isRemoved(e) || (e.kind !== "orb" && e.kind !== "pickup")) continue;
    // It shows where it appeared on its first tick (traced: z 13, then 15.7).
    const first = e.tick === 0 && e.home >= 0;
    if (e.phase === "drop" && e.tick++ > 0) stepDrop(b, e);
    if (e.kind === "orb") {
      if ((e.phase === "rest" || e.phase === "drop") && e.timer > 0 && --e.timer === 0) removeEntity(e);
      continue;
    }
    if (e.phase !== "rest" && e.phase !== "drop") continue;
    if (--e.timer <= 0) {
      removeEntity(e);
      continue;
    }
    if (first || e.z < PUSH_HEIGHT) pushOff(state, e);
    if (e.phase !== "rest" || takenByHand(e)) continue;
    const box = boxAround(e.x, e.y, PICKUP_HALF);
    const taker = b.fighters.findIndex(
      (f, i) => f.mode === "active" && onGround(f) && f.move !== "ride" && f.hearts > 0 && boxesOverlap(box, hurtbox(state.players[i]!)),
    );
    if (taker < 0) continue;
    // An orb's content taken on a GBA screen: the TV tells everyone (messages.ts).
    if (e.home < 0 && screenAt(e.y) > 0) askMessage(state, MESSAGE.crystalBall, taker);
    if (e.item === "carrot") startRide(state.players[taker]!, b.fighters[taker]!); // (Epona, at once: traced)
    else giveItem(b.fighters[taker]!, e.item as ItemKind, b);
    removeEntity(e);
  }
}
