// Navigation for the CPU Links (cpu.ts), on the arena's 8×8 collision cells: where a Link's anchor can be without a
// wall sensor in a wall (player.ts: ±7 px on the axes, ±5 diagonally) and without the pit probe (combat.ts PIT_PROBE,
// 4 px below the anchor) over a pit or a colored panel (panels.ts: another player's color is a pit), and distance fields
// toward a goal cell over those cells (Dijkstra: 10 straight, 14 diagonal, plus a penalty for cells next to a wall or a
// pit, on a trick floor, under a fire bar, or on a panel). Everything here is derived from the battle's view of the
// arena (entities.ts battleWorld: cut bushes, open trapdoors) and its props, and memoized: the caches only save work,
// their contents are a pure function of those inputs, so resimulating a frame (rollback) gives the same answers.
// One grid per screen (the TV, each side room). A side-view screen's (the Tower of Winds' TV, the side-view side rooms:
// siderooms.ts) has cells a Link stands in (the ground under him, or a ladder) and the moves between them (left and
// right, off a ledge down to where he lands, up and down a ladder), its distance fields over those moves.
import { ARENA_H, ARENA_W } from "./arena.ts";
import { TILE, TRAPDOOR_TILES } from "./entities.ts";
import { FIREBAR_RING } from "./hazards.ts";
import { Button, SUBPX } from "./player.ts";
import type { ArenaProps } from "./props.ts";
import { DOOR_STYLES, HOLE_STYLE, screenAt, sideRoomY } from "./siderooms.ts";
import { CELL, type World } from "./world.ts";

/** Per-cell flags of a NavGrid. */
export const NAV = {
  /** A Link's anchor fits somewhere in the cell without a wall sensor in a wall (walls push him there: player.ts). */
  stand: 1,
  /** Neither the cell nor the one below is a pit: the pit probe of a Link anywhere in the cell is on solid ground. */
  safe: 2,
  /** A pit is next to where the probe can be: fine to cross, not to linger or fight on. */
  edge: 4,
  /** A trick floor or a fire bar's reach: crossed only when there's no better way. */
  trap: 8,
  /** No wall in the 3×3 cells around: a Link anywhere in the cell touches no wall. */
  open: 16,
  /** A colored panel, walkable in the grid for a Link whose color they all show (crossed, never followed). */
  panel: 32,
  /** Side view: a ladder's cell (he stands on it as on the ground, and climbs it). */
  ladder: 64,
  /** A pit (or another Link's colored panel) itself: a Link whose anchor is in the cell falls (combat.ts PIT_PROBE). */
  pit: 128,
} as const;
const WALKABLE = NAV.stand | NAV.safe;

export const STRAIGHT_COST = 10;
export const DIAGONAL_COST = 14;
const EDGE_COST = 10;
const TRAP_COST = 12;
const TIGHT_COST = 6; // a cell next to a wall
const PANEL_COST = 30; // a panel cell: cross the ring, don't walk along it
/**
 * Anchor offsets in a cell (px) that cover every way the wall sensors (player.ts: ±7 on the axes, ±5 diagonally) can
 * fall into the 8 px cells around it; for each pair (x, y) of them, the cells (relative) the 8 sensors are in.
 */
const PROBE_OFFSETS = [0, 1, 3, 5, 7] as const;
const SENSORS: readonly (readonly [number, number])[] = [[0, -7], [0, 7], [-7, 0], [7, 0], [-5, -5], [5, -5], [-5, 5], [5, 5]];
const SENSOR_CELLS: readonly (readonly [number, number])[][] = (() => {
  const sets = new Map<string, [number, number][]>();
  for (const oy of PROBE_OFFSETS) {
    for (const ox of PROBE_OFFSETS) {
      const cells = SENSORS.map(([sx, sy]): [number, number] => [Math.floor((ox + sx) / CELL), Math.floor((oy + sy) / CELL)]);
      sets.set(JSON.stringify(cells), cells);
    }
  }
  return [...sets.values()];
})();
export const UNREACHABLE = 0xffff;
/** Distance fields kept per grid (one per goal cell: fieldGoal keeps them few). */
const FIELDS_KEPT = 160;
/** Field goals snap to cells on a lattice every 3 cells (when one is close by), so fields get reused. */
const GOAL_STEP = 3;

