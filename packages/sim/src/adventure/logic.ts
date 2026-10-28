// Stage machinery the adventure adds to Shadow Battle's switch network (switches.ts), read from main.dol:
// - PNPC "panel rewriting NPC" (init 0x802C9284, setup 0x802C8F28, update 0x802C89FC): its tile (params & 0x3FF)
//   replaces the base-layer tile under it while its switch (params >> 27) is on, or for good once it was ((p >> 20) & 7
//   = 0); without a switch, while a Link is within 48 px of it (or for good once one came). It acts only with enough
//   players ((p >> 10) & 3: 0 any, 1 three or more, 2 four, 3 two or more; one player here). Not done: (p >> 16) & 0xF
//   ≠ 0 (the other tile layer), the special tiles (0x30 bombable walls, the colored panels 0x8B-0x8E) and the tiles
//   it writes instead on some ground types.
// - ZNSW "all enemies beaten" (update 0x802BD924): kinds 0 and 1 turn their switch on once the room has no enemies
//   left (the stage manager's +0x305C), for good in mode 0 ((p >> 7) & 31), while it lasts in mode 1. Kinds 2-9 watch
//   a box (not done). Only the enemies the adventure animates count (enemies.ts ENEMY_TYPES).
// - FOCS "focus" (update 0x802C9558): once its input switch ((p >> 22) & 31; none: at once) is on, the camera goes to
//   it; once there it turns its own switch on and holds the camera p & 0xFFF ticks.
// - YNSW "switch for four" (init 0x8034EAB4, update 0x8034E49C, its snap 0x8034E050; stepFourSwitch): watches a ±15 px
//   box round its position, 2.5 px up; once the four Links' bodies (±7 px; on the ground, z ≤ 4, in the game: not
//   checked here) have all met it 6 ticks running (it sees them as they stood before the tick's walk), each is snapped
//   onto a corner 8 px off the box's middle and the four hold a pose 95 ticks, its switch turned on 79 ticks in.
//   Traced (Lake Hylia room 2's cave, the box formation walking up onto the switch at (128, 96)): caught 6 ticks after
//   the bottom Links' bodies reached the box, set at (120, 85.5), (136, 85.5), (120, 101.5), (136, 101.5) in one tick.
//   Trailing 18 px apart they can't all fit, so a leader stopping on it alone doesn't press it.
// - GOL2 "goal 2" (the stage's goal, four pads gc 603, lit 602, laid out by params & 0x1F): the stage is cleared when
//   the Links have the Force Gem quota (pickups.ts GEM_QUOTA) and the leader steps on a pad. TODO(measure): its switch
//   (the top bits: Lake Hylia's waits for 16, which nothing in its room sets: the quota is assumed), the pads' box, the
//   four Links on four pads.
// - SPBG "drawbridge" (Hyrule Castle rooms 1, 3 and 6's gates; init 0x80348698, update 0x8034821C): once its switch
//   (params >> 27) is on, it opens and some ticks later sets switch (p >> 22) & 31, whose PNPCs turn the gate's tiles
//   to floor: kind p & 15 0 (room 1's drawbridge) after 120 ticks, kind 1 (rooms 3 and 6's) after 30 (measured: room 1's
//   switch 16 poked on, 17 on 121 ticks later; room 3's 24 on, 25 31 ticks later). Kind 2 (room 58) isn't decoded.
//   TODO(measure): its look (apps draw nothing for it).
// - THRN "thorns" (Hyrule Castle rooms 2 and 6; init 0x802AAEC0, update 0x802AAC60): the room's spikes (tile type 0x22,
//   solid) shut its ways out. Kind p & 0xFF 0 lowers them once its switch is on; the others once the room has no
//   enemies left (the stage manager's +0x305C, as ZNSW: room 2's, kind 1). In the game they rise 15 ticks after the
//   room loads (the Links were seen walking in over lowered spikes that rose behind them) and go down over 10 ticks
//   (8 + 2); here they're up from the start and down at once, for good.
// - VWMD "view mode" (init 0x802E055C, update 0x802E03F0): writes its params' low 16 bits into the room's view flags
//   (stage +0x131B8 + 2 · room, 0x802D77E4). Bit 1 is the dark (lifted while a Link holds the lamp), bits 2-3 and
//   12-13 hold only while its switch (params >> 27; none: always) is on. Bits 12-13, the **top mode**, reach the GBA
//   only (0x803085A4 puts them in its packet, byte 4 bits 5-6; nothing else on the GameCube reads them). The GBA client
//   (Agb/client_thread.arc, LZ77; read, not run) has the top layer's map on BG2 (0x0600C000, priority 2) over the
//   base's BG3, and in modes 1 and 2 alpha-blends BG2 over BG3, the sprites and the backdrop (BLDCNT 0x3844) with
//   EVA/EVB 8/15 (mode 1) or 0/14 (mode 2), the sprites at priority 3 (under BG2, so blended too); mode 0 and 3 draw it
//   as it is (TOP_MODE_BLEND). Mode 1: the underwater passages, whose top layer is their water (a tile type the side
//   views swim in), seen through; mode 2: Lake Hylia room 5's area 2 under the bridge, whose top layer is the filler
//   tile over its right half (over its right-hand warps' arrivals), which so only darkens it to 14/16: the bridge's
//   shade. Not seen in Dolphin.
// A room's switches stay as they were when the Links come back (RYRN's init skips a gem rain whose switch is on, so the
// game keeps them): AdventureState.roomSwitches.
import { LAYER_TILES, solidMask, surfaceOf } from "@fso/formats";
import { CRYSTAL_LIT_TILE, CRYSTAL_UNLIT_TILE } from "../arenatiles.ts";
import { isRemoved, removeEntity, tileIndexAt } from "../entities.ts";
import { ownSwitch, setSwitch, switchOn } from "../switches.ts";
import { SUBPX } from "../player.ts";
import { slopeCell, SURFACE_CODES, type World } from "../world.ts";
import { actorKey, currentArea, type AdventureGame } from "./adventure.ts";
import { countsAsEnemy, enemyActive } from "./enemies.ts";
import { recordTrail } from "./formation.ts";
import { burntTiles } from "./gear.ts";
import { FOUR_SNAP_TICKS } from "./motion.ts";
import { brokenTiles } from "./zoras.ts";
import { openDoorTiles } from "./doors.ts";
import { blockTiles } from "./tileblocks.ts";
import { quotaMet } from "./pickups.ts";
import type { AdventureStage, Area, AreaActor } from "./stage.ts";

