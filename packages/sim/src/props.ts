// What an arena holds besides its tiles, read once from the stage when a match is set up: the actors the battle rules
// use (hazards, switches and their logic, orb generators, soldiers, doors), on the TV and in the side rooms (placed
// where siderooms.ts lays those out, below the arena), the doors and holes between them, and the bush and pot tiles.
// Plain data, stored in BattleState.props so a match is self-contained (rollback snapshots, replays, rematches).
import { actorPixel, LAYER_TILES, solidMask, TileType, type Stage } from "@fso/formats";
import { ARENA_H, ARENA_W } from "./arena.ts";
import { decodeWarps, MAX_SIDE_ROOM, sideRoomY, type Warp } from "./siderooms.ts";

/** An arena actor: its type ID, anchor (arena px) and parameters. */
export interface Prop {
  id: string;
  x: number;
  y: number;
  params: number;
  /**
   * The base-layer tile under the anchor blocks movement (a switch there is under a pot, like the Tower of Flames' and
   * the Tower of Winds'). Absent = false.
   */
  onSolid?: boolean;
  /** The base-layer tile index (0-0x3FF) under the anchor, when read from a stage. */
  tile?: number;
}

export interface ArenaProps {
  /**
   * Actors the rules use (PROP_TYPES), in list order, the TV's then each side room's (at their place in the world,
   * siderooms.ts); entities refer to them by index (`Entity.home`).
   */
  actors: Prop[];
  /** Bush tiles (type 0x21) of the base layers: tile index ty * 32 + tx (world rows). They can be cut or lifted. */
  bushes: number[];
  /** Pot tiles (POT_TILES) of the base layers, which can be lifted (or broken by a slam): tile index ty * 32 + tx. */
  pots?: number[];
  /** Closed door tiles (DOOR_TILES: The Field's house) of the base layers, which a Link facing them opens (siderooms.ts). */
  doors?: number[];
  /** The doors and holes between the TV and the side rooms (siderooms.ts decodeWarps), in list order. */
  warps?: Warp[];
  /** The side rooms there are (bit k: sublayer k has tiles), and the side-view screens among them and the TV (bit 0). */
  sideRooms?: number;
  sideViews?: number;
}

export const NO_PROPS: ArenaProps = { actors: [], bushes: [] };

/**
 * Actor types with battle behavior: HBMB bombs (Tower of Flames sockets), BLZ2 eternal flames, FLME fire-pit flames,
 * FBMR fire-bar arms, SWTH floor switches, TFLR trick floor, BEEE bees, SLR1 sword soldiers, CIRC magic circles, CRGN
 * orb generators, RBPN colored floor panels, CNON cannons (side rooms), PNPC lava tiles (entities.ts lavaTiles: the Tower
 * of Flames' stripes), BBSL the Tower of Winds' giant-bomb Shadow Link (giantbomb.ts), and the switch logic (switches.ts): SWOR,
 * SWT4, CHSW, OFFS, CKSW, RNSW, WTSW, GEN3 spawners and ONOF torches. See docs/formats.md. (WARP doors and holes are
 * ArenaProps.warps.)
 */
export const PROP_TYPES = [
  "DOSN",
  "BBSL",
  "CNON",
  "PNPC",
  "HBMB",
  "BLZ2",
  "FLME",
  "FBMR",
  "SWTH",
  "TFLR",
  "BEEE",
  "SLR1",
  "CIRC",
  "CRGN",
  "RBPN",
  "SWOR",
  "SWT4",
  "CHSW",
  "OFFS",
  "CKSW",
  "RNSW",
  "WTSW",
  "GEN3",
  "ONOF",
  "NIWA",
] as const;

/**
 * Pots standing on floor switches: tile 0x43 (Tower of Flames) and 0x46 (Tower of Winds). Lifting one (or slamming
 * something on it) uncovers the switch (main.dol lift code 0x8029EDB8, 0x802A3164).
 */
