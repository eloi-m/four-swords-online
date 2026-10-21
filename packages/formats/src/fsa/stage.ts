// Stage archives (`Boss/bossNNN.arc`): map layout CSV, per-room tile layers and actor lists, and the shared tileset
// in data.arc. Shadow Battle (`boss500`) lists per-room properties instead of an adventure map grid.
import type { RarcArchive } from "../rarc.ts";
import { decompressYaz0, isYaz0 } from "../yaz0.ts";
import { parseActors, type Actor } from "./actors.ts";
import { buildCharSheet, decodeLayer, decodePalettes, decodeTileParts, tilesetId, type Tileset } from "./bg.ts";
import { loadCharAnimations } from "./bganim.ts";

export const MAP_GRID = 10;

export interface MapLayout {
  index: number;
  startX: number;
  startY: number;
  bgmId: number;
  showE3Banner: number;
  tilesetIndex: number;
  npcSheetId: number;
  overlayTextureId: number;
  unknown: number;
  disallowTingle: number;
  /** rooms[y][x]: room number, or null for an empty cell. */
  rooms: (number | null)[][];
}

/** Parses an adventure-mode `mapNNN.csv`. (Shadow Battle maps use `parseBattleLayout`.) */
export function parseMapLayout(csv: string): MapLayout {
  const lines = csv.split(/\r?\n/);
  const head = lines[0]!.split(",");
  if (!head[0]!.startsWith("map")) throw new Error("not an adventure map layout");
  const n = (i: number) => Number.parseInt(head[i] ?? "0", 10);
  const rooms = lines.slice(1, 1 + MAP_GRID).map((line) =>
    line.split(",").slice(0, MAP_GRID).map((cell) => (cell === "NULL" ? null : Number.parseInt(cell, 10))),
  );
  return {
    index: Number.parseInt(head[0]!.slice(3), 10),
    startX: n(1),
    startY: n(2),
    bgmId: n(3),
    showE3Banner: n(4),
    tilesetIndex: n(5),
    npcSheetId: n(6),
    overlayTextureId: n(7),
    unknown: n(8),
    disallowTingle: n(9),
    rooms,
  };
}

/**
 * One room of a Shadow Battle layout (`map500.csv`): one line per room, `room,c1,…,c8`, ended by `end`.
 * Column 3 is the tileset (confirmed by rendering); column 5 matches the adventure maps' ground overlay IDs.
 * The other columns are kept raw in `columns` (see docs/formats.md).
 */
export interface BattleRoom {
  room: number;
  tilesetIndex: number;
  overlayTextureId: number;
  /** Every column after the room number, as read (`columns[2]` = tileset, `columns[4]` = overlay). */
  columns: number[];
}

/** Shadow Battle rooms are shown on a 5×2 grid: the five arenas, then their Dark World variants below. */
export const BATTLE_GRID_W = 5;
export const BATTLE_ARENAS = ["The Field", "Tower of Flames", "Tower of Winds", "Hyrule Castle", "Above the Clouds"] as const;

/** Arena name of a boss500 room (identified from its tileset and tiles; rooms 5-9 are the Dark World variants). */
export function battleArenaName(room: number): string | null {
  const arena = BATTLE_ARENAS[room % BATTLE_GRID_W];
  if (room < 0 || room >= 2 * BATTLE_GRID_W || !arena) return null;
  return room >= BATTLE_GRID_W ? `${arena} (Dark World)` : arena;
}

/** Parses a Shadow Battle room list (`map500.csv`, also `map500_ctrl.csv`). */
export function parseBattleLayout(csv: string): BattleRoom[] {
  const rooms: BattleRoom[] = [];
  for (const line of csv.split(/\r?\n/)) {
    const cells = line.split(",");
    if (cells[0] === "end") break;
    if (!/^\d+$/.test(cells[0] ?? "")) continue;
    const columns = cells.slice(1).filter((c) => c !== "").map((c) => Number.parseInt(c, 10));
    rooms.push({ room: Number.parseInt(cells[0]!, 10), tilesetIndex: columns[2] ?? 0, overlayTextureId: columns[4] ?? 0, columns });
  }
  return rooms;
}

/** Places battle rooms on the stage grid (room r at column r mod 5, row r div 5), as a MapLayout for grid users. */
function battleMapLayout(index: number, rooms: BattleRoom[]): MapLayout {
  const grid: (number | null)[][] = Array.from({ length: MAP_GRID }, () => new Array<number | null>(MAP_GRID).fill(null));
  for (const { room } of rooms) {
    const row = grid[Math.floor(room / BATTLE_GRID_W)];
    if (row) row[room % BATTLE_GRID_W] = room;
  }
  const first = rooms[0];
  return {
    index,
    startX: 0,
    startY: 0,
    bgmId: 0,
    showE3Banner: 0,
    tilesetIndex: first?.tilesetIndex ?? 0,
    npcSheetId: 0,
    overlayTextureId: first?.overlayTextureId ?? 0,
    unknown: 0,
    disallowTingle: 0,
    rooms: grid,
  };
}