/** A switchless PNPC acts while a Link is within this many px of it (0x8023AF14 with a ±48 box). */
export const PNPC_REACH = 48;
/** Ticks the camera takes to reach a FOCS before its switch turns on. TODO(measure): the camera's travel. */
export const FOCUS_ARRIVE_TICKS = 30;
/** The spikes' tile type (THRN), and the floor tile they leave lowered (assumed: tile 0, as the gate's PNPCs write). */
export const SPIKE_TYPE = 0x22;
const SPIKES_DOWN_TILE = 0;
/** Ticks from a drawbridge's switch to the one it sets (SPBG kind 0, measured), and from a gate's (kind 1, measured). */
export const BRIDGE_TICKS = 121;
export const GATE_TICKS = 31;
/**
 * YNSW (stepFourSwitch): its box's half size and how far up of the actor's position it lies (and the snap's corners),
 * 1/256 px; the Links' bodies meeting it (FOUR_SWITCH_REACH: the box and the body's ±7) are counted; the ticks they
 * must stay in before the snap, and the snap pose's tick its switch turns on (motion.ts FOUR_SNAP_TICKS its length).
 * Read from main.dol (0x8034E49C: the box ±15 from the init, 2.5 px up, a 5-tick countdown, then 15 + 30 ticks,
 * sprites 220-231 two ticks each, 232 ten more, the switch; 0x8034E050 the corners) and traced.
 */
