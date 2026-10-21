// The tiles an open door shows (DOOR's update 0x802C59D8, states 0 and 3: the open ones; kind 0 starts in state 0,
// the others in 1). Each tick there it writes its open tiles into the base layer from its anchor's tile along its wall
// (to the right on sides 0 and 1, down on 2 and 3), picked by its width (p >> 12) & 31 from three tables
// (docs/formats/adventure.md "DOOR's open tiles"):
// - width 0, 0x8046D598: 2 tiles, by kind (0-8) then side; width 1, 0x8046D628: 4 tiles, kinds 0-2; width 2,
//   0x8046D688: 6 tiles (the Cave of No Return's doors), kinds 0-2. Kinds 5-7 write nothing.
// - Kinds 2 and 4 of width 0 and 1 also write a pair one tile out from the wall (tables 0x8046D718, 0x8046D728,
//   0x8046D738) on the layer above: not drawn here (TODO: which layer that is).
// The tiles are the stage tileset's (every stage's door tiles sit at the same numbers). They're drawn only: the
// sim's collision keeps doors.ts (doorWorld, openDoorTiles); the open tiles' types (0x2A, 0x2B, 0x0C) aren't applied.
import { LAYER_TILES } from "@fso/formats";
import { currentArea, type AdventureGame } from "./adventure.ts";
import { doorShut } from "./doors.ts";
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

/** The tiles a door of this kind, side and width shows open (from its anchor's tile along its wall), or null. */
export function doorOpenTiles(kind: number, side: number, width: number): readonly number[] | null {
  if (kind >= 5 && kind <= 7) return null;
  const table = width === 0 ? OPEN_2 : width === 1 ? OPEN_4 : width === 2 ? OPEN_6 : null;
  return table?.[kind]?.[side & 3] ?? null;
}

/** The base-layer tiles the current area's open doors show (tile index → tile), for drawing. */
export function doorLookTiles(game: AdventureGame, stage: AdventureStage, out: Map<number, number>): void {
  const area = currentArea(game, stage);
  if (!area.base) return;
  for (const d of area.actors) {
    if (d.id !== "DOOR") continue;
    const kind = d.params & 0x7f, side = (d.params >>> 7) & 31;
    // Kinds 0, 1, 3 and 8 while doors.ts has them open (a kind 0 without a switch always). A cracked wall (kind 2) keeps
    // its look: half its open look is on the other layer.
    const opens = (kind === 0 || kind === 1 || kind === 3 || kind === 8) && !doorShut(game, d);
    const tiles = opens ? doorOpenTiles(kind, side, (d.params >>> 12) & 31) : null;
    if (!tiles) continue;
    const tx = d.x >> 4, ty = d.y >> 4, down = side >= 2;
    tiles.forEach((t, k) => {
      const x = down ? tx : tx + k, y = down ? ty + k : ty;
      if (x >= 0 && y >= 0 && x < LAYER_TILES && y < LAYER_TILES) out.set(y * LAYER_TILES + x, t);
    });
  }
}
