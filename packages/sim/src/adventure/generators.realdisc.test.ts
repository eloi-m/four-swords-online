// Enemy generators, kill counters and drops on the real stages (skips without extracted/): Lake Hylia room 5's ambush
// against its Dolphin trace (docs/measurements/adventure-enemies.md "Adventure: generators, kills and drops"), a GEN3, what enemies and
// bushes leave.
import { existsSync, readFileSync } from "node:fs";
import { decompressYaz0, Dol, loadActorTypes, parseRarc, readTileTypes, Stage } from "@fso/formats";
import { describe, expect, it } from "vitest";
import { switchOn } from "../switches.ts";
import { SUBPX } from "../player.ts";
import { createAdventure, stepAdventure, type AdventureGame } from "./adventure.ts";
import { BUSH_DROP_HIGH, BUSH_DROP_LOW, DROP_CODES, DROP_TABLE, dropFor, dropFromBush, hurtEnemy } from "./enemies.ts";
import { SOLDIER } from "./soldiers.ts";
import { GENE_INTERVAL_ZERO } from "./generators.ts";
import { GEM_VALUES } from "./pickups.ts";
import { actorStats, AdventureStage } from "./stage.ts";

const root = new URL("../../../../extracted/", import.meta.url);
const load = (path: string) => parseRarc(decompressYaz0(readFileSync(new URL(`files/GC4Sword_usa/${path}`, root))));

/** Room 5's first soldier, room px, from its first tick (Dolphin `r5gene`: walking in at 1.4 px a tick, easing 0.3). */
const WALK_IN_X = [24.0, 24.42, 25.134, 26.054, 27.118, 28.282, 29.518, 30.802, 32.122, 33.465, 34.826, 36.198, 37.579, 38.965, 40.356, 41.749, 43.144, 44.541, 45.939, 47.337, 48.736];