export interface NavGrid {
  /** Cells across and down (a screen: 64 × 48). */
  readonly w: number;
  readonly h: number;
  readonly flags: Uint8Array;
  /** Memoized distance fields by goal cell (flowField). */
  readonly fields: Map<number, Uint16Array>;
  /** Where its screen starts in the world (px): 0 for the TV, sideRoomY(k) for side room k (siderooms.ts). */
  readonly y0: number;
  /** A side-view screen's moves (sideMoves): walking, ladders and drops; absent on the top-down ones. */
  readonly side?: SideMoves;
}

/**
 * The moves between a side-view screen's cells (siderooms.ts: gravity, ladders): from each cell a Link can stand in
 * (on the ground or on a ladder), a step left or right (onto ground, a ladder, or off a ledge and down to where he
 * lands), and up or down a ladder. Edge k of cell c is k in [start[c], start[c + 1]): to `to[k]`, costing `cost[k]`,
 * pressing `dir[k]` (player.ts Button). The reverse edges (into each cell) give the distance fields.
 */
export interface SideMoves {
  readonly start: Int32Array;
  readonly to: Int32Array;
  readonly cost: Uint16Array;
  readonly dir: Uint8Array;
  readonly rstart: Int32Array;
  readonly rfrom: Int32Array;
  readonly rcost: Uint16Array;
}
/** A drop costs this much per cell on top of the step off the ledge (falling is 4 px a tick, walking 1.5). */
const DROP_COST = 4;

const grids = new WeakMap<World, WeakMap<ArenaProps, Map<number, NavGrid>>>();

/**
 * The navigation grid of a battle's view of one of its screens (memoized per view, props and screen: 0 the TV, k side
 * room k). `panels`: the colored panels are floor (for a Link whose color they show, with time to cross), else pits.
 * A side-view screen's grid has its moves (SideMoves).
 */
export function navGrid(world: World, props: ArenaProps, panels = false, screen = 0): NavGrid {
  let byProps = grids.get(world);
  if (!byProps) grids.set(world, (byProps = new WeakMap()));
  let byScreen = byProps.get(props);
  if (!byScreen) byProps.set(props, (byScreen = new Map()));
  const k = screen * 2 + (panels ? 1 : 0);
  let grid = byScreen.get(k);
  if (!grid) byScreen.set(k, (grid = buildNav(world, props, panels, screen)));
  return grid;
}

const PIT = 1; // world.ts SURFACE_CODES index of "pit"
const LADDER = 6; // …and of "ladder"

