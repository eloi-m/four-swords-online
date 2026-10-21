// Things in a Shadow Battle arena besides the Links: carried and thrown objects, bombs and explosions, arrows and other
// shots, item orbs and pickups, and the arena's hazards. They are plain records in `BattleState.entities` (one flat
// object per entity, integers and strings only), so the netcode can clone, hash and serialize them; the behaviors live
// in the modules that step them (carry.ts, projectiles.ts, items.ts, orbs.ts, hazards.ts, timeup.ts).
import type { BattleState } from "./battle.ts";
import type { PixelBox } from "./combat.ts";
import { SUBPX, type Facing } from "./player.ts";
import type { World } from "./world.ts";

/**
 * Items a Link can hold (one at a time), from item orbs; a heart is used up on the spot. "bombchu" is only a crystal
 * ball's content: they run out of it when it breaks (orbs.ts), nobody holds them.
 */
export type ItemKind = "bomb" | "bow" | "boomerang" | "slingshot" | "cucco" | "carrot" | "fourSword" | "heart" | "bombchu" | "boots" | "hammer" | "fireRod";
export const ITEM_KINDS: readonly ItemKind[] = ["bomb", "bow", "boomerang", "slingshot", "cucco", "carrot", "fourSword", "heart", "bombchu", "boots", "hammer", "fireRod"];

export type EntityKind =
  | "bush" // a lifted bush (its tile is cut when it's picked up)
  | "pot"
  | "bomb" // a Link's bomb or a Tower of Flames bomb (HBMB); `home` = its socket's index, or -1
  | "orb" // an item orb (CRTL crystal ball, from a CRGN generator = `home`); `item` = what's inside
  | "pickup" // an item on the ground: a generator's (`param` = its level; taken with Action: orbs.ts), or an orb's content
  | "arrow" // `param` its flags (projectiles.ts SHOT_DRAWN), `target` the Link a drawn one carries
  | "seed" // slingshot seed, `param` its flags
  | "boomerang"
  | "fireball" // a Fire Rod's fireball (FIRE kind 0: firerod.ts), `owner` its Link; "rest" while it bursts
  | "explosion"
  | "debris" // a broken pot, bush or orb (effect only)
  | "flame" // BLZ2 eternal flame ("active" while lit)
  | "jet" // FLME flame shooting out of the Tower of Flames' fire pit, `param` = direction 0-3, `timer` = size 0-1000
  | "firebar" // one arm of an FBMR fire bar, `angle` rotating around (x, y)
  | "switch" // SWTH floor switch, `param` = switch number
  | "trapdoor" // TFLR trick floor, `param` = switch number, `timer` > 0 while its tiles are pits
  | "logic" // a switch-logic actor (switches.ts: SWOR, SWT4, CHSW, OFFS, CKSW, RNSW, WTSW, GEN3)
  | "crystal" // ONOF crystal ("active" while lit)
  | "bee"
  | "soldier" // SLR1 sword soldier
  | "bowSoldier" // SLR2 bow soldier (castlesoldiers.ts: its fields)
  | "captain" // SLR4 captain (castlesoldiers.ts)
  | "ballSoldier" // SLR3 ball-and-chain soldier, its ball and chain kept in its fields (castlesoldiers.ts)
  | "soldierArrow" // a bow soldier's arrow (castlesoldiers.ts)
  | "circle" // CIRC magic circle (a portal to the Dark World)
  | "cucco"
  | "hen" // NIWA kind 6, The Field's cave cucco (hens.ts): `param` the hits it takes before it's angry
  | "angryCucco" // one of its angry cuccos flying across the TV (hens.ts)
  | "cannon" // CNON in a side room (siderooms.ts): `owner` its rider, `timer` how long he's been in
  | "bombchu" // BMTY (bombchus.ts): `timer` its fuse, `param` its kind and flags, `facing` its surface in side view
  | "shadowLink" // BBSL, the Tower of Winds' giant-bomb Shadow Link (giantbomb.ts): `param` its state, `timer` its clock
  | "bigBomb" // BBMB, his giant bomb (giantbomb.ts): `param` its state, `timer` its fuse, `angle` its size
  | "giantBomb"; // Vaati at time-out (timeup.ts; the kind kept its first name)

