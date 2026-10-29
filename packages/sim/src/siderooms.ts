// The GBA-screen side rooms (docs/formats/side-rooms.md "Side rooms (GBA screens)"): The Field's house and cave, the Tower of
// Flames' rooms behind its doors, the Tower of Winds' gallery, Hyrule Castle's dark side, the room under Above the
// Clouds' hole. Each is a sublayer 1-7 of the arena's room, with tile layers and actors of its own, and shows on the GBA
// of whoever is inside. The game keeps them as screens 8-14 of the room (an actor's screen = 7 + its sublayer), with
// coordinates of their own; WARP actors (doors, holes) move a Link from one screen to another. The room's 32 switches
// are shared: a switch stood on in a side room drives the TV's hazards, and the other way round.
// The sim lays each side room out in the arena's world below the arena, sublayer k at y + k × SIDE_ROOM_STRIDE (its own
// 32 tile rows; arena.ts builds the collision, props.ts places its actors), so everything spatial (walls, hits, blasts,
// switches, pickups) keeps to one room by itself, and a Link's screen is just where he is (screenAt).
// Door warps measured in Dolphin (docs/measurements/side-rooms.md "Side rooms"; The Field's house, the Tower of Flames' north room):
// once a Link's ±7 px body meets a door's box, he walks into the door 0.5 px a tick for 40 ticks, comes out of the
// other one, stands 30 ticks, walks 0.5 px a tick for 40 more, and has control back on the next tick. Hyrule Castle's
// dark side is reached through its magic circles (takeIntoCircle), for 10 s or until he steps on the spot in its middle.
// Side view (the screens whose layers have a "background" tile: the Tower of Winds' TV and gallery, the rooms under the
// holes) is the top-down game with gravity, as traced on the Tower of Winds: Links fall 4 px a tick with nothing under
// them (knocked back or not), Up and Down climb ladders and otherwise only turn them, things fall 0.15 px a tick², a
// throw's height becomes screen y; its gates take a Link on a press of Up.
import { stepLink } from "./actions.ts";
import type { BattleState } from "./battle.ts";
import { AWAY, HURTBOX, stopActing, type Fighter, type Move } from "./combat.ts";
import { FACING_STEP, removeEntity, tileIndexAt, type Entity } from "./entities.ts";
import type { GameState } from "./game.ts";
import { Button, moveAxis, nextFacing, SUBPX, WALK_SPEED, WALK_SPEED_DIAGONAL, type Facing, type PlayerState } from "./player.ts";
import { switchOn } from "./switches.ts";
import { isSolidAt, surfaceAt, type World } from "./world.ts";

/** px between side rooms in the world: a sublayer's 32 tile rows (the arena itself is rows 0-23 of the first 32). */
export const SIDE_ROOM_STRIDE = 512;
/** Side rooms the world has room for (the 10 × 10-room battle world is 3840 px tall; boss500 uses sublayers 1-5). */
export const MAX_SIDE_ROOM = 6;

/** The screen a world y (1/256 px) is on: 0 = the TV (the arena), k = sublayer k's side room. */
export const screenAt = (y: number): number => Math.max(0, Math.floor(y / (SIDE_ROOM_STRIDE * SUBPX)));
/** Are two Links (or a Link and a thing) on the same screen? */
export const sameScreen = (a: { y: number }, b: { y: number }): boolean => screenAt(a.y) === screenAt(b.y);
/** Where sublayer k's side room starts in the world (px). */
export const sideRoomY = (sublayer: number): number => sublayer * SIDE_ROOM_STRIDE;

/** A door or hole between two screens (main.dol WARP, init 0x80228B60, update 0x80227F50, the Link's 0x80290070). */
export interface Warp {
  /** Its anchor, world px: its tile's center (the init moves the actor 8 px right and down). */
  x: number;
  y: number;
  /** Its box around the anchor, 1/256 px (inclusive; the style's, init 0x802290A8). */
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** Where a Link comes out, world px. */
  toX: number;
  toY: number;
  /** params & 0x7F: how a Link goes through (0 up a door, 1 down a door, 4 a hole, 6 a spot, 21 a side-view gate…). */
  style: number;
  /** The switch it waits for (params >> 27), 0 = none. */
  gate: number;
}

/** A raw WARP actor: sublayer, position (px in its sublayer, as listed) and params. */
export interface WarpActor {
  sublayer: number;
  x: number;
  y: number;
  params: number;
}

/** Door walks (state 28, then 29 on the other side): measured on styles 0 and 1. */
export const WARP_ENTER_TICKS = 40; // walking in; out of the other door on the 40th
export const WARP_STAND_TICKS = 30; // standing in the doorway
export const WARP_WALK_TICKS = 40; // walking out
export const WARP_TICKS = WARP_ENTER_TICKS + WARP_STAND_TICKS + WARP_WALK_TICKS; // 110: control again on the 111th
export const WARP_STEP = SUBPX / 2; // 0.5 px a tick
/** The walk animation runs at 2 ticks a frame through a door (measured: frames 16, 17, 17, 18, 18…). */
export const WARP_FRAME_TICKS = 2;

/** A style's box (px around the anchor: left, top, right, bottom), init 0x802290A8. */
function styleBox(style: number, screen: number, sideView: boolean): readonly [number, number, number, number] {
  switch (style) {
    case 0:
    case 3:
      return [-4, -20, 4, 4]; // a door you walk up into
    case 1:
      return [-4, -4, 4, 20]; // …or down into
    case 4:
      return [-1, -1, 1, 1]; // a hole
    case 6:
      return [-0.01, -0.01, 0.01, 0.01];
    case 11:
      return [-8, -8, 8, 8];
    case 15:
    case 22:
      return [-24, -8, 24, 8];
    case 19:
      return [-256, -8, 256, 8]; // the top of a side-view room
    case 21:
      // A gate: on a side-view screen ±4, else up (TV) or down (a GBA screen) into it; 35 the other way round.
      return sideView ? [-4, -4, 4, 4] : screen > 0 ? [-4, -4, 4, 20] : [-4, -20, 4, 4];
    case 35:
      return sideView ? [-4, -4, 4, 4] : screen > 0 ? [-4, -20, 4, 4] : [-4, -4, 4, 20];
    case 32:
      return [-10, -10, 10, 10];
    case 40:
      return [-7, -7, 7, 7];
    default:
      return [-4, -4, 4, 4];
  }
}

/** The style a WARP of style 25-28 turns into, and the one of the warp it adds at its destination (the way back). */
const PAIRED: Readonly<Record<number, readonly [number, number]>> = { 25: [0, 1], 26: [2, 3], 27: [0x17, 0x18], 28: [0x18, 0x17] };