function buildNav(world: World, props: ArenaProps, panels: boolean, screen: number): NavGrid {
  const y0 = sideRoomY(screen), Y0 = y0 / CELL;
  const w = Math.min(world.widthCells, ARENA_W / CELL), h = Math.max(0, Math.min(world.heightCells - Y0, ARENA_H / CELL));
  const W = world.widthCells;
  const sideView = ((props.sideViews ?? 0) >>> screen) & 1;
  // Walls and pits on grids with a margin of cells around (walls outside, no pits), so neighbors need no bounds checks.
  const P = w + 4, at = (x: number, y: number) => (y + 2) * P + x + 2;
  const wall = new Uint8Array(P * (h + 4)).fill(1), hole = new Uint8Array(P * (h + 4)), ladder = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      wall[at(x, y)] = world.solid[(y + Y0) * W + x] === 1 ? 1 : 0;
      hole[at(x, y)] = world.surface[(y + Y0) * W + x] === PIT ? 1 : 0;
      ladder[y * w + x] = world.surface[(y + Y0) * W + x] === LADDER ? 1 : 0;
    }
  }
  // On a ladder: his anchor or his feet on its tiles (siderooms.ts onLadder): a ladder's cells and the one over its top.
  const climb = ladder.map((v, c) => v | (c + w < w * h ? ladder[c + w]! : 0));
  // The doors and holes to the side rooms (siderooms.ts) are walls to a CPU, a cell wider all round than their box (a
  // hole's whole tile): it keeps out unless it means to go in (cpu.ts throughWarp). (A gate wants a press of Up: no wall.)
  for (const d of props.warps ?? []) {
    if (!(DOOR_STYLES.has(d.style) || d.style === HOLE_STYLE) || screenAt(d.y * SUBPX) !== screen) continue;
    const dy = d.y - y0;
    const x0 = Math.floor((d.x * SUBPX + d.left) / SUBPX / CELL) - 1, x1 = Math.floor((d.x * SUBPX + d.right) / SUBPX / CELL) + 1;
    const ya = Math.floor((dy * SUBPX + d.top) / SUBPX / CELL) - 1, yb = Math.floor((dy * SUBPX + d.bottom) / SUBPX / CELL) + 1;
    for (let y = Math.max(0, ya); y <= Math.min(h - 1, yb); y++) for (let x = Math.max(0, x0); x <= Math.min(w - 1, x1); x++) wall[at(x, y)] = 1;
  }
  const sensorSets = SENSOR_CELLS.map((cells) => Int32Array.from(cells, ([dx, dy]) => dy * P + dx));
  const fits = (c: number) => {
    for (const set of sensorSets) {
      let k = 0;
      while (k < set.length && !wall[c + set[k]!]) k++;
      if (k === set.length) return true;
    }
    return false;
  };
  // The colored panels are a pit for everyone but one player at a time.
  const trap = new Uint8Array(w * h), panel = new Uint8Array(w * h);
  const tileCells = (tx: number, ty: number, mark: Uint8Array, padded = false) => {
    for (let q = 0; q < 4; q++) {
      const x = tx * 2 + (q & 1), y = ty * 2 + (q >> 1);
      if (x < w && y < h) mark[padded ? at(x, y) : y * w + x] = 1;
    }
  };
  for (const a of props.actors) {
    if (screenAt(a.y * SUBPX) !== screen) continue;
    const ay = a.y - y0;
    if (a.id === "RBPN") tileCells(Math.floor(a.x / TILE), Math.floor(ay / TILE), panels ? panel : hole, !panels);
    else if (a.id === "TFLR") {
      for (let k = 0; k < TRAPDOOR_TILES * TRAPDOOR_TILES; k++) tileCells(Math.floor(a.x / TILE) + (k % TRAPDOOR_TILES), Math.floor(ay / TILE) + Math.floor(k / TRAPDOOR_TILES), trap);
    } else if (a.id === "FBMR") {
      // Everything a fire-bar arm sweeps (hazards.ts fireballs), plus a Link's half width.
      const reach = (((a.params >>> 20) & 15) + 1 + Math.max(1, Math.min(16, a.params & 0xff))) * FIREBAR_RING + 8;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const dx = x * CELL + CELL / 2 - a.x, dy = y * CELL + CELL / 2 - ay;
          if (dx * dx + dy * dy <= reach * reach) trap[y * w + x] = 1;
        }
      }
    }
  }
  const flags = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = at(x, y);
      let f = 0;
      const clear = !(wall[c - P - 1]! | wall[c - P]! | wall[c - P + 1]! | wall[c - 1]! | wall[c]! | wall[c + 1]! | wall[c + P - 1]! | wall[c + P]! | wall[c + P + 1]!);
      const room = clear || (!wall[c] && fits(c));
      if (sideView) {
        // Side view: he stands on the ground (a wall right under him) or on a ladder; anywhere else he falls (no pits).
        if (room && (wall[c + P] || climb[y * w + x])) f |= NAV.stand;
        if (room) f |= NAV.safe;
        if (clear) f |= NAV.open;
        if (climb[y * w + x]) f |= NAV.ladder;
      } else {
        if (clear) f |= NAV.stand | NAV.open;
        else if (room) f |= NAV.stand;
        if (!hole[c] && !hole[c + P]) f |= NAV.safe;
        if (hole[c]) f |= NAV.pit;
        // The probe (the cell and the one below) with a cell's margin all round.
        let near = 0;
        for (let dy = -1; dy <= 2; dy++) near |= hole[c + dy * P - 1]! | hole[c + dy * P]! | hole[c + dy * P + 1]!;
        if (near) f |= NAV.edge;
        if (trap[y * w + x]) f |= NAV.trap;
        if (panel[y * w + x] || (y + 1 < h && panel[(y + 1) * w + x])) f |= NAV.panel;
      }
      flags[y * w + x] = f;
    }
  }
  if (!sideView) return { w, h, flags, fields: new Map(), y0 };
  // A ledge: a standing cell with a drop beside it (a hit could knock him off).
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = y * w + x;
      if (!(flags[c]! & NAV.stand)) continue;
      for (const dx of [-1, 1]) if (x + dx >= 0 && x + dx < w && (flags[c + dx]! & (NAV.stand | NAV.safe)) === NAV.safe) flags[c]! |= NAV.edge;
    }
  }
  return { w, h, flags, fields: new Map(), y0, side: sideMoves(w, h, flags, climb) };
}

