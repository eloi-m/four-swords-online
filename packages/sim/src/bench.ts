// What the battle sim costs per frame on the real arenas (needs extracted/): 4 bot Links fight for 60 s of game time
// on each arena, with items, hazards and orbs, and every step is timed; then a snapshot (clone), a desync hash and a
// worst-case online rollback (restore a snapshot, then 8 × snapshot + step, as RollbackSession does) mid-match.
// Then the same with 4 CPU Links (cpu.ts): the AI's own cost per tick (all four), and the rollback with the AI in each
// resimulated step, as an online match with CPU slots runs it.
//   pnpm --filter @fso/sim bench [ticks=3600]
import { existsSync, readFileSync } from "node:fs";
import { decompressYaz0, Dol, parseRarc, readTileTypes, Stage } from "@fso/formats";
import { ARENA_ROOMS, arenaName, arenaSpawns, buildArenaWorld } from "./arena.ts";
import { createBattle } from "./battle.ts";
import { botInputs } from "./battlebots.ts";
import { addCpus, cpuInputs, type CpuLevel } from "./cpu.ts";
import { cloneGame, stepGame, type GameState } from "./game.ts";
import { hashGame } from "./hash.ts";
import { arenaProps } from "./props.ts";

const root = new URL("../../../extracted/", import.meta.url);
const boss500 = new URL("files/GC4Sword_usa/Boss/boss500.arc", root);
const dolFile = new URL("sys/main.dol", root);
if (!existsSync(boss500) || !existsSync(dolFile)) {
  console.error("needs the extracted disc in extracted/ (pnpm --filter @fso/extract extract <disc>)");
  process.exit(1);
}
const TICKS = Number(process.argv[2] ?? 3600);
const ROLLBACK = 8;
const stage = new Stage(parseRarc(decompressYaz0(readFileSync(boss500))));
const tileTypes = readTileTypes(new Dol(readFileSync(dolFile)));

const rules = { hearts: 6, timeLimit: 0, wins: 99 };
const CPU_LEVELS: CpuLevel[] = ["easy", "normal", "hard", "normal"];
const percentile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const time = (runs: number, fn: () => void) => {
  const t0 = performance.now();
  for (let i = 0; i < runs; i++) fn();
  return ((performance.now() - t0) / runs) * 1000;
};

function run(room: number, record: boolean, cpus: boolean): Record<string, string | number> {
  const world = buildArenaWorld(stage, tileTypes, room);
  const game: GameState = createBattle(room, arenaSpawns(stage, room).slice(0, 4), rules, arenaProps(stage, tileTypes, room), 7);
  if (cpus) addCpus(game, CPU_LEVELS.map((level, player) => ({ player, level })));
  const seed = { s: 11 };
  const steps: number[] = [], thinks: number[] = [];
  let entities = 0, mid: GameState | null = null;
  const inputs: number[][] = [];
  for (let t = 0; t < TICKS; t++) {
    const t0 = performance.now();
    const buttons = cpus ? [...cpuInputs(game, world, [])] : botInputs(game, seed);
    const t1 = performance.now();
    if (mid) inputs.push(buttons);
    stepGame(game, buttons, world);
    steps.push((performance.now() - t1) * 1000);
    thinks.push((t1 - t0) * 1000);
    entities = Math.max(entities, game.battle!.entities.length);
    if (t === TICKS >> 1) mid = cloneGame(game);
  }
  if (!record) return {};
  steps.sort((a, b) => a - b);
  thinks.sort((a, b) => a - b);
  const snapshot = mid!;
  const clone = time(2000, () => cloneGame(snapshot));
  const hash = time(2000, () => hashGame(snapshot));
  // As RollbackSession resimulates: the CPUs think again in every step (from the restored state).
  const rollback = time(500, () => {
    let s = cloneGame(snapshot);
    for (let f = 0; f < ROLLBACK; f++) {
      const next = cloneGame(s);
      stepGame(next, cpus ? cpuInputs(next, world, []) : inputs[f]!, world);
      s = next;
    }
  });
  return {
    arena: `${room} ${arenaName(room)}`,
    "entities max": entities,
    "step µs mean": mean(steps).toFixed(1),
    "p99": percentile(steps, 0.99).toFixed(1),
    "max": steps.at(-1)!.toFixed(0),
    ...(cpus ? { "4 CPUs µs mean": mean(thinks).toFixed(1), "CPUs p99": percentile(thinks, 0.99).toFixed(1), "CPUs max": thinks.at(-1)!.toFixed(0) } : {}),
    "clone µs": clone.toFixed(1),
    "hash µs": hash.toFixed(1),
    [`${ROLLBACK}-frame rollback µs`]: rollback.toFixed(0),
  };
}

for (const cpus of [false, true]) {
  for (const room of ARENA_ROOMS) run(room, false, cpus); // warm the JIT up
  console.log(`${cpus ? `4 CPU Links (${CPU_LEVELS.join(", ")})` : "4 bot Links"}, ${TICKS} ticks per arena (node ${process.version}); a frame is 16 667 µs`);
  console.table(ARENA_ROOMS.map((room) => run(room, true, cpus)));
}