/**
 * Every warp of a room, decoded as the game's WARP init does (0x80228B60): destination screen (params >> 24) & 7 (0 = the
 * TV), destination ((params >> 16) & 0x3F, (params >> 8) & 0x3F) in 8 px units, style params & 0x7F, gate params >> 27;
 * styles 4, 6, 32 and 36 with no destination lead to the same spot of the other screen; styles 25-28 add the way back
 * (a warp at their destination leading to them: The Field's house and cave doors). Unless bit 7 is set the warp sits on
 * its tile's center (+8 px) and so does where it leads. `sideView(sublayer)` tells side-view screens (style 21's box).
 */
export function decodeWarps(actors: readonly WarpActor[], sideView: (sublayer: number) => boolean = () => false): Warp[] {
  const raw: WarpActor[] = [];
  for (const a of actors) {
    const p = a.params >>> 0, style = p & 0x7f;
    const pair = PAIRED[style];
    if (!pair) {
      raw.push(a);
      continue;
    }
    // The way back: at this one's destination (not yet moved to its tile's center), leading here.
    const to = (p >>> 24) & 7, tx = ((p >>> 16) & 0x3f) * 8, ty = ((p >>> 8) & 0x3f) * 8;
    const back = (p & 0xf8000000) | ((a.sublayer & 7) << 24) | (((a.x / 8) & 0x3f) << 16) | (((a.y / 8) & 0x3f) << 8) | (p & 0x80) | pair[1];
    raw.push({ ...a, params: ((p & ~0x7f) | pair[0]) >>> 0 });
    raw.push({ sublayer: to, x: tx, y: ty, params: back >>> 0 });
  }
  return raw.flatMap((a) => {
    if (a.sublayer > MAX_SIDE_ROOM) return [];
    const p = a.params >>> 0, style = p & 0x7f, centered = ((p >>> 7) & 1) === 0;
    const to = (p >>> 24) & 7;
    let tx = ((p >>> 16) & 0x3f) * 8, ty = ((p >>> 8) & 0x3f) * 8;
    if ((style === 4 || style === 6 || style === 32 || style === 36) && tx === 0 && ty === 0) [tx, ty] = [a.x, a.y];
    if (to > MAX_SIDE_ROOM) return [];
    const off = centered && style !== 32 ? 8 : 0;
    const at = centered && ![11, 30, 31, 32].includes(style) ? 8 : 0;
    const [l, t, r, b] = styleBox(style, a.sublayer, sideView(a.sublayer));
    return [
      {
        x: a.x + at,
        y: sideRoomY(a.sublayer) + a.y + at,
        left: Math.round(l * SUBPX),
        top: Math.round(t * SUBPX),
        right: Math.round(r * SUBPX),
        bottom: Math.round(b * SUBPX),
        toX: tx + off,
        toY: sideRoomY(to) + ty + off,
        style,
        gate: p >>> 27,
      },
    ];
  });
}

/**
 * Styles a Link walks through (state 28 and 29): the doors (3: the top of a side-view room's ladder). Holes are style 4;
 * style 19 (a side-view room's top edge) takes only a Link shot from a cannon (stepLaunch); style 6 is Hyrule Castle's
 * way back from its dark side (SPOT_STYLE); 21 and 35 are the Tower of Winds' gates (GATE_STYLES).
 */
export const DOOR_STYLES: ReadonlySet<number> = new Set([0, 1, 2, 3]);
export const HOLE_STYLE = 4;
const EDGE_STYLE = 19;
/**
 * The gates (`SVGT` beside a WARP of style 21: the Tower of Winds' four, on its TV and in its gallery, both side view).
 * Measured (docs/measurements/side-rooms.md "Side rooms") and read (0x802278A8): walking past one does nothing; a new press of Up
 * or Down (this tick or the last) while his body meets its ±4 px box takes him, no latch; state 28 as at a door: lined
 * up on its x, facing up (from the TV; down from a GBA screen), 40 ticks walking into it at 1/32 px a tick, on the
 * other screen's gate on the 40th, 1.25 px back on the 41st, 30 ticks standing, 40 walking onto the spot, free on the
 * 111th, facing the same way.
 */
export const GATE_STYLES: ReadonlySet<number> = new Set([21, 35]);
export const GATE_STEP = SUBPX / 32;

/**
 * A hole (style 4, measured: Above the Clouds' middle, the Tower of Flames' side pits): the Link is moved onto it and
 * falls in (the pit's fall, 58 ticks, no life lost); on the 59th he's at its destination in the side room, standing 60
 * ticks; then he falls on in the side view.
 */
export const HOLE_FALL_TICKS = 58;
export const HOLE_ARRIVE_TICKS = 60;
export const HOLE_TICKS = HOLE_FALL_TICKS + 1 + HOLE_ARRIVE_TICKS; // 119: on his own on the 120th

/** Side view (measured: the Tower of Winds' TV screen, the rooms under the holes): falling 4 px a tick, no speed-up. */
export const SIDE_FALL_SPEED = 4 * SUBPX;
/** Climbing a ladder, up or down: walking speed (measured on the Tower of Winds' TV, both ways), facing up or down. */
export const CLIMB_SPEED = WALK_SPEED;

/**
 * A cannon (`CNON`, measured under Above the Clouds' hole and in the Tower of Flames' basement): a Link falling onto it
 * gets in (state 76) and rides it 16 px over its anchor; one with params & 15 = 1 then patrols ((params >> 8) & 15) ×
 * 8 px either side of where it stood at 1 px a tick (the game eases at the ends: not modelled); the GBA's A (Item here)
 * fires it, or it fires by itself 300 ticks after he got in.
 */
export const CANNON_RIDE = 16;
export const CANNON_CATCH = 12; // px over its anchor where a falling Link gets in
export const CANNON_REACH = 8; // px either side
export const CANNON_SPEED = SUBPX;
export const CANNON_FUSE = 300;
/** The shot (state 77): up 13 px on the first tick, 0.25 px less each tick (measured: 13, 12.75, 12.5 … 11). */
export const SHOT_SPEED = 13 * SUBPX;
export const SHOT_SLOWING = SUBPX / 4;
/**
 * Over the side room's top edge (style 19) the Link is gone; on the TV over the hole 18 ticks after it took him, hidden
 * 59 ticks more, then up out of it (measured: z 1.3 px, then +10 px a tick, 0.25 less each tick, falling at most 6 px a
 * tick: a 206 px climb, back down 85 ticks after showing). With no steering he falls back into the hole (measured);
 * steering is walking speed here. TODO(measure): the game's steering in the air.
 */
export const LAUNCH_TV_TICK = 18;
export const LAUNCH_SHOW_TICK = 77;
export const LAUNCH_Z = 333; // 1.3 px
export const LAUNCH_VZ = 10 * SUBPX;
export const LAUNCH_GRAVITY = SUBPX / 4;
export const LAUNCH_FALL_MAX = 6 * SUBPX;

