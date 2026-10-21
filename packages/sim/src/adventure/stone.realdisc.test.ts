// Lake Hylia's grey stone (tile 0x72, room 2's cave mouth) lifted and thrown: it flies still naming its tile, so apps/battle
// draws it as the stone and not as a pot (carry.ts release; skips without extracted/).
import { existsSync, readFileSync } from "node:fs";
import { decompressYaz0, Dol, loadActorTypes, parseRarc, readTileTypes, Stage } from "@fso/formats";
import { describe, expect, it } from "vitest";
import { Button } from "../player.ts";
import { createAdventure, stepAdventure } from "./adventure.ts";
import { actorStats, AdventureStage, playedAlone } from "./stage.ts";

const root = new URL("../../../../extracted/", import.meta.url);
const load = (path: string) => parseRarc(decompressYaz0(readFileSync(new URL(`files/GC4Sword_usa/${path}`, root))));

describe.skipIf(!existsSync(root))("Lake Hylia's grey stone, thrown from room 2's cave mouth", () => {
  const tileTypes = readTileTypes(new Dol(readFileSync(new URL("sys/main.dol", root))));
  const stage = new AdventureStage(playedAlone(new Stage(load("Boss/boss010.arc"))), tileTypes, actorStats(loadActorTypes(load("data.arc"))!));
  const STONE = 0x72;
  const STONE_AT = 4 * 32 + 18; // x 288-303, y 64-79

  it("is lifted from beside it, and flies (and falls) on its tile until it breaks", () => {
    const game = createAdventure(stage, { room: 2, players: 1, x: 272, y: 72, facing: "right", hearts: 20 });
    const area = stage.area(2, 0);
    const stoneTile = (): number | null => {
      const e = game.battle.entities.find((x) => x.kind === "pot");
      return e ? area.base![e.param]! & 0x3ff : null;
    };
    expect(area.base![STONE_AT]! & 0x3ff).toBe(STONE);
    expect(game.battle.props.pots).toContain(STONE_AT);
    stepAdventure(game, [0], stage);
    stepAdventure(game, [Button.Action], stage);
    for (let t = 0; t < 40 && game.battle.fighters[0]!.move !== "carry"; t++) stepAdventure(game, [0], stage);
    expect(stoneTile()).toBe(STONE);
    stepAdventure(game, [Button.Action], stage);
    let flying = 0;
    for (let t = 0; t < 40 && game.battle.entities.some((x) => x.kind === "pot"); t++) {
      stepAdventure(game, [0], stage);
      const e = game.battle.entities.find((x) => x.kind === "pot");
      if (e?.phase === "flying") {
        flying++;
        expect(stoneTile()).toBe(STONE);
      }
    }
    expect(flying).toBeGreaterThan(0);
  });
});
