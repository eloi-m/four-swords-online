// Test helpers for Shadow Battle (not exported from the package): ASCII worlds, a match past its countdown, stepping.
import { MAP_GRID } from "@fso/formats";
import { COUNTDOWN_TICKS, createBattle, type BattleRules, type Spawn } from "./battle.ts";
import { stepGame, type GameState } from "./game.ts";
import { SUBPX } from "./player.ts";
import { NO_PROPS, type ArenaProps } from "./props.ts";
import type { World } from "./world.ts";

/** A world from ASCII rows, one character per 8×8 cell: '#' solid, 'O' pit, 'H' ladder, anything else floor. */
export function worldFrom(rows: string[]): World {
  const widthCells = rows[0]!.length, heightCells = rows.length;
  const solid = new Uint8Array(widthCells * heightCells), surface = new Uint8Array(widthCells * heightCells);
  rows.forEach((row, y) =>
    [...row].forEach((c, x) => {
      if (c === "#") solid[y * widthCells + x] = 1;
      if (c === "O") surface[y * widthCells + x] = 1; // SURFACE_CODES[1] = "pit"
      if (c === "H") surface[y * widthCells + x] = 6; // SURFACE_CODES[6] = "ladder"
    }),
  );
  const rooms = new Int16Array(MAP_GRID * MAP_GRID).fill(-1);
  rooms[0] = 0;
  return { widthCells, heightCells, solid, surface, rooms };
}

/** An open 320×240 px arena (40×30 cells) with a wall border, plus rectangles of cells set to `c` ('#', 'O', '.'). */
export function arena(...features: [x: number, y: number, w: number, h: number, c: string][]): World {
  const rows = Array.from({ length: 30 }, (_, y) => Array.from({ length: 40 }, (_, x): string => (x === 0 || y === 0 || x === 39 || y === 29 ? "#" : ".")));
  for (const [fx, fy, w, h, c] of features) for (let y = fy; y < fy + h; y++) for (let x = fx; x < fx + w; x++) rows[y]![x] = c;
  return worldFrom(rows.map((r) => r.join("")));
}

export const RULES: BattleRules = { hearts: 3, timeLimit: 0, wins: 2 };

/** A battle past its countdown. */
export function start(world: World, spawns: Spawn[], props: ArenaProps = NO_PROPS, rules: BattleRules = RULES, seed = 1): GameState {
  const game = createBattle(0, spawns, rules, props, seed);
  for (let i = 0; i < COUNTDOWN_TICKS; i++) stepGame(game, [], world);
  return game;
}

export const px = (v: number) => Math.floor(v / SUBPX);

/** Steps with `inputs` until `done` (at most `max` ticks); returns the ticks taken. */
export function until(game: GameState, world: World, done: () => boolean, max = 600, inputs: number[] = []): number {
  for (let t = 0; ; t++) {
    if (done()) return t;
    if (t === max) throw new Error("condition never met");
    stepGame(game, inputs, world);
  }
}

/** Steps `n` ticks with the same inputs. */
export function run(game: GameState, world: World, n: number, inputs: number[] = []): void {
  for (let i = 0; i < n; i++) stepGame(game, inputs, world);
}

/** Presses buttons for player `who` on one tick (everyone else idle). */
export function press(game: GameState, world: World, who: number, buttons: number): void {
  stepGame(game, game.players.map((_, i) => (i === who ? buttons : 0)), world);
}