/** Does a Link's body (±7 px, the game's +0x4C0 box) meet the warp's box grown by `grow` (1/256 px)? Inclusive. */
export function inWarp(p: PlayerState, w: Warp, grow = 0): boolean {
  const x = w.x * SUBPX, y = w.y * SUBPX;
  return (
    p.x + HURTBOX.right * SUBPX >= x + w.left - grow &&
    p.x + HURTBOX.left * SUBPX <= x + w.right + grow &&
    p.y + HURTBOX.bottom * SUBPX >= y + w.top - grow &&
    p.y + HURTBOX.top * SUBPX <= y + w.bottom + grow
  );
}

/** Can this Link go through a door now: on his feet and in control, his sword idle (a load in his hands he drops). */
function canWarp(p: PlayerState, f: Fighter): boolean {
  return f.hearts > 0 && f.mode === "active" && (f.move === "none" || f.move === "carry") && f.z === 0 && p.action === "none";
}

/**
 * Does a Link drop into a hole now: on the ground (walking, carrying, swinging; or landing from a knockback or a
 * throw: the hole's tile is no pit in the sim, so every way onto it must lead in).
 */
function canFall(f: Fighter): boolean {
  if (f.hearts <= 0) return false;
  if (f.move === "launch") return launchFlying(f); // (measured: back into the hole 5.3 px up)
  if (f.z !== 0) return false;
  if (f.mode === "hurt" || f.mode === "stunned") return true;
  return f.mode === "active" && f.move !== "held" && !AWAY.has(f.move) && !(f.move === "thrown" && f.vz !== 0);
}

/**
 * The warps, after every Link moved this tick (the game's WARP update runs once the players have moved): a Link whose
 * body meets a door goes through it from the next tick (stepWarp). A Link keeps a latch on each warp he was inside of
 * while going through one (arriving in a doorway doesn't send him back) until he's more than 1 px out of its box.
 * Warps are visited in their list order, the players in theirs, as the game does. `pressed`: each player's new presses
 * this tick (a gate wants Up or Down pressed on this tick or the last: 0x802278A8, which skips the latch for gates).
 */
export function stepWarps(state: GameState, pressed: readonly number[] = []): void {
  const b = state.battle!;
  const warps = b.props.warps ?? [];
  const press = (i: number) => ((pressed[i] ?? 0) | b.fighters[i]!.pressed) & (Button.Up | Button.Down);
  warps.forEach((w, k) => {
    if (k >= 32 || (w.gate && !switchOn(b, w.gate))) return; // (a latch is a bit of a u32)
    const bit = 1 << k;
    state.players.forEach((p, i) => {
      const f = b.fighters[i]!;
      // Over 8 px up (the game's z test) he's out of every box: a Link shot out of a hole isn't latched on it.
      const high = f.z > 8 * SUBPX;
      if (high || !inWarp(p, w)) {
        if (f.warpLatch & bit && (high || !inWarp(p, w, SUBPX))) f.warpLatch &= ~bit;
        return;
      }
      if (AWAY.has(f.move) && !launchFlying(f)) {
        f.warpLatch |= bit;
        return;
      }
      if (GATE_STYLES.has(w.style)) {
        if (canWarp(p, f) && (!sideViewAt(b, p.y) || press(i))) startWarp(p, f, k, w.style);
        return;
      }
      if (f.warpLatch & bit) return;
      if (w.style === HOLE_STYLE) {
        if (canFall(f)) startHole(p, f, k, w);
      } else if (DOOR_STYLES.has(w.style) && canWarp(p, f)) startWarp(p, f, k, w.style);
      else if (w.style === SPOT_STYLE && canWarp(p, f)) startSpot(p, f, k, w);
    });
  });
  b.fighters.forEach((f, i) => (f.pressed = (pressed[i] ?? 0) & (Button.Up | Button.Down | Button.Left | Button.Right)));
  stepDarkTimers(state);
  openDoors(state);
}

// --- things through doors and holes ---

/**
 * What a warp takes besides the Links (WARP update 0x80227F50, measured in Dolphin: docs/measurements/battle-open-items.md "Things through
 * doors and holes"): holes (styles 4, 32, 36) take bombs, boomerangs, pots and bushes (the list at 0x8046AC2C); the
 * other styles, doors among them, also arrows and seeds (0x8046ABE8). Each warp takes at most one thing a tick, the
 * first in the list.
 */
const THROUGH_DOORS: ReadonlySet<Entity["kind"]> = new Set(["arrow", "bomb", "boomerang", "pot", "bush", "seed"]);
const THROUGH_HOLES: ReadonlySet<Entity["kind"]> = new Set(["bomb", "boomerang", "pot", "bush"]);
const HOLE_STYLES: ReadonlySet<number> = new Set([HOLE_STYLE, 32, 36]);
/** Their boxes (+0x60, traced): an arrow ±2, a seed ±8, a boomerang ±8, a thrown bomb ±13, a pot ±8, a bush ±4. */
const THING_HALF: Partial<Record<Entity["kind"], number>> = { arrow: 2, seed: 8, boomerang: 8, bomb: 13, pot: 8, bush: 4 };
/** Loads (HBMB, TUBO, GRAS) go only while moving over 1 px a tick (the length of their velocity, height included). */
const LOADS: ReadonlySet<Entity["kind"]> = new Set(["bomb", "pot", "bush"]);
/** A seed and a boomerang (PCDM, BOME) keep their offset from the warp; the rest come out right on its destination. */
const KEEP_OFFSET: ReadonlySet<Entity["kind"]> = new Set(["seed", "boomerang"]);
/** Over 32 px above a warp nothing goes through it (0x80227290's 32.0; not on side-view screens). */
const THING_WARP_HEIGHT = 32 * SUBPX;
/** Into a hole: loads at most 4 px up, the boomerang on the ground. */
const HOLE_HEIGHT = 4 * SUBPX;
/**
 * Once through, another warp waits 20 ticks or until it's 40 px from where it came out (the actor's +0x180 / +0x184,
 * read in the pending move 0x801F33C4; traced: a bomb under Above the Clouds' hole sat in the room's top edge 20 ticks
 * before that took it); the boomerang 60 ticks or 80 px (0x8016A068).
 */
export const THING_WARP_TICKS = 20;
const THING_WARP_REACH = 40;
const BOOMERANG_WARP_TICKS = 60;
const BOOMERANG_WARP_REACH = 80;

/** How high a shot is for the warps: arrows, boomerangs and drawn seeds fly on the ground, a quick seed arcs
 *  (projectiles.ts seedArc, in its height). */
function shotHeight(e: Entity): number {
  return e.kind === "seed" ? e.z : 0;
}

/** Is a thing moving into the door's way: up into styles 0, 3, 21 and 35, down into 1 and 2, right 23, left 24? */
function intoDoor(style: number, vx: number, vy: number): boolean {
  if (style === 0 || style === 3 || style === 21 || style === 35) return vy < 0;
  if (style === 1 || style === 2) return vy > 0;
  if (style === 23) return vx > 0;
  if (style === 24) return vx < 0;
  return true;
}

