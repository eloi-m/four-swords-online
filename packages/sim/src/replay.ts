// Input logs and replays: a local match (or an adventure stage) is its start (arena, rules, seed, CPUs; or the stage
// and where the Links start) plus the buttons fed to the sim on each tick, so a moment the player captured
// (tools/capture, apps' F8) replays exactly in node or in a page (#replay=). The log is run-length encoded: buttons
// change a few times a second at most.
import { arenaSpawns, buildArenaWorld } from "./arena.ts";
import { COUNTDOWN_TICKS, createBattle, type BattleRules, type Spawn } from "./battle.ts";
import { addCpus, cpuInputs, type CpuLevel } from "./cpu.ts";
import { stepGame, type GameState } from "./game.ts";
import { hashState } from "./hash.ts";
import { arenaProps } from "./props.ts";
import type { World } from "./world.ts";
import type { Facing } from "./player.ts";
import type { AdventureCarry } from "./adventure/adventure.ts";
import type { Stage } from "@fso/formats";

/** Runs of identical inputs: [buttons per player, ticks]. */
export type InputRuns = [buttons: number[], ticks: number][];

/** How often (ticks) a log keeps a hash of the state, to find where a replay parts from the recording. */
export const CHECKPOINT_TICKS = 600;

/** The buttons fed to the sim, tick by tick, run-length encoded, with a state hash every CHECKPOINT_TICKS. */
export class InputLog {
  readonly runs: InputRuns = [];
  readonly checkpoints: [tick: number, hash: number][] = [];
  ticks = 0;
  /** Records the buttons of one step; `state` (hashed every CHECKPOINT_TICKS steps) is the state after it. */
  push(buttons: readonly number[], state?: unknown): void {
    const last = this.runs[this.runs.length - 1];
    if (last && last[0].length === buttons.length && last[0].every((b, i) => b === buttons[i])) last[1]++;
    else this.runs.push([[...buttons], 1]);
    this.ticks++;
    if (state !== undefined && this.ticks % CHECKPOINT_TICKS === 0) this.checkpoints.push([this.ticks, hashState(state)]);
  }
}

/** The inputs of tick `i` (0-based) of a log, walking the runs from a cursor (for sequential reads). */
export class RunCursor {
  private run = 0;
  private used = 0;
  private readonly runs: InputRuns;
  constructor(runs: InputRuns) {
    this.runs = runs;
  }
  /** The next tick's buttons, or null past the end. */
  next(): number[] | null {
    while (this.run < this.runs.length && this.used >= this.runs[this.run]![1]) [this.run, this.used] = [this.run + 1, 0];
    const run = this.runs[this.run];
    if (!run) return null;
    this.used++;
    return run[0];
  }
}

export const runTicks = (runs: InputRuns): number => runs.reduce((n, [, t]) => n + t, 0);

/** The last steps of a replay in a page run one per frame, as played: the view's per-frame effects (sparks, labels'
 *  fades) build up as they did; the steps before run REPLAY_FAST_STEPS a frame. */
export const REPLAY_REAL_TIME_STEPS = 90;
export const REPLAY_FAST_STEPS = 240;

/** How many steps a page replaying runs this frame, `left` steps from the end. */
export const replayFrameSteps = (left: number): number => (left > REPLAY_REAL_TIME_STEPS ? Math.min(REPLAY_FAST_STEPS, left - REPLAY_REAL_TIME_STEPS) : Math.min(1, left));

/** A local Shadow Battle from its start (apps/battle's startMatch): replays with replayBattle. */
export interface BattleRecord {
  kind: "battle";
  room: number;
  players: number;
  rules: BattleRules;
  seed: number;
  cpus: { player: number; level: CpuLevel }[];
  /** A round begun elsewhere (a Dolphin round state, tools/dolphin compare.ts); absent = the arena's starts in order
   *  and the whole countdown. */
  start?: RoundStart;
  /** The humans' buttons (CPU slots 0) fed to cpuInputs on each step. */
  inputs: InputRuns;
  checkpoints: [tick: number, hash: number][];
  /** The state's tick and hash when the capture was taken (after `runTicks(inputs)` steps). */
  tick: number;
  hash: number;
}

