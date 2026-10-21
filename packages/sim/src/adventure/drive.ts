// A scripted player for the adventure: a route is a list of goals ("walk to", "leave the room that way", "press the
// Action button"…), each giving the leader's buttons tick by tick until it's reached. Deterministic (it reads only the
// game state), so the same route plays the same in node (tests) and in the browser (window.fso.route, apps/game).
import { Button, SUBPX, type PlayerState } from "../player.ts";
import { isSolidAt, surfaceAt, type World } from "../world.ts";
import { areaWorld, type AdventureGame } from "./adventure.ts";
import { enemyActive, enemyBox, enemyShown, type Enemy } from "./enemies.ts";
import { MINOR_SHADOW_STATE, minorShadowState } from "./minorshadow.ts";
import { pickupShown, type Pickup } from "./pickups.ts";
import { FORMATION_BUTTONS, type StickFormation } from "./formation.ts";
import { TALK_BUTTON } from "./dialogue.ts";
import type { AdventureStage } from "./stage.ts";
import { stepSwim, SWIM_UNIT } from "./swim.ts";
import type { LinkMotion } from "./motion.ts";

/**
 * A goal's tick: the buttons to hold, or `true` once it's reached. A goal may keep its own state between ticks; it
 * starts over on its tick 0, so a route can be played again.
 */
export type Goal = { name: string; limit: number; next(game: AdventureGame, stage: AdventureStage, tick: number): number | true };

const dirTo = (dx: number, dy: number, tol: number) =>
  (dx > tol ? Button.Right : dx < -tol ? Button.Left : 0) | (dy > tol ? Button.Down : dy < -tol ? Button.Up : 0);

/** Walks the leader to (x, y), area px, within `tol` px (straight lines: give waypoints round walls). */
export function walkTo(x: number, y: number, tol = 1.5, limit = 900): Goal {
  return {
    name: `walk to (${x}, ${y})`,
    limit,
    next(game) {
      const p = game.players[0]!;
      const dx = x - p.x / SUBPX, dy = y - p.y / SUBPX;
      if (Math.abs(dx) <= tol && Math.abs(dy) <= tol) return true;
      return dirTo(dx, dy, tol);
    },
  };
}

const SENSORS: readonly (readonly [number, number])[] = [[0, -7], [0, 7], [-7, 0], [7, 0], [-5, -5], [5, -5], [-5, 5], [5, 5]];

/** Whether the leader can stand at (x, y), area px: his sensors clear of walls, no pit (nor deep water unless `swim`). */
export function standable(world: World, x: number, y: number, swim = false, stones = 0): boolean {
  if (SENSORS.some(([sx, sy]) => isSolidAt(world, x + sx, y + sy))) return false;
  if (stones && STONE_RING.some(([sx, sy]) => stoneAt(world, x + sx * stones, y + sy * stones))) return false;
  const s = surfaceAt(world, x, y);
  return s !== "pit" && (swim || s !== "deep");
}

/** How far (px) past his sensors a swimming path keeps from the river stones (they hurt: swim.ts STONE_DAMAGE). */
const STONE_CLEARANCE = 13;
/** The directions round a Link the stone clearance is checked along (unit steps, the diagonals' 1/√2 rounded). */
const STONE_RING: readonly (readonly [number, number])[] = [[0, -1], [0, 1], [-1, 0], [1, 0], [-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]];

function stoneAt(world: World, x: number, y: number): boolean {
  const cx = Math.floor(x / 8), cy = Math.floor(y / 8);
  return cx >= 0 && cy >= 0 && cx < world.widthCells && cy < world.heightCells && world.spikes![cy * world.widthCells + cx] === 1;
}

/**
 * A walkable path from (x0, y0) to (x1, y1) in the current area (area px, a 2 px grid, the Link's sensors clear of walls,
 * no pits or deep water unless `swim`), as waypoints where it turns; null when there's none.
 */
export function findPath(world: World, x0: number, y0: number, x1: number, y1: number, swim = false): { x: number; y: number }[] | null {
  // Swimming, wide of the river stones when there's a way that is.
  if (swim && world.spikes) return pathOf(world, x0, y0, x1, y1, swim, STONE_CLEARANCE) ?? pathOf(world, x0, y0, x1, y1, swim, 0);
  return pathOf(world, x0, y0, x1, y1, swim, 0);
}

function pathOf(world: World, x0: number, y0: number, x1: number, y1: number, swim: boolean, stones: number): { x: number; y: number }[] | null {
  const { from, W } = flood(world, x0, y0, swim, x1, y1, stones);
  const tx = Math.round(x1 / FLOOD_GRID), ty = Math.round(y1 / FLOOD_GRID);
  const end = ty * W + tx;
  if (from[end]! < 0) return null;
  const cells: number[] = [];
  for (let c = end; ; c = from[c]!) {
    cells.push(c);
    if (from[c] === c) break;
  }
  cells.reverse();
  // Waypoints where the way turns.
  const out: { x: number; y: number }[] = [];
  for (let k = 1; k < cells.length; k++) {
    const a = cells[k - 1]!, b = cells[k]!, c = cells[k + 1];
    const d1 = b - a, d2 = c === undefined ? NaN : c - b;
    if (d1 !== d2) out.push({ x: (b % W) * FLOOD_GRID, y: Math.floor(b / W) * FLOOD_GRID });
  }
  return out;
}