/** Does the warp's box meet a thing's (0x80227290: the thing's box top is raised by its height, its bottom by half)? */
function thingInWarp(w: Warp, e: Entity, z: number): boolean {
  const h = (THING_HALF[e.kind] ?? 4) * SUBPX, wx = w.x * SUBPX, wy = w.y * SUBPX;
  return e.x + h >= wx + w.left && e.x - h <= wx + w.right && e.y + h - (z >> 1) >= wy + w.top && e.y - h - z <= wy + w.bottom;
}

/**
 * Things thrown, shot or kicked into a door or a hole come out of the other side (measured: an arrow, a seed, a
 * boomerang and a thrown bomb up into The Field's house; a pot thrown into the Tower of Flames' north door; a bomb
 * thrown into Above the Clouds' hole, and back up the room's top edge onto the TV, into the hole's pit). Run after the
 * Links moved (and threw) and before things fly (arenastep.ts): a warp looks at where they are, moves one onto its
 * destination keeping its speed and height (into a side-view room: on the ground plane, its height dropped), and it
 * flies on from there this tick. A shot shows where it appeared first (its tick 0). A boomerang on its way back stays
 * (and finds its way back by itself: stepBoomerang); the house door is shut until a Link opens it.
 */
export function thingWarps(state: GameState): void {
  const b = state.battle!;
  const warps = b.props.warps ?? [];
  for (const e of b.entities) {
    if (e.warpTicks <= 0) continue;
    const reach = (e.kind === "boomerang" ? BOOMERANG_WARP_REACH : THING_WARP_REACH) * SUBPX;
    const dx = e.x - e.warpX, dy = e.y - e.warpY;
    e.warpTicks = dx * dx + dy * dy >= reach * reach ? 0 : e.warpTicks - 1;
  }
  if (!warps.length) return;
  warps.forEach((w) => {
    if (w.gate && !switchOn(b, w.gate)) return;
    if (w.style === SPOT_STYLE || w.style === 11 || w.style === 20) return; // (HNRY and ESRY only: none here)
    const hole = HOLE_STYLES.has(w.style), kinds = hole ? THROUGH_HOLES : THROUGH_DOORS;
    const screen = screenAt(w.y * SUBPX), side = sideViewAt(b, w.y * SUBPX);
    // (A shut door: The Field's house until a Link opens it, its tiles 0x19C/0x19D under the warp: 0x80226850.)
    const tile = tileIndexAt(w.x, w.y - sideRoomY(screen));
    if (screen === 0 && b.props.doors?.includes(tile) && !b.cut.includes(tile)) return;
    const e = b.entities.find((e) => {
      if (e.hp < 0 || !kinds.has(e.kind) || e.warpTicks > 0 || screenAt(e.y) !== screen) return false;
      const shot = e.kind === "arrow" || e.kind === "seed" || e.kind === "boomerang";
      if (e.phase !== "flying" || (shot && e.tick === 0)) return false;
      const z = shot ? shotHeight(e) : e.z;
      if (!side && Math.abs(z) > THING_WARP_HEIGHT) return false;
      if (hole && z > (e.kind === "boomerang" ? 0 : HOLE_HEIGHT)) return false;
      if (LOADS.has(e.kind) && e.vx * e.vx + e.vy * e.vy + e.vz * e.vz <= SUBPX * SUBPX) return false;
      const [vx, vy] = e.kind === "boomerang" ? FACING_STEP[e.facing] : [e.vx, e.vy];
      return (hole || intoDoor(w.style, vx, vy)) && thingInWarp(w, e, z);
    });
    if (!e) return;
    const [ox, oy] = KEEP_OFFSET.has(e.kind) ? [e.x - w.x * SUBPX, e.y - w.y * SUBPX] : [0, 0];
    if (e.kind === "boomerang") [e.homeX, e.homeY] = [e.x, e.y]; // (where it went in: its way back, stepBoomerang)
    [e.x, e.y] = [w.toX * SUBPX + ox, w.toY * SUBPX + oy];
    const boomerang = e.kind === "boomerang";
    [e.warpX, e.warpY, e.warpTicks] = [e.x, e.y, boomerang ? BOOMERANG_WARP_TICKS : THING_WARP_TICKS];
    // Into a side view: on its plane, its height dropped, its speed up the screen kept for this tick's step (traced: a
    // bomb 3 px up at 1.8 px a tick, 6.2 px down the room's top, then 1.65 up: fallStep adds gravity before it moves).
    if (sideViewAt(b, e.y)) [e.z, e.vz, e.vy] = [0, 0, e.vy - SIDE_GRAVITY];
    else if (w.style === EDGE_STYLE && LOADS.has(e.kind)) removeEntity(e); // (traced: on the TV it falls into the hole)
  });
}

/** How far over a Link's anchor the tile he opens is (px). */
const DOOR_REACH = 10;

/**
 * The round's tick from which the house door opens (traced from the round-start state: a Link walking into it from
 * frame 48 stood until the game's 58th, then walked on, pushing or not; from frame 90 on it opened as he touched it).
 * The game's door test asks whether some player's GBA is busy (0x8029E58C: three calls per player), as they are while
 * the round starts; later busy spells (a GBA screen's own business) aren't modelled.
 */
export const DOOR_LOCKED_TICKS = 48;

/**
 * The Field's house door (props.ts DOOR_TILES): a Link facing up with one of its halves 10 px over him opens both for
 * good at once, walking, pushing or standing (main.dol: every tick the Link's update 0x8028860C passes his (x, y − 10)
 * to 0x8029E508, which rewrites a 0x19C / 0x19D there into the open door 0x19E / 0x19F, JA_SE_OBJ_DOOR_OPEN, unless a
 * GBA is busy; nothing shuts it again), but not while the round is starting (`DOOR_LOCKED_TICKS`). Its tiles then count
 * as cut: drawn open (arenatiles.ts), and only the doorway between the door's posts is walked through (entities.ts
 * battleWorld; traced: walking up at x 242 he pushes the open door's post for good).
 */
function openDoors(state: GameState): void {
  const b = state.battle!, doors = b.props.doors;
  if (!doors?.length || b.phaseTick < DOOR_LOCKED_TICKS) return;
  state.players.forEach((p, i) => {
    const f = b.fighters[i]!;
    if (p.facing !== "up" || f.hearts <= 0) return;
    const tile = tileIndexAt(Math.floor(p.x / SUBPX), Math.floor(p.y / SUBPX) - DOOR_REACH);
    if (!doors.includes(tile) || b.cut.includes(tile)) return;
    for (const half of [tile - 1, tile, tile + 1]) if (doors.includes(half) && !b.cut.includes(half)) b.cut.push(half);
    Object.assign(f.push, { on: false, ticks: 0 });
  });
}

