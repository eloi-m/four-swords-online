// A Hyrulean Adventure stage as the simulation reads it: the room grid, and per room and area (the TV screen, or one of
// the GBA-screen areas: houses, caves) its collision, its actors and the props the battle code animates. Static data
// derived from the stage archive (built once, cached per area); the game state only refers to rooms and areas by
// number. Areas are simulated like Shadow Battle arenas (docs/ADVENTURE.md "Design"): one at a time, at the origin.
import { actorPixel, LAYER_TILES, MAP_GRID, solidMask, surfaceOf, TileType, type Actor, type MapLayout } from "@fso/formats";
import { WALL_ACTORS } from "../arena.ts";
import { DROP_LEDGES } from "./ledge.ts";
import { CURRENT_TILES } from "./swim.ts";
import type { MessageBook } from "./dialogue.ts";
import { LEDGE_MASKS } from "./ledge.ts";
import type { Spawn } from "../battle.ts";
import type { Facing } from "../player.ts";
import { POT_TILES, SIDE_VIEW_TYPES, type ArenaProps, type Prop } from "../props.ts";
import { CELL, ROOM_H, ROOM_W, slopeCell, SURFACE_CODES, type World } from "../world.ts";

/** The parts of a `Stage` (packages/formats) the adventure reads. */
export interface StageSource {
  readonly index: number;
  readonly layout: MapLayout;
  layer(room: number, group: 1 | 2, sublayer?: number): Uint16Array | null;
  actors(room: number): Actor[];
}

/** enemyparam.csv stats the adventure uses (read from the disc at run time: the table isn't in the repo). */
export interface ActorStats {
  life: number;
  atcp: number;
  /** `dasu` ("put out"): what it may leave when it dies, a row of enemies.ts DROP_TABLE (0: nothing). */
  dasu?: number;
}

/** The stats of every actor type from data.arc's enemyparam.csv (packages/formats loadActorTypes). */
export function actorStats(types: ReadonlyMap<string, { stats: Readonly<Record<string, number>> }>): Map<string, ActorStats> {
  return new Map([...types].map(([id, t]) => [id, { life: t.stats.life ?? 1, atcp: t.stats.atcp ?? 0, dasu: t.stats.dasu ?? 0 }]));
}

/** A placed actor of an area: its type, anchor (area px), parameters and index in the room's list. */
export interface AreaActor {
  id: string;
  x: number;
  y: number;
  params: number;
  /** Index in the room's actor list (all sublayers): the actor's identity for what's been taken or opened. */
  index: number;
}

export interface Area {
  room: number;
  /** 0 = the TV screen, 1-7 = a GBA-screen area. */
  sublayer: number;
  /** Size in px: 512 × 384 on the TV; the GBA areas use the whole 32 × 32 tile layer, 512 × 512. */
  w: number;
  h: number;
  /** Collision, the area alone at the origin (everything outside solid). */
  world: World;
  /** The area's actors, in list order. */
  actors: AreaActor[];
  /** What the battle code animates here: its actor types among ADVENTURE_PROP_TYPES, bushes and pots. */
  props: ArenaProps;
  /** The base layer, for tile lookups, and the layer drawn over it (gear.ts: what a pedestal shows). */
  base: Uint16Array | null;
  top: Uint16Array | null;
  /** Warps out of the area (adventure.ts goes through them). */
  doors: Door[];
  /** Seen from the side (sideview.ts): its layers use the side views' background or water tile types. */
  sideView: boolean;
  /**
   * The GBA screen's top-layer mode, its `VWMD`'s params bits 12-13 (0 = none; 1, 2: the top layer blended over the
   * rest, TOP_MODE_BLEND), and the switch it waits for (params >> 27; 0 = none, else the mode holds only while that
   * switch is on): topModeOf (logic.ts).
   */
  topMode: number;
  topModeGate: number;
}

/**
 * A warp out of an area: a 16 px box (top-left `x`, `y`, area px) that leads to a box of another area of the room.
 * From a `WARP` actor (params byte 0 & 7 = the area, bytes 1 and 2 = its box's top-left in 8 px units, byte 3 = the
 * style, the top 5 bits a switch it waits for), or, in a GBA-screen area, the way back through a warp that leads into
 * it where the area has no warp of its own (a house's door).
 */
export interface Door {
  x: number;
  y: number;
  to: { area: number; x: number; y: number };
  /** The WARP's style byte (0x19 a door going up, 0x1a going down, 0x1b/0x1c sideways…; 0 for a way back). */
  style: number;
  /** A switch that must be on (0 = none). TODO(measure): the gated styles (0x84, 0xa8). */
  gate: number;
  /** The WARP's index in the room's actor list, or -1 for a way back. */
  actor: number;
}

