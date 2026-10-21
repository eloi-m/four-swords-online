// Rollback cost and behavior of the real sim under simulated networks.
//   pnpm --filter @fso/net bench      (uses Lake Hylia from extracted/ when present, else a synthetic room)
import { ROOM_H, ROOM_W, type GameState } from "@fso/sim";
import { hasExtracted, initialGame, lakeHylia, simGame, syntheticWorld } from "./fixtures.ts";
import { runMatch, scriptedInput } from "./testing.ts";

const { world, origin } = hasExtracted ? lakeHylia() : { world: syntheticWorld(), origin: { x: 0, y: 0 } };
const around = { x: origin.x + ROOM_W / 2, y: origin.y + ROOM_H / 2 };
const game = simGame(world);
console.log(`world: ${hasExtracted ? "Lake Hylia (boss010)" : "synthetic room"}`);

// Primitive costs.
const time = (runs: number, fn: () => void) => {
  const t0 = performance.now();
  for (let k = 0; k < runs; k++) fn();
  return ((performance.now() - t0) / runs) * 1000;
};
const state = initialGame(world, around, 4);
const input = scriptedInput(1);
let s = game.clone(state), f = 0;
console.log(
  `4 Links, µs per call: clone ${time(20000, () => game.clone(state)).toFixed(2)}, ` +
    `step ${time(20000, () => (s = game.step(s, [0, 1, 2, 3].map((p) => input(p, f++))))).toFixed(2)}, ` +
    `hash ${time(20000, () => game.hash(state)).toFixed(2)}`,
);

const DURATION = 60_000;
const rows: Record<string, string | number>[] = [];
for (const [name, conditions, delay] of [
  ["LAN 5 ms", { latency: 5, jitter: 2, loss: 0 }, 1],
  ["30±10 ms", { latency: 30, jitter: 10, loss: 0.01 }, 2],
  ["60±30 ms, 5% loss", { latency: 60, jitter: 30, loss: 0.05 }, 2],
  ["100±50 ms, 10% loss", { latency: 100, jitter: 50, loss: 0.1 }, 2],
  ["100±50 ms, 10% loss, delay 4", { latency: 100, jitter: 50, loss: 0.1 }, 4],
  ["150±100 ms, 25% loss", { latency: 150, jitter: 100, loss: 0.25 }, 3],
] as const) {
  for (const players of [2, 4]) {
    const r = runMatch<GameState>({
      game,
      initial: () => initialGame(world, around, players),
      players,
      conditions,
      duration: DURATION,
      input: scriptedInput(players),
      session: { inputDelay: delay },
    });
    const st = r.sessions.map((x) => x.stats);
    const sum = (k: keyof (typeof st)[0]) => st.reduce((a, b) => a + b[k], 0) / players;
    const ticks = sum("ticks");
    rows.push({
      network: name,
      players,
      delay,
      "fps": ((sum("frames") / DURATION) * 1000).toFixed(1),
      "rollbacks/s": ((sum("rollbacks") / DURATION) * 1000).toFixed(1),
      "avg len": (sum("rollbackFrames") / Math.max(1, sum("rollbacks"))).toFixed(2),
      "max len": Math.max(...st.map((x) => x.maxRollback)),
      "stall %": (((sum("predictionStalls") + sum("syncStalls")) / ticks) * 100).toFixed(1),
      "µs/tick": ((r.advanceMs.reduce((a, b) => a + b, 0) / players / ticks) * 1000).toFixed(1),
      "B/s out": Math.round((sum("bytesSent") / DURATION) * 1000),
      desyncs: sum("desyncs"),
    });
  }
}
console.table(rows);
