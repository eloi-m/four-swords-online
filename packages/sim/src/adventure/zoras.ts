// Hyrule Castle's escort Zoras and room 7's barrier (docs/ADVENTURE.md "Hyrule Castle": the barrier's rule, read from
// main.dol, not traced):
// - BARI (ctor 0x8011FD28) stands while its switch p >> 27 is off (16 in room 7; measured: poking 16 took it away), a
//   wall across the corridor. Assumed: its box ±32 × ±8 around its anchor (the corridor's width; measured: the Links
//   held below it, shocked back to y 197). The shock itself is not done.
// - FAZR, the Zora to fetch, follows the Link who meets it (0x801EEC98) from area to area and room to room, and in the
//   room of its arrival point (an FZRA waiting for the switch it sets, p >> 27) walks there and sets that switch.
//   Traced (room 58's areas 3 and 2, measurements/adventure-world1.md "Hyrule Castle room 58's area 2"): its talk began
//   with the Link 46.7 px away (MEET_REACH; the talk itself, which holds him ~330 ticks, is not done); it then walks
//   16-22 px behind the Link in control at his pace, stopped by walls and pits (it waited at the pits' edge); left
//   more than DASH_FROM px behind by him walking on, it dashes straight at him at DASH_SPEED over anything, then walks
//   again; into another area it comes in FOLLOW_GAP px behind him. Assumed: it follows the Link in control (it did in both traces;
//   the game keeps the one who met it at +0x3CC); it walks to the FZRA's spot (the game: the farther of its two rails,
//   (p >> 8) & 0xFF and (p >> 16) & 0xFF).
// - FZRA, the arrival point, waits for its switch (p >> 22) & 31; once every FZRA of the room waits, 60 + 120 + 60
//   ticks (states 12, 13, 14) on the great fairy (SPFR) comes with switch p >> 27 (16). Assumed: 16 the tick she comes
//   (her own scene is not read).
// - The fragile blocks (tile type 0x53, room 9's area 5 column in front of its Zora) break where a bomb's blast meets
//   them (assumed: what breaks them is not read; the Links carry bombs from room 9's area 2). They show the tile
//   beside them in the row (assumed: the background behind).
import { BLAST_HALF } from "../bombs.ts";
import { FACING_STEP, isRemoved } from "../entities.ts";
import { SUBPX } from "../player.ts";
import { setSwitch, switchOn } from "../switches.ts";
import { isSolidAt, surfaceAt, type World } from "../world.ts";
import { actorKey, areaWorld, currentArea, type AdventureGame } from "./adventure.ts";
import { openScripted } from "./dialogue.ts";
import { tileKey } from "./gear.ts";
import type { AdventureStage, AreaActor } from "./stage.ts";

/** The fragile blocks' tile type. */
export const FRAGILE_TYPE = 0x53;
/** The barrier's half width and half height (px). Assumed. */
const BARRIER_HALF_W = 32, BARRIER_HALF_H = 8;
/** A Link nearer than this (px) meets a Zora (traced: its talk began at 46.7 px, not at 48.2). */
export const MEET_REACH = 48;
/** The Zora keeps this far (px) behind the Link, at most ZORA_SPEED a tick (traced: 16-22 px, his 1.5 px pace). */
const FOLLOW_GAP = 16, ZORA_SPEED = 1.5 * SUBPX;
/** Left further behind than this (px) by him walking on, it dashes at him at DASH_SPEED until FOLLOW_GAP (traced: 47.7 px
 *  and 76 px from a Link standing it waited at the pits, 49 px from one walking off it dashed, 5 px a tick). */
export const DASH_FROM = 48;
const DASH_SPEED = 5 * SUBPX;
/** Where the Zora walks: clear of walls and pits (px from its anchor; traced: it stopped at y 137, the pits from 144). */
const ZORA_SENSORS: readonly (readonly [number, number])[] = [[0, -7], [0, 7], [-7, 0], [7, 0]];
/** All the room's arrival points waiting, the great fairy comes after (states 12-14: 60, 120, 60 ticks; read). */
export const FAIRY_TICKS = 240;
/**
 * The greeting an escort Zora opens on meeting the Link (its talk, which holds him): messages 692 then 691 (0x2B4 "Who...
 * Who is it?", then 0x2B3 "The world is in turmoil..."), in that order (assumed; main.dol's ids 691, 692 by the Zora's
 * code). Measured by main's Dolphin run: the talk held him ~330 ticks (~16 A presses); a fast reader's typing of these two
 * is ~270 ticks. TODO(measure) the ids and order.
 */
export const ESCORT_GREETING: readonly number[] = [0x2b4, 0x2b3];

/** The Zora following the Links: its actor key, the switch it sets on arriving, its room and area, where (1/256 px), dashing. */
export interface Escort {
  key: number;
  sw: number;
  room: number;
  area: number;
  x: number;
  y: number;
  dash: boolean;
}

const waitsFor = (a: AreaActor) => (a.params >>> 22) & 31;
const sets = (a: AreaActor) => a.params >>> 27;

/** Whether a barrier stands now. */
export function barrierUp(game: AdventureGame, a: AreaActor): boolean {
  return a.id === "BARI" && !switchOn(game.battle, sets(a));
}

/** The current area's standing barriers as solid boxes. */
export function barrierWorld(world: World, game: AdventureGame, stage: AdventureStage): World {
  const up = currentArea(game, stage).actors.filter((a) => barrierUp(game, a));
  if (!up.length) return world;
  const boxes = [...(world.boxes ?? [])];
  for (const b of up) boxes.push({ left: b.x - BARRIER_HALF_W, top: b.y - BARRIER_HALF_H, right: b.x + BARRIER_HALF_W - 1, bottom: b.y + BARRIER_HALF_H - 1 });
  return { ...world, boxes };
}

