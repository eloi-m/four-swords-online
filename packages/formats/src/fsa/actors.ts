// Actor lists (`bin/bNNN/d_enemy_mapNNN_RR.bin`, one per room): 11-byte records, big-endian, ended by a record whose
// ID is four spaces. Record: char[4] ID, u8 sublayer (0 = TV, 1-7 = GBA-screen area, as in the tile layer names),
// u8 x, u8 y (half-tiles = 8 px from the room's top-left), u32 parameters (meaning depends on the actor type).
// Actor types are listed with Japanese names and stats in `data.arc/enm/enemyparam.csv` (Shift-JIS).
import { dataView } from "../bytes.ts";
import type { RarcArchive } from "../rarc.ts";
import { decompressYaz0, isYaz0 } from "../yaz0.ts";

export const ACTOR_RECORD_SIZE = 11;
export const ACTOR_UNIT = 8; // px per position unit (half a tile)
const END_ID = "    ";

export interface Actor {
  /** 4-character type ID, e.g. `WARP`, `PLAS`. */
  id: string;
  /** 0 = TV screen, 1-7 = GBA-screen area (house, cave…), matching tile layer sublayers. */
  sublayer: number;
  /** Position in half-tiles (8 px) from the room's top-left. Tile-bound actors (doors, chests, signs) use even
   *  values, i.e. the top-left corner of their 16×16 tile; free actors are often odd, i.e. a tile's center. */
  x: number;
  y: number;
  /** Type-specific parameters as a big-endian u32 (byte 0 = most significant). */
  params: number;
}

/** Parses a room's actor list. Stops at the terminator record (or the end of the data). */
export function parseActors(bytes: Uint8Array): Actor[] {
  const v = dataView(bytes);
  const actors: Actor[] = [];
  for (let o = 0; o + ACTOR_RECORD_SIZE <= bytes.length; o += ACTOR_RECORD_SIZE) {
    const id = String.fromCharCode(bytes[o]!, bytes[o + 1]!, bytes[o + 2]!, bytes[o + 3]!);
    if (id === END_ID) break;
    actors.push({ id, sublayer: bytes[o + 4]!, x: bytes[o + 5]!, y: bytes[o + 6]!, params: v.getUint32(o + 7) });
  }
  return actors;
}

/** Serializes actors back to the on-disc layout, with the terminator record. */
export function encodeActors(actors: readonly Actor[]): Uint8Array {
  const out = new Uint8Array((actors.length + 1) * ACTOR_RECORD_SIZE);
  const v = dataView(out);
  const records = [...actors, { id: END_ID, sublayer: 0, x: 0, y: 0, params: 0 }];
  records.forEach((a, i) => {
    const o = i * ACTOR_RECORD_SIZE;
    for (let k = 0; k < 4; k++) out[o + k] = a.id.charCodeAt(k) & 0xff;
    out.set([a.sublayer, a.x, a.y], o + 4);
    v.setUint32(o + 7, a.params >>> 0);
  });
  return out;
}

/** The four parameter bytes, most significant first (the order they're stored in). */
export function actorParamBytes(actor: Actor): [number, number, number, number] {
  const p = actor.params;
  return [p >>> 24, (p >>> 16) & 0xff, (p >>> 8) & 0xff, p & 0xff];
}

/** Room-pixel position of an actor. */
export function actorPixel(actor: Actor): { x: number; y: number } {
  return { x: actor.x * ACTOR_UNIT, y: actor.y * ACTOR_UNIT };
}

export interface ActorType {
  id: string;
  /** Japanese description from the game's table (e.g. the type's display name). */
  name: string;
  /** The remaining numeric columns, keyed by the file's own header names (`life`, `atcp`…). */
  stats: Record<string, number>;
}

/** Loads the actor type table from data.arc, or null if it's missing. */
export function loadActorTypes(data: RarcArchive): Map<string, ActorType> | null {
  const found = data.files.find((f) => f.path === "enm/enemyparam.csv");
  return found ? parseActorTypes(isYaz0(found.data) ? decompressYaz0(found.data) : found.data) : null;
}

/** Parses `data.arc/enm/enemyparam.csv` (Shift-JIS; bytes are decoded here) into a table keyed by actor ID. */
export function parseActorTypes(csv: Uint8Array | string): Map<string, ActorType> {
  const text = typeof csv === "string" ? csv : new TextDecoder("shift_jis").decode(csv);
  const [head, ...rows] = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  const columns = head!.split(",").map((c) => c.trim());
  const types = new Map<string, ActorType>();
  for (const row of rows) {
    const cells = row.split(",");
    const id = cells[0]!;
    if (id.length !== 4) continue;
    const stats: Record<string, number> = {};
    for (let i = 2; i < columns.length; i++) stats[columns[i]!] = Number.parseInt(cells[i] ?? "", 10);
    types.set(id, { id, name: (cells[1] ?? "").trim(), stats });
  }
  return types;
}