/** Whether (x, y) can be walked to from (x0, y0) (findPath's grid and rules), for many points at once. */
export function reachable(world: World, x0: number, y0: number, swim = false): (x: number, y: number) => boolean {
  const { from, W, H } = flood(world, x0, y0, swim);
  return (x, y) => {
    const gx = Math.round(x / FLOOD_GRID), gy = Math.round(y / FLOOD_GRID);
    return gx >= 0 && gy >= 0 && gx < W && gy < H && from[gy * W + gx]! >= 0;
  };
}

/** findPath's grid step (px). */
const FLOOD_GRID = 2;

/** A breadth-first walk of the area from (x0, y0) on findPath's grid (until (x1, y1), given): where each point came from. */
function flood(world: World, x0: number, y0: number, swim: boolean, x1 = -1, y1 = -1, stones = 0): { from: Int32Array; W: number; H: number } {
  const G = FLOOD_GRID, W = Math.ceil((world.widthCells * 8) / G), H = Math.ceil((world.heightCells * 8) / G);
  // Each point's standing checked once (0 unknown, 1 free, 2 not).
  const known = new Uint8Array(W * H);
  const free = (gx: number, gy: number) => {
    if (gx < 0 || gy < 0 || gx >= W || gy >= H) return standable(world, gx * G, gy * G, swim, stones);
    const n = gy * W + gx;
    if (!known[n]) known[n] = standable(world, gx * G, gy * G, swim, stones) ? 1 : 2;
    return known[n] === 1;
  };
  const sx = Math.round(x0 / G), sy = Math.round(y0 / G), tx = x1 < 0 ? -1 : Math.round(x1 / G), ty = Math.round(y1 / G);
  const from = new Int32Array(W * H).fill(-1);
  const queue = [sy * W + sx];
  from[sy * W + sx] = sy * W + sx;
  // A Link snug against a wall can stand where his grid point isn't free: the free points round him start too.
  if (!free(sx, sy)) {
    for (let r = 1; r <= 2; r++) {
      for (let gy = sy - r; gy <= sy + r; gy++) {
        for (let gx = sx - r; gx <= sx + r; gx++) {
          const n = gy * W + gx;
          if (gx < 0 || gy < 0 || gx >= W || gy >= H || from[n]! >= 0 || !free(gx, gy)) continue;
          from[n] = n;
          queue.push(n);
        }
      }
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const c = queue[q]!, cx = c % W, cy = Math.floor(c / W);
    if (cx === tx && cy === ty) break;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      const nx = cx + dx, ny = cy + dy, n = ny * W + nx;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || from[n]! >= 0 || !free(nx, ny)) continue;
      if (dx && dy && (!free(cx + dx, cy) || !free(cx, cy + dy))) continue;
      from[n] = c;
      queue.push(n);
    }
  }
  return { from, W, H };
}

/** The stick ways a swimming plan tries (none, the four sides, the four diagonals). */
const SWIM_WAYS: readonly number[] = [
  0, Button.Up, Button.Down, Button.Left, Button.Right,
  Button.Up | Button.Left, Button.Up | Button.Right, Button.Down | Button.Left, Button.Down | Button.Right,
];
/** A swimming plan: ticks each way is held, the most states kept at each step of the search, how many steps it takes. */
const SWIM_HOLD = 6;
const SWIM_BEAM = 600;
const SWIM_STEPS = 120;
/** Ticks swimTo heads straight for its target after a search found no plan, before it searches again. */
const SWIM_RETRY = 60;
/** The search keeps the nearest state in each square this many px wide. */
const SWIM_SPREAD = 4;

interface SwimNode {
  p: PlayerState;
  m: LinkMotion;
  /** The node it came from and the way held from there (the plan is read back along these). */
  from: SwimNode | null;
  way: number;
}

/**
 * A plan for the swimming leader to come within `reach` px of (x, y) (area px), searched over his own swim step
 * (swim.ts stepSwim: the water's currents carrying him as they do): holds of SWIM_HOLD ticks of each stick way, the
 * nearest SWIM_BEAM states kept at each step, none running into a river stone or out of the water. The buttons of each
 * tick and where he is after it (1/256 px, x then y); null if none was found.
 */