/** A stage of the adventure from where the Links started (apps/game's createAdventure): replays with replayAdventure. */
export interface AdventureRecord {
  kind: "adventure";
  stage: string;
  room?: number;
  x?: number;
  y?: number;
  players: number;
  /** What the stage began with (the run's stage before it, or a Dolphin place): the Links' hearts, the leader's item. */
  carry?: AdventureCarry;
  /** The room's GBA-screen area the Links start in (1-7: a house, a cave; adventure.ts enterArea), x, y and the
   *  links' spots in its own px; absent = the TV part (0). */
  area?: number;
  /** Each Link put at this room px, facing this way, once the room is entered (a Dolphin place, tools/dolphin
   *  compare.ts); absent = all stacked on the leader at x, y. `swim`: he is swimming, the water's current carrying him
   *  by this much (px/tick; swim.ts stepCurrent). `air`: the ticks left on his clock in a side view's water
   *  (adventure waterclock.ts; the leader's is the one kept). */
  links?: { x: number; y: number; facing?: Facing; swim?: { x: number; y: number }; air?: number }[];
  /** The room's switches once it is entered (bit n: switch n; a Dolphin place's); absent = the room's own. */
  switches?: number;
  /** The room's Shadow Link put at a state of his entrance (0-13) and its ticks once the room is entered (a Dolphin
   *  place's: sim shadowlink.ts enterShadowAt); absent = his own start. */
  shadow?: { state: number; tick: number };
  inputs: InputRuns;
  checkpoints: [tick: number, hash: number][];
  tick: number;
  hash: number;
}

export type ReplayRecord = BattleRecord | AdventureRecord;

/** Where a replay ended: the state, and the first checkpoint whose hash differs from the recording's (null: none). */
export interface ReplayResult<S> {
  state: S;
  steps: number;
  hash: number;
  diverged: number | null;
}

/** Steps a replay `ticks` times (all of it by default), checking the log's checkpoints on the way. */
export function replaySteps<S>(state: S, record: ReplayRecord, step: (state: S, buttons: number[]) => void, ticks = runTicks(record.inputs)): ReplayResult<S> {
  const cursor = new RunCursor(record.inputs), checks = new Map(record.checkpoints);
  let steps = 0, diverged: number | null = null;
  for (let buttons = cursor.next(); buttons && steps < ticks; buttons = cursor.next()) {
    step(state, buttons);
    steps++;
    const expected = checks.get(steps);
    if (diverged === null && expected !== undefined && hashState(state) !== expected) diverged = steps;
  }
  return { state, steps, hash: hashState(state), diverged };
}

/** A round's start other than the arena's: the Links' starts in player order, and the countdown's ticks left. */
export interface RoundStart {
  spawns: Spawn[];
  countdown: number;
}

/** The Links' starts of a match: the round start's, else the arena's in order. */
export const matchSpawns = (stage: Stage, room: number, players: number, start?: RoundStart): Spawn[] => start?.spawns ?? arenaSpawns(stage, room).slice(0, players);

/** A new match's countdown cut to a round start's. */
export function applyRoundStart(game: GameState, start?: RoundStart): void {
  if (start && game.battle?.phase === "countdown") game.battle.phaseTick = Math.max(0, COUNTDOWN_TICKS - start.countdown);
}

/** A battle record's start, as apps/battle builds it: the world, then the state before its first step. */
export function startBattle(record: BattleRecord, stage: Stage, tileTypes: Uint16Array): { game: GameState; world: World } {
  const world = buildArenaWorld(stage, tileTypes, record.room);
  const spawns = matchSpawns(stage, record.room, record.players, record.start);
  const game = createBattle(record.room, spawns, record.rules, arenaProps(stage, tileTypes, record.room), record.seed);
  applyRoundStart(game, record.start);
  addCpus(game, record.cpus);
  return { game, world };
}

/** Replays a battle record (boss500's stage) `ticks` steps, all of them by default. */
export function replayBattle(record: BattleRecord, stage: Stage, tileTypes: Uint16Array, ticks?: number): ReplayResult<GameState> & { world: World } {
  const { game, world } = startBattle(record, stage, tileTypes);
  return { ...replaySteps(game, record, (g, buttons) => stepGame(g, cpuInputs(g, world, buttons), world), ticks), world };
}
