// The adventure's enemies on the real stages (skips without extracted/): the Keese wakes, flies and lands, the sword
// soldiers chase, a switch-gated swarm stays away until its switch, and the sword kills each in its number of hits.
import { existsSync, readFileSync } from "node:fs";
import { decompressYaz0, Dol, loadActorTypes, parseRarc, readTileTypes, Stage } from "@fso/formats";
import { describe, expect, it } from "vitest";
import { Button, SUBPX } from "../player.ts";
import { createAdventure, stepAdventure, type AdventureGame } from "./adventure.ts";
import { enemyShown, KEESE, type Enemy } from "./enemies.ts";
import { actorStats, AdventureStage } from "./stage.ts";

const root = new URL("../../../../extracted/", import.meta.url);
const load = (path: string) => parseRarc(decompressYaz0(readFileSync(new URL(`files/GC4Sword_usa/${path}`, root))));

describe.skipIf(!existsSync(root))("the adventure's enemies", () => {
  if (!existsSync(root)) return void it.skip("needs extracted/", () => {});
  const tileTypes = readTileTypes(new Dol(readFileSync(new URL("sys/main.dol", root))));
  const stats = actorStats(loadActorTypes(load("data.arc"))!);
  const stageOf = (id: string) => new AdventureStage(new Stage(load(`Boss/${id}.arc`)), tileTypes, stats);

  const step = (game: AdventureGame, stage: AdventureStage, n = 1, buttons = 0) => {
    for (let i = 0; i < n; i++) stepAdventure(game, [buttons], stage);
  };
  const px = (v: number) => v / SUBPX;
  const distance = (e: Enemy, game: AdventureGame) => Math.hypot(px(e.x - game.players[0]!.x), px(e.y - game.players[0]!.y));

  /** Stabs `e` from 14 px to its left until it's out of life; the number of stabs that landed (4 off its life each). */
  function kill(game: AdventureGame, stage: AdventureStage, e: Enemy): number {
    let hits = 0;
    for (let tries = 0; e.life > 0 && tries < 20; tries++) {
      const p = game.players[0]!, f = game.battle.fighters[0]!;
      // Another enemy's touch may knock the Link about: wait for him (and for the enemy's knockback) to be done.
      while (e.invincible > 0 || e.state === "knock" || f.mode !== "active" || f.move !== "none") step(game, stage);
      Object.assign(p, { x: e.x - 14 * SUBPX, y: e.y, facing: "right", action: "none", actionTick: 0 });
      const life = e.life;
      step(game, stage, 1, Button.Sword);
      step(game, stage, 12);
      if (e.life < life) {
        expect(life - e.life).toBe(Math.min(life, 4));
        hits++;
      }
    }
    return hits;
  }

  it("the Keese rests until a Link comes within 60 px, flies, lands, and dies to one stab", () => {
    const stage = stageOf("boss023");
    // Eastern Temple's first room: three Keese at y 176.
    const game = createAdventure(stage, { room: 0, x: 96, y: 240, facing: "up" });
    const keese = game.adventure.enemies.filter((e) => e.type === "KETH");
    expect(keese.length).toBe(3);
    const k = keese[0]!;
    step(game, stage, 30);
    expect(k.state).toBe("rest");
    game.players[0]!.y = 220 * SUBPX; // 44 px below it
    step(game, stage);
    expect(k.state).toBe("fly");
    const flight = k.timer;
    expect(flight).toBeGreaterThanOrEqual(KEESE.flyMin - 1);
    // It takes off away from the Link, then curves back toward him.
    step(game, stage, 10);
    expect(px(k.y)).toBeLessThan(176);
    game.players[0]!.y = 340 * SUBPX; // out of its way
    step(game, stage, flight + 20);
    expect(k.state).toBe("rest");
    expect(kill(game, stage, k)).toBe(1);
    step(game, stage, 40);
    expect(game.adventure.enemies.includes(k)).toBe(false);
  });

  it("the sword soldiers look round, notice a Link ahead, wind up and chase; a kind 0 takes three stabs, a kind 2 one", () => {
    const stage = stageOf("boss010");
    // Lake Hylia room 9: kind 2 soldiers at y 224, kind 0 at y 256 (their captain taken away: on their own).
    const game = createAdventure(stage, { room: 9, x: 144, y: 420, facing: "up" });
    game.adventure.enemies = game.adventure.enemies.filter((e) => e.type !== "SLR4");
    const soldiers = game.adventure.enemies.filter((e) => e.type === "SLR1");
    expect(soldiers.map((e) => e.kind)).toEqual([2, 2, 2, 0, 0, 0]);
    expect(soldiers.map((e) => e.life)).toEqual([1, 1, 1, 12, 12, 12]);
    // Placed, they look round first (traced: room 9's six).
    step(game, stage);
    expect(soldiers.every((e) => e.state === "look")).toBe(true);
    // One walking down with the Link 84 px below it: "!", a 21-tick wind-up, a chase.
    game.players[0]!.y = 340 * SUBPX;
    const near = soldiers[4]!, before = distance(near, game);
    Object.assign(near, { state: "patrol", facing: "down", shot: 0, timer: 100, tvx: 0, tvy: 0 });
    step(game, stage);
    expect(near.state).toBe("notice");
    step(game, stage, 20);
    expect(near.state).toBe("stop");
    step(game, stage);
    expect(near.state).toBe("chase");
    // (Aimed at him give or take 90°: closer within a few aims.)
    let closest = before;
    for (let k = 0; k < 90; k++) step(game, stage), (closest = Math.min(closest, distance(near, game)));
    expect(closest).toBeLessThan(before - 20);
    expect(kill(game, stage, soldiers[3]!)).toBe(3);
    expect(kill(game, stage, soldiers.find((s) => s.kind === 2 && s.life > 0)!)).toBe(1);
  });

  it("a switch-gated swarm stays away until its switch is on", () => {
    const stage = stageOf("boss011");
    const game = createAdventure(stage, { room: 3, x: 64, y: 340 });
    const swarm = game.adventure.enemies.filter((e) => e.type === "KETH" && e.gate === 19);
    expect(swarm.length).toBe(50);
    step(game, stage, 10);
    expect(swarm.some((e) => enemyShown(game, e))).toBe(false);
    game.battle.switches |= 1 << 19;
    step(game, stage, 10);
    expect(swarm.every((e) => enemyShown(game, e))).toBe(true);
    // Kind 3 patrols back and forth while resting.
    expect(swarm.some((e) => e.x !== e.homeX || e.y !== e.homeY)).toBe(true);
  });
});