export function planSwim(
  world: World, p0: PlayerState, m0: LinkMotion, x: number, y: number, reach: number,
  { hold = SWIM_HOLD, beam = SWIM_BEAM, steps = SWIM_STEPS, spread = SWIM_SPREAD } = {},
): { plan: number[]; at: number[] } | null {
  const tx = x * SUBPX, ty = y * SUBPX, r2 = (reach * SUBPX) ** 2;
  const dist2 = (p: PlayerState) => (p.x - tx) ** 2 + (p.y - ty) ** 2;
  // Played again from the start along the ways found, up to the tick it gets there.
  const replay = (end: SwimNode, ticks: number) => {
    const ways: number[] = [];
    for (let n: SwimNode | null = end; n?.from; n = n.from) ways.unshift(n.way);
    const p = { ...p0 }, m = { ...m0 }, plan: number[] = [], at: number[] = [];
    for (const way of ways) {
      for (let t = 0; t < hold && plan.length < ticks; t++) {
        stepSwim(m, p, way, world);
        plan.push(way);
        at.push(p.x, p.y);
      }
    }
    return { plan, at };
  };
  let frontier: SwimNode[] = [{ p: { ...p0 }, m: { ...m0 }, from: null, way: 0 }];
  const seen = new Set<string>();
  for (let step = 0; step < steps && frontier.length; step++) {
    const next: SwimNode[] = [];
    for (const node of frontier) {
      for (const way of SWIM_WAYS) {
        const p = { ...node.p }, m = { ...node.m };
        let ok = true;
        for (let t = 0; t < hold && ok; t++) {
          if (!stepSwim(m, p, way, world, () => (ok = false))) ok = false;
          if (ok && dist2(p) <= r2) return replay({ p, m, from: node, way }, step * hold + t + 1);
        }
        if (!ok) continue;
        const key = `${Math.round(p.x / SUBPX)},${Math.round(p.y / SUBPX)},${Math.round((m.cx * 8) / SWIM_UNIT)},${Math.round((m.cy * 8) / SWIM_UNIT)},${m.dir}`;
        if (seen.has(key)) continue;
        seen.add(key);
        next.push({ p, m, from: node, way });
      }
    }
    // The nearest in each SWIM_SPREAD px square, the nearest squares first (spread out: the way to a whirl's middle
    // may lead away from it first).
    const best = new Map<number, SwimNode>();
    for (const n of next) {
      const cell = ((n.p.y / SUBPX / spread) | 0) * 4096 + ((n.p.x / SUBPX / spread) | 0);
      const b = best.get(cell);
      if (!b || dist2(n.p) < dist2(b.p)) best.set(cell, n);
    }
    frontier = [...best.values()].sort((a, b) => dist2(a.p) - dist2(b.p)).slice(0, beam);
  }
  return null;
}

/**
 * Swims the leader through the water's currents to within `reach` px of where `target` says (area px; null: done), on
 * a plan (planSwim), searched again whenever he isn't where it said he'd be (struck, the target moved).
 */
export function swimTo(name: string, target: (game: AdventureGame) => { x: number; y: number } | null, reach = 3, limit = 1800): Goal {
  let plan: { plan: number[]; at: number[] } | null = null, k = 0, aim = { x: 0, y: 0 }, retry = 0;
  return {
    name,
    limit,
    next(game, stage, tick) {
      const want = target(game);
      if (!want) return true;
      const p = game.players[0]!, m = game.adventure.links[0]!;
      if ((p.x / SUBPX - want.x) ** 2 + (p.y / SUBPX - want.y) ** 2 <= reach * reach) return true;
      if (m.mode !== "swim" || game.battle.fighters[0]!.mode !== "active") return 0;
      const onPlan = plan !== null && k > 0 && k < plan.plan.length && plan.at[k * 2 - 2] === p.x && plan.at[k * 2 - 1] === p.y;
      if (tick === 0) retry = 0;
      // No plan found: straight at it for a while, then search again.
      if (!plan && tick < retry) return dirTo(want.x - p.x / SUBPX, want.y - p.y / SUBPX, 1);
      if (tick === 0 || !onPlan || want.x !== aim.x || want.y !== aim.y) {
        plan = planSwim(areaWorld(game, stage), p, m, want.x, want.y, reach);
        k = 0;
        aim = want;
        if (!plan) {
          retry = tick + SWIM_RETRY;
          return dirTo(want.x - p.x / SUBPX, want.y - p.y / SUBPX, 1);
        }
      }
      return plan!.plan[k++]!;
    },
  };
}

/** Walks the leader to (x, y) along a path round the walls (findPath), within `tol` px. */
export function travelTo(x: number, y: number, opts: { tol?: number; swim?: boolean; limit?: number; exact?: boolean } = {}): Goal {
  const tol = opts.tol ?? 1.5;
  let path: { x: number; y: number }[] | null = null, at = 0, last = -1, stuck = 0;
  return {
    name: `travel to (${x}, ${y})`,
    limit: opts.limit ?? 2400,
    next(game, stage, tick) {
      const p = game.players[0]!, px = p.x / SUBPX, py = p.y / SUBPX;
      if (Math.abs(x - px) <= tol && Math.abs(y - py) <= tol) return true;
      if (tick === 0) [last, stuck] = [-1, 0];
      if (tick === 0 || !path || stuck > 40) {
        path = findPath(areaWorld(game, stage), Math.round(px), Math.round(py), x, y, opts.swim) ?? [{ x, y }];
        // The last grid point is the target rounded to the grid: aim at the target itself (a tolerance under 2 px
        // could otherwise stop short of it for good).
        if (!path.length) path = [{ x, y }];
        if (opts.exact) path[path.length - 1] = { x, y };
        at = 0;
        stuck = 0;
      }
      let wp = path[at]!;
      while (at < path.length - 1 && Math.abs(wp.x - px) <= 1.5 && Math.abs(wp.y - py) <= 1.5) wp = path[++at]!;
      const d = Math.abs(px - (last >> 16)) + Math.abs(py - (last & 0xffff));
      stuck = d < 0.5 ? stuck + 1 : 0;
      last = (Math.round(px) << 16) | Math.round(py);
      // (At the last grid point but still outside the tolerance of the target itself: on at the target.)
      return dirTo(wp.x - px, wp.y - py, at < path.length - 1 ? 0.75 : tol) || dirTo(x - px, y - py, 0.75);
    },
  };
}

