// The Cave of No Return's darkness and lights (light.ts) from the stage's LTEVs, TRCHs and LWSWs: room 12 lit, room 6
// dark at once (kind 3), room 4 fading to 200 (kind 5), room 3 dark until its switch 21 (kind 16), the lamp's light
// round each Link and a candle's light easing in. Skipped when extracted/ is absent (e.g. in CI).
import { existsSync, readFileSync } from "node:fs";
import { decompressYaz0, Dol, isYaz0, loadActorTypes, parseRarc, readTileTypes, Stage } from "@fso/formats";
import { setSwitch } from "@fso/sim";
import { actorStats, AdventureStage, createAdventure, type AdventureGame } from "@fso/sim/adventure";
import { describe, expect, it } from "vitest";
import { AdventureLight, LAMP_LIGHT } from "./light.ts";

const root = new URL("../../../extracted/", import.meta.url);
const present = existsSync(new URL("sys/main.dol", root));
const archive = (path: string) => {
  const bytes = readFileSync(new URL(`files/GC4Sword_usa/${path}`, root));
  return parseRarc(isYaz0(bytes) ? decompressYaz0(bytes) : bytes);
};

describe.skipIf(!present)("real disc: the Cave of No Return's light", () => {
  const stage = present ? new Stage(archive("Boss/boss011.arc")) : null!;
  const adventure = present
    ? new AdventureStage(stage, readTileTypes(new Dol(readFileSync(new URL("sys/main.dol", root)))), actorStats(loadActorTypes(archive("data.arc"))!))
    : null!;
  const steps = (light: AdventureLight, game: AdventureGame, n: number) => {
    for (let i = 0; i < n; i++) light.step(game, adventure);
  };
  const into = (game: AdventureGame, room: number) => {
    game.adventure.room = room;
    game.battle.switches = 0;
  };

  it("room 12 lit, room 6 dark at once, room 4 fading to 200, room 3 brightening once its switch 21 is on", () => {
    const game = createAdventure(adventure, { players: 4 }), light = new AdventureLight(stage);
    expect(game.adventure.room).toBe(12);
    steps(light, game, 1);
    expect(light.current()).toBeNull();
    into(game, 6);
    steps(light, game, 1);
    expect(light.current()).toMatchObject({ tint: [255, 200, 160], ambient: 10 });
    into(game, 4);
    steps(light, game, 47);
    expect(light.current()!.ambient).toBe(10 + 47 * 4);
    steps(light, game, 1);
    expect(light.current()!.ambient).toBe(200);
    into(game, 3);
    steps(light, game, 30);
    expect(light.current()!.ambient).toBe(10);
    setSwitch(game.battle, 21, true);
    steps(light, game, 10);
    expect(light.current()!.ambient).toBe(50);
    steps(light, game, 100);
    expect(light.current()!.ambient).toBe(200);
  });

  it("the lamp lights 100 px round each Link, easing 1 px a tick; a lit candle 70 px, easing 4", () => {
    const game = createAdventure(adventure, { players: 4, room: 6 }), light = new AdventureLight(stage);
    const lamps = () => light.sources(game, adventure).filter((s) => s.alpha === LAMP_LIGHT.alpha);
    steps(light, game, 10);
    expect(lamps()).toEqual([]);
    game.adventure.gear = "lamp";
    steps(light, game, 40);
    expect(lamps().map((s) => s.radius)).toEqual([40, 40, 40, 40]);
    steps(light, game, 100);
    expect(lamps().map((s) => s.radius)).toEqual([100, 100, 100, 100]);
    // Room 6's east candle (LWSW switch 19 at (432, 32)) and its torch: their lights once its switch is on.
    const at = (x: number, y: number) => light.sources(game, adventure).find((s) => s.x === x && s.y === y);
    expect(at(440, 40)).toBeUndefined();
    setSwitch(game.battle, 19, true);
    steps(light, game, 10);
    expect(at(440, 40)?.radius).toBe(40);
    steps(light, game, 10);
    expect(at(440, 40)?.radius).toBe(70);
    expect(at(448, 48)?.radius).toBe(70); // its TRCH, at its anchor + (8, 8)
  });
});