/** A WARP actor's destination and style (Door). */
export function warpTarget(params: number): { area: number; x: number; y: number; style: number; gate: number } {
  return { area: (params >>> 24) & 7, x: ((params >>> 16) & 0xff) * 8, y: ((params >>> 8) & 0xff) * 8, style: params & 0xff, gate: params >>> 27 };
}

/**
 * Actor types the battle code (hazards.ts, switches.ts) animates in an adventure area: bombs in sockets, eternal
 * flames, fire-pit flames, fire bars, floor switches, trick floors, bees and the switch logic. Left out: orb generators
 * and magic circles (Shadow Battle's), warps, colored panels (adventure.ts handles warps), sword soldiers and GEN3
 * spawners (the adventure's enemies, enemies.ts).
 */
export const ADVENTURE_PROP_TYPES: readonly string[] = [
  "HBMB",
  "BLZ2",
  "FLME",
  "FBMR",
  "SWTH",
  "TFLR",
  "BEEE",
  "SWOR",
  "SWT4",
  "CHSW",
  "OFFS",
  "CKSW",
  "RNSW",
  "WTSW",
  "ONOF",
];

/**
 * Stones and pots a Link lifts with the Action button like a battle pot (they're solid tiles, type 1): Lake Hylia's
 * grey stone 0x72, which leaves 0x7c (traced: room 5's, the tile rewritten in RAM; arenatiles.ts UNCOVERED_TILE), the
 * Cave of No Return's pot 0x40, which leaves 0x11 (traced in room 13), Tingle's Tower's side-view pot 0x45 (room 7's
 * area 5, its ledge's three; leaving the cave's background 0x3E0: assumed), Hyrule Castle's pot over a floor switch
 * 0x41 (room 58's area 2: traced, it held the Link beside it though its tile type is floor; COVERING_POTS). TODO: the
 * other liftable tiles (main.dol's lift check 0x802A1050 also takes 0x5F, 0x68-0x6B, 0x70, 0x71, 0x73, 0x75, 0x82,
 * 0x42-0x44, 0xE5: docs/formats/adventure.md "The lifted grey stone").
 */
export const LIFT_STONES: ReadonlySet<number> = new Set([0x40, 0x41, 0x45, 0x72]);
/** Pots over a floor switch whose tile type is floor: solid until lifted (traced: room 58's area 2, held at x 216.8). */
export const COVERING_POTS: ReadonlySet<number> = new Set([0x41]);
/**
 * Stages where the water's currents (swim.ts CURRENT_TILES) and the ladder's-foot drops (ledge.ts DROP_LEDGES) are
 * played: Tingle's Tower, where they were traced. Lake Hylia has the same tiles (rooms 6, 7) but its route was planned
 * without them and they weren't traced there yet (docs/ADVENTURE.md "Tingle's Tower" "Left to do").
 */
export const TRACED_WATER_STAGES: ReadonlySet<number> = new Set([12]);
/** JIJI kinds ((params >> 16) & 0xFF) with the big box (dialogue.ts BIG_JIJI). */
export const VILLAGER_BIG_KINDS: ReadonlySet<number> = new Set([6, 11, 16, 25]);

/**
 * Rooms numbered 50 and up on a stage's grid have a variant 50 lower off the grid (Lake Hylia's 58 and 8, Hyrule
 * Castle's 57/58 and 7/8, the Eastern Temple's 52/61/66 and 2/11/16…): played alone, the game loads the variant's
 * actors and tiles (traced: Lake Hylia room 58's area 5 ran room 8's list, its switch 17 at (304, 192), not 58's at
 * (432, 144) beyond a pit; 58's own puzzles need several players: switches two each side of a pit, `TMI2` "blocks for
 * 2-3 players").
 */
export const ALONE_VARIANT = 50;

/**
 * Alone variants outside that rule, per stage index: grid room → the room loaded in its place. The Cave of No Return's
 * room 9 is played as room 8 (measured: in `w1-011-room3.sav`, one GC player, the live base layer at room 9's cell was
 * room 8's, its pedestal at tile (12, 11) on the island; docs/ADVENTURE.md "The Cave of No Return"). How the game
 * picks it isn't known.
 */
export const ALONE_ROOMS: Readonly<Record<number, Readonly<Record<number, number>>>> = { 11: { 9: 8 } };