/** How far from an enemy the leader stands to stab it (px, along the axis he faces it on). */
const STAB_RANGE = 18;
/** The way behind something facing one way (unit steps). */
const BEHIND: Readonly<Record<string, readonly [number, number]>> = { right: [-1, 0], left: [1, 0], down: [0, -1], up: [0, 1] };

/**
 * Fights the area's enemies that `which` picks, the nearest first, until none is left (or, given `until`, until it
 * holds: more may come out of generators): the leader walks round the walls to STAB_RANGE px (or `range`'s) from it on
 * the axis he's further along, faces it and stabs.
 */
export function defeat(name: string, which: (e: Enemy) => boolean, limit = 1800, until?: (game: AdventureGame) => boolean, range?: (e: Enemy) => number): Goal {
  let path: { x: number; y: number }[] = [], at = 0, plannedAt = -99, swing = 0;
  return {
    name,
    limit,
    next(game, stage, tick) {
      if (tick === 0) [path, at, plannedAt, swing] = [[], 0, -99, 0];
      const p = game.players[0]!, px = p.x / SUBPX, py = p.y / SUBPX;
      const foes = game.adventure.enemies.filter((e) => which(e) && enemyActive(e) && enemyShown(game, e));
      if (!until && !foes.length) return true;
      if (until && (until(game) || !foes.length)) {
        if (swing > 0) return swing-- > 8 ? Button.Sword : 0;
        return until(game) ? true : 0;
      }
      const d = (e: Enemy) => Math.abs(e.x / SUBPX - px) + Math.abs(e.y / SUBPX - py);
      const e = foes.reduce((a, b) => (d(b) < d(a) ? b : a));
      const ex = e.x / SUBPX, ey = e.y / SUBPX;
      // A captain: winding up or lunging, out of his line (sideways); holding after a lunge, struck from behind (his
      // shield stops a sword from ahead of him); else drawn into a lunge (closer than 80 px).
      if (e.type === "SLR4" && swing === 0 && (e.state === "stop" || e.state === "fly")) {
        const [bx, by] = BEHIND[e.facing]!;
        if (bx) return py >= ey ? Button.Down : Button.Up;
        void by;
        return px >= ex ? Button.Right : Button.Left;
      }
      const back = e.type === "SLR4" && (e.state === "spit" || e.state === "knock") ? BEHIND[e.facing] : null;
      const dx = back ? -back[0] : ex - px, dy = back ? -back[1] : ey - py;
      let horizontal = Math.abs(dx) >= Math.abs(dy);
      // (From the other axis when nobody can stand on that side of it: against a wall; from its far sides when neither
      // near one is standable: in a pocket open the other way.)
      let sx = Math.sign(dx || 1), sy = Math.sign(dy || 1);
      const r = range?.(e) ?? STAB_RANGE;
      const spot = (h: boolean) => (h ? [ex - sx * r, ey] : [ex, ey - sy * r]) as [number, number];
      if (!back && !standable(areaWorld(game, stage), ...spot(horizontal))) {
        if (standable(areaWorld(game, stage), ...spot(!horizontal))) horizontal = !horizontal;
        else if (standable(areaWorld(game, stage), ...(horizontal ? [ex + sx * r, ey] : [ex, ey + sy * r]) as [number, number])) [sx, sy] = horizontal ? [-sx, sy] : [sx, -sy];
        else if (standable(areaWorld(game, stage), ...(horizontal ? [ex, ey + sy * r] : [ex + sx * r, ey]) as [number, number])) {
          horizontal = !horizontal;
          [sx, sy] = horizontal ? [-sx, sy] : [sx, -sy];
        }
      }
      const [tx, ty] = spot(horizontal);
      if (swing > 0) return swing-- > 8 ? Button.Sword : 0;
      if (Math.abs(tx - px) <= 4 && Math.abs(ty - py) <= 4) {
        const toward = horizontal ? (sx > 0 ? Button.Right : Button.Left) : sy > 0 ? Button.Down : Button.Up;
        if (p.facing !== (horizontal ? (sx > 0 ? "right" : "left") : sy > 0 ? "down" : "up")) return toward;
        swing = 10;
        return Button.Sword;
      }
      if (tick - plannedAt >= 20 || at >= path.length) {
        path = findPath(areaWorld(game, stage), Math.round(px), Math.round(py), Math.round(tx), Math.round(ty)) ?? [{ x: tx, y: ty }];
        at = 0;
        plannedAt = tick;
      }
      while (at < path.length - 1 && Math.abs(path[at]!.x - px) <= 1.5 && Math.abs(path[at]!.y - py) <= 1.5) at++;
      const wp = path[at] ?? { x: tx, y: ty };
      return dirTo(wp.x - px, wp.y - py, 0.75);
    },
  };
}