describe.skipIf(!existsSync(root))("the adventure's generators", () => {
  const tileTypes = readTileTypes(new Dol(readFileSync(new URL("sys/main.dol", root))));
  const stats = actorStats(loadActorTypes(load("data.arc"))!);
  const stageOf = (id: string) => new AdventureStage(new Stage(load(`Boss/${id}.arc`)), tileTypes, stats);
  const step = (game: AdventureGame, stage: AdventureStage, n = 1) => {
    for (let i = 0; i < n; i++) stepAdventure(game, [0], stage);
  };
  const soldiers = (game: AdventureGame) => game.adventure.enemies.filter((e) => e.type === "SLR1");

  it("room 5's ambush: one sword soldier every 10 ticks from the tick after the bridge's switch, walking in (traced)", () => {
    const stage = stageOf("boss010");
    // The Link on the bridge's floor switch (2): its two generators wait for switches 2 and 1.
    const game = createAdventure(stage, { room: 5, x: 264, y: 304, players: 4 });
    expect(soldiers(game)).toHaveLength(0);
    step(game, stage);
    expect(switchOn(game.battle, 2)).toBe(true);
    expect(soldiers(game)).toHaveLength(0);
    // The next tick (as traced): the way west shut (switch 4: the bridge's switch and not yet switch 16, the kills'),
    // the first soldier.
    step(game, stage);
    expect(switchOn(game.battle, 4)).toBe(true);
    const first = soldiers(game)[0]!;
    expect(soldiers(game)).toHaveLength(1);
    expect([first.x / SUBPX, first.y / SUBPX, first.kind, first.life, first.state, first.facing]).toEqual([24, 74, 2, 1, "walk", "right"]);
    const xs = [first.x / SUBPX];
    for (let t = 1; t < WALK_IN_X.length; t++) {
      step(game, stage);
      xs.push(first.x / SUBPX);
      if (t % GENE_INTERVAL_ZERO === 0) expect(soldiers(game)).toHaveLength(1 + t / GENE_INTERVAL_ZERO);
    }
    // (Within 0.02 px: the sim's 1/256 px against the game's floats.)
    xs.forEach((x, t) => expect(Math.abs(x - WALK_IN_X[t]!)).toBeLessThan(0.02));
    step(game, stage, 200);
    // Sixteen in all; the walks in last 110-149 ticks, then they chase.
    expect(soldiers(game)).toHaveLength(16);
    expect(first.state).not.toBe("walk");
    expect(soldiers(game).every((e) => e.speed === Math.round(SOLDIER.baseSpeed * SUBPX))).toBe(true);
  });

  it("room 5's SKIL opens the way west on the 16th kill", () => {
    const stage = stageOf("boss010");
    const game = createAdventure(stage, { room: 5, x: 264, y: 304, players: 1, hearts: 20 });
    step(game, stage);
    let killed = 0;
    for (let t = 0; t < 400 && killed < 16; t++) {
      // Each soldier as it comes (they have 1 life): the sword's power on it, as a stab would.
      for (const e of soldiers(game)) if (e.life > 0 && killed < 16) hurtEnemy(e, 4, e.x - 8 * SUBPX, e.y), killed++;
      step(game, stage);
    }
    expect(killed).toBe(16);
    step(game, stage, 60);
    expect(game.adventure.kills).toBe(16);
    expect(switchOn(game.battle, 16)).toBe(true);
    expect(switchOn(game.battle, 4)).toBe(false);
  });

  it("the Link's kill streak: a red Force Gem falls onto him from 300 px 90 ticks after his 10th kill and his 15th (traced)", () => {
    const stage = stageOf("boss010");
    const game = createAdventure(stage, { room: 5, x: 264, y: 304, players: 1, hearts: 20 });
    const p = game.players[0]!;
    step(game, stage);
    const falling = () => game.adventure.pickups.filter((g) => g.type === "gem" && g.actor < 0 && g.z > 100 * SUBPX);
    const fell: { tick: number; kind: number; x: number; y: number }[] = [];
    let killed = 0;
    const killedAt: number[] = [];
    for (let t = 0; t < 900 && fell.length < 2; t++) {
      for (const e of soldiers(game)) {
        if (e.life <= 0 || killed >= 16 || t % 20) continue;
        e.hitBy = 0;
        hurtEnemy(e, 4, e.x - 8 * SUBPX, e.y);
        killed++;
        break;
      }
      const before = game.adventure.kills;
      step(game, stage);
      if (game.adventure.kills > before) killedAt.push(game.tick);
      for (const g of falling()) if (g.tick === 1) fell.push({ tick: game.tick, kind: g.kind, x: g.x, y: g.y });
    }
    expect(game.adventure.streak.kills[0]).toBeGreaterThanOrEqual(15);
    expect(fell.map((f) => f.kind)).toEqual([2, 2]);
    expect(fell.map((f) => f.tick)).toEqual([killedAt[9]! + 90, killedAt[14]! + 90]);
    expect([fell[0]!.x, fell[0]!.y]).toEqual([p.x, p.y]);
  });

  it("a GEN3 makes its enemy two ticks after its puff, the tick after its switch, once in mode 0", () => {
    const stage = stageOf("boss013");
    // Hyrule Castle room 3: two GEN3 kind 0x22 (sword soldiers) on switch 3, one each, mode 0.
    const game = createAdventure(stage, { room: 3, x: 256, y: 340 });
    const before = soldiers(game).length;
    step(game, stage, 5);
    expect(soldiers(game).length).toBe(before);
    game.battle.switches |= 1 << 3;
    step(game, stage, 3); // seen, puff…
    expect(soldiers(game).length).toBe(before);
    step(game, stage);
    expect(soldiers(game).length).toBe(before + 2);
    game.battle.switches &= ~(1 << 3);
    step(game, stage, 5);
    game.battle.switches |= 1 << 3;
    step(game, stage, 10);
    expect(soldiers(game).length).toBe(before + 2);
  });

  it("an enemy's drop by its class (enemyparam.csv dasu), a bush's 21 in 100", () => {
    const stage = stageOf("boss010");
    const game = createAdventure(stage, { room: 0, seed: 7 });
    const worth = () => game.adventure.pickups.filter((p) => p.actor < 0).reduce((n, p) => n + (p.type === "gem" ? GEM_VALUES[p.kind]! : 0), 0);
    const hearts = () => game.adventure.pickups.filter((p) => p.actor < 0 && p.type === "heart").length;
    const clear = () => (game.adventure.pickups = game.adventure.pickups.filter((p) => p.actor >= 0));
    // Class 0: nothing; class 9: always ten green gems; class 11: twenty green and twenty blue.
    dropFor(game, 0, 0, 0);
    expect(worth() + hearts()).toBe(0);
    dropFor(game, 9, 100 * SUBPX, 100 * SUBPX);
    expect(worth()).toBe(10);
    clear();
    dropFor(game, 11, 100 * SUBPX, 100 * SUBPX);
    expect(worth()).toBe(20 + 20 * 5);
    clear();
    // Class 4 (sword soldiers): half the time, and then red gems half the time.
    let drops = 0, reds = 0;
    for (let k = 0; k < 2000; k++) {
      const n = game.adventure.pickups.length;
      dropFor(game, 4, 0, 0);
      if (game.adventure.pickups.length > n) drops++;
      if (game.adventure.pickups.at(-1)?.kind === 2 && game.adventure.pickups.length > n) reds++;
    }
    expect(drops / 2000).toBeGreaterThan(0.45);
    expect(drops / 2000).toBeLessThan(0.55);
    expect(reds / drops).toBeGreaterThan(0.45);
    expect(reds / drops).toBeLessThan(0.55);
    expect(DROP_TABLE[4]!.filter((c) => DROP_CODES[c]!.gems[0]?.[1] === 2)).toHaveLength(4);
    clear();
    let bush = 0;
    for (let k = 0; k < 4000; k++) {
      const n = game.adventure.pickups.length;
      dropFromBush(game, 0, 0);
      if (game.adventure.pickups.length > n) bush++;
    }
    expect(bush / 4000).toBeCloseTo((BUSH_DROP_HIGH - BUSH_DROP_LOW + 1) / 100, 1);
  });
});
