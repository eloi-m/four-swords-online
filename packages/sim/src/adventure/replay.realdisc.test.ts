// An adventure record's start (replay.ts startAdventure): a record without a carry, spots or switches starts as
// createAdventure does; one with them (a Dolphin place, tools/dolphin compare.ts) starts with the leader's item, each
// Link on his spot facing his way, the room's switches, its Shadow Link in his entrance's state, and the followers
// holding their spots (skips without extracted/).
import { existsSync, readFileSync } from "node:fs";
import { decompressYaz0, Dol, loadActorTypes, parseRarc, readTileTypes, Stage } from "@fso/formats";
import { describe, expect, it } from "vitest";
import { hashState } from "../hash.ts";
import { SUBPX } from "../player.ts";
import type { AdventureRecord } from "../replay.ts";
import { createAdventure, stepAdventure } from "./adventure.ts";
import { replayAdventure, startAdventure } from "./replay.ts";
import { SHADOW_STATE, shadowState } from "./shadowlink.ts";
import { actorStats, AdventureStage, playedAlone } from "./stage.ts";

const root = new URL("../../../../extracted/", import.meta.url);
const load = (path: string) => parseRarc(decompressYaz0(readFileSync(new URL(`files/GC4Sword_usa/${path}`, root))));

describe.skipIf(!existsSync(root))("an adventure record's start", () => {
  if (!existsSync(root)) return void it.skip("needs extracted/", () => {});
  const tileTypes = readTileTypes(new Dol(readFileSync(new URL("sys/main.dol", root))));
  const stage = new AdventureStage(playedAlone(new Stage(load("Boss/boss011.arc"))), tileTypes, actorStats(loadActorTypes(load("data.arc"))!));
  const record: AdventureRecord = { kind: "adventure", stage: "boss011", room: 7, x: 400, y: 263, players: 4, inputs: [], checkpoints: [], tick: 0, hash: 0 };

  it("is createAdventure's without a carry, spots or switches (older records)", () => {
    expect(hashState(startAdventure(record, stage))).toBe(hashState(createAdventure(stage, { room: 7, x: 400, y: 263, players: 4 })));
  });

  it("takes the carry, each Link's spot and facing, and the room's switches", () => {
    const links = [{ x: 400, y: 263.125, facing: "up" as const }, { x: 400, y: 281.625 }, { x: 400, y: 299.625, facing: "left" as const }, { x: 400, y: 317.625 }];
    const game = startAdventure({ ...record, carry: { hearts: [12, 12, 12, 12], maxHearts: 3, gear: "lamp" }, links, switches: 1 << 14 }, stage);
    expect(game.adventure.gear).toBe("lamp");
    expect(game.battle.fighters.map((f) => f.hearts)).toEqual([12, 12, 12, 12]);
    expect(game.players.map((p) => [p.x, p.y])).toEqual(links.map((l) => [Math.round(l.x * SUBPX), Math.round(l.y * SUBPX)]));
    expect(game.players.map((p) => p.facing)).toEqual(["up", "down", "left", "down"]);
    expect(game.battle.switches).toBe(1 << 14);
    for (let t = 0; t < 60; t++) stepAdventure(game, [0], stage);
    // Left idle, the followers keep their spots (their trails begin at the Link ahead, not on the leader's spot).
    expect(game.players.map((p) => [p.x, p.y])).toEqual(links.map((l) => [Math.round(l.x * SUBPX), Math.round(l.y * SUBPX)]));
  });

  it("puts room 4's Shadow Link in the record's state of his entrance, and replays it the same", () => {
    const room4: AdventureRecord = { ...record, room: 4, x: 231, y: 265, switches: 1 << 20, shadow: { state: SHADOW_STATE.portal, tick: 21 }, inputs: [[[0], 300]] };
    const game = startAdventure(room4, stage);
    const shadow = game.adventure.enemies.find((e) => e.type === "SLK2")!;
    expect([shadowState(shadow), shadow.tick]).toEqual([SHADOW_STATE.portal, 21]);
    // Out of the portal 235 ticks into it (214 steps on), as Dolphin's place (measurements/adventure-world1.md).
    const at = (ticks: number) => shadowState(replayAdventure(room4, stage, ticks).state.adventure.enemies.find((e) => e.type === "SLK2")!);
    expect([at(213), at(214)]).toEqual([SHADOW_STATE.portal, SHADOW_STATE.rise]);
    // Without it, he waits unseen as the room starts him; the record's hash is its own.
    expect(shadowState(startAdventure({ ...room4, shadow: undefined }, stage).adventure.enemies.find((e) => e.type === "SLK2")!)).toBe(SHADOW_STATE.wait);
    expect(hashState(replayAdventure(room4, stage).state)).not.toBe(hashState(replayAdventure({ ...room4, shadow: undefined }, stage).state));
  });
});
