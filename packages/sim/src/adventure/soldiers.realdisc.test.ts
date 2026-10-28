// The bow soldiers and the captains on the real stages (skips without extracted/): a bow soldier noticing a Link
// ahead and shooting, room 9's captain marching away with his group gathering on him (traced), his shield, his lunge.
import { existsSync, readFileSync } from "node:fs";
import { decompressYaz0, Dol, loadActorTypes, parseRarc, readTileTypes, Stage } from "@fso/formats";
import { describe, expect, it } from "vitest";
import { Button, SUBPX } from "../player.ts";
import { createAdventure, stepAdventure, type AdventureGame } from "./adventure.ts";
import { hurtEnemy } from "./enemies.ts";
import { ARROW_KIND, BOWMAN, CAPTAIN, GROUP, ORDER_ATTACK, ORDER_GATHER, SOLDIER } from "./soldiers.ts";
import { actorStats, AdventureStage } from "./stage.ts";

const root = new URL("../../../../extracted/", import.meta.url);
const load = (path: string) => parseRarc(decompressYaz0(readFileSync(new URL(`files/GC4Sword_usa/${path}`, root))));

describe.skipIf(!existsSync(root))("the adventure's bow soldiers and captains", () => {
  if (!existsSync(root)) return void it.skip("needs extracted/", () => {});
  const tileTypes = readTileTypes(new Dol(readFileSync(new URL("sys/main.dol", root))));
  const stats = actorStats(loadActorTypes(load("data.arc"))!);
  const stageOf = (id: string) => new AdventureStage(new Stage(load(`Boss/${id}.arc`)), tileTypes, stats);
  const step = (game: AdventureGame, stage: AdventureStage, n = 1) => {
    for (let i = 0; i < n; i++) stepAdventure(game, [0], stage);
  };

  it("a bow soldier notices a Link ahead within 100 px and shoots arrows at 3 px/tick", () => {
    const stage = stageOf("boss022");
    const game = createAdventure(stage, { room: 11, x: 256, y: 192 });
    const s = game.adventure.enemies.find((e) => e.type === "SLR2")!;
    expect([s.kind, s.life]).toEqual([0, BOWMAN.life]);
    // Facing right, the Link 90 px to its right.
    Object.assign(s, { x: 96 * SUBPX, y: 192 * SUBPX, facing: "right", state: "walk", shot: 0, timer: 100 });
    Object.assign(game.players[0]!, { x: 186 * SUBPX, y: 192 * SUBPX });
    step(game, stage);
    expect(s.state).toBe("chase");
    let arrow = undefined;
    for (let k = 0; k < 200 && !arrow; k++) {
      step(game, stage);
      arrow = game.adventure.enemies.find((e) => e.type === "OKTM" && e.kind === ARROW_KIND);
    }
    expect(arrow).toBeDefined();
    expect([arrow!.vx, arrow!.vy]).toEqual([BOWMAN.arrowSpeed, 0]);
  });

  it("sword soldiers keep 40-56 px off an idle Link until one is struck: then one takes his attack slot (traced, main.dol)", () => {
    const stage = stageOf("boss010");
    // Room 5's ambush, the Link idle on the bridge's switch (traced: 900 ticks, none closer than 44 px, slots free).
    const game = createAdventure(stage, { room: 5, x: 264, y: 304, hearts: 20 });
    const p = game.players[0]!;
    const near = () => Math.min(...game.adventure.enemies.filter((e) => e.type === "SLR1").map((e) => Math.hypot(e.x - p.x, e.y - p.y) / SUBPX));
    step(game, stage, 400);
    let closest = Infinity;
    for (let t = 0; t < 500; t++) step(game, stage), (closest = Math.min(closest, near()));
    expect(closest).toBeGreaterThan(40);
    expect(closest).toBeLessThan(SOLDIER.slotReach);
    expect(game.adventure.slots).toEqual({ links: [-1, -1, -1, -1], wait: SOLDIER.slotWait, rate: 0 });
    // A soldier struck: the rate up by 2, the countdown out; the next one within 56 px takes the slot and comes on.
    const struck = game.adventure.enemies.find((e) => e.type === "SLR1")!;
    hurtEnemy(struck, 0, struck.x, struck.y - 8 * SUBPX, game);
    expect([game.adventure.slots.wait, game.adventure.slots.rate]).toEqual([0, SOLDIER.slotRate]);
    closest = Infinity;
    let taken = false;
    for (let t = 0; t < 300; t++) {
      step(game, stage);
      closest = Math.min(closest, near());
      taken ||= game.adventure.slots.links[0]! > 0;
    }
    expect(taken).toBe(true);
    expect(closest).toBeLessThan(24);
  });

  it("room 9's captain marches away first, his soldiers gathering on him; his shield; his lunge (traced, main.dol)", () => {
    const stage = stageOf("boss010");
    const game = createAdventure(stage, { room: 9, x: 472, y: 88 });
    const c = game.adventure.enemies.find((e) => e.type === "SLR4")!;
    const soldiers = game.adventure.enemies.filter((e) => e.type === "SLR1");
    expect([c.life, c.group, c.shot2]).toEqual([24, 1, ORDER_GATHER]);
    const p = game.players[0]!;
    const d0 = Math.hypot(c.x - p.x, c.y - p.y);
    step(game, stage, 150);
    // Away from the Link at 0.9 px/tick (traced: 0.66, 0.61 a tick), the soldiers on him.
    expect(Math.hypot(c.x - p.x, c.y - p.y)).toBeGreaterThan(d0 + 40 * SUBPX);
    expect(soldiers.every((s) => s.leader === c.id)).toBe(true);
    step(game, stage, 150);
    expect(soldiers.filter((s) => Math.hypot(s.x - c.x, s.y - c.y) < (GROUP.gather + 20) * SUBPX).length).toBeGreaterThanOrEqual(4);
    // A stab from ahead of him: blocked (no harm); from behind: 4 off.
    const stab = (side: 1 | -1) => {
      for (const s of soldiers) s.life = -1;
      // (Ahead: winding up, still; behind: holding after a lunge.)
      Object.assign(c, { state: side > 0 ? "stop" : "spit", tick: 0, timer: 200, facing: "right", invincible: 0, vx: 0, vy: 0 });
      Object.assign(p, { x: c.x + side * 16 * SUBPX, y: c.y, facing: side > 0 ? "left" : "right", action: "none", actionTick: 0 });
      game.battle.fighters[0]!.invincible = 99;
      stepAdventure(game, [Button.Sword], stage);
      step(game, stage, 12);
    };
    stab(1);
    expect(c.life).toBe(24);
    stab(-1);
    expect(c.life).toBe(20);
    void hurtEnemy;
    // Within 80 px with his cool-down over: a 47-tick wind-up, then a lunge along his facing.
    c.shot2 = ORDER_ATTACK;
    // (In the open: the middle of the room.)
    Object.assign(c, { state: "walk", shot: 0, tick: 0, vx: 0, vy: 0, x: 200 * SUBPX, y: 200 * SUBPX });
    game.battle.fighters[0]!.invincible = 0;
    Object.assign(p, { x: c.x + 60 * SUBPX, y: c.y });
    for (const s of soldiers) s.life = -1;
    step(game, stage);
    expect(c.state).toBe("stop");
    expect(c.facing).toBe("right");
    step(game, stage, CAPTAIN.windupTicks);
    expect(c.state).toBe("fly");
    const x0 = c.x;
    step(game, stage, 3);
    expect(c.x - x0).toBeGreaterThan(30 * SUBPX);
  });
});
