// The real game (packages/sim stepGame/cloneGame/hashGame) over the rollback session on 2–4 simulated peers.
import { ROOM_H, ROOM_W, type GameState, type World } from "@fso/sim";
import { describe, expect, it } from "vitest";
import { canonical, hasExtracted, initialGame, lakeHylia, simGame, syntheticWorld } from "./fixtures.ts";
import { appliedInputs, replay, runMatch, scriptedInput } from "./testing.ts";

function netplay(world: World, around: { x: number; y: number }, players: number, seed: number) {
  const game = simGame(world);
  const states: string[][] = Array.from({ length: players }, () => []);
  const r = runMatch<GameState>({
    game,
    initial: () => initialGame(world, around, players),
    players,
    conditions: { latency: 50, jitter: 40, loss: 0.15, duplicate: 0.02 },
    seed,
    duration: 12_000,
    input: scriptedInput(seed * 31),
    inputUntil: 560,
    onFinal: (p, frame, state) => frame % 100 === 0 && (states[p]![frame] = canonical(state)),
  });
  const frames = Math.min(...r.sessions.map((s) => s.finalizedFrame));
  const ref = replay(game, initialGame(world, around, players), players, frames, appliedInputs(r.sessions[0]!));
  for (let p = 0; p < players; p++) {
    const firstBad = r.finals[p]!.slice(0, frames + 1).findIndex((h, f) => h !== ref[f]);
    expect(firstBad, `peer ${p} diverges at frame ${firstBad}`).toBe(-1);
    expect(r.sessions[p]!.stats.desyncs).toBe(0);
    expect(r.sessions[p]!.stats.rollbacks).toBeGreaterThan(10);
  }
  // Bit-identical full states, not just equal hashes.
  for (let f = 0; f <= frames; f += 100) for (let p = 1; p < players; p++) expect(states[p]![f]).toBe(states[0]![f]);
  // Links actually moved around.
  const moved = r.sessions[0]!.state.players.filter((pl, i) => pl.x !== initialGame(world, around, players).players[i]!.x).length;
  expect(moved).toBeGreaterThan(0);
  return { frames, r };
}

describe("rollback netcode with the real sim", () => {
  for (const players of [2, 3, 4]) {
    it(`${players} Links on a synthetic room, 50±40 ms, 15% loss: every peer bit-identical`, () => {
      const { frames } = netplay(syntheticWorld(), { x: ROOM_W / 2 - 60, y: ROOM_H / 2 }, players, players);
      expect(frames).toBeGreaterThan(690);
    });
  }

  it.skipIf(!hasExtracted)("4 Links around Lake Hylia (extracted/), same conditions: every peer bit-identical", () => {
    const { world, origin } = lakeHylia();
    const { frames } = netplay(world, { x: origin.x + ROOM_W / 2, y: origin.y + ROOM_H / 2 }, 4, 9);
    expect(frames).toBeGreaterThan(690);
  });

  it("resimulating 8 frames of the sim is cheap", () => {
    const world = hasExtracted ? lakeHylia().world : syntheticWorld();
    const origin = hasExtracted ? lakeHylia().origin : { x: 0, y: 0 };
    const game = simGame(world);
    const input = scriptedInput(5);
    let state = initialGame(world, { x: origin.x + ROOM_W / 2, y: origin.y + ROOM_H / 2 }, 4);
    const runs = 2000;
    const t0 = performance.now();
    for (let k = 0; k < runs; k++) {
      let s = game.clone(state);
      for (let f = 0; f < 8; f++) s = game.step(game.clone(s), [0, 1, 2, 3].map((p) => input(p, k * 8 + f)));
      state = s;
    }
    const us = ((performance.now() - t0) / runs) * 1000;
    console.log(`8-frame rollback (restore + 8 × snapshot + step, 4 Links): ${us.toFixed(1)} µs`);
    expect(us).toBeLessThan(2000); // a 60 Hz frame is 16 667 µs
  });
});
