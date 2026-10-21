// Free play (battle.ts rules.free): no rounds and no lost hearts, though every hit and fall plays out; 1-8 Links; and
// the spot search (freeplay.ts openSpots) on small ASCII worlds. The real map: freeplay.realdisc.test.ts.
import { describe, expect, it } from "vitest";
import { createBattle, DEFAULT_RULES, MAX_LINKS, type BattleRules, type Spawn } from "./battle.ts";
import { FALL_TICKS, HEART, hurtFighter, INVINCIBLE_TICKS, KNOCKBACK_TICKS } from "./combat.ts";
import { createFreePlay, FREE_SPACING, islandAt, openSpots, standsAt } from "./freeplay.ts";
import { cloneGame, stepGame } from "./game.ts";
import { hashGame } from "./hash.ts";
import { Button, HITBOX, SUBPX } from "./player.ts";
import { arena, px, run, until } from "./testarena.ts";
import { isSolidAt, surfaceAt } from "./world.ts";

const FREE: BattleRules = { ...DEFAULT_RULES, free: true };
const FULL = FREE.hearts * HEART;
const row = (n: number): Spawn[] => Array.from({ length: n }, (_, i) => ({ x: 40 + (i % 4) * 60, y: 60 + Math.floor(i / 4) * 80, facing: "down" }));

describe("Free play", () => {
  it("takes 1 to 8 Links (a battle 2 to 8), and starts in the free phase at once", () => {
    for (const n of [1, 2, MAX_LINKS]) expect(createBattle(0, row(n), FREE).battle!.phase).toBe("free");
    expect(() => createBattle(0, row(MAX_LINKS + 1), FREE)).toThrow(/1-8/);
    expect(() => createBattle(0, [], FREE)).toThrow(/1-8/);
    expect(() => createBattle(0, row(1))).toThrow(/2-8/);
    expect(createBattle(0, row(MAX_LINKS)).battle!.phase).toBe("countdown");
    expect(() => createBattle(0, row(MAX_LINKS + 1))).toThrow(/2-8/);
  });

  it("a sword hit knocks the victim back with his invincibility, and his hearts are full again the same tick", () => {
    const world = arena();
    const game = createBattle(0, [{ x: 100, y: 100, facing: "right" }, { x: 120, y: 100, facing: "right" }], FREE);
    const fv = game.battle!.fighters[1]!;
    stepGame(game, [Button.Sword, 0], world);
    const hits: number[] = [];
    until(game, world, () => {
      hits.push(...game.battle!.hits.map((h) => h.damage));
      expect(game.battle!.fighters.map((f) => f.hearts)).toEqual([FULL, FULL]);
      return fv.mode === "hurt";
    });
    expect(hits.length).toBe(1);
    expect(hits[0]).toBeGreaterThan(0);
    expect(fv.invincible).toBe(INVINCIBLE_TICKS);
    const x0 = game.players[1]!.x;
    until(game, world, () => fv.mode === "active", KNOCKBACK_TICKS + 1);
    expect(game.players[1]!.x).toBeGreaterThan(x0);
    expect(fv.hearts).toBe(FULL);
  });

  it("a Link who walks into a pit falls, hops back out onto the edge and keeps his hearts", () => {
    const world = arena([20, 1, 6, 28, "O"]); // pit at px 160-207
    const game = createBattle(0, [{ x: 140, y: 100, facing: "right" }], FREE);
    const p = game.players[0]!, f = game.battle!.fighters[0]!;
    until(game, world, () => f.mode === "falling", 100, [Button.Right]);
    let lowest = f.hearts;
    until(game, world, () => ((lowest = Math.min(lowest, f.hearts)), f.mode === "active"), FALL_TICKS + 1);
    expect([px(p.x), lowest, f.hearts]).toEqual([152, FULL, FULL]); // (7 px past the floor's last pixel, 159)
  });

  it("a hit that takes the last heart leaves the Link on his feet; a retired Link stays out", () => {
    const world = arena();
    const game = createBattle(0, [{ x: 60, y: 100, facing: "right" }, { x: 120, y: 100, facing: "left" }, { x: 200, y: 100, facing: "left" }], FREE);
    const [f0, f1] = game.battle!.fighters;
    expect(hurtFighter(game.players[0]!, f0!, 0, FULL, 0, 100 * 256)).not.toBeNull();
    expect([f0!.hearts, f0!.mode]).toEqual([0, "hurt"]);
    Object.assign(f1!, { hearts: 0, mode: "dead", modeTick: 0 }); // as apps/battle's online-game.ts retire() leaves him
    stepGame(game, [], world);
    expect(f0!.hearts).toBe(FULL);
    until(game, world, () => f0!.mode === "active", KNOCKBACK_TICKS * 2);
    run(game, world, 60);
    expect([f0!.mode, f0!.hearts, f1!.mode, f1!.hearts]).toEqual(["active", FULL, "dead", 0]);
  });

  it("never ends: no rounds, no time limit, no Vaati, even alone or with a time limit in the rules", () => {
    const world = arena();
    for (const game of [createBattle(0, row(1), FREE), createBattle(0, row(3), { ...FREE, timeLimit: 120 })]) {
      for (let t = 0; t < 3000; t++) stepGame(game, game.players.map((_, i) => ((t >> 5) + i) % 3 === 0 ? Button.Sword : [Button.Right, Button.Left, Button.Down][(t >> 6) % 3]!), world);
      const b = game.battle!;
      expect([b.phase, b.phaseTick, b.round, b.roundWinner, b.matchWinner, b.timeUp]).toEqual(["free", 3000, 1, -1, -1, 0]);
      expect(b.fighters.every((f) => f.hearts === FULL && f.stars === 0)).toBe(true);
    }
  });

  it("createFreePlay keeps the Links given a spot where they stand (unless it's in a wall), the others apart from them", () => {
    const world = arena([20, 10, 4, 4, "#"]); // a block at px 160-191 × 80-111
    const kept = [{ x: 100, y: 100, facing: "left" as const }, null, { x: 170, y: 90, facing: "up" as const }];
    const game = createFreePlay(world, 4, 5, kept);
    const at = game.players.map((p) => ({ x: p.x / SUBPX, y: p.y / SUBPX, facing: p.facing }));
    expect(at[0]).toEqual(kept[0]);
    expect(at[2]).not.toEqual(kept[2]);
    for (const [i, p] of at.entries()) {
      expect(standsAt(world, p.x, p.y), `P${i + 1}`).toBe(true);
      for (const q of at.slice(i + 1)) expect(Math.abs(p.x - q.x) + Math.abs(p.y - q.y)).toBeGreaterThanOrEqual(FREE_SPACING);
    }
    expect(game.battle!.phase).toBe("free");
    expect(hashGame(createFreePlay(world, 4, 5, kept))).toBe(hashGame(game));
    expect(hashGame(createFreePlay(world, 4, 5))).not.toBe(hashGame(game));
  });

  it("cloneGame and hashGame cover it: a clone plays the same, and the free flag changes the hash", () => {
    const world = arena();
    const game = createBattle(0, row(MAX_LINKS), FREE, undefined, 9);
    expect(hashGame(game)).not.toBe(hashGame(createBattle(0, row(MAX_LINKS), DEFAULT_RULES, undefined, 9)));
    const inputs = (t: number) => game.players.map((_, i) => ((t + i * 7) % 40 < 3 ? Button.Sword : [Button.Right, Button.Up, Button.Left, Button.Down][(t >> 5) % 4]!));
    run(game, world, 1);
    const copy = cloneGame(game);
    copy.battle!.rules.free = false;
    expect(game.battle!.rules.free).toBe(true);
    copy.battle!.rules.free = true;
    let hits = 0;
    for (let t = 0; t < 600; t++) {
      stepGame(game, inputs(t), world);
      stepGame(copy, inputs(t), world);
      hits += game.battle!.hits.filter((h) => h.damage > 0).length;
    }
    expect(hits).toBeGreaterThan(0);
    expect(hashGame(copy)).toBe(hashGame(game));
    expect(game.battle!.fighters.every((f) => f.hearts === FULL)).toBe(true);
  });
});

