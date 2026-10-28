// The Cave of No Return's room 4 pots (tile 0x40, LIFT_STONES): the one at cell (23, 3) lifts from beside it, and not
// from a step lower, where only Link's cut corner touches it and the lift point (16 px ahead of his anchor, at its
// height: carry.ts LIFT_REACH) falls on the floor row below (a playtest stood there; skips without extracted/).
import { existsSync, readFileSync } from "node:fs";
import { decompressYaz0, Dol, loadActorTypes, parseRarc, readTileTypes, Stage } from "@fso/formats";
import { describe, expect, it } from "vitest";
import { Button, SUBPX } from "../player.ts";
import { createAdventure, stepAdventure } from "./adventure.ts";
import { actorStats, AdventureStage, playedAlone } from "./stage.ts";

const root = new URL("../../../../extracted/", import.meta.url);
const load = (path: string) => parseRarc(decompressYaz0(readFileSync(new URL(`files/GC4Sword_usa/${path}`, root))));

describe.skipIf(!existsSync(root))("room 4's pots in the Cave of No Return", () => {
  if (!existsSync(root)) return void it.skip("needs extracted/", () => {});
  const tileTypes = readTileTypes(new Dol(readFileSync(new URL("sys/main.dol", root))));
  const stage = new AdventureStage(playedAlone(new Stage(load("Boss/boss011.arc"))), tileTypes, actorStats(loadActorTypes(load("data.arc"))!));
  const POT = 3 * 32 + 23; // y 48-63, x 368-383

  const tryAt = (y: number) => {
    const game = createAdventure(stage, { room: 4, players: 1, x: 391, y, facing: "left" });
    expect(game.battle.props.pots).toContain(POT);
    stepAdventure(game, [0], stage);
    stepAdventure(game, [Button.Action], stage);
    stepAdventure(game, [0], stage);
    return game;
  };

  it("lifts from beside it, facing it", () => {
    const game = tryAt(63);
    expect(game.battle.cut).toContain(POT);
    expect(game.battle.fighters[0]!.move).toBe("lift");
  });

  it("doesn't lift from a step lower: the lift point is on the floor below it", () => {
    const game = tryAt(64);
    expect(game.players[0]!.y).toBe(64 * SUBPX);
    expect(game.battle.cut).not.toContain(POT);
    for (let t = 0; t < 30; t++) stepAdventure(game, [0], stage);
    expect(game.battle.cut).not.toContain(POT);
    expect(game.battle.fighters[0]!.carryEntity).toBe(0);
  });
});