/** Unit steps along each facing. */
const AHEAD: Readonly<Record<string, readonly [number, number]>> = { right: [1, 0], left: [-1, 0], down: [0, 1], up: [0, -1] };
/** A captain's lane (px): a lunge goes ~91 px ahead of him, his body and spear reaching ~23 px across it. */
const LANE_BEHIND = 24;
const LANE_AHEAD = 124;
const LANE_ACROSS = 30;
/** From this far (px) a captain holding after his lunge is struck. */
const CAPTAIN_STAB = 24;
/** A foe this far ahead (px), this far across, is struck at once (the swing's boxes: 32 px ahead, ±8 across). */
const FIGHT_REACH = 34;
const FIGHT_ACROSS = 10;

/**
 * Fights the area's enemies that `which` picks as defeat does, minding the captains (SLR4): a captain winding up or
 * lunging, the leader steps out of his lane (sideways, the way that's free); holding after his lunge (his shield down),
 * he's struck from where the leader is; else, the soldiers beaten first, the leader waits within his reach for the
 * wind-up (from ahead his shield stops the sword).
 */
export function fight(name: string, which: (e: Enemy) => boolean, limit = 1800, until?: (game: AdventureGame) => boolean): Goal {
  // (A big one is stabbed from outside its box: STAB_RANGE is within reach of its touch.)
  const half = (e: Enemy) => (enemyBox(e).right - enemyBox(e).left) / 2 / SUBPX;
  const soldiers = defeat(name, (e) => which(e) && e.type !== "SLR4", limit, until, (e) => Math.max(STAB_RANGE, half(e) + 7 + 3));
  let swing = 0, inner = 0, side = 0;
  return {
    name,
    limit,
    next(game, stage, tick) {
      if (tick === 0) [swing, inner, side] = [0, 0, 0];
      if (swing > 0) return swing-- > 8 ? Button.Sword : 0;
      const p = game.players[0]!, px = p.x / SUBPX, py = p.y / SUBPX, world = areaWorld(game, stage);
      const foes = game.adventure.enemies.filter((e) => which(e) && enemyActive(e) && enemyShown(game, e));
      const captains = foes.filter((e) => e.type === "SLR4");
      // Out of a winding-up or lunging captain's lane, sideways.
      for (const c of captains) {
        if (c.state !== "stop" && c.state !== "fly") continue;
        const [fx, fy] = AHEAD[c.facing]!, rx = px - c.x / SUBPX, ry = py - c.y / SUBPX;
        const along = rx * fx + ry * fy, across = rx * -fy + ry * fx;
        if (along < -LANE_BEHIND || along > LANE_AHEAD || Math.abs(across) >= LANE_ACROSS) continue;
        if (!side) {
          // The side he's already on, unless a wall's there.
          const pick = across >= 0 ? 1 : -1, clear = (s: number) => [8, 16, 24].every((d) => standable(world, px - fy * s * d, py + fx * s * d));
          side = clear(pick) ? pick : clear(-pick) ? -pick : pick;
        }
        const sx = -fy * side, sy = fx * side;
        return (sx > 0 ? Button.Right : sx < 0 ? Button.Left : 0) | (sy > 0 ? Button.Down : sy < 0 ? Button.Up : 0);
      }
      side = 0;
      // A captain holding after his lunge: struck.
      const open = captains.find((c) => c.state === "spit");
      if (open) {
        const dx = open.x / SUBPX - px, dy = open.y / SUBPX - py, horizontal = Math.abs(dx) >= Math.abs(dy);
        const tx = horizontal ? open.x / SUBPX - Math.sign(dx || 1) * CAPTAIN_STAB : open.x / SUBPX;
        const ty = horizontal ? open.y / SUBPX : open.y / SUBPX - Math.sign(dy || 1) * CAPTAIN_STAB;
        if (Math.abs(tx - px) <= 3 && Math.abs(ty - py) <= 3) {
          const facing = horizontal ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
          if (p.facing !== facing) return { right: Button.Right, left: Button.Left, down: Button.Down, up: Button.Up }[facing];
          swing = 10;
          return Button.Sword;
        }
        return dirTo(tx - px, ty - py, 0.75);
      }
      // One coming within the sword's reach: struck where he stands (turned to it; a step into its line first).
      const close = foes.filter((e) => e.type !== "SLR4" && e.state !== "knock");
      const near = close.length ? close.reduce((a, b) => (Math.max(Math.abs(b.x - p.x), Math.abs(b.y - p.y)) < Math.max(Math.abs(a.x - p.x), Math.abs(a.y - p.y)) ? b : a)) : null;
      if (near) {
        const dx = near.x / SUBPX - px, dy = near.y / SUBPX - py, horizontal = Math.abs(dx) >= Math.abs(dy);
        const along = Math.abs(horizontal ? dx : dy), across = horizontal ? dy : dx;
        if (along <= FIGHT_REACH && Math.abs(across) <= FIGHT_ACROSS) {
          const facing = horizontal ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
          if (p.facing !== facing) return { right: Button.Right, left: Button.Left, down: Button.Down, up: Button.Up }[facing];
          swing = 10;
          return Button.Sword;
        }
      }
      // The soldiers first.
      if (foes.some((e) => e.type !== "SLR4")) {
        const out = soldiers.next(game, stage, inner++);
        if (out !== true) return out;
      }
      if (!until && !captains.length) return true;
      if (until?.(game)) return true;
      // A captain marching or on his cool-down: within his reach, out of his way, for the wind-up.
      const c = captains.reduce<Enemy | null>((a, b) => (!a || Math.hypot(b.x - p.x, b.y - p.y) < Math.hypot(a.x - p.x, a.y - p.y) ? b : a), null);
      if (!c) return 0;
      const d = Math.hypot(c.x / SUBPX - px, c.y / SUBPX - py);
      if (d > 64) {
        const path = findPath(world, Math.round(px), Math.round(py), Math.round(c.x / SUBPX), Math.round(c.y / SUBPX));
        const wp = path?.find((w) => Math.abs(w.x - px) > 1.5 || Math.abs(w.y - py) > 1.5) ?? { x: c.x / SUBPX, y: c.y / SUBPX };
        return dirTo(wp.x - px, wp.y - py, 0.75);
      }
      if (d < 44) {
        // Back off (away from him, as the walls let).
        const ax = px - c.x / SUBPX, ay = py - c.y / SUBPX;
        const bx = Math.sign(ax), by = Math.sign(ay);
        if (standable(world, px + bx * 8, py + by * 8)) return dirTo(ax, ay, 0.75);
        if (bx && standable(world, px + bx * 8, py)) return bx > 0 ? Button.Right : Button.Left;
        if (by && standable(world, px, py + by * 8)) return by > 0 ? Button.Down : Button.Up;
        return Math.abs(ax) >= Math.abs(ay) ? (ay >= 0 ? Button.Down : Button.Up) : ax >= 0 ? Button.Right : Button.Left;
      }
      return 0;
    },
  };
}

