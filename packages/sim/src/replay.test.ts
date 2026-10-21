// Input logs (replay.ts): run-length encoding, reading back, checkpoints; and a recorded match replaying to its hash
// on the real arena (skips without extracted/).
import { existsSync, readFileSync } from "node:fs";
import { decompressYaz0, Dol, parseRarc, readTileTypes, Stage } from "@fso/formats";
import { describe, expect, it } from "vitest";
import { stepGame } from "./game.ts";
import { cpuInputs } from "./cpu.ts";
import { hashGame, hashState } from "./hash.ts";
import { CHECKPOINT_TICKS, InputLog, replayBattle, RunCursor, runTicks, startBattle, type BattleRecord } from "./replay.ts";

describe("input logs", () => {
  it("run-length encodes the buttons and reads them back tick by tick", () => {
    const log = new InputLog();
    const ticks = [[0, 0], [0, 0], [1, 0], [1, 0], [1, 0], [1, 2], [0, 0]];
    for (const t of ticks) log.push(t);
    expect(log.runs).toEqual([[[0, 0], 2], [[1, 0], 3], [[1, 2], 1], [[0, 0], 1]]);
    expect(runTicks(log.runs)).toBe(ticks.length);
    const cursor = new RunCursor(JSON.parse(JSON.stringify(log.runs)));
    expect(ticks.map(() => cursor.next())).toEqual(ticks);
    expect(cursor.next()).toBeNull();
  });

  it("keeps a hash of the state every CHECKPOINT_TICKS steps", () => {
    const log = new InputLog();
    for (let i = 1; i <= CHECKPOINT_TICKS * 2 + 5; i++) log.push([0], { i });
    expect(log.checkpoints).toEqual([[CHECKPOINT_TICKS, hashState({ i: CHECKPOINT_TICKS })], [CHECKPOINT_TICKS * 2, hashState({ i: CHECKPOINT_TICKS * 2 })]]);
  });
});

const root = new URL("../../../extracted/", import.meta.url);
const boss500 = new URL("files/GC4Sword_usa/Boss/boss500.arc", root);

describe.skipIf(!existsSync(boss500))("a recorded match (boss500)", () => {
  it("replays from its record to the same state", () => {
    const stage = new Stage(parseRarc(decompressYaz0(readFileSync(boss500))));
    const tileTypes = readTileTypes(new Dol(readFileSync(new URL("sys/main.dol", root))));
    const start = { kind: "battle" as const, room: 1, players: 3, rules: { hearts: 3, timeLimit: 0, wins: 3 }, seed: 1234, cpus: [{ player: 1, level: "hard" as const }, { player: 2, level: "normal" as const }] };
    const { game, world } = startBattle({ ...start, inputs: [], checkpoints: [], tick: 0, hash: 0 }, stage, tileTypes);
    const log = new InputLog();
    // P1 walks about and swings, a pattern changing every few ticks; the CPUs play themselves.
    for (let t = 0; t < 1500; t++) {
      const buttons = [[0x10, 0x20, 0x40, 0x80, 0x01][Math.floor(t / 37) % 5]! | (t % 50 < 3 ? 0x01 : 0), 0, 0];
      stepGame(game, cpuInputs(game, world, buttons), world);
      log.push(buttons, game);
    }
    const record: BattleRecord = { ...start, inputs: log.runs, checkpoints: log.checkpoints, tick: game.tick, hash: hashGame(game) };
    const replayed = replayBattle(JSON.parse(JSON.stringify(record)) as BattleRecord, stage, tileTypes);
    expect(replayed.steps).toBe(1500);
    expect(replayed.diverged).toBeNull();
    expect(replayed.hash).toBe(record.hash);
    expect(replayed.state.tick).toBe(record.tick);
  });
});