/**
 * The way a door is walked through: up into a style 0 or 3 door, down into a style 1. TODO(measure): the game's state 28
 * may walk along the facing instead (both are the same when the Link walked into the door, as traced); a Link backing
 * into a door sideways (a CPU steering round something) would come out of the other one into a wall that way.
 */
const DOOR_FACING: Readonly<Record<number, Facing>> = { 0: "up", 3: "up", 1: "down", 21: "up", 35: "up" };

function startWarp(p: PlayerState, f: Fighter, k: number, style: number): void {
  stopActing(p);
  p.facing = DOOR_FACING[style] ?? p.facing;
  // A gate is walked into facing up from the TV, down from a GBA screen, and out of the other one the same way
  // (0x80294ADC, 0x80294374: up into the gallery's, down out onto the TV).
  if (GATE_STYLES.has(style) && screenAt(p.y) > 0) p.facing = "down";
  // Into a hole from a knockback, a stun or a hop: he falls in all the same.
  if (f.mode !== "active") Object.assign(f, { mode: "active", modeTick: 0, pushX: 0, pushY: 0 });
  if (f.move === "thrown" || f.move === "launch") Object.assign(f, { thrower: -1, flyX: 0, flyY: 0, vz: 0, z: 0 });
  f.move = style === HOLE_STYLE ? "hole" : "warp"; // a load in his hands drops where he stands (carry.ts attachLoads)
  f.moveTick = 0;
  f.warp = k;
  f.warpLatch |= 1 << k;
}

/** Into a hole: onto its middle on the tick it takes him (measured: (760, 552) on that frame). */
function startHole(p: PlayerState, f: Fighter, k: number, w: Warp): void {
  startWarp(p, f, k, HOLE_STYLE);
  [p.x, p.y] = [w.x * SUBPX, w.y * SUBPX];
}

const STEPS: Readonly<Record<Facing, readonly [number, number]>> = { right: [1, 0], left: [-1, 0], down: [0, 1], up: [0, -1] };

/**
 * One tick of a Link going through a door (moves.ts; no control): lined up on the door (its x, or its y for styles 23
 * and 24) on the first tick, he walks 0.5 px a tick along his facing, through walls, for 39 ticks; on the 40th he's at
 * the other door; 30 ticks standing, 40 walking on, and he's free. Into a hole: onto it on the first tick, falling to
 * the 58th, in the side room on the 59th, standing to the 119th.
 */
export function stepWarp(state: GameState, i: number, buttons: number): boolean {
  const b = state.battle!, p = state.players[i]!, f = b.fighters[i]!;
  if (f.move !== "warp" && f.move !== "hole") return false;
  p.held = buttons;
  const w = b.props.warps?.[f.warp];
  const t = ++f.moveTick;
  if (!w) return endWarp(p, f), true;
  if (w.style === HOLE_STYLE) {
    p.moving = false;
    if (t === HOLE_FALL_TICKS + 1) [p.x, p.y, p.facing] = [w.toX * SUBPX, w.toY * SUBPX, "up"];
    else if (t >= HOLE_TICKS) {
      endWarp(p, f);
      p.facing = "right"; // (measured: he turns right as he starts to fall in the side view)
    }
    return true;
  }
  const [sx, sy] = STEPS[p.facing];
  if (t === 1) {
    if (w.style === 23 || w.style === 24) p.y = w.y * SUBPX;
    else p.x = w.x * SUBPX;
  }
  if (t < WARP_ENTER_TICKS || t > WARP_ENTER_TICKS + WARP_STAND_TICKS) {
    // (Into a gate he walks "into the screen": 1/32 px a tick up, measured on both sides.)
    const step = GATE_STYLES.has(w.style) ? GATE_STEP : WARP_STEP;
    p.x += sx * step;
    p.y += sy * step;
  } else if (t === WARP_ENTER_TICKS) {
    p.x = w.toX * SUBPX;
    p.y = w.toY * SUBPX;
  } else if (t === WARP_ENTER_TICKS + 1 && GATE_STYLES.has(w.style)) {
    // Out of a gate he starts 1.25 px back and walks onto its spot (measured: (64, 184), then 185.25, then up to 184).
    p.x -= sx * WARP_WALK_TICKS * GATE_STEP;
    p.y -= sy * WARP_WALK_TICKS * GATE_STEP;
  }
  p.moving = t <= WARP_ENTER_TICKS || t > WARP_ENTER_TICKS + WARP_STAND_TICKS;
  p.walkTicks = 0;
  if (t >= WARP_TICKS) endWarp(p, f);
  return true;
}

function endWarp(p: PlayerState, f: Fighter): void {
  f.move = "none";
  f.moveTick = 0;
  f.warp = -1;
  p.moving = false;
}

// --- the side-view rooms ---

/**
 * Is world y (1/256 px) on a side-view screen (props.sideViews: the screens whose layers have a "background" tile, as
 * the game's loader flags them; the Tower of Winds' TV among them)?
 */
export function sideViewAt(b: BattleState, y: number): boolean {
  return (((b.props.sideViews ?? 0) >>> screenAt(y)) & 1) === 1;
}

/**
 * Is a Link on a ladder: his anchor or his feet (7 px under it) on its tiles? (So he climbs it until he stands level
 * with the ground beside its top, and walks over its top as over the ground; Up held there, he stands: stepSideView.)
 */
export const onLadder = (world: World, p: { x: number; y: number }): boolean => {
  const x = Math.floor(p.x / SUBPX), y = Math.floor(p.y / SUBPX);
  return surfaceAt(world, x, y) === "ladder" || surfaceAt(world, x, y + 7) === "ladder";
};

/**
 * A Link on his own on a side-view screen (moves.ts, after Action and Item had their say). Side view is the top-down
 * game with gravity (measured on the Tower of Winds' TV): he walks left and right and uses his sword as usual; Up and
 * Down only turn him (the sword then goes up or down) and don't move him, except on a ladder's tiles, where they climb
 * it at walking speed; off a ladder, with nothing under him, he falls 4 px a tick (measured: walking off a ledge).
 * (Links doing anything else fall in sideViewFall.) Returns false elsewhere.
 */