/** A foe this close (px, both axes) is struck where the leader stands (guard). */
const GUARD_REACH = 28;
/** …once it's this close to his line (px across). */
const GUARD_ACROSS = 10;
/** A resting one is shot from up to this far (px), and the arrow waited for this many ticks (guard's `shoot`). */
const SHOOT_RANGE = 200;
const SHOOT_WAIT = 40;

/**
 * Fights the enemies `which` picks where they can't be walked up to (fliers over a pit): the leader stabs whichever
 * comes within GUARD_REACH px, turning to it. Between foes he plays `idle` (started over after each swing, again once
 * it's done), or else walks up to a resting one whose stab spot a path reaches, or else walks the `patrol` waypoints
 * round and round (waking the others: a Keese wakes for a Link within 60 px). Done when none is left, or, given
 * `until`, once it holds (between swings).
 */
export function guard(
  name: string,
  which: (e: Enemy) => boolean,
  opts: { patrol?: readonly { x: number; y: number }[]; limit?: number; until?: (game: AdventureGame) => boolean; idle?: Goal; shoot?: boolean } = {},
): Goal {
  const patrol = opts.patrol ?? [];
  let swing = 0, stop = 0, path: { x: number; y: number }[] = [], at = 0, plannedAt = -99, target = -1, idleTick = 0;
  let aim = 0, fire = 0;
  return {
    name,
    limit: opts.limit ?? 6000,
    next(game, stage, tick) {
      if (tick === 0) [swing, stop, path, at, plannedAt, target, idleTick, aim, fire] = [0, 0, [], 0, -99, -1, 0, 0, 0];
      if (swing > 0) return swing-- > 8 ? Button.Sword : 0;
      const p = game.players[0]!, px = p.x / SUBPX, py = p.y / SUBPX;
      const foes = game.adventure.enemies.filter((e) => which(e) && enemyActive(e) && enemyShown(game, e));
      if (!foes.length || opts.until?.(game)) return true;
      const d = (e: Enemy) => Math.max(Math.abs(e.x / SUBPX - px), Math.abs(e.y / SUBPX - py));
      const near = foes.reduce((a, b) => (d(b) < d(a) ? b : a));
      if (d(near) <= GUARD_REACH) {
        idleTick = 0;
        // In line (the sword's boxes reach 32 px ahead, ±8 across): turn to it and swing; else a step into its line.
        const dx = near.x / SUBPX - px, dy = near.y / SUBPX - py;
        const horizontal = Math.abs(dx) >= Math.abs(dy), across = horizontal ? dy : dx;
        if (Math.abs(across) > GUARD_ACROSS) return horizontal ? (dy > 0 ? Button.Down : Button.Up) : dx > 0 ? Button.Right : Button.Left;
        const facing = horizontal ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
        if (p.facing !== facing) return { right: Button.Right, left: Button.Left, down: Button.Down, up: Button.Up }[facing];
        swing = 10;
        return Button.Sword;
      }
      if (opts.idle) {
        const out = opts.idle.next(game, stage, idleTick++);
        if (out !== true) return out;
        idleTick = 0;
        return 0;
      }
      // A resting one within reach of a path: up to it (as defeat); else the next patrol point.
      const world = areaWorld(game, stage);
      if (tick - plannedAt >= 30 || at >= path.length) {
        plannedAt = tick;
        target = -1;
        path = [];
        at = 0;
        const resting = foes.filter((e) => e.state === "rest").sort((a, b) => d(a) - d(b));
        const can = reachable(world, Math.round(px), Math.round(py));
        for (const e of resting.slice(0, 4)) {
          const ex = Math.round(e.x / SUBPX), ey = Math.round(e.y / SUBPX);
          for (const [ox, oy] of [[0, 16], [0, -16], [16, 0], [-16, 0]] as const) {
            if (!can(ex + ox, ey + oy)) continue;
            const found = findPath(world, Math.round(px), Math.round(py), ex + ox, ey + oy);
            if (found) {
              [path, target] = [found, e.id];
              break;
            }
          }
          if (target >= 0) break;
        }
        // With `shoot`: a spot in line with a resting one, on the axis it sways on (a kind 3 Keese), to shoot it from.
        aim = 0;
        for (const e of opts.shoot && target < 0 ? resting.slice(0, 6) : []) {
          const ex = Math.round(e.x / SUBPX), ey = Math.round(e.y / SUBPX), across = e.kind === 3 && e.shot !== 0;
          for (let r = 16; r <= SHOOT_RANGE && target < 0; r += 2) {
            for (const side of [-1, 1]) {
              const sx = across ? ex : ex + side * r, sy = across ? ey + side * r : ey;
              if (!standable(world, sx, sy) || !can(sx, sy)) continue;
              const found = findPath(world, Math.round(px), Math.round(py), sx, sy);
              if (!found) continue;
              [path, target] = [found.length ? found : [{ x: sx, y: sy }], e.id];
              path[path.length - 1] = { x: sx, y: sy };
              aim = across ? (side < 0 ? Button.Down : Button.Up) : side < 0 ? Button.Right : Button.Left;
              break;
            }
          }
          if (target >= 0) break;
        }
        if (target < 0 && patrol.length) {
          const wp = patrol[stop % patrol.length]!;
          if (Math.abs(wp.x - px) <= 3 && Math.abs(wp.y - py) <= 3) stop++;
          const next = patrol[stop % patrol.length]!;
          path = findPath(world, Math.round(px), Math.round(py), next.x, next.y) ?? [];
        }
      }
      while (at < path.length - 1 && Math.abs(path[at]!.x - px) <= 1.5 && Math.abs(path[at]!.y - py) <= 1.5) at++;
      const wp = path[at];
      if (!wp) {
        plannedAt = -99;
        return 0;
      }
      const there = at === path.length - 1 && Math.abs(wp.x - px) <= 1.5 && Math.abs(wp.y - py) <= 1.5;
      if (there && aim) {
        // In line: turn, shoot, and wait for the arrow before looking again.
        const facing = aim === Button.Right ? "right" : aim === Button.Left ? "left" : aim === Button.Down ? "down" : "up";
        if (p.facing !== facing && fire === 0) return aim;
        plannedAt = tick;
        if (++fire <= 2) return Button.Item;
        if (fire < SHOOT_WAIT) return 0;
        [fire, plannedAt] = [0, -99];
        return 0;
      }
      if (there) plannedAt = -99;
      return dirTo(wp.x - px, wp.y - py, 0.75);
    },
  };
}

