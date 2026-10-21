// The Links' bow (bow.ts) in the Cave of No Return (skips without extracted/): room 8's pedestal (at room 9's cell, played
// alone) gives it, room 0's the lamp it draws;
// in room 3 an arrow shot up through a lit torch on the near ledge flies over the candle stands, catches fire and lights
// the candle across the pit, an arrow lights the crystal, and arrows still stick in walls.
import { existsSync, readFileSync } from "node:fs";
import { decompressYaz0, Dol, loadActorTypes, parseRarc, readTileTypes, Stage } from "@fso/formats";
import { describe, expect, it } from "vitest";
import { Button, SUBPX, type Facing } from "../player.ts";
import { switchOn } from "../switches.ts";
import { createAdventure, stepAdventure, type AdventureGame } from "./adventure.ts";
import { ARROW_BURNING } from "./bow.ts";
import { giveGear, pedestalItem } from "./gear.ts";
import { actorStats, AdventureStage } from "./stage.ts";

const root = new URL("../../../../extracted/", import.meta.url);
const load = (path: string) => parseRarc(decompressYaz0(readFileSync(new URL(`files/GC4Sword_usa/${path}`, root))));

describe("the pedestals' items", () => {
  it("are Lake Hylia's boomerang whatever they draw; elsewhere none by stage (the drawn item)", () => {
    expect(pedestalItem(10, "")).toBe("boomerang");
    expect(pedestalItem(10, "boomerang")).toBe("");
    expect(pedestalItem(11, "")).toBe("");
    expect(pedestalItem(12, "")).toBe("");
  });
});

describe.skipIf(!existsSync(root))("the bow in the Cave of No Return", () => {
  const tileTypes = readTileTypes(new Dol(readFileSync(new URL("sys/main.dol", root))));
  const stats = actorStats(loadActorTypes(load("data.arc"))!);
  const stage = new AdventureStage(new Stage(load("Boss/boss011.arc")), tileTypes, stats);
  const step = (game: AdventureGame, n = 1, buttons = 0) => {
    for (let i = 0; i < n; i++) stepAdventure(game, [buttons], stage);
  };
  /** The leader alone with the bow at (x, y) in `room`, its enemies gone, `switches` on. */
  const start = (room: number, x: number, y: number, facing: Facing, switches = 0) => {
    const game = createAdventure(stage, { room, x, y, facing });
    game.adventure.enemies = [];
    game.battle.switches |= switches;
    giveGear(game, "bow");
    step(game, 2);
    return game;
  };
  const arrow = (game: AdventureGame) => game.battle.entities.find((e) => e.kind === "arrow");
  /** Shoots, then follows the arrow until it stops: the farthest it got (px along y), and whether it burned. */
  const shoot = (game: AdventureGame) => {
    step(game, 2, Button.Item);
    let burned = false, reach = Infinity, lowest = -Infinity;
    for (let i = 0; i < 120; i++) {
      step(game);
      const e = arrow(game);
      if (!e) continue;
      burned ||= (e.param & ARROW_BURNING) !== 0;
      reach = Math.min(reach, e.y / SUBPX);
      lowest = Math.max(lowest, e.y / SUBPX);
      if (e.phase === "rest") break;
    }
    return { burned, reach, lowest };
  };

  it("room 8's pedestal on the island (room 9's cell, played alone) gives the bow it draws; room 0's the lamp", () => {
    const game = createAdventure(stage, { room: 9, x: 200, y: 200, facing: "up" });
    giveGear(game, "lamp");
    step(game, 2);
    step(game, 2, Button.Action);
    expect(game.adventure.gear).toBe("bow");
    expect(game.battle.fighters[0]!.item).toBe("bow");
    expect(game.adventure.get?.message).toBe(0xcb);
    const lamp = createAdventure(stage, { room: 0, x: 440, y: 322, facing: "down" });
    giveGear(lamp, "bow");
    step(lamp, 2);
    step(lamp, 2, Button.Action);
    expect(lamp.adventure.gear).toBe("lamp");
  });

  it("an arrow up through a lit torch catches fire, crosses the candle stands and lights the candle across the pit", () => {
    const game = start(3, 104, 300, "up");
    expect(switchOn(game.battle, 18)).toBe(false);
    const shot = shoot(game);
    expect(shot.burned).toBe(true);
    // Past the stands at y 272, 240 and 96 and the candle's at y 64.
    expect(shot.reach).toBeLessThan(64);
    expect(switchOn(game.battle, 18)).toBe(true);
  });

  it("an arrow that hasn't passed a lit torch yet doesn't light the candle it crosses", () => {
    // From the far ledge, down over the candle at (96, 64) (it catches fire further down, at the near ledge's torch).
    const game = start(3, 104, 52, "down");
    const shot = shoot(game);
    expect(shot.lowest).toBeGreaterThan(80);
    expect(switchOn(game.battle, 18)).toBe(false);
  });

  it("an arrow lights the crystal the four candles show: the bridge", () => {
    const game = start(3, 297, 300, "up", 1 << 19);
    shoot(game);
    expect(switchOn(game.battle, 16)).toBe(true);
    // Not before the candles: the ledge under the crystal stops it.
    const before = start(3, 297, 300, "up");
    const shot = shoot(before);
    expect(shot.reach).toBeGreaterThan(90);
    expect(switchOn(before.battle, 16)).toBe(false);
  });

  it("an arrow that sticks in the crystal's own tile lights it, from either side of a pixel", () => {
    // Room 3's crystal from below, from y 298 and 300 (the arrow stops at different points short of the crystal's tile).
    for (const y of [298, 299, 300]) {
      const game = start(3, 297, y, "up", 1 << 19);
      shoot(game);
      expect(switchOn(game.battle, 16)).toBe(true);
    }
    // Room 8's (at room 9's cell), across the pit west from the far side (its bridge).
    const game = start(9, 344, 246, "left");
    shoot(game);
    expect(switchOn(game.battle, 16)).toBe(true);
  });

  it("arrows still stick in walls", () => {
    // Room 3's south wall, below its near ledge.
    const game = start(3, 160, 330, "down");
    const shot = shoot(game);
    expect(shot.lowest).toBeLessThan(352);
  });
});
