// The Links' bow in the adventure (item 4; the Cave of No Return's second item, after the lamp). Shooting is the battle
// code's (items.ts: the pose, the arrow on its 7th tick; projectiles.ts: 5 px/tick, stuck in a wall 35 ticks; the
// leader's fighter `item` is "bow": gear.ts giveGear); arrows hurt enemies (enemies.ts arenaAttacks). The adventure adds,
// from main.dol:
// - ARRW's wall test (a method of its vtable, 0x8016636C): an arrow flies over pits, water and the floor's types, and
//   over the solid tiles 0x3A and 0x3D (the candle stands the torches and the candle switches stand on), so it crosses
//   a torch's stand; (when its +0x94 is 0 or 4, tiles 0x40-0x9A too: TODO(measure), not done);
// - ONOF (update 0x802CB230) lights for any of a Link's attacks meeting it (0x8023BA68 → 0x80273C30, which walks his
//   arrow slots +0xB00 too), as for the sword (gear.ts swordOnCrystals);
// - ARRW's update (0x80165730) shows a flame on an arrow while its +0x94 is 2 or 4 (effect 189, the torches' own
//   flame); an arrow meeting an eternal flame (FLME, or a burning BLZ2) stops and burns out in 20 ticks; a candle switch
//   (LWSW, update 0x802BE9E0) lights when its +0x94 is set, besides a Link's fire and FIRE fireballs. The guides: arrows
//   shot through a lit torch catch fire and light the torches they reach (the Cave of No Return's room 3: the lit
//   torches on the near ledge stand in line with the four candles across the pit).
// - an arrow flying into a warp's box (a door) goes on in the area it leads to (traced: room 5's gatehouse in Hyrule
//   Castle, shot down over its pit through the south door, lit the crystal 48 px below the door's way out on the TV,
//   switch 17 on 20 ticks after the arrow left the bow). The sim plays one area at a time: the arrow's flight there is
//   worked out at once (that area's walls and crystals), and a crystal it reaches lights as many ticks later.
// Assumed: what sets an arrow alight (passing over a lit torch: TRCH lit, ±8 px; TODO(measure)), and that a burning
// arrow lights a candle switch its box meets (LWSW's ±10 px), burning until it's gone.
import { boxAround, boxesOverlap, isRemoved, type Entity } from "../entities.ts";
import { SHOT_LIFETIME } from "../projectiles.ts";
import { SUBPX } from "../player.ts";
import { setSwitch, switchOn } from "../switches.ts";
import { isSolidAt, type World } from "../world.ts";
import { currentArea, type AdventureGame } from "./adventure.ts";
import { lightCrystal } from "./gear.ts";
import { CANDLE_HALF, candles, torchLit } from "./lamp.ts";
import { rewrittenTiles } from "./logic.ts";
import type { AdventureStage, Area } from "./stage.ts";

/** Solid tiles an arrow flies over (ARRW's wall test). */
export const ARROW_PASS_TILES: ReadonlySet<number> = new Set([0x3a, 0x3d]);
/** An arrow's `param` flags besides projectiles.ts SHOT_DRAWN (1): burning, spent on a crystal, gone through a door
 *  into another area (`home` then the crystal it's to reach there: its index in the room's list, -1 none). */
export const ARROW_BURNING = 2;
export const ARROW_SPENT = 4;
export const ARROW_AWAY = 8;
/** Where an arrow gone through a door waits out its flight (out of sight), 1/256 px. */
const AWAY_AT = -4096 * SUBPX;
/** A lit torch sets an arrow alight within this many px of its anchor (TODO(measure)). */
export const TORCH_HALF = 8;
/** A crystal's box (as for the sword, gear.ts) and an arrow's (projectiles.ts SHOT_HALF), px. */
const CRYSTAL_HALF = 8;
const ARROW_HALF = 3;

/** The world the arrows see: `world` with the candle stands (ARROW_PASS_TILES) open. */
export function arrowWorld(world: World, game: AdventureGame, stage: AdventureStage): World {
  const area = currentArea(game, stage), base = area.base;
  if (!base) return world;
  const cached = seen.get(world);
  if (cached) return cached;
  const rewritten = rewrittenTiles(game, stage);
  let solid: Uint8Array | null = null;
  for (let i = 0; i < base.length; i++) {
    if (!ARROW_PASS_TILES.has(rewritten.get(i) ?? base[i]! & 0x3ff)) continue;
    solid ??= world.solid.slice();
    const tx = i % 32, ty = Math.floor(i / 32);
    for (let q = 0; q < 4; q++) {
      const cx = tx * 2 + (q & 1), cy = ty * 2 + (q >> 1);
      if (cx < world.widthCells && cy < world.heightCells) solid[cy * world.widthCells + cx] = 0;
    }
  }
  const out = solid ? { ...world, solid } : world;
  seen.set(world, out);
  return out;
}
const seen = new WeakMap<World, World>();

/** The Links' arrows in flight. */
const flying = (game: AdventureGame): Entity[] => game.battle.entities.filter((e) => e.kind === "arrow" && e.owner >= 0 && e.phase === "flying" && !isRemoved(e));