export const FOUR_SWITCH_BOX = 15 * SUBPX;
export const FOUR_SWITCH_LIFT = 640;
export const FOUR_SWITCH_REACH = FOUR_SWITCH_BOX + 7 * SUBPX;
export const FOUR_SWITCH_WAIT = 5;
export const FOUR_SWITCH_ON_TICK = 79;
/** Where the snap puts the Links about the box's middle, 1/256 px. */
export const FOUR_SNAP_OFFSET = 8 * SUBPX;
/** GOL2's pads, x offsets then y offsets by params & 0x1F (main.dol 0x8046EA10, 0x8046EA70). */
export const GOAL_LAYOUTS: readonly (readonly number[])[] = [
  [0, 64, 0, 64, 0, 0, 64, 64],
  [0, -48, 48, 0, 0, 48, 48, 96],
  [0, 32, 64, 96, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 32, 64, 96],
  [0, 48, 112, 160, 0, 48, 48, 0],
  [0, 160, 0, 160, 0, 0, 96, 96],
];
/** A goal pad takes a Link this close to its anchor. TODO(measure). */
export const GOAL_PAD_HALF = 12;
/** The chests' tiles (chests.ts): closed, open. */
const CHEST_TILE = 0x30, OPEN_CHEST_TILE = 0x10;

const field = (params: number, shift: number) => (params >>> shift) & 31;

/** Whether a PNPC acts with this many players ((p >> 10) & 3, setup 0x802C8F28). */
function enoughPlayers(params: number, players: number): boolean {
  const cond = (params >>> 10) & 3;
  return cond === 0 || players >= [0, 3, 4, 2][cond]!;
}

/** Is a PNPC's tile shown now (or latched)? */
function pnpcActive(game: AdventureGame, params: number, x: number, y: number, latched: boolean): boolean {
  if (latched) return true;
  const sw = ownSwitch(params);
  if (sw) return switchOn(game.battle, sw);
  return game.players.some((p) => Math.abs(p.x / SUBPX - (x + 8)) <= PNPC_REACH && Math.abs(p.y / SUBPX - (y + 8)) <= PNPC_REACH);
}

/** The base-layer tiles the current area's PNPCs show instead of its own (tile index ty * 32 + tx → tile). */
export function rewrittenTiles(game: AdventureGame, stage: AdventureStage): Map<number, number> {
  const a = game.adventure, out = new Map<number, number>();
  const area = currentArea(game, stage);
  for (const actor of area.actors) {
    const p = actor.params >>> 0;
    if (actor.id !== "PNPC" || (p >>> 16) & 0xf || !enoughPlayers(p, 1)) continue;
    if (!pnpcActive(game, p, actor.x, actor.y, a.rewritten.includes(actorKey(a.room, actor.index)))) continue;
    out.set((actor.y >> 4) * LAYER_TILES + (actor.x >> 4), p & 0x3ff);
  }
  // Lowered spikes (THRN, latched in `rewritten`).
  const base = area.base;
  for (const actor of area.actors) {
    if (actor.id !== "THRN" || !base || !a.rewritten.includes(actorKey(a.room, actor.index))) continue;
    for (let i = 0; i < base.length; i++) if (stage.typeOf(base[i]! & 0x3ff) === SPIKE_TYPE) out.set(i, SPIKES_DOWN_TILE);
  }
  // Burnt stumps (gear.ts), open doors' stones (doors.ts).
  burntTiles(game, out);
  brokenTiles(game, stage, out);
  openDoorTiles(game, stage, out);
  blockTiles(game, stage, out);
  // Opened chests (chests.ts).
  for (const actor of area.actors) {
    if (actor.id !== "TKRA" || !a.opened.includes(actorKey(a.room, actor.index))) continue;
    const i = (actor.y >> 4) * LAYER_TILES + (actor.x >> 4);
    if ((out.get(i) ?? (area.base?.[i] ?? 0) & 0x3ff) === CHEST_TILE) out.set(i, OPEN_CHEST_TILE);
  }
  return out;
}