/** `source` as played alone: a grid room with an alone variant (ALONE_VARIANT, ALONE_ROOMS) reads the variant's actors and layers. */
export function playedAlone<S extends StageSource>(source: S): S {
  const has = (room: number) => source.layer(room, 1, 0) !== null || source.actors(room).length > 0;
  const variants = new Map<number, number>();
  for (const row of source.layout.rooms) for (const r of row) if (r !== null && r >= ALONE_VARIANT && has(r - ALONE_VARIANT)) variants.set(r, r - ALONE_VARIANT);
  for (const [r, v] of Object.entries(ALONE_ROOMS[source.index] ?? {})) if (has(v)) variants.set(Number(r), v);
  if (!variants.size) return source;
  const alone = Object.create(source) as S;
  alone.layer = (room, group, sublayer) => source.layer(variants.get(room) ?? room, group, sublayer);
  alone.actors = (room) => source.actors(variants.get(room) ?? room);
  return alone;
}

/** PLAS params bits 4-5 → the start's facing (main.dol table 0x8046C890: down, up, right, left). */
const PLAS_FACING: readonly Facing[] = ["down", "up", "right", "left"];

export class AdventureStage {
  readonly index: number;
  readonly layout: MapLayout;
  /** Room number per layout cell (row-major MAP_GRID × MAP_GRID), -1 for none. */
  readonly grid: Int16Array;
  readonly stats: ReadonlyMap<string, ActorStats>;
  /** The messages signs and people say (dialogue.ts), when the game's message file was loaded. */
  messages: MessageBook | null = null;
  private readonly source: StageSource;
  private readonly tileTypes: Uint16Array;
  private readonly areas = new Map<number, Area>();
  private readonly lists = new Map<number, Actor[]>();

  /** `source` is played alone (playedAlone): one player with the four Links. */
  constructor(source: StageSource, tileTypes: Uint16Array, stats: ReadonlyMap<string, ActorStats> = new Map()) {
    this.source = playedAlone(source);
    this.index = source.index;
    this.layout = source.layout;
    this.tileTypes = tileTypes;
    this.stats = stats;
    this.grid = new Int16Array(MAP_GRID * MAP_GRID).fill(-1);
    source.layout.rooms.forEach((row, cy) => row.forEach((room, cx) => room !== null && cy < MAP_GRID && cx < MAP_GRID && (this.grid[cy * MAP_GRID + cx] = room)));
  }

  /** The stage's rooms. */
  get rooms(): number[] {
    return [...new Set([...this.grid].filter((r) => r >= 0))].sort((a, b) => a - b);
  }

  /** A room's layout cell, or null when it isn't on the grid. */
  cellOf(room: number): { cx: number; cy: number } | null {
    const i = this.grid.indexOf(room);
    return i < 0 ? null : { cx: i % MAP_GRID, cy: Math.floor(i / MAP_GRID) };
  }

  /** The room at a layout cell, or -1. */
  roomAtCell(cx: number, cy: number): number {
    return cx < 0 || cy < 0 || cx >= MAP_GRID || cy >= MAP_GRID ? -1 : this.grid[cy * MAP_GRID + cx]!;
  }

  /** A room's actor list, every sublayer, in file order. */
  actorList(room: number): Actor[] {
    let list = this.lists.get(room);
    if (!list) this.lists.set(room, (list = this.source.actors(room)));
    return list;
  }

  /** Whether a room has a GBA-screen area `sublayer` (its base layer exists). */
  hasArea(room: number, sublayer: number): boolean {
    return sublayer === 0 || this.source.layer(room, 1, sublayer) !== null;
  }

  /** An area of a room (built on first use). */
  area(room: number, sublayer = 0): Area {
    const key = room * 8 + sublayer;
    let area = this.areas.get(key);
    if (!area) this.areas.set(key, (area = this.buildArea(room, sublayer)));
    return area;
  }

  /** A tile's type (main.dol's tile type table). */
  typeOf(tile: number): number {
    return this.tileTypes[tile & 0x3ff]!;
  }

  /** The base-layer tile type under an area pixel (0 outside). */
  tileTypeAt(area: Area, x: number, y: number): number {
    if (!area.base || x < 0 || y < 0 || x >= area.w || y >= area.h) return 0;
    return this.tileTypes[area.base[(y >> 4) * LAYER_TILES + (x >> 4)]! & 0x3ff]!;
  }