/** The goals one after another, as one goal (done after the last). */
export function sequence(name: string, goals: readonly Goal[]): Goal {
  let index = 0, start = 0;
  return {
    name,
    limit: goals.reduce((n, g) => n + g.limit, 0),
    next(game, stage, tick) {
      if (tick === 0) [index, start] = [0, 0];
      while (index < goals.length) {
        const out = goals[index]!.next(game, stage, tick - start);
        if (out !== true) return out;
        index++;
        start = tick;
      }
      return true;
    },
  };
}

/** Where the leader stands to take a pickup he can't stand on (a gem against a wall): within the bodies' reach (a gem's
 *  ±6 px and his ±7). */
const COLLECT_BESIDE: readonly (readonly [number, number])[] = [[0, 10], [0, -10], [10, 0], [-10, 0], [8, 8], [-8, 8], [8, -8], [-8, -8]];

/**
 * Picks up the area's pickups that `which` picks (shown, reachable), the nearest first, until none is left: the leader
 * walks round the walls onto each (a gem still falling, under it; swimming too with `swim`).
 */
export function collect(name: string, which: (p: Pickup) => boolean, limit = 3600, swim = false, beside = false): Goal {
  let path: { x: number; y: number }[] = [], at = 0, target = -1, plannedAt = -99;
  const unreachable = new Set<number>();
  return {
    name,
    limit,
    next(game, stage, tick) {
      if (tick === 0) [path, at, target, plannedAt] = [[], 0, -1, -99];
      if (tick === 0) unreachable.clear();
      const p = game.players[0]!, px = p.x / SUBPX, py = p.y / SUBPX;
      const left = game.adventure.pickups.filter((it) => which(it) && pickupShown(game, it) && !it.fetched && !unreachable.has(it.id));
      if (!left.length) return true;
      const d = (it: Pickup) => Math.abs(it.x / SUBPX - px) + Math.abs(it.y / SUBPX - py);
      const it = left.reduce((a, b) => (d(b) < d(a) ? b : a));
      let tx = Math.round(it.x / SUBPX), ty = Math.round(it.y / SUBPX);
      if (it.id !== target || tick - plannedAt >= 60 || at >= path.length) {
        const world = areaWorld(game, stage);
        let found = findPath(world, Math.round(px), Math.round(py), tx, ty, swim);
        // With `beside`, one lying against a wall (flung there) is taken from beside it, within the bodies' reach.
        for (const [ox, oy] of beside ? COLLECT_BESIDE : []) {
          if (found) break;
          found = findPath(world, Math.round(px), Math.round(py), tx + ox, ty + oy, swim);
          if (found) [tx, ty] = [tx + ox, ty + oy];
        }
        if (!found) {
          unreachable.add(it.id);
          return 0;
        }
        [path, at, target, plannedAt] = [found, 0, it.id, tick];
      }
      while (at < path.length - 1 && Math.abs(path[at]!.x - px) <= 1.5 && Math.abs(path[at]!.y - py) <= 1.5) at++;
      const wp = path[at] ?? { x: tx, y: ty };
      return dirTo(wp.x - px, wp.y - py, 0.75);
    },
  };
}

