// Phantom Ganon (phantomganon.ts) against the Dolphin trace of Hyrule Castle's room 11 (docs/measurements/adventure-world1.md
// "Phantom Ganon"): his place, his body under the sword while he's down and the hurt frames between blows, the ball's
// return speeds, his catch box, its burst and shards, the Force Gems (GOLD) of his falls and his end. The GOLD's gem
// rule runs without the game files; the rest skips without extracted/.
import { existsSync, readFileSync } from "node:fs";
import { decompressYaz0, Dol, loadActorTypes, parseRarc, readTileTypes, Stage } from "@fso/formats";
import { describe, expect, it } from "vitest";
import { attackMeets, swordAttack } from "../attacks.ts";
import { SUBPX } from "../player.ts";
import { areaWorld, createAdventure, type AdventureGame } from "./adventure.ts";
import { GANON, ganonBox, stepGanon, type Ganon } from "./phantomganon.ts";
import { GEM_GRAVITY, GEM_VALUES, burstGems, goldGems, stepPickups } from "./pickups.ts";
import { actorStats, AdventureStage } from "./stage.ts";

describe("GOLD's Force Gems", () => {
  it("makes the traced mix for 99: the picks taken off what's left, a green one each once below 20", () => {
    // Traced (his first fall): 5, 5, 5, 50, 20, then fourteen 1s.
    const picks = [1, 1, 1, 3, 2];
    const gems = goldGems(99, () => picks.shift() ?? 0);
    expect(gems).toEqual([1, 1, 1, 3, 2, ...Array<number>(14).fill(0)]);
  });

  it("always adds up to its worth, never a gem worth more than what's left", () => {
    let seed = 7;
    const rand = (n: number) => ((seed = (seed * 1103515245 + 12345) >>> 0) >>> 8) % n;
    for (const worth of [80, 99, 278, 1, 19, 20]) {
      const gems = goldGems(worth, rand);
      expect(gems.reduce((s, k) => s + GEM_VALUES[k]!, 0)).toBe(worth);
    }
  });
});

const root = new URL("../../../../extracted/", import.meta.url);
const load = (path: string) => parseRarc(decompressYaz0(readFileSync(new URL(`files/GC4Sword_usa/${path}`, root))));

