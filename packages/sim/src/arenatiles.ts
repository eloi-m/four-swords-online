// The tiles an arena shows (and walks on) as a round changes them: cut bushes, lifted pots uncovering floor switches,
// pressed switches, Above the Clouds' colored panels, the Tower of Flames' crystals and lava stripes. Tile indices from
// main.dol: the lift code 0x8029EDB8 and SWTH's pressed-tile map (0x802A6BC4), RBPN's 0x8B + color, ONOF's 0xBE /
// 0xBF, PNPC's 0x0D.
// Pure: renderers pass the room's own base tiles in.
import type { BattleState } from "./battle.ts";
import { lavaTiles, tileIndexAt } from "./entities.ts";
import { panelColor, PANEL_TILE } from "./panels.ts";
import { SUBPX } from "./player.ts";

/** A cut bush: 0x70 -> 0x79 in Lake Hylia (measured); the other bushes are assumed alike. */
export const CUT_BUSH_TILE = 0x79;
/** What a cover leaves when it's lifted or cut: the floor switch under it (Hyrule Castle's pot 0x41 the orange button:
 *  main.dol's lift 0x8029EF7C); the adventure's grey stone (0x72, Lake Hylia: traced) its hole, the Cave of No
 *  Return's pot (0x40, traced: room 13's, the tile rewritten in RAM) its base, Tingle's Tower's side-view pot (0x45)
 *  the cave's background (assumed). */
export const UNCOVERED_TILE: Readonly<Record<number, number>> = { 0x40: 0x11, 0x41: 0x12, 0x45: 0x3e0, 0x43: 0x50, 0x46: 0x14, 0x68: 0x12, 0x6a: 0x50, 0x72: 0x7c };
/** Tiles that hide a switch (SWTH stays dormant on them). */
export const COVER_TILES: ReadonlySet<number> = new Set([0x41, 0x43, 0x46, 0x68, 0x6a]);
/** A switch tile while it's pressed. */
export const PRESSED_TILE: Readonly<Record<number, number>> = {
  0x12: 0x13,
  0x41: 0x13,
  0x68: 0x13,
  0x14: 0x15,
  0x52: 0x15,
  0x50: 0x51,
  0x43: 0x51,
  0x6a: 0x51,
  0x15a: 0x360,
};
export const CRYSTAL_LIT_TILE = 0xbe;
export const CRYSTAL_UNLIT_TILE = 0xbf;

/** A closed door's halves opened (main.dol 0x8029E508: The Field's house door, 0x19C/0x19D → 0x19E/0x19F). */
export const OPEN_DOOR_TILE: Readonly<Record<number, number>> = { 0x19c: 0x19e, 0x19d: 0x19f };

/** The tile a cut or lifted tile leaves (or an opened door). */
export const cutTile = (original: number) => UNCOVERED_TILE[original] ?? OPEN_DOOR_TILE[original] ?? CUT_BUSH_TILE;

/**
 * Tiles to show instead of the room's own (tile index ty * 32 + tx → tile), given the room's base tile at an index.
 */
export function tileOverrides(b: BattleState, baseTile: (index: number) => number): Map<number, number> {
  const out = new Map<number, number>();
  for (const index of b.cut) out.set(index, cutTile(baseTile(index)));
  let panel = 0;
  for (const e of b.entities) {
    if (e.hp < 0) continue;
    if (e.kind === "switch" && e.phase === "active") {
      const index = tileIndexAt(Math.floor(e.x / SUBPX), Math.floor(e.y / SUBPX));
      const shown = out.get(index) ?? baseTile(index);
      const pressed = PRESSED_TILE[shown];
      if (pressed !== undefined) out.set(index, pressed);
    } else if (e.kind === "crystal") out.set(tileIndexAt(Math.floor(e.x / SUBPX), Math.floor(e.y / SUBPX)), e.phase === "active" ? CRYSTAL_LIT_TILE : CRYSTAL_UNLIT_TILE);
  }
  for (const a of b.props.actors) if (a.id === "RBPN") out.set(tileIndexAt(a.x, a.y), PANEL_TILE + panelColor(b, panel++));
  for (const index of lavaTiles(b)) out.set(index, LAVA_TILE);
  return out;
}

/** What a PNPC turns its tile into while its switch is on (the Tower of Flames' lava, type 0x0E). */
export const LAVA_TILE = 0x0d;
