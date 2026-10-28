// The snake, the Zol and the PAME on the real stages (skips without extracted/): main.dol's readings (walkers.ts), and
// Lake Hylia room 4's Zol held under its two-Link rock until the rock is lifted.
import { existsSync, readFileSync } from "node:fs";
import { decompressYaz0, Dol, loadActorTypes, parseRarc, readTileTypes, Stage } from "@fso/formats";
import { describe, expect, it } from "vitest";
import { Button, SUBPX } from "../player.ts";
import { createAdventure, stepAdventure, type AdventureGame } from "./adventure.ts";
import { tryHeavyLift } from "./rocks.ts";
import { actorStats, AdventureStage } from "./stage.ts";
import { isSolidAt } from "../world.ts";
import { PAME, ROPE, wayBlocked, ZOL } from "./walkers.ts";

const root = new URL("../../../../extracted/", import.meta.url);
const load = (path: string) => parseRarc(decompressYaz0(readFileSync(new URL(`files/GC4Sword_usa/${path}`, root))));

describe.skipIf(!existsSync(root))("the adventure's snakes, Zols and PAMEs", () => {
  if (!existsSync(root)) return void it.skip("needs extracted/", () => {});
  const tileTypes = readTileTypes(new Dol(readFileSync(new URL("sys/main.dol", root))));
  const stats = actorStats(loadActorTypes(load("data.arc"))!);
  const stageOf = (id: string) => new AdventureStage(new Stage(load(`Boss/${id}.arc`)), tileTypes, stats);
  const step = (game: AdventureGame, stage: AdventureStage, n = 1, buttons = 0) => {
    for (let i = 0; i < n; i++) stepAdventure(game, [buttons], stage);
  };

  it("a snake rests, walks at 0.4 px/tick, and dashes at 1.5 px/tick at a Link in line with it", () => {
    const stage = stageOf("boss023");
    const game = createAdventure(stage, { room: 1, x: 256, y: 360, hearts: 20 });
    const snakes = game.adventure.enemies.filter((e) => e.type === "ROPE");
    expect(snakes.length).toBe(4);
    expect(snakes.every((e) => e.state === "rest" && e.life === 8)).toBe(true);
    let walked = false;
    for (let t = 0; t < 200 && !walked; t++) {
      step(game, stage);
      walked = snakes.some((e) => e.state === "walk" && e.speed === ROPE.walkSpeed);
    }
    expect(walked).toBe(true);
    // One standing a while, the Link 60 px off in its column or row with the way clear: it dashes at him.
    const world = stage.area(1, 0).world;
    const ways = [["down", 0, 1], ["up", 0, -1], ["right", 1, 0], ["left", -1, 0]] as const;
    let found: { s: (typeof snakes)[number]; way: (typeof ways)[number] } | null = null;
    for (const s of snakes) for (const way of ways) if (!found && !wayBlocked(world, s.x, s.y, way[0], 60) && !isSolidAt(world, s.x / SUBPX + way[1] * 60, s.y / SUBPX + way[2] * 60)) found = { s, way };
    expect(found).not.toBeNull();
    const { s, way } = found!;
    for (const x of snakes) if (x !== s) x.life = -1;
    Object.assign(s, { state: "rest", tick: ROPE.dashAfter, timer: 1000, speed: 0, tvx: 0 });
    Object.assign(game.players[0]!, { x: s.x + way[1] * 60 * SUBPX + 2 * SUBPX * way[2], y: s.y + way[2] * 60 * SUBPX + 2 * SUBPX * way[1] });
    step(game, stage);
    expect([s.state, s.facing]).toEqual(["chase", way[0]]);
    step(game, stage, 15); // (0.1 px/tick faster a tick)
    expect(s.speed).toBe(ROPE.dashSpeed);
  });

  it("the Tower of Winds' Zols rest and move at 0.4 px/tick; a stab kills one", () => {
    const stage = stageOf("boss073");
    const game = createAdventure(stage, { room: 15, x: 256, y: 300, hearts: 20 });
    const zols = game.adventure.enemies.filter((e) => e.type === "ZASL");
    expect(zols.length).toBe(3);
    expect(zols.every((e) => e.life === 1 && e.kind === 0)).toBe(true);
    let moved = false;
    for (let t = 0; t < 200 && !moved; t++) {
      step(game, stage);
      moved = zols.some((e) => e.state === "walk" && e.speed === ZOL.speed);
    }
    expect(moved).toBe(true);
  });

  it("Lake Hylia room 4's Zol lies under the two-Link rock until two Links lift it (main.dol)", () => {
    const stage = stageOf("boss010");
    const game = createAdventure(stage, { room: 4, x: 176, y: 140, facing: "up", players: 2, hearts: 20 });
    expect(game.adventure.enemies.some((e) => e.type === "ZASL")).toBe(false);
    const rock = game.adventure.rocks.find((r) => r.type === "RCK2" && r.x === 176 * SUBPX && r.y === 112 * SUBPX)!;
    expect(rock.held.length).toBe(1);
    // The two Links side by side below it, facing it: they lift it, and a few ticks after it leaves the ground (the
    // lift's 67th tick: rocks.ts RCK2_UP_TICKS) the Zol comes out where it was placed.
    Object.assign(game.players[0]!, { x: 172 * SUBPX, y: 140 * SUBPX, facing: "up" });
    Object.assign(game.players[1]!, { x: 182 * SUBPX, y: 140 * SUBPX, facing: "up" });
    expect(tryHeavyLift(game, Button.Action)).toBe(true);
    let zol = undefined;
    for (let t = 0; t < 90 && !zol; t++) {
      step(game, stage);
      zol = game.adventure.enemies.find((e) => e.type === "ZASL");
    }
    expect(zol).toBeDefined();
    expect([zol!.homeX / SUBPX, zol!.homeY / SUBPX]).toEqual([176, 112]);
  });

  it("a PAME: a stab kicks a small one sliding at 2.5 px/tick; on its back a stab kills it", () => {
    const stage = stageOf("boss070");
    const game = createAdventure(stage, { room: 27, x: 256, y: 300, hearts: 20 });
    const pames = game.adventure.enemies.filter((e) => e.type === "PAME");
    expect(pames.length).toBeGreaterThan(0);
    const e = pames[0]!;
    expect([e.life, e.state]).toEqual([PAME.smallLife, "walk"]);
    // The Link 14 px left of it, stabbing right.
    const stab = () => {
      Object.assign(game.players[0]!, { x: e.x - 14 * SUBPX, y: e.y, facing: "right", action: "none", actionTick: 0 });
      game.battle.fighters[0]!.invincible = 99;
      step(game, stage, 1, Button.Sword);
      step(game, stage, 4);
    };
    Object.assign(e, { state: "walk" });
    stab();
    expect(e.state).toBe("chase");
    expect(e.life).toBe(PAME.smallLife);
    // Let it slide out, then lie on its back.
    for (let t = 0; t < PAME.slideTicks + 20 && e.state === "chase"; t++) step(game, stage);
    expect(e.state).toBe("rest");
    stab();
    expect(e.life).toBe(0);
  });
});
