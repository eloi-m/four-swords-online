// The tiles an open door shows (DOOR's update 0x802C59D8, states 0 and 3: the open ones; kind 0 starts in state 0,
// the others in 1). Each tick there it writes its open tiles into the base layer from its anchor's tile along its wall
// (to the right on sides 0 and 1, down on 2 and 3), picked by its width (p >> 12) & 31 from three tables
// (docs/formats/adventure.md "DOOR's open tiles"):
// - width 0, 0x8046D598: 2 tiles, by kind (0-8) then side; width 1, 0x8046D628: 4 tiles, kinds 0-2; width 2,
//   0x8046D688: 6 tiles (the Cave of No Return's doors), kinds 0-2. Kinds 5-7 write nothing.
// - Kinds 2 and 4 of width 0 (tables 0x8046D718, 0x8046D728: 2 tiles) and kind 2 of width 1 (0x8046D738: 4 tiles)
//   also write a row one tile out from the wall (x 0, 0, -16, 16, y 16, -16, 0, 0 by side: 0x8046D7E8, 0x8046D7F8)
//   on the area's top layer (the layer index + 1 on the TV, + 8 on a GBA screen: Hyrule Castle room 5's bombed wall
//   read in RAM): the doorway's lintel, drawn over the Links. The base layer keeps its cracked tiles under it.
// The tiles are the stage tileset's (every stage's door tiles sit at the same numbers). They're drawn only: the
// sim's collision keeps doors.ts (doorWorld, openDoorTiles); the open tiles' types (0x2A, 0x2B, 0x0C) aren't applied.
import { LAYER_TILES } from "@fso/formats";
import { actorKey, currentArea, type AdventureGame } from "./adventure.ts";
import { CRACKED, doorShut } from "./doors.ts";
import type { AdventureStage } from "./stage.ts";

/** Width 0's open tiles: [kind][side] → the two tiles (0x8046D598). */
const OPEN_2: readonly (readonly (readonly number[])[])[] = [
  [[0x342, 0x343], [0x350, 0x351], [0x345, 0x355], [0x346, 0x356]],
  [[0x342, 0x343], [0x350, 0x351], [0x345, 0x355], [0x346, 0x356]],
  [[0x32a, 0x32b], [0x338, 0x339], [0x32d, 0x33d], [0x32e, 0x33e]],
  [[0x3a2, 0x3a3], [0x3b0, 0x3b1], [0x3a5, 0x3b5], [0x3a6, 0x3b6]],
  [[0x38a, 0x38b], [0x398, 0x399], [0x38d, 0x39d], [0x38e, 0x39e]],
  [[0x38a, 0x38b], [0x398, 0x399], [0x38d, 0x39d], [0x38e, 0x39e]],
  [[0x38a, 0x38b], [0x398, 0x399], [0x38d, 0x39d], [0x38e, 0x39e]],
  [[0x38a, 0x38b], [0x398, 0x399], [0x38d, 0x39d], [0x38e, 0x39e]],
  [[0x3a2, 0x3a3], [0x3b0, 0x3b1], [0x3a5, 0x3b5], [0x3a6, 0x3b6]],
];
/** Width 1's (0x8046D628): [kind][side] → four tiles. */
const OPEN_4: readonly (readonly (readonly number[])[])[] = [
  [[0x2fa, 0x2fe, 0x2fe, 0x2fb], [0x2ea, 0x2ee, 0x2ee, 0x2eb], [0x2ec, 0x2ef, 0x2ef, 0x2fc], [0x2ed, 0x2ff, 0x2ff, 0x2fd]],
  [[0x2fa, 0x2fe, 0x2fe, 0x2fb], [0x2ea, 0x2ee, 0x2ee, 0x2eb], [0x2ec, 0x2ef, 0x2ef, 0x2fc], [0x2ed, 0x2ff, 0x2ff, 0x2fd]],
  [[0x2da, 0x2de, 0x2de, 0x2db], [0x2ca, 0x2ce, 0x2ce, 0x2cb], [0x2cc, 0x2cf, 0x2cf, 0x2dc], [0x2cd, 0x2df, 0x2df, 0x2dd]],
];
/** Width 2's (0x8046D688): [kind][side] → six tiles, width 1's with four middles. */
const OPEN_6: readonly (readonly (readonly number[])[])[] = OPEN_4.map((kind) => kind.map(([a, m, , b]) => [a!, m!, m!, m!, m!, b!]));