/** The moves of a side-view grid (SideMoves) from its flags and ladder cells. */
function sideMoves(w: number, h: number, flags: Uint8Array, ladder: Uint8Array): SideMoves {
  const stand = (c: number) => (flags[c]! & NAV.stand) !== 0, air = (c: number) => (flags[c]! & (NAV.stand | NAV.safe)) === NAV.safe;
  const edges: [number, number, number, number][] = []; // from, to, cost, dir
  // Where a Link falling from cell (x, y) lands: the first standing cell down its column, or -1.
  const landing = (x: number, y: number) => {
    for (let k = y; k < h; k++) {
      const c = k * w + x;
      if (stand(c)) return c;
      if (!air(c)) return -1;
    }
    return -1;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = y * w + x;
      if (!stand(c)) continue;
      for (const [dx, dir] of [[1, Button.Right], [-1, Button.Left]] as const) {
        if (x + dx < 0 || x + dx >= w) continue;
        const n = c + dx;
        if (stand(n)) edges.push([c, n, STRAIGHT_COST, dir]);
        else if (air(n)) {
          const land = landing(x + dx, y);
          if (land >= 0) edges.push([c, land, STRAIGHT_COST + DROP_COST * (Math.floor(land / w) - y), dir]);
        }
      }
      if (!ladder[c]) continue;
      if (y > 0 && ladder[c - w] && stand(c - w)) edges.push([c, c - w, STRAIGHT_COST, Button.Up]);
      if (y + 1 < h) {
        if (stand(c + w)) edges.push([c, c + w, STRAIGHT_COST, Button.Down]);
        else if (air(c + w)) {
          const land = landing(x, y + 1);
          if (land >= 0) edges.push([c, land, STRAIGHT_COST + DROP_COST * (Math.floor(land / w) - y), Button.Down]);
        }
      }
    }
  }
  const n = w * h, start = new Int32Array(n + 1), rstart = new Int32Array(n + 1);
  for (const [from, to] of edges) {
    start[from + 1]!++;
    rstart[to + 1]!++;
  }
  for (let c = 0; c < n; c++) {
    start[c + 1]! += start[c]!;
    rstart[c + 1]! += rstart[c]!;
  }
  const to = new Int32Array(edges.length), cost = new Uint16Array(edges.length), dir = new Uint8Array(edges.length);
  const rfrom = new Int32Array(edges.length), rcost = new Uint16Array(edges.length);
  const fill = start.slice(), rfill = rstart.slice();
  for (const [a, b, k, d] of edges) {
    const i = fill[a]!++, j = rfill[b]!++;
    [to[i], cost[i], dir[i]] = [b, k, d];
    [rfrom[j], rcost[j]] = [a, k];
  }
  return { start, to, cost, dir, rstart, rfrom, rcost };
}

/** The cell index of a point (px), or -1 outside the grid. */
export function cellAt(nav: NavGrid, x: number, y: number): number {
  const cx = Math.floor(x / CELL), cy = Math.floor((y - nav.y0) / CELL);
  return cx < 0 || cy < 0 || cx >= nav.w || cy >= nav.h ? -1 : cy * nav.w + cx;
}

/** A cell's middle (px). */
export const cellX = (nav: NavGrid, cell: number) => (cell % nav.w) * CELL + CELL / 2;
export const cellY = (nav: NavGrid, cell: number) => Math.floor(cell / nav.w) * CELL + CELL / 2 + nav.y0;

export function walkable(nav: NavGrid, cell: number): boolean {
  return cell >= 0 && (nav.flags[cell]! & WALKABLE) === WALKABLE;
}

/** The pit probe of a Link anywhere in this cell is on solid ground (walls don't matter). */
export function safeCell(nav: NavGrid, cell: number): boolean {
  return cell >= 0 && (nav.flags[cell]! & NAV.safe) !== 0;
}