function unwrap(data: Uint8Array): Uint8Array {
  return isYaz0(data) ? decompressYaz0(data) : data;
}

function file(archive: RarcArchive, path: string): Uint8Array {
  const found = archive.files.find((f) => f.path === path);
  if (!found) throw new Error(`${archive.rootName}: missing ${path}`);
  return unwrap(found.data);
}

/** Palette set: TV screen, GBA screen (`_gb_`) or Dark World (`_ura_`). */
export type PaletteVariant = "tv" | "gba" | "dark";

// The GBA screen uses a different character sheet for a few tilesets.
const GBA_CHAR_SHEET: Record<number, string> = { 2: "c2" };

/** Loads a tileset from data.arc. */
export function loadTileset(data: RarcArchive, index: number, variant: PaletteVariant = "tv"): Tileset {
  const id = tilesetId(index);
  const charId = variant === "gba" ? (GBA_CHAR_SHEET[index] ?? id) : id;
  const suffix = variant === "gba" ? "_gb" : variant === "dark" ? "_ura" : "";
  return {
    chars: buildCharSheet(file(data, `sch/bg_${charId}_sch.szs`), file(data, "sch/bg_base_sch.szs")),
    parts: decodeTileParts(file(data, "spl/bg_a_spl.szs")),
    palettes: decodePalettes(file(data, `scl/bg_${id}${suffix}_scl.szs`)),
    animations: loadCharAnimations(data, index),
  };
}

export class Stage {
  readonly archive: RarcArchive;
  /** Room grid and stage-wide properties. For Shadow Battle, a 5×2 grid; per-room properties are in `battleRooms`. */
  readonly layout: MapLayout;
  readonly index: number;
  /** Shadow Battle (`boss500`) room properties, or null for adventure-mode stages. */
  readonly battleRooms: BattleRoom[] | null;

  constructor(archive: RarcArchive) {
    this.archive = archive;
    this.index = Number.parseInt(archive.rootName.replace(/^boss/i, ""), 10);
    const id = pad3(this.index);
    const csv = new TextDecoder().decode(file(archive, `map/map${id}.csv`));
    if (csv.startsWith("map")) {
      this.layout = parseMapLayout(csv);
      this.battleRooms = null;
    } else {
      this.battleRooms = parseBattleLayout(csv);
      this.layout = battleMapLayout(this.index, this.battleRooms);
    }
  }

  /** Tileset of a room (per room in Shadow Battle, stage-wide otherwise). */
  tilesetIndexOf(room: number): number {
    return this.battleRooms?.find((r) => r.room === room)?.tilesetIndex ?? this.layout.tilesetIndex;
  }

  /** Ground overlay texture ID of a room (per room in Shadow Battle, stage-wide otherwise). */
  overlayTextureIdOf(room: number): number {
    return this.battleRooms?.find((r) => r.room === room)?.overlayTextureId ?? this.layout.overlayTextureId;
  }

  /** A room's actor list (`bin/bNNN/d_enemy_mapNNN_RR.bin`), empty when the file doesn't exist. */
  actors(room: number): Actor[] {
    const id = pad3(this.index);
    const found = this.archive.files.find((f) => f.path === `bin/b${id}/d_enemy_map${id}_${String(room).padStart(2, "0")}.bin`);
    return found ? parseActors(unwrap(found.data)) : [];
  }

  /** Room numbers present in the layout grid. */
  get roomNumbers(): number[] {
    return [...new Set(this.layout.rooms.flat().filter((r): r is number => r !== null))].sort((a, b) => a - b);
  }

  /**
   * One tile layer of a room. `group` 1 is drawn below actors, 2 above.
   * `sublayer` 0 is the TV screen; 1-7 are GBA-screen areas (houses, caves…).
   * Returns null when the file doesn't exist.
   */
  layer(room: number, group: 1 | 2, sublayer = 0): Uint16Array | null {
    const id = pad3(this.index);
    const path = `szs/m${id}/d_map${id}_${String(room).padStart(2, "0")}_mmm_${group}_${sublayer}.szs`;
    const found = this.archive.files.find((f) => f.path === path);
    return found ? decodeLayer(unwrap(found.data)) : null;
  }
}

function pad3(n: number): string {
  return String(n).padStart(3, "0");
}