export const POT_TILES: ReadonlySet<number> = new Set([0x43, 0x46]);
/** A closed door's two halves (type 1, solid): The Field's house (arenatiles.ts OPEN_DOOR_TILE: what they become). */
export const DOOR_TILES: ReadonlySet<number> = new Set([0x19c, 0x19d]);

/** Tile types that make a screen side view (the stage loader 0x802D4CCC sets +0x131DF[screen] when its layers have one). */
export const SIDE_VIEW_TYPES: ReadonlySet<number> = new Set([TileType.Background, 0x3b]);

/** Which side rooms a boss500 room has (bit k: sublayer k's base layer has tiles), and which screens are side view. */
export function sideRoomsOf(stage: Stage, tileTypes: Uint16Array, room: number): { rooms: number; sideViews: number } {
  let rooms = 0, sideViews = 0;
  for (let k = 0; k <= MAX_SIDE_ROOM; k++) {
    const layers = [stage.layer(room, 1, k), stage.layer(room, 2, k)];
    if (k > 0 && layers[0]?.some((t) => (t & 0x3ff) !== 0)) rooms |= 1 << k;
    if (layers.some((l) => l?.some((t) => SIDE_VIEW_TYPES.has(tileTypes[t & 0x3ff]!)))) sideViews |= 1 << k;
  }
  return { rooms, sideViews: sideViews & (rooms | 1) };
}

/**
 * The battle props of one boss500 room: the TV's actors, then each side room's (sublayers 1-6, placed at
 * siderooms.ts sideRoomY), the warps between them, and the bush and pot tiles of every base layer.
 */
export function arenaProps(stage: Stage, tileTypes: Uint16Array, room: number): ArenaProps {
  const actors: Prop[] = [];
  const bushes: number[] = [], pots: number[] = [], doors: number[] = [];
  const { rooms, sideViews } = sideRoomsOf(stage, tileTypes, room);
  const all = stage.actors(room);
  for (let k = 0; k <= MAX_SIDE_ROOM; k++) {
    if (k > 0 && !(rooms & (1 << k))) continue;
    const base = stage.layer(room, 1, k), dy = sideRoomY(k);
    for (const actor of all) {
      if (actor.sublayer !== k || !(PROP_TYPES as readonly string[]).includes(actor.id)) continue;
      const { x, y } = actorPixel(actor);
      if (x >= ARENA_W || y >= ARENA_H) continue;
      const tile = base ? base[Math.floor(y / 16) * LAYER_TILES + Math.floor(x / 16)]! & 0x3ff : 0;
      const type = tileTypes[tile]!;
      const prop: Prop = { id: actor.id, x, y: y + dy, params: actor.params, tile };
      // Bushes block too, but a switch under a bush is a floor switch waiting to be uncovered (The Field's).
      if (solidMask(type) && type !== TileType.Bush) prop.onSolid = true;
      actors.push(prop);
    }
    if (!base) continue;
    for (let ty = 0; ty < ARENA_H / 16; ty++) {
      for (let tx = 0; tx < LAYER_TILES; tx++) {
        const tile = base[ty * LAYER_TILES + tx]! & 0x3ff, index = (ty + dy / 16) * LAYER_TILES + tx;
        if (tileTypes[tile] === TileType.Bush) bushes.push(index);
        else if (POT_TILES.has(tile)) pots.push(index);
        else if (DOOR_TILES.has(tile)) doors.push(index);
      }
    }
  }
  return { actors, bushes, pots, ...(doors.length ? { doors } : {}), warps: stageWarps(stage, tileTypes, room), sideRooms: rooms, sideViews };
}

/** The warps of a boss500 room (siderooms.ts decodeWarps), from the TV and the side rooms it has. */
export function stageWarps(stage: Stage, tileTypes: Uint16Array, room: number): Warp[] {
  const { rooms, sideViews } = sideRoomsOf(stage, tileTypes, room);
  const actors = stage.actors(room).filter((a) => a.id === "WARP" && (a.sublayer === 0 || rooms & (1 << a.sublayer)));
  return decodeWarps(actors.map((a) => ({ sublayer: a.sublayer, ...actorPixel(a), params: a.params })), (k) => (sideViews & (1 << k)) !== 0);
}