/** Holds a direction (and other buttons) until `until` holds. */
export function holdUntil(name: string, buttons: number, until: (game: AdventureGame) => boolean, limit = 900): Goal {
  return { name, limit, next: (game) => (until(game) ? true : buttons) };
}

/** Holds a direction until the Links are in `room` (area `area`), done with the walk in. */
export function goTo(buttons: number, room: number, area = 0, limit = 900): Goal {
  return holdUntil(`go to room ${room} area ${area}`, buttons, (g) => g.adventure.room === room && g.adventure.area === area && !g.adventure.edge && !g.adventure.warp, limit);
}

/** Presses `buttons` for `ticks` ticks, then lets go for `rest` ticks. */
export function press(buttons: number, ticks = 2, rest = 2): Goal {
  return { name: `press ${buttons}`, limit: ticks + rest + 1, next: (_g, _s, t) => (t >= ticks + rest ? true : t < ticks ? buttons : 0) };
}

/** Does nothing for `ticks` ticks. */
export function wait(ticks: number): Goal {
  return { name: `wait ${ticks}`, limit: ticks + 1, next: (_g, _s, t) => (t >= ticks ? true : 0) };
}

/** Waits (holding `buttons`) until `until` holds. */
export function waitUntil(name: string, until: (game: AdventureGame) => boolean, limit = 1200, buttons = 0): Goal {
  return holdUntil(name, buttons, until, limit);
}

/** Waits for the room's minor Shadow Link to be off the TV, his hammer's blows (they stun the leader) over. */
export function shadowGone(): Goal {
  return waitUntil("the minor Shadow Link gone", (g) => !g.adventure.enemies.some((e) => e.type === "ZSLH" && minorShadowState(e) !== MINOR_SHADOW_STATE.away), 1100);
}

/** A C-stick formation, then a few ticks for the Links to get there. */
export function formation(kind: StickFormation): Goal {
  return press(FORMATION_BUTTONS[kind], 1, 12);
}

/** Turns the leader (a one-tick tap). */
export function face(dir: number): Goal {
  return press(dir, 1, 2);
}

/** Presses the talk button until the message on show (or the item got's) is over: each press types a page out or turns it. */
export function readOn(): Goal {
  let last = -99;
  return {
    name: "read the message to its end",
    limit: 2400,
    next(g, _s, t) {
      if (t === 0) last = -99;
      if (!g.adventure.talk && !g.adventure.get) return true;
      if (!g.adventure.talk || t - last < 8) return 0;
      last = t;
      return TALK_BUTTON;
    },
  };
}

/** Opens the chest the leader touches the way he faces (the talk button: the GC's A), and reads its message. */
export function openChestFacing(dir: number): Goal[] {
  return [face(dir), press(TALK_BUTTON, 2, 4), readOn()];
}

/** Runs a route on `game`, one goal after another; throws with where it got stuck when a goal runs past its limit. */
export class RoutePlayer {
  index = 0;
  tick = 0;
  done = false;
  readonly goals: readonly Goal[];
  constructor(goals: readonly Goal[]) {
    this.goals = goals;
  }

  /** The leader's buttons this tick (0 once the route is over). */
  next(game: AdventureGame, stage: AdventureStage): number {
    while (!this.done) {
      const goal = this.goals[this.index];
      if (!goal) {
        this.done = true;
        break;
      }
      const out = goal.next(game, stage, this.tick);
      if (out !== true) {
        if (++this.tick > goal.limit) {
          const p = game.players[0]!, a = game.adventure;
          throw new Error(`route goal ${this.index} "${goal.name}" not reached in ${goal.limit} ticks: room ${a.room} area ${a.area} at (${(p.x / SUBPX).toFixed(1)}, ${(p.y / SUBPX).toFixed(1)}), tick ${game.tick}`);
        }
        return out;
      }
      this.index++;
      this.tick = 0;
    }
    return 0;
  }

  get current(): string {
    return this.goals[this.index]?.name ?? "done";
  }
}