/** Is (x, y) px over a pit (or another Link's colored panel)? Off the grid: no. */
export function pitAt(nav: NavGrid, x: number, y: number): boolean {
  const cell = cellAt(nav, x, y);
  return cell >= 0 && (nav.flags[cell]! & NAV.pit) !== 0;
}

/** Walkable, away from pits and off the panels: somewhere to stand and fight. */
export function solidGround(nav: NavGrid, cell: number): boolean {
  return walkable(nav, cell) && (nav.flags[cell]! & (NAV.edge | NAV.panel)) === 0;
}

/** The solid-ground cell of region `home` nearest to (x, y) px (for waiting where a rival out of reach is closest), or -1. */
export function nearestInRegion(nav: NavGrid, home: number, x: number, y: number): number {
  let best = -1, bestD = Infinity;
  for (let cell = 0; cell < nav.w * nav.h; cell++) {
    if (!solidGround(nav, cell) || region(nav, cell) !== home) continue;
    const d = (cellX(nav, cell) - x) ** 2 + (cellY(nav, cell) - y) ** 2;
    if (d < bestD) (best = cell), (bestD = d);
  }
  return best;
}

/** The walkable cell nearest to (x, y) px within `radius` cells (rings outward, in a fixed order), or -1. */
export function nearestWalkable(nav: NavGrid, x: number, y: number, radius = 4, test: (nav: NavGrid, cell: number) => boolean = walkable): number {
  y -= nav.y0; // (the screen's own rows)
  const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
  for (let r = 0; r <= radius; r++) {
    let best = -1, bestD = Infinity;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= nav.w || ny >= nav.h) continue;
        const cell = ny * nav.w + nx;
        if (!test(nav, cell)) continue;
        const ddx = nx * CELL + CELL / 2 - x, ddy = ny * CELL + CELL / 2 - y, d = ddx * ddx + ddy * ddy;
        if (d < bestD) (best = cell), (bestD = d);
      }
    }
    if (best >= 0) return best;
  }
  return -1;
}

// Neighbors in a fixed order (straight first), as [dx, dy, cost].
const NEIGHBORS: readonly (readonly [number, number, number])[] = [
  [1, 0, STRAIGHT_COST],
  [-1, 0, STRAIGHT_COST],
  [0, 1, STRAIGHT_COST],
  [0, -1, STRAIGHT_COST],
  [1, 1, DIAGONAL_COST],
  [-1, 1, DIAGONAL_COST],
  [1, -1, DIAGONAL_COST],
  [-1, -1, DIAGONAL_COST],
];

/** The cost of stepping into a cell (on top of the step itself). */
function penalty(flags: number): number {
  return (flags & NAV.edge ? EDGE_COST : 0) + (flags & NAV.trap ? TRAP_COST : 0) + (flags & NAV.open ? 0 : TIGHT_COST) + (flags & NAV.panel ? PANEL_COST : 0);
}

/**
 * Distance from every walkable cell to `goal` (a walkable cell), UNREACHABLE elsewhere; memoized per goal. Diagonal
 * steps need both straight neighbors walkable (no cutting corners).
 */
export function flowField(nav: NavGrid, goal: number): Uint16Array {
  const hit = nav.fields.get(goal);
  if (hit) return hit;
  if (nav.side) return keepField(nav, goal, sideField(nav, nav.side, goal));
  const { w, h, flags } = nav, n = w * h;
  const dist = new Uint16Array(n).fill(UNREACHABLE);
  if (walkable(nav, goal)) {
    // Dial's algorithm: a step costs at most DIAGONAL_COST + EDGE_COST + TRAP_COST + TIGHT_COST + PANEL_COST < RING, so
    // a ring of buckets (linked lists in scratch arrays) keeps the cells to visit in order.
    const pool = scratch(n * 8 + 1);
    const head = bucketHeads.fill(-1);
    let used = 0, pending = 1;
    dist[goal] = 0;
    pool.cell[0] = goal;
    pool.next[0] = -1;
    head[0] = used++;
    for (let d = 0; pending > 0; d++) {
      const slot = d & (RING - 1);
      for (let k = head[slot]!; k !== -1; k = head[slot]!) {
        head[slot] = pool.next[k]!;
        pending--;
        const cell = pool.cell[k]!;
        if (dist[cell] !== d) continue;
        const x = cell % w, y = (cell - x) / w;
        for (let j = 0; j < 8; j++) {
          const dx = STEP_X[j]!, dy = STEP_Y[j]!, nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const next = cell + dy * w + dx, f = flags[next]!;
          if ((f & WALKABLE) !== WALKABLE) continue;
          if (j >= 4 && ((flags[cell + dx]! & WALKABLE) !== WALKABLE || (flags[cell + dy * w]! & WALKABLE) !== WALKABLE)) continue;
          const nd = d + STEP_COST[j]! + penalty(f);
          if (nd >= dist[next]!) continue; // (UNREACHABLE caps it: no arena path costs that much)
          dist[next] = nd;
          const b = nd & (RING - 1);
          pool.cell[used] = next;
          pool.next[used] = head[b]!;
          head[b] = used++;
          pending++;
        }
      }
    }
  }
  return keepField(nav, goal, dist);
}