export function stepSideView(state: GameState, i: number, buttons: number, world: World): boolean {
  const b = state.battle!, p = state.players[i]!, f = b.fighters[i]!;
  if (f.move !== "none" || !sideViewAt(b, p.y)) return false;
  const ladder = onLadder(world, p);
  const climb = ladder && p.action === "none" ? ((buttons & Button.Down) ? 1 : 0) - ((buttons & Button.Up) ? 1 : 0) : 0;
  if (climb) {
    p.facing = climb < 0 ? "up" : "down";
    p.held = buttons;
    const x = p.x, y = p.y;
    moveAxis(p, world, climb * CLIMB_SPEED, "y", true); // (round a ledge's corner as walking does)
    // Not up off its top: a step that would leave him off the ladder isn't taken, and he stands there level with the
    // ground beside it, Up held (traced on the Tower of Winds' TV: 234.7, 233.2, then standing).
    if (climb < 0 && !onLadder(world, p)) [p.x, p.y, p.moving] = [x, y, false];
    else {
      p.moving = true;
      p.walkTicks++;
    }
    return true;
  }
  // Up or Down with a side: walking along it (TODO(measure): at full speed, or the diagonal's), sliding round corners
  // as on the ground; on its own, turning him without a step.
  const y = p.y, lateral = (buttons & (Button.Left | Button.Right)) !== 0;
  stepLink(p, lateral ? buttons & ~(Button.Up | Button.Down) : buttons, world);
  if (!lateral) p.y = y;
  // (Where the step took him: walked onto a ladder's column he stays level, as traced.)
  if (!onLadder(world, p)) moveAxis(p, world, SIDE_FALL_SPEED, "y", true); // (sliding off a corner: measured 3.3, 2.2 px a frame)
  return true;
}

/** Moves on a side-view screen whose walking (stepPlayer: carry.ts, roll.ts, items.ts) mustn't go up or down. */
const LEVEL_MOVES: ReadonlySet<Move> = new Set(["ready", "roll", "carry", "use", "ride"]);

/**
 * Gravity on the side-view screens for the Links stepSideView didn't step, once every Link moved (fight(), battle.ts):
 * one with nothing under him falls 4 px a tick (measured: knocked off a ledge, the knockback and its hop go on while he
 * falls) unless he's on a ladder's tiles; going through a door, held overhead or out of the round, he doesn't. `before`
 * is each Link's y before the tick's moves: walking moves (LEVEL_MOVES) are kept level.
 */
export function sideViewFall(state: GameState, world: World, before: readonly number[]): void {
  const b = state.battle!;
  if (!b.props.sideViews) return;
  state.players.forEach((p, i) => {
    const f = b.fighters[i]!;
    if (!sideViewAt(b, p.y) || f.mode === "dead" || f.mode === "falling" || AWAY.has(f.move) || f.move === "held") return;
    if ((f.mode === "active" || f.mode === "recoil") && f.move === "none") return; // (stepSideView's)
    if (f.mode === "active" && LEVEL_MOVES.has(f.move) && before[i] !== undefined && screenAt(before[i]!) === screenAt(p.y)) p.y = before[i]!;
    if (!onLadder(world, p)) moveAxis(p, world, SIDE_FALL_SPEED, "y", true);
  });
}

/**
 * Things fall on the side-view screens too, but not as Links do (measured in the Tower of Winds' gallery: its spawned
 * bombs fell from rest, 0.15, 0.30, 0.45 … px a tick, and stopped on the platform with their ±7 px box on it; a pot
 * thrown on its TV left at its height of 20 px as screen y, 6 px a tick sideways, falling the same way).
 */
export const SIDE_GRAVITY = 38; // 0.15 px/tick² (38.4/256)
/** Half the box a falling thing stands on (a bomb's ±7 px: it rests with its anchor 7 px over the ground). */
export const FALL_HALF = 7;
/** What falls when nothing holds it up (in its "rest" phase: carried and flying things have their own motion). */
const FALLING_KINDS: ReadonlySet<Entity["kind"]> = new Set(["bomb", "pot", "bush", "orb", "pickup"]);

/** Is there ground right under a thing at (x, y) (1/256 px), its box FALL_HALF px down from its anchor? */
export function groundUnder(world: World, x: number, y: number): boolean {
  return isSolidAt(world, Math.floor(x / SUBPX), Math.floor(y / SUBPX) + FALL_HALF);
}

/**
 * One step of a thing falling on a side-view screen (its fall speed in `vy`, `gravity` added to it): it lands with its
 * box on the ground it meets. Returns true when it's on the ground (then `vy` is 0).
 */
export function fallStep(world: World, e: Entity, gravity = SIDE_GRAVITY): boolean {
  if (groundUnder(world, e.x, e.y) && e.vy >= 0) {
    e.vy = 0;
    return true;
  }
  e.vy += gravity;
  const from = Math.floor(e.y / SUBPX), to = Math.floor((e.y + e.vy) / SUBPX), px = Math.floor(e.x / SUBPX);
  for (let y = from; y <= to; y++) {
    if (isSolidAt(world, px, y + FALL_HALF)) {
      e.y = Math.max(e.y, y * SUBPX); // (on it: its box's last row over the ground; traced: 201 over 208)
      e.vy = 0;
      return true;
    }
  }
  e.y += e.vy;
  return false;
}

/** Things resting on a side-view screen with nothing under them fall (arenastep.ts, after the shots and throws). */
export function fallEntities(state: GameState, world: World): void {
  const b = state.battle!;
  if (!b.props.sideViews) return;
  for (const e of b.entities) {
    if (e.hp < 0 || e.phase !== "rest" || !FALLING_KINDS.has(e.kind) || !sideViewAt(b, e.y)) continue;
    fallStep(world, e);
  }
}

/** A CNON prop's patrol half-width (px): ((params >> 8) & 15) × 8 for a moving one (params & 15 = 1), else 0. */
export const cannonRange = (params: number): number => ((params & 15) === 1 ? ((params >>> 8) & 15) * 8 : 0);

/**
 * The cannons (entity "cannon", `home` its prop, `owner` its rider or -1, `timer` ticks he's been in): they patrol, take
 * in a Link falling onto them, and shoot him up when he presses Item or after CANNON_FUSE ticks. Run after the Links
 * moved (hazards.ts).
 */
export function stepCannon(state: GameState, e: Entity): void {
  const b = state.battle!, prop = b.props.actors[e.home];
  if (!prop) return;
  const range = cannonRange(prop.params) * SUBPX;
  const rider = e.owner >= 0 ? state.players[e.owner] : undefined, f = e.owner >= 0 ? b.fighters[e.owner] : undefined;
  if (rider && f && f.move === "cannon") {
    // It moves only with someone in it (measured: still at home when he fell in, then 1 px a tick). TODO(measure): where
    // it goes once empty again (it stays put here).
    if (range) {
      if (!e.vx) e.vx = CANNON_SPEED;
      e.x += e.vx;
      if (e.x >= e.homeX + range || e.x <= e.homeX - range) {
        e.x = Math.max(e.homeX - range, Math.min(e.homeX + range, e.x));
        e.vx = -e.vx;
      }
    }
    [rider.x, rider.y] = [e.x, e.y - CANNON_RIDE * SUBPX];
    const pressed = rider.held & ~e.param & Button.Item;
    e.param = rider.held; // (the rider's buttons last tick: a press of Item fires)
    if (pressed || ++e.timer >= CANNON_FUSE) {
      Object.assign(f, { move: "launch", moveTick: 0, warp: -1, vz: -SHOT_SPEED, z: 0 });
      e.owner = -1;
      e.timer = 0;
    }
    return;
  }
  e.owner = -1;
  // A Link falling onto it (in the side view, on his own) gets in.
  state.players.forEach((p, i) => {
    const g = b.fighters[i]!;
    if (e.owner >= 0 || g.move !== "none" || g.mode !== "active" || g.hearts <= 0 || !sameScreen(p, e) || !sideViewAt(b, p.y)) return;
    const dx = Math.abs(p.x - e.x), above = e.y - p.y;
    if (dx > CANNON_REACH * SUBPX || above > CANNON_CATCH * SUBPX || above < 0) return;
    stopActing(p);
    Object.assign(g, { move: "cannon", moveTick: 0 });
    [p.x, p.y, p.facing] = [e.x, e.y - CANNON_RIDE * SUBPX, "right"];
    e.owner = i;
    e.timer = 0;
    e.param = p.held;
  });
}