/** The Zoras, the arrival points and the fragile blocks, one tick (after the arena stepped). */
export function stepZoras(game: AdventureGame, stage: AdventureStage): void {
  const a = game.adventure, b = game.battle, area = currentArea(game, stage);
  breakBlocks(game, stage);
  const leader = game.players[0]!;
  // Met: the Zora goes with the Links.
  if (!a.escort) {
    for (const z of area.actors) {
      const key = actorKey(a.room, z.index);
      if (z.id !== "FAZR" || a.taken.includes(key)) continue;
      if (Math.hypot(leader.x / SUBPX - z.x, leader.y / SUBPX - z.y) >= MEET_REACH) continue;
      a.taken.push(key);
      a.escort = { key, sw: sets(z), room: a.room, area: a.area, x: z.x * SUBPX, y: z.y * SUBPX, dash: false };
      if (!a.talk) openScripted(game, stage, z.index, ESCORT_GREETING[0]!, "balloon", ESCORT_GREETING.slice(1));
      break;
    }
  }
  // While its greeting holds the Links, the Zora stands (assumed: it walks behind them after).
  const e = a.talk ? null : a.escort;
  if (e) {
    // Into another area or room with the Links: FOLLOW_GAP behind him.
    if (e.room !== a.room || e.area !== a.area) {
      const [fx, fy] = FACING_STEP[leader.facing];
      Object.assign(e, { room: a.room, area: a.area, x: leader.x - fx * FOLLOW_GAP * SUBPX, y: leader.y - fy * FOLLOW_GAP * SUBPX, dash: false });
    }
    const point = area.actors.find((z) => z.id === "FZRA" && waitsFor(z) === e.sw);
    const tx = point ? point.x * SUBPX : leader.x, ty = point ? point.y * SUBPX : leader.y;
    const dx = tx - e.x, dy = ty - e.y, d = Math.hypot(dx, dy), gap = point ? 0 : FOLLOW_GAP * SUBPX;
    if (!point && leader.moving && d > DASH_FROM * SUBPX) e.dash = true;
    if (e.dash) {
      const step = Math.min(DASH_SPEED, d - gap);
      e.x += Math.round((dx / d) * step);
      e.y += Math.round((dy / d) * step);
      if (d - step <= gap) e.dash = false;
    } else if (d > gap) {
      const step = Math.min(ZORA_SPEED, d - gap), world = areaWorld(game, stage);
      const nx = e.x + Math.round((dx / d) * step), ny = e.y + Math.round((dy / d) * step);
      // (To its arrival point it goes along its rails: straight there, assumed.)
      if (point || zoraFree(world, nx, e.y)) e.x = nx;
      if (point || zoraFree(world, e.x, ny)) e.y = ny;
    }
    if (point && Math.abs(tx - e.x) <= SUBPX && Math.abs(ty - e.y) <= SUBPX) {
      setSwitch(b, e.sw, true);
      a.escort = null;
    }
  }
  // The arrival points: all waiting, the great fairy, then their switch.
  const points = area.actors.filter((z) => z.id === "FZRA");
  if (points.length && points.every((z) => switchOn(b, waitsFor(z))) && points.some((z) => !switchOn(b, sets(z)))) {
    if (++a.fairy >= FAIRY_TICKS) {
      for (const z of points) setSwitch(b, sets(z), true);
      a.fairy = 0;
    }
  } else a.fairy = 0;
}

/** Whether the Zora may walk onto (x, y) (1/256 px): no wall nor pit at its sensors. */
function zoraFree(world: World, x: number, y: number): boolean {
  const px = x / SUBPX, py = y / SUBPX;
  return ZORA_SENSORS.every(([sx, sy]) => !isSolidAt(world, px + sx, py + sy) && surfaceAt(world, px + sx, py + sy) !== "pit");
}

/** Bombs' blasts break the fragile blocks they meet, for good. */
function breakBlocks(game: AdventureGame, stage: AdventureStage): void {
  const a = game.adventure, base = currentArea(game, stage).base;
  if (!base) return;
  for (const x of game.battle.entities) {
    if (x.kind !== "explosion" || isRemoved(x)) continue;
    const cx = x.x / SUBPX, cy = x.y / SUBPX;
    for (let ty = Math.max(0, (cy - BLAST_HALF) >> 4); ty <= Math.min(31, (cy + BLAST_HALF - 1) >> 4); ty++) {
      for (let tx = Math.max(0, (cx - BLAST_HALF) >> 4); tx <= Math.min(31, (cx + BLAST_HALF - 1) >> 4); tx++) {
        const i = ty * 32 + tx, key = tileKey(a.room, a.area, i);
        if (stage.typeOf(base[i]!) === FRAGILE_TYPE && !a.broken.includes(key)) a.broken.push(key);
      }
    }
  }
}

/** The tiles the broken blocks show (tile index → tile), for logic.ts' rewrites: the nearest other tile in the row. */
export function brokenTiles(game: AdventureGame, stage: AdventureStage, out: Map<number, number>): void {
  const a = game.adventure, from = tileKey(a.room, a.area, 0), base = currentArea(game, stage).base;
  if (!base) return;
  for (const key of a.broken) {
    if (key < from || key >= from + 1024) continue;
    const i = key - from, row = i - (i % 32);
    for (let d = 1; d < 32; d++) {
      const j = [i - d, i + d].find((k) => k >= row && k < row + 32 && stage.typeOf(base[k]!) !== FRAGILE_TYPE);
      if (j === undefined) continue;
      out.set(i, base[j]! & 0x3ff);
      break;
    }
  }
}