  /**
   * Where the stage starts: the layout's start room, and its `PLAS` starts (params & 3 = player, bits 4-5 = facing)
   * in player order; without any, the room's middle facing down.
   */
  start(): { room: number; spawns: Spawn[] } {
    const room = this.roomAtCell(this.layout.startX, this.layout.startY);
    const first = room >= 0 ? room : this.rooms[0]!;
    const spawns: Spawn[] = [];
    for (const a of this.actorList(first)) {
      if (a.id !== "PLAS" || a.sublayer !== 0) continue;
      const { x, y } = actorPixel(a);
      spawns[a.params & 3] = { x, y, facing: PLAS_FACING[(a.params >>> 4) & 3]! };
    }
    const found = spawns.filter((s) => s !== undefined);
    return { room: first, spawns: found.length ? found : [{ x: ROOM_W / 2, y: ROOM_H / 2, facing: "down" }] };
  }

  private buildArea(room: number, sublayer: number): Area {
    const w = ROOM_W, h = sublayer === 0 ? ROOM_H : LAYER_TILES * 16;
    const base = this.source.layer(room, 1, sublayer);
    const widthCells = w / CELL, heightCells = h / CELL;
    const solid = new Uint8Array(widthCells * heightCells).fill(1);
    const surface = new Uint8Array(widthCells * heightCells);
    let slopes: Uint8Array | undefined;
    if (base) {
      for (let ty = 0; ty < heightCells / 2; ty++) {
        for (let tx = 0; tx < LAYER_TILES; tx++) {
          const tile = base[ty * LAYER_TILES + tx]! & 0x3ff, type = this.tileTypes[tile]!;
          const mask = COVERING_POTS.has(tile) ? 15 : ((DROP_LEDGES.has(type) && !TRACED_WATER_STAGES.has(this.index) ? undefined : LEDGE_MASKS[type]) ?? solidMask(type)), code = SURFACE_CODES.indexOf(surfaceOf(type));
          for (let q = 0; q < 4; q++) {
            const i = (ty * 2 + (q >> 1)) * widthCells + tx * 2 + (q & 1);
            solid[i] = mask & (1 << q) ? 1 : 0;
            surface[i] = code;
            const slope = mask === 15 ? 0 : slopeCell(type, q);
            if (slope) (slopes ??= new Uint8Array(widthCells * heightCells))[i] = slope;
          }
        }
      }
    }
    const list = this.actorList(room);
    const actors: AreaActor[] = [];
    list.forEach((a, index) => {
      if (a.sublayer !== sublayer) return;
      const { x, y } = actorPixel(a);
      actors.push({ id: a.id, x, y, params: a.params, index });
      // Invisible walls block their 16 px tile (arena.ts WALL_ACTORS).
      if (WALL_ACTORS.includes(a.id) && a.x + 1 < widthCells && a.y + 1 < heightCells) for (let q = 0; q < 4; q++) solid[(a.y + (q >> 1)) * widthCells + a.x + (q & 1)] = 1;
    });
    const doors = this.doorsOf(sublayer, list);
    // A warp's box is passable (measured: a house's door tile, solid in the tile types, let Link walk in).
    for (const d of doors) {
      for (let cy = d.y >> 3; cy < (d.y + 16) >> 3; cy++) for (let cx = d.x >> 3; cx < (d.x + 16) >> 3; cx++) if (cx >= 0 && cy >= 0 && cx < widthCells && cy < heightCells) solid[cy * widthCells + cx] = 0;
    }
    const rooms = new Int16Array(MAP_GRID * MAP_GRID).fill(-1);
    rooms[0] = room;
    // Villagers (JIJI) stand in the Links' way: their box (init 0x8037C788: ±8 px round the anchor, −16…16 × −16…8 for
    // the big kinds) blocks (measured in Dolphin: Tingle's Tower room 0's at (416, 144) stopped the leader walking left).
    const boxes = actors
      .filter((a) => a.id === "JIJI")
      .map((a) => {
        const big = VILLAGER_BIG_KINDS.has((a.params >>> 16) & 0xff), h = big ? 16 : 8;
        return { left: a.x - h, top: a.y - h, right: a.x + h - 1, bottom: a.y + (big ? 8 : h) - 1 };
      });
    // The water's currents and its stones (spike tiles: they hurt a swimmer), by tile (swim.ts CURRENT_TILES,
    // STONE_DAMAGE).
    let currents: Uint8Array | undefined, spikes: Uint8Array | undefined;
    if (base && TRACED_WATER_STAGES.has(this.index)) {
      for (let ty = 0; ty < heightCells / 2; ty++) {
        for (let tx = 0; tx < LAYER_TILES; tx++) {
          const tile = base[ty * LAYER_TILES + tx]! & 0x3ff, code = CURRENT_TILES.findIndex((c) => c.tile === tile) + 1;
          const stone = this.tileTypes[tile] === TileType.Spikes;
          if (!code && !stone) continue;
          if (code) currents ??= new Uint8Array(widthCells * heightCells);
          if (stone) spikes ??= new Uint8Array(widthCells * heightCells);
          for (let q = 0; q < 4; q++) {
            const i = (ty * 2 + (q >> 1)) * widthCells + tx * 2 + (q & 1);
            if (code) currents![i] = code;
            if (stone) spikes![i] = 1;
          }
        }
      }
    }
    const world: World = {
      widthCells, heightCells, solid, surface, rooms,
      ...(boxes.length ? { boxes } : {}), ...(currents ? { currents } : {}), ...(spikes ? { spikes } : {}), ...(slopes ? { slopes } : {}),
    };
    const top = this.source.layer(room, 2, sublayer);
    const sideView = sublayer > 0 && [base, top].some((l) => l?.some((t) => SIDE_VIEW_TYPES.has(this.tileTypes[t & 0x3ff]!)));
    const view = sublayer > 0 ? actors.find((a) => a.id === "VWMD") : undefined;
    const topMode = view ? (view.params >>> 12) & 3 : 0, topModeGate = topMode ? view!.params >>> 27 : 0;
    return { room, sublayer, w, h, world, actors, props: this.areaProps(actors, base, w, h), base, top, doors, sideView, topMode, topModeGate };
  }