/** A Link in a cannon: he only waits (stepCannon carries him and fires). */
export function stepInCannon(state: GameState, i: number, buttons: number): boolean {
  const p = state.players[i]!, f = state.battle!.fighters[i]!;
  if (f.move !== "cannon") return false;
  p.held = buttons;
  p.moving = false;
  f.moveTick++;
  return true;
}

/** Over the side room's top edge, gone, and back on the TV out of the hole: the launch's flight (z) has begun. */
export const launchFlying = (f: Fighter): boolean => f.move === "launch" && f.warp >= 0 && f.moveTick > LAUNCH_SHOW_TICK;
/** Is a launched Link out of sight (over the top edge, or still in the hole on the TV: measured from the step after it)? */
export const launchHidden = (f: Fighter): boolean => f.move === "launch" && f.warp >= 0 && f.moveTick >= 1 && f.moveTick < LAUNCH_SHOW_TICK;

/**
 * A Link shot from a cannon (state 77): up the side room until its top edge (style 19) takes him (`warp` = that edge,
 * `moveTick` counting again from it); one more step, gone; on the TV out of the hole the edge leads to 18 ticks later,
 * hidden to the 77th; then flying up and down (z) and steered, until he lands (or the hole takes him again: stepWarps).
 */
export function stepLaunch(state: GameState, i: number, buttons: number, world: World): boolean {
  const b = state.battle!, p = state.players[i]!, f = b.fighters[i]!;
  if (f.move !== "launch") return false;
  p.held = buttons;
  p.moving = false;
  const t = ++f.moveTick;
  if (f.warp < 0) {
    p.y += f.vz;
    f.vz += SHOT_SLOWING;
    const edge = (b.props.warps ?? []).findIndex((w) => w.style === EDGE_STYLE && inWarp(p, w));
    if (edge >= 0) [f.warp, f.moveTick] = [edge, 0];
    else if (f.vz >= 0 || t > 120) endLaunch(f); // (no edge above: he lands where he got)
    return true;
  }
  const w = b.props.warps![f.warp]!;
  if (t === 1) p.y += f.vz;
  else if (t === LAUNCH_TV_TICK) [p.x, p.y, f.z] = [w.toX * SUBPX, w.toY * SUBPX, LAUNCH_Z];
  else if (t === LAUNCH_SHOW_TICK) f.vz = LAUNCH_VZ;
  else if (t > LAUNCH_SHOW_TICK) {
    const dx = (buttons & Button.Right ? 1 : 0) - (buttons & Button.Left ? 1 : 0), dy = (buttons & Button.Down ? 1 : 0) - (buttons & Button.Up ? 1 : 0);
    if (dx || dy) {
      p.facing = nextFacing(p.facing, buttons);
      const speed = dx && dy ? WALK_SPEED_DIAGONAL : WALK_SPEED;
      moveAxis(p, world, dx * speed, "x");
      moveAxis(p, world, dy * speed, "y");
    }
    f.z += f.vz;
    f.vz = Math.max(-LAUNCH_FALL_MAX, f.vz - LAUNCH_GRAVITY);
    if (f.z <= 0) endLaunch(f);
  }
  return true;
}

function endLaunch(f: Fighter): void {
  Object.assign(f, { move: "none", moveTick: 0, warp: -1, z: 0, vz: 0 });
}

// --- Hyrule Castle's dark side (its sublayer 1), through the magic circles ---

/**
 * A magic circle (`CIRC`, update 0x8028AE2C) takes a Link whose body meets its ±8 px box (around its listed spot), once
 * it has been full size for 10 ticks (+0x248); having taken one it stays open 180 ticks more (+0x238), its switch on or
 * not. Each player has a latch on it (+0x252[i]) until he's more than 1 px out of its box. Hyrule Castle's (color 5,
 * params & 7) take anyone, with warp style 20, to the params' screen ((params >> 24) & 7) and spot (((params >> 16) &
 * 0x3F, (params >> 8) & 0x3F) × 8 + 8): the dark side. (Circles of colors 1-4 take only that player, with style 6: none
 * in battle, not simulated.)
 */
export const CIRCLE_BOX = 8;
export const CIRCLE_SETTLE = 10;
export const CIRCLE_HOLD = 180;
const CIRCLE_ANYONE = 5;
/**
 * Through a circle (states 36, 37; measured): onto its middle on the tick it takes him; the sword raised 60 ticks, gone,
 * on the dark side on the 119th, standing there to the 179th, on his own on the 180th. "You got 10 Dark World seconds!":
 * 600 ticks later (Link +0xBD8, counting while he's on his own there) he goes back the same way (states 32, 33: on the
 * TV on the 119th, 16 px over the circle, hidden there until he's free).
 */
export const CIRCLE_RAISE_TICKS = 60;
export const CIRCLE_ARRIVE_TICK = 119;
export const CIRCLE_TICKS = 180;
export const DARK_TICKS = 600;
export const CIRCLE_BACK_Y = 16;
/** The style of the WARP in the dark side's middle: out at once, to the TV (states 34, 35; measured). */
export const SPOT_STYLE = 6;
/**
 * Out by the middle: onto it, spinning (a facing every 4 ticks: down, left, up, right), rising 4 px a tick from the 60th
 * tick, on the TV on the 92nd; there hidden, then spinning down onto the spot (frame dumps: seen from about the 226th,
 * down on the 262nd; the height a guess), on his own on the 263rd.
 */
export const SPOT_RISE_TICK = 60;
export const SPOT_RISE = 4 * SUBPX;
export const SPOT_ARRIVE_TICK = 92;
export const SPOT_SHOW_TICK = 226;
export const SPOT_TICKS = 263;
export const SPOT_DROP_SPEED = Math.round(1.6 * SUBPX);
const SPIN: readonly Facing[] = ["down", "left", "up", "right"];