export type EntityPhase =
  | "rest" // lying on the ground / idle at home
  | "held" // carried over a Link's head (`owner`)
  | "flying" // thrown or shot
  | "return" // boomerang or cucco coming back to `owner`; bee or soldier going home
  | "chase" // bee, soldier or cucco after a Link (`target`)
  | "stun" // soldier knocked back
  | "look" // bow soldier looking round
  | "shoot" // bow soldier drawing and loosing an arrow
  | "lunge" // captain lunging with his spear
  | "hold" // captain holding after his lunge
  | "drop" // an orb or an item appearing: dropping or popping up into place (orbs.ts)
  | "active"; // explosions, jets, hazards doing their thing

export interface Entity {
  id: number;
  kind: EntityKind;
  phase: EntityPhase;
  x: number; // 1/256 px, ground position
  y: number;
  z: number; // height above the ground, 1/256 px
  vx: number; // 1/256 px per tick
  vy: number;
  vz: number;
  facing: Facing;
  tick: number; // ticks in the phase
  timer: number; // kind-specific countdown: fuse, lifetime, respawn
  owner: number; // player index who holds, threw or shot it, -1 = nobody
  target: number; // player index chased, -1 = none
  item: ItemKind | ""; // orbs and pickups
  hp: number;
  hitMask: number; // players already hit by this shot/explosion, one bit per player index
  param: number; // kind-specific (switch number, direction, arm index, stolen hearts…)
  home: number; // index of the arena prop it came from (socket, generator, actor), -1 = none
  homeX: number; // where it returns to, 1/256 px
  homeY: number;
  angle: number; // fire bars: 0-65535 = one turn clockwise from right (y down)
  /** Through a door or a hole (siderooms.ts thingWarps): ticks before another warp may take it, 0 = any time. */
  warpTicks: number;
  /** Where it came out of that warp, 1/256 px (another warp waits until it's this far from there or the ticks ran out). */
  warpX: number;
  warpY: number;
}

export function spawnEntity(b: BattleState, kind: EntityKind, x: number, y: number, fields: Partial<Entity> = {}): Entity {
  const e: Entity = {
    id: b.nextId++,
    kind,
    phase: "rest",
    x,
    y,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    facing: "down",
    tick: 0,
    timer: 0,
    owner: -1,
    target: -1,
    item: "",
    hp: 1,
    hitMask: 0,
    param: 0,
    home: -1,
    homeX: x,
    homeY: y,
    angle: 0,
    warpTicks: 0,
    warpX: 0,
    warpY: 0,
    ...fields,
  };
  b.entities.push(e);
  return e;
}

export function entityById(b: BattleState, id: number): Entity | undefined {
  return b.entities.find((e) => e.id === id);
}

/** Marks an entity for removal at the end of the tick (removing mid-iteration would skip entities). */
export function removeEntity(e: Entity): void {
  e.hp = -1;
}

export function isRemoved(e: Entity): boolean {
  return e.hp < 0;
}

export function sweepEntities(b: BattleState): void {
  if (b.entities.some(isRemoved)) b.entities = b.entities.filter((e) => !isRemoved(e));
}

export function setPhase(e: Entity, phase: EntityPhase): void {
  e.phase = phase;
  e.tick = 0;
}

// --- deterministic randomness: a 32-bit xorshift in BattleState.rng ---

/** Next random u32 from the battle's generator. */
export function nextRandom(b: BattleState): number {
  let x = b.rng | 0 || 0x6d2b79f5;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  b.rng = x >>> 0;
  return b.rng;
}

/** A random integer in 0 … n-1. */
export function randomInt(b: BattleState, n: number): number {
  return nextRandom(b) % n;
}

// --- integer trigonometry (no float trig in the sim: results must be bit-identical on every machine) ---

