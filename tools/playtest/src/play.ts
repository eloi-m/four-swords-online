// Playing goals (packages/sim drive.ts) on a stage with an eye on the Links: the scripted route from the stage's
// start, kept at each milestone's start (a clone and the buttons so far), and any list of goals played from there,
// watched tick by tick for a Link stuck (in a wall, or not moving for STUCK_TICKS with the stick held).
import { Button, isSolidAt, SUBPX } from "@fso/sim";
import { areaWorld, cloneAdventure, createAdventure, RoutePlayer, stepAdventure, type AdventureGame, type AdventureStage, type Goal } from "@fso/sim/adventure";

/** Ticks the leader may hold the stick without moving before he counts as stuck. */
export const STUCK_TICKS = 300;
/** Ticks a Link may stand with his middle in a solid cell before he counts as in a wall. */
export const WALL_TICKS = 30;

const STICK = Button.Up | Button.Down | Button.Left | Button.Right;

/** A lifter of a two-Link rock this far (px, either axis) from it counts as left behind. */
export const LIFTER_REACH = 32;

/**
 * A Link stuck or out of place: which, why, when (the game's tick), where (area px). wall: his middle in a solid cell
 * for WALL_TICKS; still: the leader holding the stick without moving for STUCK_TICKS; lifter: a two-Link rock carried
 * with one of its lifters LIFTER_REACH px from it; carried: a two-Link rock still carried in another area than its own.
 */
export interface Stuck {
  link: number;
  why: "wall" | "still" | "lifter" | "carried";
  tick: number;
  room: number;
  area: number;
  x: number;
  y: number;
}

/** How a list of goals played: done, or the goal it gave up on; the buttons fed, the Links stuck on the way. */
export interface Played {
  done: boolean;
  error: string | null;
  buttons: number[];
  stuck: Stuck[];
}

/** Watches a game tick by tick for stuck Links (one report per Link and kind until he gets free). */
export class StuckWatch {
  readonly found: Stuck[] = [];
  private still = 0;
  private lastX = 0;
  private lastY = 0;
  private walls: number[] = [0, 0, 0, 0];
  private reported = new Set<string>();
  private heavyIn = "";

  /** After a step fed `buttons` (the leader's). */
  look(game: AdventureGame, stage: AdventureStage, buttons: number): void {
    const a = game.adventure, p = game.players[0]!;
    if (a.edge || a.warp || a.stairs || a.talk || a.get || a.cleared) {
      this.still = 0;
      return;
    }
    const moved = p.x !== this.lastX || p.y !== this.lastY;
    [this.lastX, this.lastY] = [p.x, p.y];
    this.still = moved || !(buttons & STICK) ? 0 : this.still + 1;
    if (this.still === STUCK_TICKS) this.report(game, 0, "still");
    if (this.still === 0) this.reported.delete("0:still");
    const h = a.heavy, here = `${a.room}/${a.area}`;
    if (!h) this.heavyIn = "";
    else if (!this.heavyIn) this.heavyIn = here;
    else if (this.heavyIn !== here) this.report(game, 0, "carried");
    if (h?.phase === "carry") {
      const r = a.rocks[h.rock];
      game.players.forEach((q, i) => {
        if (!(h.lifters & (1 << i)) || !r) return;
        const far = Math.max(Math.abs(q.x - r.x), Math.abs(q.y - r.y)) > LIFTER_REACH * SUBPX;
        if (far) this.report(game, i, "lifter");
      });
    }
    if (game.tick % 2) return;
    const world = areaWorld(game, stage);
    game.players.forEach((q, i) => {
      const mode = a.links[i]?.mode;
      const parked = i > 0 && !!a.away;
      const inWall = !parked && (mode === "walk" || mode === "swim") && isSolidAt(world, q.x / SUBPX, q.y / SUBPX);
      this.walls[i] = inWall ? this.walls[i]! + 2 : 0;
      if (this.walls[i] === WALL_TICKS || this.walls[i] === WALL_TICKS + 1) this.report(game, i, "wall");
      if (!inWall) this.reported.delete(`${i}:wall`);
    });
  }

  private report(game: AdventureGame, link: number, why: Stuck["why"]): void {
    const key = `${link}:${why}`;
    if (this.reported.has(key)) return;
    this.reported.add(key);
    const q = game.players[link]!;
    this.found.push({ link, why, tick: game.tick, room: game.adventure.room, area: game.adventure.area, x: q.x / SUBPX, y: q.y / SUBPX });
  }
}

/** Plays `goals` on `game` (changing it) until they're done or one runs past its limit (or `cap` ticks). */
export function playGoals(game: AdventureGame, stage: AdventureStage, goals: readonly Goal[], cap = 20000): Played {
  const player = new RoutePlayer(goals), watch = new StuckWatch(), buttons: number[] = [];
  try {
    while (!player.done && buttons.length < cap) {
      const b = player.next(game, stage);
      if (player.done) break;
      stepAdventure(game, [b], stage);
      buttons.push(b);
      watch.look(game, stage, b);
    }
  } catch (e) {
    return { done: false, error: (e as Error).message, buttons, stuck: watch.found };
  }
  return { done: player.done, error: player.done ? null : `still going after ${cap} ticks (${player.current})`, buttons, stuck: watch.found };
}

/** The scripted route played once: at each milestone's start, a clone of the game and the buttons fed so far. */
export interface RouteRun {
  starts: { game: AdventureGame; buttons: number[] }[];
  /** A clone at each milestone's end. */
  ends: AdventureGame[];
  /** Stuck Links seen on the scripted route itself, per milestone. */
  stuck: Stuck[][];
}

/** Plays `milestones` (a stage's scripted route) from the stage's start, the first `upTo` of them. */
export function runRoute(stage: AdventureStage, milestones: readonly { goals: readonly Goal[] }[], upTo = milestones.length): RouteRun {
  const game = createAdventure(stage, { players: 4 });
  const all: number[] = [];
  const run: RouteRun = { starts: [], ends: [], stuck: [] };
  for (let n = 0; n < upTo; n++) {
    run.starts.push({ game: cloneAdventure(game), buttons: all.slice() });
    const played = playGoals(game, stage, milestones[n]!.goals);
    if (!played.done) throw new Error(`the scripted route fails in milestone ${n}: ${played.error}`);
    all.push(...played.buttons);
    run.stuck.push(played.stuck);
    run.ends.push(cloneAdventure(game));
  }
  return run;
}