/**
 * What is drawn over the base layer for the PNPCs (apps/game, the playtest): rewrittenTiles, then the crystals' own
 * tiles over a PNPC's on their tiles (the battle's ONOF entities, as arenatiles.ts tileOverrides shows them). Collision
 * keeps rewrittenTiles': a dark crystal's base tile is what it collides as (room 3's is passable, 0x361).
 * Assumed: in the game the later write is the one on screen, and a crystal's tile follows its light.
 */
export function drawnRewrites(game: AdventureGame, stage: AdventureStage): Map<number, number> {
  const out = rewrittenTiles(game, stage);
  for (const e of game.battle.entities) {
    if (e.kind !== "crystal" || e.hp < 0) continue;
    out.set(tileIndexAt(Math.floor(e.x / SUBPX), Math.floor(e.y / SUBPX)), e.phase === "active" ? CRYSTAL_LIT_TILE : CRYSTAL_UNLIT_TILE);
  }
  return out;
}

/** GOL2's pads (area px). */
export function goalPads(a: AreaActor): { x: number; y: number }[] {
  const l = GOAL_LAYOUTS[a.params & 0x1f] ?? GOAL_LAYOUTS[0]!;
  return [0, 1, 2, 3].map((i) => ({ x: a.x + l[i]!, y: a.y + l[4 + i]! }));
}

/** The pad of a goal a Link stands on, or -1. */
export function padUnder(a: AreaActor, x: number, y: number): number {
  return goalPads(a).findIndex((p) => Math.abs(x - p.x) <= GOAL_PAD_HALF && Math.abs(y - p.y) <= GOAL_PAD_HALF);
}

/** One tick of the area's PNPCs (latching), ZNSWs, spikes, drawbridges and FOCSes, after the enemies and the arena stepped. */
export function stepLogic(game: AdventureGame, stage: AdventureStage): void {
  const a = game.adventure, b = game.battle;
  const area = currentArea(game, stage);
  const beaten = !a.enemies.some((e) => countsAsEnemy(e) && enemyActive(e)) && !(a.ganon && !a.ganon.gone);
  for (const actor of area.actors) {
    const p = actor.params >>> 0;
    switch (actor.id) {
      case "PNPC": {
        const key = actorKey(a.room, actor.index);
        if ((p >>> 20) & 7 || (p >>> 16) & 0xf || !enoughPlayers(p, 1) || a.rewritten.includes(key)) break;
        if (pnpcActive(game, p, actor.x, actor.y, false)) a.rewritten.push(key);
        break;
      }
      case "THRN": {
        const key = actorKey(a.room, actor.index);
        const down = (p & 0xff) === 0 ? switchOn(b, ownSwitch(p)) : beaten;
        if (down && !a.rewritten.includes(key)) a.rewritten.push(key);
        break;
      }
      case "ZNSW": {
        const kind = p & 31, mode = field(p, 7);
        if (kind > 1) break;
        if (beaten) setSwitch(b, ownSwitch(p), true);
        else if (mode === 1) setSwitch(b, ownSwitch(p), false);
        break;
      }
      case "GOL2": {
        if (a.cleared || !quotaMet(game)) break;
        const l = game.players[0]!;
        if (b.fighters[0]!.mode === "active" && padUnder(actor, l.x / SUBPX, l.y / SUBPX) >= 0) a.cleared = game.tick + 1;
        break;
      }
      case "SPBG": {
        const input = ownSwitch(p), out = field(p, 22), key = actorKey(a.room, actor.index);
        if (!input || !out || switchOn(b, out) || !switchOn(b, input)) break;
        let k = 0;
        while (k < a.bridges.length && a.bridges[k] !== key) k += 2;
        if (k >= a.bridges.length) a.bridges.push(key, game.tick);
        else if (game.tick - a.bridges[k + 1]! >= ((p & 15) === 1 ? GATE_TICKS : BRIDGE_TICKS)) setSwitch(b, out, true);
        break;
      }
      case "FOCS": {
        const out = ownSwitch(p), input = field(p, 22);
        if ((out && switchOn(b, out)) || (input && !switchOn(b, input))) break;
        if (!a.focus || a.focus.actor !== actor.index) {
          if (!out || a.focus) break; // a switchless focus only moves the camera (not done); one at a time
          a.focus = { actor: actor.index, x: actor.x, y: actor.y, tick: 0 };
        }
        if (++a.focus.tick >= FOCUS_ARRIVE_TICKS) {
          setSwitch(b, out, true);
          a.focus = null;
        }
        break;
      }
    }
  }
  latchMonitors(b);
}