/** Width 0's top-layer row: [side] → two tiles, kind 2 (0x8046D718) and kind 4 (0x8046D728). */
const TOP_2: Readonly<Record<number, readonly (readonly number[])[]>> = {
  2: [[0x33a, 0x33b], [0x328, 0x329], [0x32c, 0x33c], [0x32f, 0x33f]],
  4: [[0x39a, 0x39b], [0x388, 0x389], [0x38c, 0x39c], [0x38f, 0x39f]],
};
/** Width 1's (0x8046D738), kind 2 only: [side] → four tiles. */
const TOP_4: readonly (readonly number[])[] = [[0x2d4, 0x2d5, 0x2d5, 0x2d6], [0x2c4, 0x2c5, 0x2c5, 0x2c6], [0x2c7, 0x2c8, 0x2c8, 0x2c9], [0x2d7, 0x2d8, 0x2d8, 0x2d9]];
/** Where the top-layer row starts from the anchor's tile, by side (in tiles). */
const TOP_STEP: readonly (readonly [number, number])[] = [[0, 1], [0, -1], [-1, 0], [1, 0]];

/** The tiles a door of this kind, side and width shows open (from its anchor's tile along its wall), or null. */
export function doorOpenTiles(kind: number, side: number, width: number): readonly number[] | null {
  if (kind >= 5 && kind <= 7) return null;
  const table = width === 0 ? OPEN_2 : width === 1 ? OPEN_4 : width === 2 ? OPEN_6 : null;
  return table?.[kind]?.[side & 3] ?? null;
}

/** The top-layer tiles a door of this kind, side and width also shows open (one tile out from its wall), or null. */
export function doorOpenTopTiles(kind: number, side: number, width: number): readonly number[] | null {
  if (width === 0) return TOP_2[kind]?.[side & 3] ?? null;
  return width === 1 && kind === CRACKED ? TOP_4[side & 3]! : null;
}

/**
 * The tiles the current area's open doors show (tile index → tile), for drawing: the base layer's into `out`, the top
 * layer's into `top`.
 */
export function doorLookTiles(game: AdventureGame, stage: AdventureStage, out: Map<number, number>, top?: Map<number, number>): void {
  const area = currentArea(game, stage);
  if (!area.base) return;
  for (const d of area.actors) {
    if (d.id !== "DOOR") continue;
    const kind = d.params & 0x7f, side = (d.params >>> 7) & 31;
    // Kinds 0, 1, 3 and 8 while doors.ts has them open (a kind 0 without a switch always); kinds 2 and 4 once opened
    // (a bomb's blast opens a cracked wall; nothing opens a kind 4 in the sim, which leaves it unblocked).
    const opens = kind === CRACKED || kind === 4 ? game.adventure.opened.includes(actorKey(game.adventure.room, d.index)) : !doorShut(game, d);
    if (!opens) continue;
    const width = (d.params >>> 12) & 31, tx = d.x >> 4, ty = d.y >> 4;
    put(out, doorOpenTiles(kind, side, width), tx, ty, side);
    if (top) put(top, doorOpenTopTiles(kind, side, width), tx + TOP_STEP[side & 3]![0], ty + TOP_STEP[side & 3]![1], side);
  }
}

/** A row of tiles from (tx, ty) along a door's wall: to the right on sides 0 and 1, down on 2 and 3. */
function put(out: Map<number, number>, tiles: readonly number[] | null, tx: number, ty: number, side: number): void {
  const down = (side & 3) >= 2;
  tiles?.forEach((t, k) => {
    const x = down ? tx : tx + k, y = down ? ty + k : ty;
    if (x >= 0 && y >= 0 && x < LAYER_TILES && y < LAYER_TILES) out.set(y * LAYER_TILES + x, t);
  });
}
