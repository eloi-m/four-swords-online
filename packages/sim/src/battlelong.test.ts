// A long 4-player bot match on an arena with every hazard, items from orbs, lifting, throwing and rolling: it must be
// deterministic (two runs match tick for tick) and survive a JSON snapshot mid-way (rollback netcode's requirement).
import { describe, expect, it } from "vitest";
import { createBattle, type Spawn } from "./battle.ts";
import { botInputs, type BotSeed } from "./battlebots.ts";
import { cloneGame, stepGame, type GameState } from "./game.ts";
import { hashGame } from "./hash.ts";
import { giveItem } from "./orbs.ts";
import type { ArenaProps } from "./props.ts";
import { arena } from "./testarena.ts";
import type { World } from "./world.ts";

const world: World = arena([4, 20, 6, 4, "O"], [30, 4, 3, 3, "#"], [8, 6, 2, 2, "#"], [26, 18, 2, 2, "#"]);
const props: ArenaProps = {
  actors: [
    { id: "HBMB", x: 40, y: 40, params: 0x101 },
    { id: "HBMB", x: 56, y: 40, params: 0x101 },
    { id: "HBMB", x: 280, y: 200, params: 0x101 },
    // The Tower of Flames' logic: an orb picker (RNSW: switch 1 or 2; the items' generator waits for 2), the fire pit's
    // OR gates, and a CKSW that lights the eternal flames (switch 14) at each round's start.
    { id: "RNSW", x: 0, y: 0, params: 0x00422106 }, // (room 1 has 0x0042213c: a pick every 600 ticks; 60 here)
    ...[0x53dfff84, 0x5a52f784, 0x6421ff84, 0x6a530804].map((params) => ({ id: "SWOR", x: 16, y: 0, params })),
    { id: "CKSW", x: 32, y: 0, params: (14 << 22) | (14 << 17) | (14 << 12) | (14 << 7) },
    { id: "BLZ2", x: 120, y: 200, params: 0x70000013 },
    { id: "BLZ2", x: 200, y: 40, params: 0x70000013 },
    ...[0x58000001, 0x68020001, 0x50030001, 0x60010001].map((params) => ({ id: "FLME", x: 160, y: 120, params })),
    { id: "SWTH", x: 128, y: 96, params: 0x48000000 }, // switch 9: fires the fire-pit flames right and down
    { id: "SWTH", x: 48, y: 128, params: 0x10000000 }, // opens the trick floor (switch 2)
    { id: "TFLR", x: 208, y: 144, params: 0x11000106 },
    { id: "FBMR", x: 96, y: 176, params: 0x42220008 },
    { id: "FBMR", x: 96, y: 176, params: 0x42220108 },
    { id: "BEEE", x: 240, y: 60, params: 0x08000000 },
    { id: "SLR1", x: 280, y: 120, params: 0x1002 },
    { id: "CIRC", x: 160, y: 200, params: 0x91131325 },
    { id: "CRGN", x: 100, y: 100, params: 0x00000001 }, // an orb (kind 1, no switch: rounds end before 450 gated ticks)
    { id: "CRGN", x: 220, y: 100, params: 0x100001e2 }, // items on the ground (kind 2): slingshot, boomerang, bow, bombs
    { id: "WARP", x: 16, y: 208, params: 0x02091019 },
  ],
  bushes: [2 * 32 + 12, 2 * 32 + 13, 12 * 32 + 3, 12 * 32 + 16],
};
// The bushes' tiles block movement, like real bush tiles.
for (const tile of props.bushes) {
  const tx = tile % 32, ty = Math.floor(tile / 32);
  for (let q = 0; q < 4; q++) world.solid[(ty * 2 + (q >> 1)) * world.widthCells + tx * 2 + (q & 1)] = 1;
}
const spawns: Spawn[] = [
  { x: 80, y: 60, facing: "right" },
  { x: 240, y: 60, facing: "left" },
  { x: 80, y: 180, facing: "right" },
  { x: 240, y: 180, facing: "left" },
];
const RULES = { hearts: 3, timeLimit: 25 * 60, wins: 3 };
const TICKS = 9000, FORK = 3700;
// The bots' seed: one whose match holds every rule checked below (many do; a rules change can call for another).
const BOT = 3;

// Round 1 starts with an item each (orbs give more later), so bombs, arrows, the boomerang and seeds always get used.
function newBattle(): GameState {
  const game = createBattle(0, spawns, RULES, props, 99);
  (["bomb", "bow", "boomerang", "slingshot"] as const).forEach((item, i) => giveItem(game.battle!.fighters[i]!, item));
  return game;
}

function play(game: GameState, seed: BotSeed, from: number, to: number, log: number[], seen?: Set<string>): void {
  for (let t = from; t < to; t++) {
    stepGame(game, botInputs(game, seed), world);
    log.push(hashGame(game));
    if (!seen) continue;
    const b = game.battle!;
    for (const h of b.hits) seen.add(`hit:${h.cause ?? "sword"}`);
    for (const e of b.entities) seen.add(`entity:${e.kind}`);
    for (const f of b.fighters) {
      seen.add(`move:${f.move}`);
      if (f.item) seen.add(`item:${f.item}`);
      if (f.dark > 0) seen.add("dark");
    }
    if (b.timeUp > 0) seen.add("timeUp");
  }
}

describe("a long Shadow Battle with items and hazards", () => {
  it("is deterministic and survives a JSON snapshot mid-way", () => {
    const run = (seen?: Set<string>, bot = BOT) => {
      const game = newBattle();
      const seed = { s: bot }, log: number[] = [];
      play(game, seed, 0, TICKS, log, seen);
      return { log, final: JSON.stringify(game) };
    };
    const seen = new Set<string>();
    const a = run(seen);
    const again = run();
    expect(again.log).toEqual(a.log);
    expect(again.final).toBe(a.final);

    // Rollback-style: snapshot through JSON at FORK, carry on from the copy, and land on the same states.
    const game = newBattle();
    const seed = { s: BOT }, log: number[] = [];
    play(game, seed, 0, FORK, log);
    const copy = JSON.parse(JSON.stringify(cloneGame(game))) as GameState;
    expect(hashGame(copy)).toBe(hashGame(game));
    play(copy, seed, FORK, TICKS, log);
    expect(log).toEqual(a.log);
    expect(JSON.stringify(copy)).toBe(a.final);

    // The script actually exercises the new rules.
    const final = JSON.parse(a.final) as GameState;
    console.log(`long battle: ${[...seen].sort().join(" ")}`);
    expect(final.battle!.round).toBeGreaterThan(2);
    for (const what of [
      "move:lift",
      "move:carry",
      "move:throw",
      "move:held",
      "move:thrown",
      "move:roll",
      "move:take",
      "entity:orb",
      "entity:pickup",
      "entity:explosion",
      "entity:firebar",
      "hit:sword",
      "hit:clash",
      "hit:seed",
      "hit:boomerang",
      "hit:flame",
      "hit:firebar",
    ]) {
      expect(seen, what).toContain(what);
    }
    expect([...seen].filter((s) => s.startsWith("item:")).length).toBeGreaterThan(2);
  }, 30_000); // ~3 s alone; much more when the whole suite runs in parallel on a busy machine
});