/**
 * The area's four-Link switch (YNSW), before the Links walk this tick: counts the ticks the four have stood in its box,
 * snaps them onto its corners once they stayed FOUR_SWITCH_WAIT, then plays the pose out (its switch on
 * FOUR_SWITCH_ON_TICK ticks in). Returns whether the Links are held in the pose this tick.
 */
export function stepFourSwitch(game: AdventureGame, stage: AdventureStage): boolean {
  const a = game.adventure, b = game.battle;
  const actor = currentArea(game, stage).actors.find((s) => s.id === "YNSW" && ownSwitch(s.params >>> 0) && !switchOn(b, ownSwitch(s.params >>> 0)));
  if (a.fourSnap >= 0) {
    if (++a.fourSnap === FOUR_SWITCH_ON_TICK && actor) setSwitch(b, ownSwitch(actor.params >>> 0), true);
    if (a.fourSnap >= FOUR_SNAP_TICKS) a.fourSnap = -1;
    return a.fourSnap >= 0;
  }
  const x = actor ? actor.x * SUBPX : 0, y = actor ? actor.y * SUBPX - FOUR_SWITCH_LIFT : 0;
  const all = !!actor && b.fighters[0]!.mode === "active" && game.players.length === 4 &&
    game.players.every((p) => Math.abs(p.x - x) <= FOUR_SWITCH_REACH && Math.abs(p.y - y) <= FOUR_SWITCH_REACH);
  if (!all) {
    a.fourCatch = 0;
    return false;
  }
  if (a.fourCatch++ < FOUR_SWITCH_WAIT) return false;
  a.fourCatch = 0;
  snapFour(game, actor.x * SUBPX, actor.y * SUBPX);
  a.fourSnap = 0;
  return true;
}

/**
 * The snap (0x8034E050): the corners left top, left bottom, right top, right bottom in turn each take the Link nearest
 * a point 60 px out that way from the actor (of those left; the first of equals), put 8 px each way off the box's
 * middle, his walk stopped.
 */