/** Whether an arrow is alight. */
export const arrowBurning = (e: Entity): boolean => (e.param & ARROW_BURNING) !== 0;

/** After the arena's things moved: arrows over a lit torch catch fire, burning ones light candles, any lights crystals. */
export function stepArrows(game: AdventureGame, stage: AdventureStage): void {
  arrowsAway(game, stage);
  const crystals = game.battle.entities.filter((e) => e.kind === "crystal" && !isRemoved(e));
  // One stuck this tick in a crystal's own tile met the crystal where it struck (projectiles.ts puts it back a step).
  for (const e of game.battle.entities) {
    if (e.kind !== "arrow" || e.owner < 0 || e.phase !== "rest" || e.tick !== 0 || e.param & ARROW_SPENT || isRemoved(e)) continue;
    const hit = crystals.find((c) => boxesOverlap(boxAround(e.x + e.vx, e.y + e.vy, ARROW_HALF), boxAround(c.x, c.y, CRYSTAL_HALF)));
    if (hit) {
      e.param |= ARROW_SPENT;
      lightCrystal(game, hit);
    }
  }
  const arrows = flying(game);
  if (!arrows.length) return;
  const area = currentArea(game, stage);
  const torches = area.actors.filter((t) => t.id === "TRCH" && torchLit(game, t));
  const switches = candles(game, stage);
  for (const e of arrows) {
    const box = boxAround(e.x, e.y, ARROW_HALF);
    if (!arrowBurning(e) && torches.some((t) => boxesOverlap(box, boxAround(t.x * SUBPX, t.y * SUBPX, TORCH_HALF)))) e.param |= ARROW_BURNING;
    if (arrowBurning(e)) {
      for (const c of switches) if (boxesOverlap(box, boxAround((c.x + 8) * SUBPX, (c.y + 8) * SUBPX, CANDLE_HALF))) setSwitch(game.battle, c.params >>> 27, true);
    }
    if (e.param & ARROW_SPENT) continue;
    const hit = crystals.find((c) => boxesOverlap(box, boxAround(c.x, c.y, CRYSTAL_HALF)));
    if (hit) {
      e.param |= ARROW_SPENT;
      lightCrystal(game, hit);
    }
  }
}

/**
 * Arrows through a door: one flying into a door's box of the current area that leads to another goes on there (out of
 * sight: its flight there worked out at once, ARROW_AWAY); one whose flight there ends on a crystal lights it when it
 * gets there.
 */
function arrowsAway(game: AdventureGame, stage: AdventureStage): void {
  const a = game.adventure;
  for (const e of game.battle.entities) {
    if (e.kind !== "arrow" || e.owner < 0 || isRemoved(e)) continue;
    if (e.param & ARROW_AWAY) {
      if (e.timer !== 1 || e.home < 0) continue;
      const prop = stage.actorList(a.room)[e.home];
      if (prop) awayCrystal(game, prop.params);
      continue;
    }
    if (e.phase !== "flying") continue;
    const x = Math.floor(e.x / SUBPX), y = Math.floor(e.y / SUBPX);
    const door = currentArea(game, stage).doors.find((d) => d.to.area !== a.area && x >= d.x && x < d.x + 16 && y >= d.y && y < d.y + 16);
    if (!door || !stage.hasArea(a.room, door.to.area)) continue;
    const there = stage.area(a.room, door.to.area);
    const flight = flightThere(there, e.x + (door.to.x - door.x) * SUBPX, e.y + (door.to.y - door.y) * SUBPX, e.vx, e.vy);
    e.param |= ARROW_AWAY;
    e.phase = "rest";
    e.timer = flight.ticks + 1;
    e.home = flight.crystal;
    e.x = e.y = AWAY_AT;
    e.vx = e.vy = 0;
  }
}

/** An arrow's flight in another area from (x, y): the crystal it reaches (its index in the room's list, -1 none) and in how many ticks. */
function flightThere(area: Area, x: number, y: number, vx: number, vy: number): { crystal: number; ticks: number } {
  const crystals = area.actors.filter((c) => c.id === "ONOF");
  for (let t = 1; t <= SHOT_LIFETIME && (vx || vy); t++) {
    x += vx;
    y += vy;
    const box = boxAround(x, y, ARROW_HALF);
    const hit = crystals.find((c) => boxesOverlap(box, boxAround((c.x + 8) * SUBPX, (c.y + 8) * SUBPX, CRYSTAL_HALF)));
    if (hit) return { crystal: hit.index, ticks: t };
    if (isSolidAt(area.world, Math.floor(x / SUBPX), Math.floor(y / SUBPX))) break;
  }
  return { crystal: -1, ticks: 0 };
}

/** A crystal in another area struck (gear.ts lightCrystal without its entity): its switch on, or off for a lit toggle one. */
function awayCrystal(game: AdventureGame, params: number): void {
  const own = params >>> 27, kind = (params >>> 12) & 7;
  setSwitch(game.battle, own, (kind === 1 || kind === 3) && switchOn(game.battle, own) ? false : true);
}
