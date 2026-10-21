// The minor Shadow Link who jumps (minorshadow.ts ZSLJ) in Lake Hylia's room 3, the house's doorway, the Links put by
// him as in the Dolphin traces (docs/measurements/adventure-lake-hylia.md "The minor Shadow Link who jumps"; skips
// without extracted/).
import { existsSync, readFileSync } from "node:fs";
import { decompressYaz0, Dol, loadActorTypes, parseRarc, readTileTypes, Stage } from "@fso/formats";
import { describe, expect, it } from "vitest";
import { SUBPX } from "../player.ts";
import { actorKey, createAdventure, stepAdventure, type AdventureGame } from "./adventure.ts";
import { gatherOnLeader } from "./formation.ts";
import { JUMPING_SHADOW_STATE as S, minorShadowEffects, minorShadowFrame, minorShadowState } from "./minorshadow.ts";
import { actorStats, AdventureStage } from "./stage.ts";

const root = new URL("../../../../extracted/", import.meta.url);
const load = (path: string) => parseRarc(decompressYaz0(readFileSync(new URL(`files/GC4Sword_usa/${path}`, root))));

describe.skipIf(!existsSync(root))("Lake Hylia's jumping minor Shadow Link (room 3)", () => {
  const tileTypes = readTileTypes(new Dol(readFileSync(new URL("sys/main.dol", root))));
  const stats = actorStats(loadActorTypes(load("data.arc"))!);
  const stage = new AdventureStage(new Stage(load("Boss/boss010.arc")), tileTypes, stats);
  const zslj = (g: AdventureGame) => g.adventure.enemies.find((e) => e.type === "ZSLJ");
  const px = (v: number) => v / SUBPX;
  /** The four Links put at (x, y) (as actor-trace.ts --tele does), standing. */
  const put = (game: AdventureGame, x: number, y: number) => {
    for (const p of game.players) Object.assign(p, { x: x * SUBPX, y: y * SUBPX });
    gatherOnLeader(game);
  };
  /** Room 3 with the Links at (x, y), its Octoroks taken out (their rocks would knock the Links about). */
  const room3 = (x: number, y: number, players = 4) => {
    const game = createAdventure(stage, { room: 3, x, y, facing: "up", players });
    game.adventure.enemies = game.adventure.enemies.filter((e) => e.type === "ZSLJ");
    return game;
  };
  /** Steps until his state changes; the ticks it took. */
  const until = (game: AdventureGame, state: number, limit = 600) => {
    const start = game.tick;
    while (zslj(game) && minorShadowState(zslj(game)!) !== state && game.tick - start < limit) stepAdventure(game, [0], stage);
    return game.tick - start;
  };

  it("stands in the doorway at (400, 120), hopping in place facing down, with the Links away", () => {
    const game = room3(280, 340);
    const heights: number[] = [];
    for (let t = 0; t < 600; t++) {
      stepAdventure(game, [0], stage);
      heights.push(zslj(game)!.z);
    }
    const e = zslj(game)!;
    expect([px(e.x), px(e.y)]).toEqual([400, 120]);
    expect(minorShadowState(e)).toBe(S.hop);
    expect(minorShadowFrame(e)).toBe(62);
    // Hops of 24 ticks up to 14.4 px (traced: 0, 2.3, 4.4 … 14.4 … 2.3, 0).
    const top = Math.max(...heights);
    expect(px(top)).toBeCloseTo(14.4, 1);
    const grounded = heights.flatMap((z, t) => (z === 0 ? [t] : []));
    expect(grounded.slice(-3).map((t, i, a) => (i ? t - a[i - 1]! : 24))).toEqual([24, 24, 24]);
  });

  it("jumps 125.16 px aside when a Link comes within 48 px, three times, then spins in smoke and goes left unseen", () => {
    const game = room3(280, 340);
    for (let t = 0; t < 10; t++) stepAdventure(game, [0], stage);
    // As traced: the Links put 40 px below him; he's off on his next landing.
    put(game, 400, 160);
    expect(until(game, S.jump)).toBeLessThanOrEqual(24);
    const peak: number[] = [];
    expect(until(game, S.land)).toBe(44);
    expect(px(zslj(game)!.x)).toBeCloseTo(274.84, 1);
    expect(until(game, S.hop)).toBe(12);
    // Hopping where he landed while nobody's near; the Links come by him there, and he jumps back.
    for (let t = 0; t < 100; t++) stepAdventure(game, [0], stage);
    expect(minorShadowState(zslj(game)!)).toBe(S.hop);
    put(game, 275, 160);
    until(game, S.jump);
    while (minorShadowState(zslj(game)!) === S.jump) {
      stepAdventure(game, [0], stage);
      peak.push(zslj(game)!.z);
    }
    expect(px(Math.max(...peak))).toBeCloseTo(48.4, 1);
    expect(px(zslj(game)!.x)).toBeCloseTo(400, 1);
    // The third, and he's done: the spin (115 ticks, smoke on its 70th), then away, unseen, 48 px past the left edge.
    until(game, S.hop);
    put(game, 400, 160);
    until(game, S.land);
    expect(px(zslj(game)!.x)).toBeCloseTo(274.84, 1);
    expect(until(game, S.spin)).toBe(12);
    const spinAt = game.tick, frames = new Set<number>();
    let smokeAt = -1;
    while (minorShadowState(zslj(game)!) === S.spin) {
      stepAdventure(game, [0], stage);
      const e = zslj(game)!;
      if (minorShadowState(e) === S.spin) frames.add(minorShadowFrame(e));
      if (smokeAt < 0 && minorShadowEffects(game, e).some((f) => f.id === 1046)) smokeAt = game.tick - spinAt;
    }
    expect(game.tick - spinAt).toBe(115);
    expect(smokeAt).toBe(70);
    expect([...frames].sort()).toEqual([60, 61, 62, 63]);
    expect(minorShadowFrame(zslj(game)!)).toBe(-1);
    while (zslj(game)) stepAdventure(game, [0], stage);
    // Gone 488 ticks after the spin began (traced: frames 242 to 730), for good.
    expect(game.tick - spinAt).toBe(488);
    expect(game.adventure.taken).toContain(actorKey(3, stage.area(3, 0).actors.find((a) => a.id === "ZSLJ")!.index));
  });

  it("the Link who brings the key sets him off before he reaches the door", () => {
    const game = room3(396, 178, 1);
    // A Link walking up at 1.5 px a tick from 48 px off: within 24 ticks he's in the air, the door 34 px further up.
    let off = -1;
    for (let t = 0; t < 40 && off < 0; t++) {
      game.players[0]!.y -= 384;
      stepAdventure(game, [0], stage);
      if (minorShadowState(zslj(game)!) === S.jump) off = px(game.players[0]!.y);
    }
    expect(off).toBeGreaterThan(123);
  });
});