function keepField(nav: NavGrid, goal: number, dist: Uint16Array): Uint16Array {
  if (nav.fields.size >= FIELDS_KEPT) nav.fields.delete(nav.fields.keys().next().value!);
  nav.fields.set(goal, dist);
  return dist;
}

/**
 * A side-view grid's distance field (flowField): the cost from every cell to `goal` over its moves (SideMoves), each
 * one costing its own plus the cell it leads to (penalty), by Dijkstra on the reverse moves (a binary heap: drops cost
 * more than a bucket ring holds). Cells that can't get there are UNREACHABLE (the top of a ladderless ledge…).
 */
function sideField(nav: NavGrid, moves: SideMoves, goal: number): Uint16Array {
  const dist = new Uint16Array(nav.w * nav.h).fill(UNREACHABLE);
  if (!walkable(nav, goal)) return dist;
  const heap: number[] = []; // (distance << 16 | cell) pairs, a min-heap (cells < 65536)
  const push = (d: number, c: number) => {
    let k = heap.push(d * 65536 + c) - 1;
    while (k > 0) {
      const up = (k - 1) >> 1;
      if (heap[up]! <= heap[k]!) break;
      [heap[up], heap[k]] = [heap[k]!, heap[up]!];
      k = up;
    }
  };
  const pop = () => {
    const top = heap[0]!, last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let k = 0; ; ) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < heap.length && heap[l]! < heap[m]!) m = l;
        if (r < heap.length && heap[r]! < heap[m]!) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k]!, heap[m]!];
        k = m;
      }
    }
    return top;
  };
  dist[goal] = 0;
  push(0, goal);
  while (heap.length) {
    const top = pop(), d = Math.floor(top / 65536), v = top % 65536;
    if (d !== dist[v]) continue;
    const enter = penalty(nav.flags[v]!);
    for (let k = moves.rstart[v]!; k < moves.rstart[v + 1]!; k++) {
      const u = moves.rfrom[k]!, nd = d + moves.rcost[k]! + enter;
      if (nd >= dist[u]!) continue;
      dist[u] = nd;
      push(nd, u);
    }
  }
  return dist;
}

/**
 * On a side-view grid, the move to make from (x, y) px down a distance field: the cell it leads to and the button it
 * takes (Left or Right, Up or Down on a ladder), or null when there's none better (there already, or in the air).
 */
export function sideStep(nav: NavGrid, field: Uint16Array, x: number, y: number): { to: number; dir: number } | null {
  const moves = nav.side, here = cellAt(nav, x, y);
  if (!moves || here < 0 || !walkable(nav, here)) return null;
  let best: { to: number; dir: number } | null = null, bestD = field[here]!;
  for (let k = moves.start[here]!; k < moves.start[here + 1]!; k++) {
    const to = moves.to[k]!, d = field[to]!;
    if (d < bestD) (best = { to, dir: moves.dir[k]! }), (bestD = d);
  }
  return best;
}

