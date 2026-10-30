// Force Gems spilled by a Link struck (pickups.ts spillOf, spillGems): in Dolphin a river stone's strike in Tingle's
// Tower room 5 (ref/places/tingle-room5.sav idle: struck on frame 217) cost the leader 8 of his 301 Force Gems as his
// knockback ended on frame 251, flung out of him as green gems; those that fell on the bank lay there 830 ticks, one
// that fell in the pool sank and went 30 ticks later. The rules run without the game files; the stage's strike skips
// without extracted/.
import { existsSync, readFileSync } from "node:fs";
import { decompressYaz0, Dol, loadActorTypes, parseRarc, readTileTypes, Stage } from "@fso/formats";
import { describe, expect, it } from "vitest";
import { Button, SUBPX } from "../player.ts";
import { createAdventure, stepAdventure } from "./adventure.ts";
import { GEM_LIFE, GEM_SINK_TICKS, spillOf, stepPickups } from "./pickups.ts";
import { actorStats, AdventureStage, playedAlone } from "./stage.ts";

const hit = (cause: string, damage = 1) => ({ attacker: -1, victim: 0, blocked: false, damage, cause });

describe("what a hit spills", () => {
  it("goes by the game's hit type: 4 and 7 from 5, 5 and 8 from 20, 6 and 9 from 50, the rest none", () => {
    expect(spillOf(hit("stone"))).toEqual([5, 5]);
    expect(spillOf(hit("bite"))).toEqual([5, 5]);
    expect(spillOf(hit("flame", 1))).toEqual([5, 5]);
    expect(spillOf(hit("flame", 4))).toEqual([50, 20]);
    expect(spillOf(hit("bomb", 2))).toEqual([20, 10]);
    expect(spillOf(hit("boulder", 2))).toEqual([50, 20]);
    expect(spillOf(hit("soldier", 2))).toBeNull();
    expect(spillOf({ attacker: 1, victim: 0, blocked: false, damage: 2 })).toBeNull();
  });
});

const root = new URL("../../../../extracted/", import.meta.url);
describe.skipIf(!existsSync(root))("a river stone's strike in Tingle's Tower room 5", () => {
  if (!existsSync(root)) return void it.skip("needs extracted/", () => {});
  const load = (path: string) => parseRarc(decompressYaz0(readFileSync(new URL(`files/GC4Sword_usa/${path}`, root))));
  const tileTypes = readTileTypes(new Dol(readFileSync(new URL("sys/main.dol", root))));
  const stage = new AdventureStage(playedAlone(new Stage(load("Boss/boss012.arc"))), tileTypes, actorStats(loadActorTypes(load("data.arc"))!));

  it("spills 5-9 of the leader's gems as his knockback ends; in the pool they sink and go 30 ticks later", () => {
    // Dolphin's spot, carried west by the current onto the stones; Down runs him into one.
    const game = createAdventure(stage, { room: 5, players: 4, x: 421.625, y: 142.924, facing: "down", hearts: 14 });
    game.adventure.gems = 301;
    let struck = -1, spilled = -1;
    for (let t = 0; t < 400 && spilled < 0; t++) {
      stepAdventure(game, [t > 240 && t < 270 ? Button.Down : 0], stage);
      const f = game.battle.fighters[0]!;
      if (struck < 0 && f.mode === "hurt") struck = t;
      if (game.adventure.gems < 301) spilled = t;
    }
    expect(struck).toBeGreaterThan(0);
    // The tick he's back on his feet (the knockback: 2 × hop / gravity + 1 ticks).
    expect(spilled - struck).toBe(33);
    const lost = 301 - game.adventure.gems;
    expect(lost).toBeGreaterThanOrEqual(5);
    expect(lost).toBeLessThanOrEqual(9);
    const flung = game.adventure.pickups.filter((p) => p.actor < 0);
    expect(flung.length).toBe(lost);
    expect(flung.every((p) => p.kind === 0)).toBe(true);
    for (let t = 0; t < 40 + GEM_SINK_TICKS; t++) stepAdventure(game, [0], stage);
    expect(game.adventure.pickups.filter((p) => p.actor < 0)).toEqual([]);
    expect(game.adventure.gems).toBe(301 - lost);
  });

  it("leaves a gem a GOLD flung on the ground for 830 ticks", () => {
    const game = createAdventure(stage, { room: 11, players: 1, x: 416, y: 96, facing: "down", hearts: 3 });
    game.adventure.pickups = [{ id: 99, type: "gem", from: "RUPY", actor: -1, x: 300 * SUBPX, y: 150 * SUBPX, z: 0, kind: 1, gate: 0, tick: 0, vz: 0, vx: 0, vy: 0 }];
    for (let t = 0; t < GEM_LIFE - 1; t++) stepPickups(game);
    expect(game.adventure.pickups.length).toBe(1);
    stepPickups(game);
    expect(game.adventure.pickups).toEqual([]);
  });
});
