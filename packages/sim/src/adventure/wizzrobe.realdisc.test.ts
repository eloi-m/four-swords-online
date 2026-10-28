// The Wizzrobe and the Stalfos it raises on the real stages (skips without extracted/): main.dol's readings (wizzrobe.ts).
import { existsSync, readFileSync } from "node:fs";
import { decompressYaz0, Dol, loadActorTypes, parseRarc, readTileTypes, Stage } from "@fso/formats";
import { describe, expect, it } from "vitest";
import { SUBPX } from "../player.ts";
import { createAdventure, stepAdventure, type AdventureGame } from "./adventure.ts";
import { hurtEnemy } from "./enemies.ts";
import { actorStats, AdventureStage } from "./stage.ts";
import { isCaster, WIZZROBE, WIZZROBE_BOLTS } from "./wizzrobe.ts";

const root = new URL("../../../../extracted/", import.meta.url);
const load = (path: string) => parseRarc(decompressYaz0(readFileSync(new URL(`files/GC4Sword_usa/${path}`, root))));

describe.skipIf(!existsSync(root))("the adventure's Wizzrobes", () => {
  if (!existsSync(root)) return void it.skip("needs extracted/", () => {});
  const tileTypes = readTileTypes(new Dol(readFileSync(new URL("sys/main.dol", root))));
  const stats = actorStats(loadActorTypes(load("data.arc"))!);
  const stageOf = (id: string) => new AdventureStage(new Stage(load(`Boss/${id}.arc`)), tileTypes, stats);
  const step = (game: AdventureGame, stage: AdventureStage, n = 1) => {
    for (let i = 0; i < n; i++) stepAdventure(game, [0], stage);
  };

  it("a Wizzrobe appears 64-128 px from the Link, casts a bolt at 2.5 px/tick 43 ticks later, and vanishes; struck, it goes at once", () => {
    const stage = stageOf("boss053");
    const game = createAdventure(stage, { room: 13, x: 256, y: 200, hearts: 20 });
    const casters = game.adventure.enemies.filter(isCaster);
    expect(casters.map((e) => e.kind).sort()).toEqual([0, 0, 3, 5]);
    const w = casters.find((e) => e.kind === 0)!;
    let appeared = -1;
    for (let t = 0; t < 400 && appeared < 0; t++) {
      step(game, stage);
      if (w.state === "spit") appeared = game.tick;
    }
    expect(appeared).toBeGreaterThan(0);
    const p = game.players[0]!;
    const d = Math.hypot(w.x - p.x, w.y - p.y) / SUBPX;
    expect(d).toBeGreaterThanOrEqual(WIZZROBE.spotMin - 1);
    expect(d).toBeLessThanOrEqual(WIZZROBE.spotMin + WIZZROBE.spotSpread + 1);
    let bolt = undefined;
    for (let t = 0; t < 60 && !bolt; t++) {
      step(game, stage);
      bolt = game.adventure.enemies.find((e) => e.type === "WIZR" && WIZZROBE_BOLTS.includes(e.kind) && e.leader === w.id);
    }
    expect(bolt).toBeDefined();
    expect(game.tick - appeared).toBe(WIZZROBE.standTicks + 3);
    expect(Math.abs(bolt!.vx) + Math.abs(bolt!.vy)).toBe(WIZZROBE.boltSpeed);
    // Struck while it stands: hurt, then it vanishes once its knockback is over.
    const life = w.life;
    hurtEnemy(w, 4, w.x - 8 * SUBPX, w.y, game);
    expect(w.life).toBe(life - 4);
    for (let t = 0; t < 40 && w.state === "knock"; t++) step(game, stage);
    expect(w.state === "rest" || w.state === "hide").toBe(true);
  });

  it("a kind 1 Wizzrobe raises four Stalfos round the Link; they collapse when struck out of hit points, not dying", () => {
    const stage = stageOf("boss023");
    const game = createAdventure(stage, { room: 4, x: 256, y: 250, hearts: 99 });
    const w = game.adventure.enemies.find((e) => isCaster(e) && e.kind === 1)!;
    expect(w).toBeDefined();
    let raised: ReturnType<typeof game.adventure.enemies.filter> = [];
    for (let t = 0; t < 900 && raised.length < 4; t++) {
      step(game, stage);
      game.battle.fighters[0]!.hearts = 99 * 4;
      raised = game.adventure.enemies.filter((e) => e.type === "STAL" && e.kind === 5);
    }
    expect(raised.length).toBe(4);
    step(game, stage, 60);
    const s = raised.find((e) => e.state !== "hide" && e.z === 0)!;
    expect(s).toBeDefined();
    hurtEnemy(s, 4, s.x - 8 * SUBPX, s.y, game);
    for (let t = 0; t < 40 && s.state === "knock"; t++) step(game, stage);
    step(game, stage, 2);
    expect(s.state).toBe("hide");
    expect(s.life).toBeGreaterThan(0);
  });
});
