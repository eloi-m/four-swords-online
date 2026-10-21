// Color blocks (BCK2, "カラーブロック１人用": the Cave of No Return's room 0, 22 of them; init 0x803754E8, update
// 0x80374BAC). Read from main.dol: a 16 px block on its tile's middle, its color (p >> 2) & 7 (1-4 = the Link of that
// tunic, green, red, blue, purple; 0 any Link; 5 a color picked at random among those the others don't have: unused in
// World 1), its way p & 3 (right, left, down, up). It moves only for the Link of its color leaning on it the way it
// goes, one tile, then it's done (its color gone, it moves no more); (p >> 8) & 15 makes it still from the start, and
// with params bit 5 clear the save keeps it moved (every block of room 0 has it set: they come back with the room).
// Playing alone that Link must be the one in control (formation.ts: apart, the D-pad's pick). Its slide here is the
// movable tiles' (tileblocks.ts: 0.5 px/tick over 16 px, the Link with it; table 0x804750C0 holds 0.5).
import { SUBPX, type Facing } from "../player.ts";
import { isSolidAt, type World } from "../world.ts";
import { currentArea, type AdventureGame } from "./adventure.ts";
import type { AdventureStage, AreaActor } from "./stage.ts";
import { BLOCK_SLIDE_TICKS } from "./tileblocks.ts";

const WAYS: readonly Facing[] = ["right", "left", "down", "up"];
const STEP: Readonly<Record<Facing, readonly [number, number]>> = { right: [1, 0], left: [-1, 0], down: [0, 1], up: [0, -1] };

/** A color block's color: 0 any Link, 1-4 the Link of that tunic (green, red, blue, purple). */
export const blockColor = (a: AreaActor): number => (a.params >>> 2) & 7;
const wayOf = (a: AreaActor): Facing => WAYS[a.params & 3]!;
const isColorBlock = (a: AreaActor) => a.id === "BCK2";

/** A color block as it stands: its tile's top-left (area px; between two tiles while it slides), done once moved. */
export interface ColorBlockView {
  actor: AreaActor;
  x: number;
  y: number;
  /** Moved (or still from the start): no color, no more pushes. */
  done: boolean;
}

/** The current area's color blocks where they are now (AdventureState.colorBlocks: actor index, ticks into its slide…). */
export function colorBlocks(game: AdventureGame, stage: AdventureStage): ColorBlockView[] {
  const moved = game.adventure.colorBlocks;
  return currentArea(game, stage).actors.filter(isColorBlock).map((actor) => {
    const x0 = (actor.x >> 4) * 16, y0 = (actor.y >> 4) * 16;
    let tick = -1;
    for (let k = 0; k < moved.length; k += 2) if (moved[k] === actor.index) tick = moved[k + 1]!;
    if (tick < 0) return { actor, x: x0, y: y0, done: ((actor.params >>> 8) & 15) !== 0 };
    const [dx, dy] = STEP[wayOf(actor)], d = (Math.min(tick, BLOCK_SLIDE_TICKS) * 16) / BLOCK_SLIDE_TICKS;
    return { actor, x: x0 + dx * d, y: y0 + dy * d, done: true };
  });
}

/** The world with the color blocks solid (a sliding one at both its tiles). */
export function colorBlockWorld(world: World, game: AdventureGame, stage: AdventureStage): World {
  const blocks = colorBlocks(game, stage);
  if (!blocks.length) return world;
  const solid = world.solid.slice();
  const fill = (tx: number, ty: number) => {
    for (let q = 0; q < 4; q++) {
      const gx = tx * 2 + (q & 1), gy = ty * 2 + (q >> 1);
      if (gx >= 0 && gy >= 0 && gx < world.widthCells && gy < world.heightCells) solid[gy * world.widthCells + gx] = 1;
    }
  };
  for (const b of blocks) {
    fill(Math.floor(b.x / 16), Math.floor(b.y / 16));
    fill(Math.ceil(b.x / 16), Math.ceil(b.y / 16));
  }
  return { ...world, solid };
}

/**
 * After the leader's step (`view` without the color blocks' slides of this tick): a sliding block moves on, the Link
 * leaning on it with it; else one he leans on starts sliding if it's his color, goes his way and the tile beyond is free.
 */
export function stepColorBlocks(game: AdventureGame, stage: AdventureStage, view: World): void {
  const a = game.adventure, p = game.players[0]!, moved = a.colorBlocks;
  let sliding = false;
  for (let k = 0; k < moved.length; k += 2) {
    if (moved[k + 1]! >= BLOCK_SLIDE_TICKS) continue;
    moved[k + 1]!++;
    sliding = true;
    const actor = currentArea(game, stage).actors.find((x) => x.index === moved[k]);
    if (actor && a.push.on) {
      const [dx, dy] = STEP[wayOf(actor)];
      p.x += (dx * SUBPX) / 2;
      p.y += (dy * SUBPX) / 2;
    }
  }
  if (sliding || !a.push.on) return;
  const [dx, dy] = STEP[p.facing];
  const fx = Math.floor(p.x / SUBPX) + dx * 8, fy = Math.floor(p.y / SUBPX) + dy * 8;
  const blocks = colorBlocks(game, stage);
  const b = blocks.find((q) => !q.done && fx >= q.x && fx < q.x + 16 && fy >= q.y && fy < q.y + 16);
  if (!b || wayOf(b.actor) !== p.facing) return;
  const color = blockColor(b.actor);
  if (color && (a.colors[0] ?? 0) !== color - 1) return;
  const tx = b.x / 16 + dx, ty = b.y / 16 + dy;
  if (isSolidAt(view, tx * 16 + 8, ty * 16 + 8)) return;
  const inside = (x: number, y: number) => Math.abs(x / SUBPX - (tx * 16 + 8)) < 16 && Math.abs(y / SUBPX - (ty * 16 + 8)) < 16;
  if (a.enemies.some((e) => e.life > 0 && inside(e.x, e.y))) return;
  moved.push(b.actor.index, 0);
}