// The 8 steps: straight first, then diagonal (as NEIGHBORS).
const STEP_X = Int8Array.from([1, -1, 0, 0, 1, -1, 1, -1]);
const STEP_Y = Int8Array.from([0, 0, 1, -1, 1, 1, -1, -1]);
const STEP_COST = Uint8Array.from([STRAIGHT_COST, STRAIGHT_COST, STRAIGHT_COST, STRAIGHT_COST, DIAGONAL_COST, DIAGONAL_COST, DIAGONAL_COST, DIAGONAL_COST]);
const RING = 128;
const bucketHeads = new Int32Array(RING);
// Scratch space for flowField's buckets, grown as needed: overwritten by every call (no state is kept in it).
let pool = { cell: new Int32Array(0), next: new Int32Array(0) };
function scratch(size: number): typeof pool {
  if (pool.cell.length < size) pool = { cell: new Int32Array(size), next: new Int32Array(size) };
  return pool;
}

/**
 * The goal cell of a distance field toward (x, y) px: the walkable cell nearest to it, moved to a lattice cell of the
 * same region within 2 cells when there is one (a moving goal then only needs a new field every few cells), or -1.
 */
export function fieldGoal(nav: NavGrid, x: number, y: number): number {
  const exact = nearestWalkable(nav, x, y, 5);
  if (exact < 0) return -1;
  const cx = exact % nav.w, cy = (exact - cx) / nav.w, home = region(nav, exact);
  let best = exact, bestD = Infinity;
  for (let ly = cy - 2; ly <= cy + 2; ly++) {
    // (Side view: along the row only, where he stands.)
    if (ly < 0 || ly >= nav.h || (nav.side ? ly !== cy : ly % GOAL_STEP !== 1)) continue;
    for (let lx = cx - 2; lx <= cx + 2; lx++) {
      if (lx < 0 || lx >= nav.w || lx % GOAL_STEP !== 1) continue;
      const cell = ly * nav.w + lx;
      if (!walkable(nav, cell) || region(nav, cell) !== home) continue;
      const d = (lx - cx) ** 2 + (ly - cy) ** 2;
      if (d < bestD) (best = cell), (bestD = d);
    }
  }
  return best;
}

/**
 * The next cell to head for from (x, y) px down a distance field: the best walkable neighbor of the cell there (or,
 * from a cell next to a wall, the best walkable cell within 2), or -1 when there's no way (or we're there).
 */
export function nextStep(nav: NavGrid, field: Uint16Array, x: number, y: number): number {
  if (nav.side) return sideStep(nav, field, x, y)?.to ?? -1;
  const here = cellAt(nav, x, y);
  if (here < 0) return -1;
  const cx = here % nav.w, cy = (here - cx) / nav.w;
  if (walkable(nav, here)) {
    if (field[here] === 0) return -1;
    let best = -1, bestD = field[here]!;
    for (const [dx, dy] of NEIGHBORS) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= nav.w || ny >= nav.h) continue;
      const cell = ny * nav.w + nx;
      if (dx && dy && (!walkable(nav, cy * nav.w + nx) || !walkable(nav, ny * nav.w + cx))) continue;
      if (field[cell]! < bestD) (best = cell), (bestD = field[cell]!);
    }
    return best;
  }
  // Off the grid's walkable cells (against a wall, or knocked next to a pit): the best cell nearby.
  let best = -1, bestD = UNREACHABLE;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= nav.w || ny >= nav.h) continue;
      const cell = ny * nav.w + nx, d = field[cell]! + (Math.abs(dx) + Math.abs(dy)) * STRAIGHT_COST;
      if (field[cell]! < UNREACHABLE && d < bestD) (best = cell), (bestD = d);
    }
  }
  return best;
}

/**
 * Can a Link walk straight from (x0, y0) to (x1, y1) px without meeting a wall or a pit's edge? Samples every
 * 4 px; the first and last 8 px only need to be pit-safe (a Link next to a wall can still walk away from it).
 */