function snapFour(game: AdventureGame, x: number, y: number): void {
  const left = game.players.map((_, i) => i);
  for (const [sx, sy] of [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const) {
    const fx = x + sx * 60 * SUBPX, fy = y + sy * 60 * SUBPX;
    const far = (i: number) => (game.players[i]!.x - fx) ** 2 + (game.players[i]!.y - fy) ** 2;
    let best = 0;
    left.forEach((i, k) => {
      if (far(i) < far(left[best]!)) best = k;
    });
    const i = left.splice(best, 1)[0]!;
    Object.assign(game.players[i]!, { x: x + sx * FOUR_SNAP_OFFSET, y: y - FOUR_SWITCH_LIFT + sy * FOUR_SNAP_OFFSET, moving: false, walkTicks: 0 });
    recordTrail(game, i);
  }
}

/**
 * SWT4 in the adventure (update 0x802A96B0): once its four inputs are on, modes other than 0 and 3 keep its switch on
 * for good, the actor gone (traced: Lake Hylia room 58's middle room, switch 16 still on after a Link stepped off one
 * of its four floor switches). Shadow Battle's switches.ts keeps only mode 2 (its arenas take another branch: TODO
 * check), so the adventure ends the others here, the tick they turn on.
 */
function latchMonitors(b: AdventureGame["battle"]): void {
  for (const e of b.entities) {
    const prop = e.kind === "logic" ? b.props.actors[e.home] : undefined;
    if (prop?.id !== "SWT4" || e.phase !== "active" || isRemoved(e)) continue;
    const mode = prop.params & 31;
    if (mode !== 0 && mode !== 3) removeEntity(e);
  }
}

const rewritten = new WeakMap<World, Map<string, World>>();

/** `world` (an area's collision) with rewritten tiles' collision (cached per distinct set of rewrites). */
export function rewriteWorld(world: World, tiles: ReadonlyMap<number, number>, stage: AdventureStage): World {
  if (!tiles.size) return world;
  const key = [...tiles].map(([i, t]) => `${i}:${t}`).join(",");
  let cache = rewritten.get(world);
  if (!cache) rewritten.set(world, (cache = new Map()));
  const hit = cache.get(key);
  if (hit) return hit;
  const solid = world.solid.slice(), surface = world.surface.slice();
  let slopes = world.slopes?.slice();
  for (const [index, tile] of tiles) {
    const type = stage.typeOf(tile), mask = solidMask(type), code = SURFACE_CODES.indexOf(surfaceOf(type));
    const tx = index % LAYER_TILES, ty = Math.floor(index / LAYER_TILES);
    for (let q = 0; q < 4; q++) {
      const cx = tx * 2 + (q & 1), cy = ty * 2 + (q >> 1);
      if (cx >= world.widthCells || cy >= world.heightCells) continue;
      solid[cy * world.widthCells + cx] = mask & (1 << q) ? 1 : 0;
      surface[cy * world.widthCells + cx] = code;
      const slope = slopeCell(type, q);
      if (slope || slopes) (slopes ??= new Uint8Array(solid.length))[cy * world.widthCells + cx] = slope;
    }
  }
  const out: World = { ...world, solid, surface, ...(slopes ? { slopes } : {}) };
  if (cache.size > 32) cache.clear();
  cache.set(key, out);
  return out;
}

/**
 * How a GBA top-layer mode blends the top layer over what is under it (header, VWMD): the GBA's EVA and EVB (16ths: the
 * top layer's color × eva / 16 + what is under it × evb / 16); null: drawn as it is.
 */
export const TOP_MODE_BLEND: readonly ({ eva: number; evb: number } | null)[] = [null, { eva: 8, evb: 15 }, { eva: 0, evb: 14 }, null];

/** The current GBA-screen area's top-layer mode in force (Area.topMode while its switch, if any, is on; else 0). */
export function topModeOf(game: AdventureGame, area: Area): number {
  if (!area.topMode || (area.topModeGate && !switchOn(game.battle, area.topModeGate))) return 0;
  return area.topMode;
}

/** A room's saved switches (0 when it was never left). */
export function savedSwitches(game: AdventureGame, room: number): number {
  const s = game.adventure.roomSwitches;
  for (let i = 0; i < s.length; i += 2) if (s[i] === room) return s[i + 1]!;
  return 0;
}

/** Saves a room's switches. */
export function saveSwitches(game: AdventureGame, room: number, switches: number): void {
  const s = game.adventure.roomSwitches;
  for (let i = 0; i < s.length; i += 2) {
    if (s[i] === room) {
      s[i + 1] = switches >>> 0;
      return;
    }
  }
  s.push(room, switches >>> 0);
}
