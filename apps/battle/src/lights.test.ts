// The arenas' lighting read from the user's disc (extracted/): which rooms are dark, and the light sources of a frame.
import { existsSync, readFileSync } from "node:fs";
import { decompressYaz0, parseRarc, Stage } from "@fso/formats";
import { arenaSpawns, createBattle, SUBPX } from "@fso/sim";
import { describe, expect, it } from "vitest";
import { FLAME_LIGHT, LINK_LIGHT, lightSources, roomLight } from "./lights.ts";

const boss500 = new URL("../../../extracted/files/GC4Sword_usa/Boss/boss500.arc", import.meta.url);

describe.skipIf(!existsSync(boss500))("arena lighting (boss500)", () => {
  if (!existsSync(boss500)) return void it.skip("needs extracted/", () => {});
  const stage = new Stage(parseRarc(decompressYaz0(readFileSync(boss500))));

  it("darkens the Dark World rooms and warms the Tower of Flames", () => {
    const lights = Array.from({ length: 10 }, (_, room) => roomLight(stage, room));
    // The Light World's Field and Hyrule Castle have no light; the Tower of Winds and Above the Clouds get theirs from
    // their SWEV (measured in RAM).
    for (const room of [0, 3]) expect(lights[room]).toBeNull();
    expect(lights[2]).toEqual({ kind: -1, tint: [150, 200, 255], tintAlpha: 20, ambient: 180 });
    expect(lights[4]).toEqual({ kind: -1, tint: [190, 210, 200], tintAlpha: 0, ambient: 255 });
    expect(lights[1]).toEqual({ kind: 4, tint: [255, 200, 160], tintAlpha: 0, ambient: 200 });
    expect(lights[5]).toEqual({ kind: 9, tint: [150, 200, 255], tintAlpha: 0, ambient: 10 });
    expect(lights[6]).toEqual({ kind: 3, tint: [255, 200, 160], tintAlpha: 0, ambient: 10 });
    expect(lights[7]).toEqual({ kind: 1, tint: [150, 200, 255], tintAlpha: 0, ambient: 10 });
    expect(lights[8]).toEqual({ kind: 9, tint: [150, 200, 255], tintAlpha: 0, ambient: 10 });
    expect(lights[9]).toEqual({ kind: 0, tint: [210, 200, 170], tintAlpha: 0, ambient: 10 });
  });

  it("lights each Link and the eternal flames", () => {
    const room = 6;
    const game = createBattle(room, arenaSpawns(stage, room), undefined, {
      actors: [{ id: "BLZ2", x: 120, y: 100, params: 0x70000013 }],
      bushes: [],
    });
    let sources = lightSources(game);
    expect(sources.filter((s) => s.radius === LINK_LIGHT.radius)).toHaveLength(4);
    expect(sources[0]).toEqual({ x: game.players[0]!.x / SUBPX, y: game.players[0]!.y / SUBPX, ...LINK_LIGHT });
    expect(sources).not.toContainEqual({ x: 120, y: 100, ...FLAME_LIGHT }); // out until switch 14 lights it
    game.battle!.entities.find((e) => e.kind === "flame")!.phase = "active";
    sources = lightSources(game);
    expect(sources).toContainEqual({ x: 120, y: 100, ...FLAME_LIGHT });
    // A Link out of the round has no light.
    game.battle!.fighters[1]!.mode = "dead";
    expect(lightSources(game).filter((s) => s.radius === LINK_LIGHT.radius)).toHaveLength(3);
  });
});