  // The area's WARPs, then (in a GBA-screen area) the ways back through the other areas' warps into this one where it
  // has none of its own. The TV gets none: the Cave of No Return's rooms list an area 2 whose warps lead onto the TV,
  // and walking over their targets there (room 6's way north) leads nowhere in the game (traced).
  private doorsOf(sublayer: number, list: readonly Actor[]): Door[] {
    const doors: Door[] = [];
    list.forEach((a, index) => {
      if (a.id !== "WARP" || a.sublayer !== sublayer) return;
      const { area, x, y, style, gate } = warpTarget(a.params);
      const p = actorPixel(a);
      doors.push({ x: p.x, y: p.y, to: { area, x, y }, style, gate, actor: index });
    });
    const own = doors.slice();
    for (const a of sublayer ? list : []) {
      if (a.id !== "WARP" || a.sublayer === sublayer) continue;
      const t = warpTarget(a.params);
      if (t.area !== sublayer || own.some((d) => Math.abs(d.x - t.x) < 16 && Math.abs(d.y - t.y) < 16)) continue;
      if (doors.some((d) => d.actor < 0 && d.x === t.x && d.y === t.y)) continue;
      const p = actorPixel(a);
      doors.push({ x: t.x, y: t.y, to: { area: a.sublayer, x: p.x, y: p.y }, style: 0, gate: 0, actor: -1 });
    }
    return doors;
  }

  // The battle props of an area (props.ts arenaProps' rules, for any area size).
  private areaProps(actors: readonly AreaActor[], base: Uint16Array | null, w: number, h: number): ArenaProps {
    const props: Prop[] = [];
    for (const a of actors) {
      if (!ADVENTURE_PROP_TYPES.includes(a.id) || a.x >= w || a.y >= h) continue;
      // The Cave of No Return's rings of fire (FLME kind 5) aren't the fire pit's jets (tileblocks.ts).
      if (a.id === "FLME" && (a.params & 0xff) === 5) continue;
      const tile = base ? base[Math.floor(a.y / 16) * LAYER_TILES + Math.floor(a.x / 16)]! & 0x3ff : 0;
      const type = this.tileTypes[tile]!;
      const prop: Prop = { id: a.id, x: a.x, y: a.y, params: a.params, tile };
      if (solidMask(type) && type !== TileType.Bush) prop.onSolid = true;
      props.push(prop);
    }
    const bushes: number[] = [], pots: number[] = [];
    if (base) {
      for (let ty = 0; ty < h / 16; ty++) {
        for (let tx = 0; tx < LAYER_TILES; tx++) {
          const tile = base[ty * LAYER_TILES + tx]! & 0x3ff;
          if (this.tileTypes[tile] === TileType.Bush) bushes.push(ty * LAYER_TILES + tx);
          else if (POT_TILES.has(tile) || LIFT_STONES.has(tile)) pots.push(ty * LAYER_TILES + tx);
        }
      }
    }
    return { actors: props, bushes, pots };
  }
}