describe("openSpots", () => {
  const stands = (world: ReturnType<typeof arena>, s: { x: number; y: number }) =>
    [HITBOX.left, HITBOX.right].every((dx) => [HITBOX.top, HITBOX.bottom].every((dy) => !isSolidAt(world, s.x + dx, s.y + dy))) && surfaceAt(world, s.x, s.y) !== "pit";

  it("finds distinct spots to stand on around the center, off walls and pits, the same every time", () => {
    const world = arena([10, 10, 4, 4, "#"], [18, 10, 4, 4, "O"]);
    const spots = openSpots(world, { x: 130, y: 100 }, 8);
    expect(spots).toEqual(openSpots(world, { x: 130, y: 100 }, 8));
    expect(spots.length).toBe(8);
    for (const [i, s] of spots.entries()) {
      expect(stands(world, s), JSON.stringify(s)).toBe(true);
      for (const t of spots.slice(i + 1)) expect(Math.abs(s.x - t.x) + Math.abs(s.y - t.y)).toBeGreaterThanOrEqual(32);
      expect(Number.isInteger(s.x) && Number.isInteger(s.y)).toBe(true);
    }
  });

  it("keeps to the center's island: a wall across the arena leaves the far side out", () => {
    const world = arena([20, 1, 2, 28, "#"]); // a wall at px 160-175, top to bottom
    const spots = openSpots(world, { x: 150, y: 120 }, 12);
    expect(spots.every((s) => s.x < 160)).toBe(true);
    const island = islandAt(world, 150, 120);
    expect(spots.every((s) => island[Math.floor(s.y / 8) * world.widthCells + Math.floor(s.x / 8)] === 1)).toBe(true);
    expect(islandAt(world, 200, 120)[Math.floor(120 / 8) * world.widthCells + Math.floor(150 / 8)]).toBe(0);
  });

  it("short of room, the rest are the center", () => {
    const world = arena([1, 1, 38, 28, "#"], [4, 4, 3, 3, "."]);
    const spots = openSpots(world, { x: 44, y: 44 }, 3);
    expect(spots.length).toBe(3);
    expect(spots.slice(1)).toEqual([{ x: 44, y: 44 }, { x: 44, y: 44 }]);
  });
});