describe.skipIf(!existsSync(root))("Phantom Ganon, as traced", () => {
  const tileTypes = readTileTypes(new Dol(readFileSync(new URL("sys/main.dol", root))));
  const stage = new AdventureStage(new Stage(load("Boss/boss013.arc")), tileTypes, actorStats(loadActorTypes(load("data.arc"))!));
  const room11 = () => createAdventure(stage, { room: 11, x: 256, y: 330, facing: "up", players: 1 });
  const ganon = (game: AdventureGame): Ganon => game.adventure.ganon!;
  const step = (game: AdventureGame) => stepGanon(game, areaWorld(game, stage));
  /** Him down on the ground, open to the sword, `dx`, `dy` px from the leader. */
  const down = (game: AdventureGame, dx: number, dy: number) => {
    const g = ganon(game), p = game.players[0]!;
    Object.assign(g, { state: 20, z: 0, zTarget: 0, c250: 100, c254: 1, frame: 4, frameTicks: 4, x: p.x + dx * SUBPX, y: p.y + dy * SUBPX });
  };
  const swing = (game: AdventureGame, tick = 2) => Object.assign(game.players[0]!, { action: "swing", actionTick: tick, facing: "up" });

  it("starts where he's placed, (256, 192), his home 16 px below", () => {
    const g = ganon(room11());
    expect([g.x / SUBPX, g.y / SUBPX, g.homeX / SUBPX, g.homeY / SUBPX]).toEqual([256, 192, 256, 208]);
  });

  it("down, his body is x ± 16, y − 8 … y + 40 on the ground: met by a sword swung up from 64 px below him to 8 px above, 20 px aside, not 28", () => {
    const hits: [number, number][] = [[0, -24], [0, -56], [0, -44], [0, -64], [0, 8], [20, -24], [-20, -24]];
    const misses: [number, number][] = [[0, 20], [0, 36], [0, 28], [28, -24]];
    for (const [dx, dy] of [...hits, ...misses]) {
      const game = room11();
      down(game, dx, dy);
      swing(game);
      expect(attackMeets(swordAttack(game.players[0]!)!, ganonBox(ganon(game))), `${dx}, ${dy}`).toBe(hits.some(([x, y]) => x === dx && y === dy));
    }
  });

  it("each blow takes 4 and closes him till his hurt frames played again (the next blow ~20 ticks on)", () => {
    const game = room11();
    down(game, 0, -24);
    const blows: number[] = [];
    for (let t = 0; t < 120; t++) {
      // A swing every 6 ticks: only the window decides.
      swing(game, (t % 6) + 1);
      const hp = ganon(game).hp;
      step(game);
      if (ganon(game).hp < hp) blows.push(t), expect(hp - ganon(game).hp).toBe(4);
      game.players[0]!.action = "none";
      step(game);
    }
    const gaps = blows.slice(1).map((t, i) => t - blows[i]!);
    // (Two ticks a loop: the traced gaps were 15 to 21 frames.)
    for (const gap of gaps) expect(gap * 2).toBeGreaterThanOrEqual(15), expect(gap * 2).toBeLessThanOrEqual(24);
  });

  it("the ball: a Link's return keeps its speed, his bats go 3, 3.26, 3.78 px/tick", () => {
    const game = room11();
    const g = ganon(game);
    Object.assign(g, { state: 13, x: 256 * SUBPX, y: 148 * SUBPX, z: 40 * SUBPX });
    const speeds: number[] = [];
    for (let k = 0; k < 3; k++) {
      // His bat, then the ball put in front of the leader and sent back.
      Object.assign(g, { t238: 0 });
      if (k === 0) step(game);
      Object.assign(g, { state: 14, t238: 0 });
      step(game);
      const ball = g.ball!;
      speeds.push(Math.round((Math.hypot(ball.vx, ball.vy) / SUBPX) * 100) / 100);
      const p = game.players[0]!;
      Object.assign(ball, { x: p.x, y: p.y - 30 * SUBPX, vx: 0, vy: -ball.speed });
      swing(game);
      step(game);
      game.players[0]!.action = "none";
      expect(ball.back).toBe(true);
      expect(Math.round(Math.hypot(ball.vx, ball.vy) / SUBPX * 100) / 100).toBeCloseTo(speeds[k]!, 1);
      g.state = 17;
    }
    expect(speeds).toEqual([3, 3.26, 3.78]);
  });

  it("catches it from below 14.5 px aside and 6.7 px under his place, not 9.9 px under", () => {
    for (const [dx, dy, caught] of [[-14.5, 6.7, true], [-6, 5.2, true], [-15.4, 9.9, false], [-6.4, 8.2, false]] as const) {
      const game = room11();
      const g = ganon(game);
      Object.assign(g, { state: 17, x: 258 * SUBPX, y: 144 * SUBPX, z: 43 * SUBPX, rally: 1 });
      g.ball = { x: g.x + dx * SUBPX, y: g.y + dy * SUBPX, vx: 0, vy: -3 * SUBPX, speed: 3 * SUBPX, hits: 1, back: true, fly: 0, safe: 50, flown: 51 };
      step(game);
      expect(g.state === 14, `${dx}, ${dy}`).toBe(caught);
    }
  });

  it("left alone, 16 px past the screen's edge it bursts: seven shards 22.5° apart at the leader, 5 px/tick, through walls, 78 ticks", () => {
    const game = room11();
    const g = ganon(game);
    Object.assign(g, { state: 17, x: 258 * SUBPX, y: 144 * SUBPX, z: 43 * SUBPX });
    const p = game.players[0]!;
    Object.assign(p, { x: 266 * SUBPX, y: 361 * SUBPX });
    g.ball = { x: 244 * SUBPX, y: 394 * SUBPX, vx: 0, vy: 3 * SUBPX, speed: 3 * SUBPX, hits: 0, back: false, fly: 0, safe: 0, flown: 51 };
    step(game);
    expect(g.ball?.y).toBe(397 * SUBPX);
    step(game);
    expect(g.ball).toBeNull();
    expect(g.shards).toHaveLength(7);
    const angles = g.shards.map((s) => (Math.atan2(s.vy, s.vx) * 180) / Math.PI);
    for (let k = 1; k < 7; k++) expect(angles[k]! - angles[k - 1]!).toBeCloseTo(-22.5, 0);
    expect(angles[3]!).toBeCloseTo((Math.atan2(361 - 400, 266 - 244) * 180) / Math.PI, 0);
    for (const s of g.shards) expect(Math.hypot(s.vx, s.vy) / SUBPX).toBeCloseTo(5, 1);
    // Out of the leader's way: they fly their 78 ticks, walls or not.
    p.x = 40 * SUBPX;
    let ticks = 1;
    while (g.shards.length && ticks < 200) step(game), ticks++;
    expect(ticks - 1).toBe(GANON.shardTicks);
  });

  it("his first two falls fling Force Gems worth 99 out of him, the third none; beaten, he dies 300 ticks at z 40, then 80 more", () => {
    const game = room11();
    const g = ganon(game);
    const worth = () => game.adventure.pickups.filter((p) => p.type === "gem").reduce((s, p) => s + GEM_VALUES[p.kind]!, 0);
    for (const total of [99, 198, 198]) {
      Object.assign(g, { state: 18, z: 40 * SUBPX });
      step(game);
      expect(worth()).toBe(total);
    }
    // Flung from his place at his height, up 2-4 px a tick, ±1 px a tick across.
    const gem = game.adventure.pickups[0]!;
    expect([gem.x, gem.y]).toEqual([g.x, g.y]);
    expect(Math.abs(gem.z - 40 * SUBPX)).toBeLessThanOrEqual(2 * SUBPX);
    expect(gem.vz - GEM_GRAVITY).toBeGreaterThanOrEqual(2 * SUBPX);
    expect(gem.vz - GEM_GRAVITY).toBeLessThan(4 * SUBPX);
    expect(Math.abs(gem.vx!)).toBeLessThanOrEqual(SUBPX);
    game.adventure.pickups = [];
    Object.assign(g, { state: 22, hp: 0 });
    let t = 0;
    while (!g.gone && t < 1000) step(game), t++;
    expect(g.lock).toBe(false);
    expect(Math.abs(g.z - 40 * SUBPX)).toBeLessThanOrEqual(SUBPX);
    expect(t).toBeGreaterThan(GANON.dying);
    expect(t).toBeLessThan(GANON.dying + 20);
    expect(worth()).toBe(80);
  });

  it("a flung gem flies on and lands where it falls, as traced (from z 43.2 up 2.11 px/tick, down 27 ticks on)", () => {
    const game = room11();
    game.adventure.pickups = [];
    burstGems(game, 258 * SUBPX, 144 * SUBPX, Math.round(43.21 * SUBPX), 1);
    const gem = game.adventure.pickups[0]!;
    Object.assign(gem, { vz: Math.round(2.113 * SUBPX) + GEM_GRAVITY, vx: Math.round(0.499 * SUBPX), vy: 0 });
    // (Out of the Links' reach.)
    game.players.forEach((p) => (p.y = 340 * SUBPX));
    let t = 0;
    while (gem.z > 0 && t < 100) stepPickups(game), t++;
    expect(t).toBe(27);
    expect(gem.x / SUBPX).toBeCloseTo(258 + 0.5 * 27, 0);
    stepPickups(game);
    expect(gem.vx).toBe(0);
  });
});
