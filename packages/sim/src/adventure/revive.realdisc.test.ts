// The Links out of hearts in Lake Hylia's room 4 (octoroks about): they get up again where they came into the room,
// hearts full, blinking through REVIVE_INVINCIBLE_TICKS (shown 2 ticks in 4: a sampler stepping by fours can see them
// hidden all along, as a playtest did), struck by nothing until it runs out, and they walk at once
// (adventure.ts revive; skips without extracted/).
import { existsSync, readFileSync } from "node:fs";
import { decompressYaz0, Dol, loadActorTypes, parseRarc, readTileTypes, Stage } from "@fso/formats";
import { describe, expect, it } from "vitest";
import { fighterVisible, hurtFighter } from "../combat.ts";
import { Button, SUBPX } from "../player.ts";
import { createAdventure, REVIVE_INVINCIBLE_TICKS, stepAdventure } from "./adventure.ts";
import { actorStats, AdventureStage, playedAlone } from "./stage.ts";

const root = new URL("../../../../extracted/", import.meta.url);
const load = (path: string) => parseRarc(decompressYaz0(readFileSync(new URL(`files/GC4Sword_usa/${path}`, root))));

describe.skipIf(!existsSync(root))("a Link out of hearts (Lake Hylia room 4)", () => {
  it("gets the four up at the room's entry, full, blinking, unhurt through the invincibility and walking", () => {
    const tileTypes = readTileTypes(new Dol(readFileSync(new URL("sys/main.dol", root))));
    const stage = new AdventureStage(playedAlone(new Stage(load("Boss/boss010.arc"))), tileTypes, actorStats(loadActorTypes(load("data.arc"))!));
    const game = createAdventure(stage, { room: 4, players: 4 });
    const idle = [0, 0, 0, 0];
    for (let i = 0; i < 60; i++) stepAdventure(game, idle, stage);
    const full = game.battle.fighters[0]!.hearts;
    // The last quarter heart lost (the Links share them).
    for (const f of game.battle.fighters) f.hearts = 1;
    const p = game.players[0]!;
    expect(hurtFighter(p, game.battle.fighters[0]!, 0, 1, p.x, p.y - 16 * SUBPX)).not.toBeNull();
    let ticks = 0;
    while (game.battle.fighters[0]!.invincible !== REVIVE_INVINCIBLE_TICKS && ticks++ < 600) stepAdventure(game, idle, stage);
    expect(ticks).toBeLessThan(600);
    const a = game.adventure;
    game.battle.fighters.forEach((f, i) => {
      expect(f.hearts).toBe(full);
      expect(f.mode).toBe("active");
      expect([game.players[i]!.x, game.players[i]!.y]).toEqual([a.entryX * SUBPX, a.entryY * SUBPX]);
    });
    // The invincibility: never hidden more than 2 ticks running, no heart lost (standing still, then walking down).
    const hidden = [0, 0, 0, 0], y0 = p.y;
    for (let t = 1; t < REVIVE_INVINCIBLE_TICKS; t++) {
      stepAdventure(game, t < 60 ? idle : [Button.Down, 0, 0, 0], stage);
      game.battle.fighters.forEach((f, i) => {
        hidden[i] = fighterVisible(f) ? 0 : hidden[i]! + 1;
        expect(hidden[i], `Link ${i} at ${t}`).toBeLessThanOrEqual(2);
        expect(f.hearts).toBe(full);
        expect(f.invincible).toBeGreaterThan(0);
      });
    }
    expect(p.y).toBeGreaterThan(y0);
    stepAdventure(game, idle, stage);
    expect(game.battle.fighters.every((f) => f.invincible === 0 && fighterVisible(f))).toBe(true);
  });
});