// sin(i · 90° / 64) × 4096, i = 0…64.
const QUARTER_SINE = [
  0, 101, 201, 301, 401, 501, 601, 700, 799, 897, 995, 1092, 1189, 1285, 1380, 1474, 1567, 1660, 1751, 1842, 1931, 2019, 2106, 2191,
  2276, 2359, 2440, 2520, 2598, 2675, 2751, 2824, 2896, 2967, 3035, 3102, 3166, 3229, 3290, 3349, 3406, 3461, 3513, 3564, 3612, 3659,
  3703, 3745, 3784, 3822, 3857, 3889, 3920, 3948, 3973, 3996, 4017, 4036, 4052, 4065, 4076, 4085, 4091, 4095, 4096,
];
export const TRIG_ONE = 4096;

/** sin of `angle` (0-65535 = one turn) × 4096, from a 256-step table. */
export function sin4096(angle: number): number {
  const i = ((angle & 0xffff) >> 8) & 0xff; // 256 steps per turn
  const q = i >> 6, r = i & 63;
  switch (q) {
    case 0:
      return QUARTER_SINE[r]!;
    case 1:
      return QUARTER_SINE[64 - r]!;
    case 2:
      return -QUARTER_SINE[r]!;
    default:
      return -QUARTER_SINE[64 - r]!;
  }
}

export function cos4096(angle: number): number {
  return sin4096(angle + 0x4000);
}

// --- geometry ---

/** A box of half-size (hw, hh) px around an entity's ground position (inclusive world px). */
export function boxAround(x: number, y: number, hw: number, hh: number = hw): PixelBox {
  const px = Math.floor(x / SUBPX), py = Math.floor(y / SUBPX);
  return { left: px - hw, top: py - hh, right: px + hw - 1, bottom: py + hh - 1 };
}

export const boxesOverlap = (a: PixelBox, b: PixelBox) => a.left <= b.right && b.left <= a.right && a.top <= b.bottom && b.top <= a.bottom;

export function pointInBox(x: number, y: number, b: PixelBox): boolean {
  return x >= b.left && x <= b.right && y >= b.top && y <= b.bottom;
}

/** Squared distance in whole px between two 1/256 px points. */
export function distance2(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.floor(ax / SUBPX) - Math.floor(bx / SUBPX), dy = Math.floor(ay / SUBPX) - Math.floor(by / SUBPX);
  return dx * dx + dy * dy;
}

/** floor(√n) for a non-negative integer n < 2^53, exact (the float square root is corrected with integer checks). */
export function isqrt(n: number): number {
  let r = Math.floor(Math.sqrt(n));
  while (r * r > n) r--;
  while ((r + 1) * (r + 1) <= n) r++;
  return r;
}

/**
 * A velocity of `speed` (1/256 px per tick) along (dx, dy), at any angle; [0, 0] for a zero vector. Integer math only
 * (a correctly rounded division), so it's the same on every machine.
 */
export function velocityAlong(dx: number, dy: number, speed: number): [number, number] {
  const len = isqrt(dx * dx + dy * dy);
  if (len === 0) return [0, 0];
  return [Math.round((speed * dx) / len), Math.round((speed * dy) / len)];
}

export const FACING_STEP: Readonly<Record<Facing, readonly [number, number]>> = { right: [1, 0], left: [-1, 0], down: [0, 1], up: [0, -1] };

/** The 8-way unit step from (fx, fy) toward (tx, ty), in the same units; [0, 0] on the same spot. */
export function stepToward(fx: number, fy: number, tx: number, ty: number): [number, number] {
  const dx = tx - fx, dy = ty - fy, ax = Math.abs(dx), ay = Math.abs(dy);
  // Within 22.5° of an axis (tan ≈ 5/12) the step is straight along it.
  return [ax * 12 < ay * 5 ? 0 : Math.sign(dx), ay * 12 < ax * 5 ? 0 : Math.sign(dy)];
}

// --- the arena's changing ground: cut bushes and open trapdoors ---

export const TILE = 16;
export const ROOM_TILES_X = 32; // tile index = ty * 32 + tx, like the tile layers