export function lineClear(nav: NavGrid, x0: number, y0: number, x1: number, y1: number): boolean {
  if (nav.side) {
    // Side view: along the ground he stands on, every cell of the way standing.
    const a = cellAt(nav, x0, y0), b = cellAt(nav, x1, y1);
    if (a < 0 || b < 0 || Math.floor(a / nav.w) !== Math.floor(b / nav.w)) return false;
    for (let c = Math.min(a, b); c <= Math.max(a, b); c++) if (!walkable(nav, c)) return false;
    return true;
  }
  const dx = x1 - x0, dy = y1 - y0;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 4));
  const ends = Math.ceil(8 / Math.max(1, Math.max(Math.abs(dx), Math.abs(dy)) / steps));
  for (let k = 0; k <= steps; k++) {
    const cell = cellAt(nav, x0 + Math.trunc((dx * k) / steps), y0 + Math.trunc((dy * k) / steps));
    if (cell < 0) return false;
    const f = nav.flags[cell]!;
    if (!(f & NAV.safe) || f & (NAV.edge | NAV.panel)) return false;
    if (!(f & NAV.open) && k > ends && k < steps - ends) return false;
  }
  return true;
}

const regionMaps = new WeakMap<NavGrid, Int32Array>();

/**
 * The connected area of walkable cells a cell belongs to (numbered from 1), 0 for a cell that isn't walkable: two cells
 * of the same region have a path between them. Memoized per grid.
 */
export function region(nav: NavGrid, cell: number): number {
  let map = regionMaps.get(nav);
  if (!map && nav.side) {
    // Side view: cells joined by a move either way (a drop joins a ledge to where it lands; the fields know the way).
    const moves = nav.side, parent = Int32Array.from({ length: nav.w * nav.h }, (_, c) => c);
    const find = (c: number): number => {
      while (parent[c] !== c) c = parent[c] = parent[parent[c]!]!;
      return c;
    };
    for (let c = 0; c < nav.w * nav.h; c++) for (let k = moves.start[c]!; k < moves.start[c + 1]!; k++) parent[find(c)] = find(moves.to[k]!);
    map = new Int32Array(nav.w * nav.h);
    const ids = new Map<number, number>();
    for (let c = 0; c < map.length; c++) {
      if (!walkable(nav, c)) continue;
      const root = find(c);
      if (!ids.has(root)) ids.set(root, ids.size + 1);
      map[c] = ids.get(root)!;
    }
    regionMaps.set(nav, map);
  }
  if (!map) {
    map = new Int32Array(nav.w * nav.h);
    let next = 0;
    const stack: number[] = [];
    for (let start = 0; start < map.length; start++) {
      if (map[start] || !walkable(nav, start)) continue;
      map[start] = ++next;
      stack.push(start);
      while (stack.length) {
        const c = stack.pop()!, x = c % nav.w, y = (c - x) / nav.w;
        for (const [dx, dy] of NEIGHBORS) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= nav.w || ny >= nav.h) continue;
          const n = ny * nav.w + nx;
          if (map[n] || !walkable(nav, n)) continue;
          if (dx && dy && (!walkable(nav, y * nav.w + nx) || !walkable(nav, ny * nav.w + x))) continue;
          map[n] = next;
          stack.push(n);
        }
      }
    }
    regionMaps.set(nav, map);
  }
  return cell >= 0 ? map[cell]! : 0;
}

const SPOT_STEP = 3;

/** Walkable cells away from pit edges and traps on a lattice every 3 cells: places to run to (memoized per grid). */
export function openSpots(nav: NavGrid): readonly number[] {
  let spots = spotLists.get(nav);
  if (!spots) {
    spots = [];
    for (let y = nav.side ? 0 : 1; y < nav.h; y += nav.side ? 1 : SPOT_STEP) {
      for (let x = 1; x < nav.w; x += SPOT_STEP) {
        const f = nav.flags[y * nav.w + x]!;
        // (Side view: on the ground, every row, not on a ladder.)
        if (solidGround(nav, y * nav.w + x) && !(f & NAV.trap) && !(nav.side && f & NAV.ladder)) spots.push(y * nav.w + x);
      }
    }
    spotLists.set(nav, spots);
  }
  return spots;
}
const spotLists = new WeakMap<NavGrid, number[]>();

/** Is every point from (x, y) px along (sx, sy) for `length` px pit-safe and off pit edges (a roll, a lunge)? */
export function runClear(nav: NavGrid, x: number, y: number, sx: number, sy: number, length: number): boolean {
  for (let d = 0; d <= length; d += 4) {
    const cell = cellAt(nav, x + sx * d, y + sy * d);
    if (cell < 0) return true; // off the grid: a wall stops the Link first
    const f = nav.flags[cell]!;
    if (!(f & NAV.safe) || f & NAV.edge) return false;
  }
  return true;
}