/** Where a magic circle (its prop) leads: world px, or null when its room isn't there. */
export function circleDestination(b: BattleState, params: number): { x: number; y: number } | null {
  const screen = (params >>> 24) & 7;
  if (screen === 0 || screen > MAX_SIDE_ROOM || !((b.props.sideRooms ?? 0) & (1 << screen))) return null;
  return { x: ((params >>> 16) & 0x3f) * 8 + 8, y: sideRoomY(screen) + ((params >>> 8) & 0x3f) * 8 + 8 };
}

/**
 * A full-size magic circle (hazards.ts runs its size and timers: `timer` its size, `tick` ticks at full size, `param`
 * the ticks it stays open, `hitMask` the players' latches): it takes the Links whose bodies meet its box.
 */
export function takeIntoCircle(state: GameState, e: Entity): void {
  const b = state.battle!, prop = b.props.actors[e.home];
  if (!prop || (prop.params & 7) !== CIRCLE_ANYONE || !circleDestination(b, prop.params)) return;
  const near = (p: PlayerState, grow: number) => {
    const reach = (CIRCLE_BOX + HURTBOX.right) * SUBPX + grow;
    return Math.abs(p.x - e.x) <= reach && p.y + HURTBOX.bottom * SUBPX >= e.y - CIRCLE_BOX * SUBPX - grow && p.y + HURTBOX.top * SUBPX <= e.y + CIRCLE_BOX * SUBPX + grow;
  };
  state.players.forEach((p, i) => {
    const f = b.fighters[i]!, bit = 1 << i;
    if (!near(p, 0) || !sameScreen(p, e)) {
      if (!near(p, SUBPX)) e.hitMask &= ~bit;
      return;
    }
    if (e.hitMask & bit || !canWarp(p, f)) return;
    e.hitMask |= bit;
    stopActing(p);
    Object.assign(f, { move: "circle", moveTick: 0, circle: e.home, warp: -1 });
    [p.x, p.y] = [e.x, e.y];
    e.param = CIRCLE_HOLD;
  });
}

/** Back to the TV once his time on the dark side is up (stepWarps): over the circle that took him. */
function stepDarkTimers(state: GameState): void {
  const b = state.battle!;
  b.fighters.forEach((f, i) => {
    if (f.dark <= 0 || AWAY.has(f.move) || --f.dark > 0) return;
    const p = state.players[i]!;
    // Held over someone's head, thrown, falling: as soon as he's back on his feet. TODO(measure)
    if (f.hearts <= 0 || f.move === "held" || f.move === "thrown" || (f.mode !== "active" && f.mode !== "recoil" && f.mode !== "hurt" && f.mode !== "stunned")) {
      f.dark = 1;
      return;
    }
    stopActing(p);
    Object.assign(f, { mode: "active", modeTick: 0, pushX: 0, pushY: 0, move: "circleBack", moveTick: 0, warp: -1, z: 0, vz: 0, flyX: 0, flyY: 0 });
  });
}

/**
 * One tick of a Link taken by a magic circle, sent back from the dark side, or out of it by its middle (moves.ts; no
 * control).
 */
export function stepCircle(state: GameState, i: number, buttons: number): boolean {
  const b = state.battle!, p = state.players[i]!, f = b.fighters[i]!;
  if (f.move !== "circle" && f.move !== "circleBack" && f.move !== "spot") return false;
  p.held = buttons;
  p.moving = false;
  p.walkTicks = 0;
  const t = ++f.moveTick;
  if (f.move === "spot") {
    const w = b.props.warps?.[f.warp];
    if (t < SPOT_ARRIVE_TICK || t >= SPOT_SHOW_TICK) p.facing = SPIN[Math.floor(t / 4) % 4]!;
    if (t >= SPOT_RISE_TICK && t < SPOT_ARRIVE_TICK) f.z = (t - SPOT_RISE_TICK + 1) * SPOT_RISE;
    else if (t === SPOT_ARRIVE_TICK && w) [p.x, p.y, f.z] = [w.toX * SUBPX, w.toY * SUBPX, 0];
    else if (t >= SPOT_SHOW_TICK) f.z = Math.max(0, (SPOT_TICKS - 1 - t) * SPOT_DROP_SPEED);
    if (t >= SPOT_TICKS - 1 || !w) {
      Object.assign(f, { move: "none", moveTick: 0, warp: -1, z: 0, dark: 0, circle: -1 });
      p.facing = "down";
    }
    return true;
  }
  const prop = b.props.actors[f.circle];
  if (t === CIRCLE_ARRIVE_TICK && prop) {
    const to = f.move === "circle" ? circleDestination(b, prop.params) : { x: prop.x, y: prop.y - CIRCLE_BACK_Y };
    if (to) [p.x, p.y] = [to.x * SUBPX, to.y * SUBPX];
  }
  if (t >= CIRCLE_TICKS - 1 || !prop) {
    // (The timer counts from this tick on: 599 on his first tick on his own, 0 and on his way back 600 ticks later.)
    const back = f.move === "circleBack" || !prop;
    Object.assign(f, { move: "none", moveTick: 0, dark: back ? 0 : DARK_TICKS + 1, circle: back ? -1 : f.circle });
  }
  return true;
}

/** Into the dark side's middle spot (style 6): onto it on the tick it takes him (measured: (256, 208) on that frame). */
function startSpot(p: PlayerState, f: Fighter, k: number, w: Warp): void {
  stopActing(p);
  Object.assign(f, { move: "spot", moveTick: 0, warp: k });
  f.warpLatch |= 1 << k;
  [p.x, p.y] = [w.x * SUBPX, w.y * SUBPX];
}

/** Is this Link out of sight going through a magic circle, back from the dark side, or out by its middle? */
export function circleHidden(f: Fighter): boolean {
  const t = f.moveTick;
  if (f.move === "circle") return t > CIRCLE_RAISE_TICKS && t < CIRCLE_ARRIVE_TICK;
  if (f.move === "circleBack") return t >= CIRCLE_ARRIVE_TICK;
  return f.move === "spot" && t >= SPOT_ARRIVE_TICK && t < SPOT_SHOW_TICK;
}

/**
 * The walk frame (0-7) a Link going through a door shows, or -1 for the stride he stands in (frames 16, 17, 17, 18, 18…:
 * the cycle from its first frame, 2 ticks a frame).
 */
export function warpWalkStep(f: Fighter): number {
  const t = f.moveTick;
  if (t <= WARP_ENTER_TICKS) return Math.floor(t / WARP_FRAME_TICKS) % 8;
  if (t <= WARP_ENTER_TICKS + WARP_STAND_TICKS) return 0;
  return Math.floor((t - WARP_ENTER_TICKS - WARP_STAND_TICKS) / WARP_FRAME_TICKS) % 8;
}

/** Is Link `i` in a side room (his GBA shows it, the TV doesn't)? */
export function inSideRoom(state: GameState, i: number): boolean {
  const p = state.players[i];
  return !!p && screenAt(p.y) > 0;
}

/** The warps of a battle (props.ts). */
export const battleWarps = (b: BattleState): readonly Warp[] => b.props.warps ?? [];