/**
 * A tile index (ty * 32 + tx) under a world pixel, in a world one room wide at the origin: an arena (free play's map is
 * two rooms wide, and has no props).
 */
export function tileIndexAt(px: number, py: number): number {
  return Math.floor(py / TILE) * ROOM_TILES_X + Math.floor(px / TILE);
}

type Patch = { open: readonly number[]; pits: readonly number[] };
const patched = new WeakMap<World, Map<string, World>>();

/**
 * The arena's collision with this battle's changes applied: cut bush tiles no longer block, and open trapdoor tiles
 * are pits. Built once per distinct set of changes and cached (the state stays plain data; this is derived from it).
 */
export function battleWorld(world: World, b: BattleState): World {
  const floors = b.entities.filter((e) => e.kind === "trapdoor" && e.timer > 0);
  const pits = [...floors.flatMap((e) => trapdoorTiles(e)), ...lavaTiles(b)];
  if (!b.cut.length && !pits.length) return world;
  const patch: Patch = { open: b.cut, pits };
  const key = `${patch.open.join(",")}|${patch.pits.join(",")}`;
  let cache = patched.get(world);
  if (!cache) patched.set(world, (cache = new Map()));
  const hit = cache.get(key);
  if (hit) return hit;
  const solid = world.solid.slice(), surface = world.surface.slice();
  const cells = (tile: number, f: (i: number) => void) => {
    const tx = tile % ROOM_TILES_X, ty = Math.floor(tile / ROOM_TILES_X);
    for (let q = 0; q < 4; q++) {
      const cx = tx * 2 + (q & 1), cy = ty * 2 + (q >> 1);
      if (cx < world.widthCells && cy < world.heightCells) f(cy * world.widthCells + cx);
    }
  };
  for (const tile of patch.open) cells(tile, (i) => (solid[i] = 0));
  for (const tile of patch.pits) cells(tile, (i) => (surface[i] = PIT_SURFACE));
  const out: World = { ...world, solid, surface, ...(floors.length ? { widePits: floors.map(trapdoorBox) } : {}) };
  if (cache.size > 16) cache.clear();
  cache.set(key, out);
  return out;
}

const PIT_SURFACE = 1; // index of "pit" in world.ts SURFACE_CODES

/**
 * The Tower of Flames' lava stripes: each `PNPC` ("panel rewriting NPC") turns its tile into lava (tile 0x0D, type 0x0E: a
 * damaging pit) while its switch is on (docs/formats/battle-arenas.md "Switches"; 3-6, set from the floor switches of the side room
 * under the side pits, siderooms.ts). Tile indices (ty * 32 + tx).
 */
export function lavaTiles(b: BattleState): number[] {
  const out: number[] = [];
  for (const a of b.props.actors) {
    const n = a.params >>> 27;
    if (a.id === "PNPC" && n > 0 && ((b.switches >>> n) & 1) === 1) out.push(tileIndexAt(a.x, a.y));
  }
  return out;
}
/** A trick floor (TFLR) covers a square of TRAPDOOR_TILES × TRAPDOOR_TILES tiles from its anchor (the top-left). */
export const TRAPDOOR_TILES = 4;

/** A trick floor's tiles, whole px inclusive (its pit reaches a pixel further right and down: World.widePits). */
function trapdoorBox(e: Entity): { left: number; top: number; right: number; bottom: number } {
  const left = Math.floor(e.x / SUBPX / TILE) * TILE, top = Math.floor(e.y / SUBPX / TILE) * TILE, size = TRAPDOOR_TILES * TILE;
  return { left, top, right: left + size - 1, bottom: top + size - 1 };
}

export function trapdoorTiles(e: Entity): number[] {
  const tx = Math.floor(e.x / SUBPX / TILE), ty = Math.floor(e.y / SUBPX / TILE);
  const out: number[] = [];
  for (let dy = 0; dy < TRAPDOOR_TILES; dy++) for (let dx = 0; dx < TRAPDOOR_TILES; dx++) out.push((ty + dy) * ROOM_TILES_X + tx + dx);
  return out;
}
