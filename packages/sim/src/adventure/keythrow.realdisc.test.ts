// A carried small key thrown (Lake Hylia room 3; traced in Dolphin, docs/measurements/adventure-lake-hylia.md "The key's
// throw"): the wind-up, the flight, the landing on the floor, the key lifted again and used in the house's door, and a
// key thrown into the house's wall (skips without extracted/).
import { existsSync, readFileSync } from "node:fs";
import { decompressYaz0, Dol, loadActorTypes, parseRarc, readTileTypes, Stage } from "@fso/formats";
import { describe, expect, it } from "vitest";
import { Button, SUBPX } from "../player.ts";
import { createAdventure, stepAdventure, type AdventureGame } from "./adventure.ts";
import { KEY_LIFT_TICKS } from "./doors.ts";
import { actorStats, AdventureStage } from "./stage.ts";

const root = new URL("../../../../extracted/", import.meta.url);
const load = (path: string) => parseRarc(decompressYaz0(readFileSync(new URL(`files/GC4Sword_usa/${path}`, root))));

describe.skipIf(!existsSync(root))("a carried key thrown (Lake Hylia room 3, traced in Dolphin)", () => {
  if (!existsSync(root)) return void it.skip("needs extracted/", () => {});
  const tileTypes = readTileTypes(new Dol(readFileSync(new URL("sys/main.dol", root))));
  const stats = actorStats(loadActorTypes(load("data.arc"))!);
  const stage = new AdventureStage(new Stage(load("Boss/boss010.arc")), tileTypes, stats);
  const step = (game: AdventureGame, n = 1, buttons = 0) => {
    for (let i = 0; i < n; i++) stepAdventure(game, [buttons], stage);
  };
  /** The key lifted from 18 px below (its spot (456, 200)) and carried. */
  const carrying = (): AdventureGame => {
    const game = createAdventure(stage, { room: 3, x: 456, y: 218, facing: "up" });
    step(game, 2);
    step(game, 1, Button.Action);
    step(game, KEY_LIFT_TICKS);
    expect(game.adventure.keys).toBe(1);
    return game;
  };
  /** The Link stood at (x, y) px facing up (the Dolphin spot for the throw: (400.5, 217)). */
  const standAt = (game: AdventureGame, x: number, y: number) => {
    Object.assign(game.players[0]!, { x: x * SUBPX, y: y * SUBPX, facing: "up", moving: false, walkTicks: 0 });
  };
  const floorKey = (game: AdventureGame) => game.adventure.pickups.find((p) => p.type === "key");

  it("throws the carried key: a wind-up of 10 ticks, then 6 px a tick up for 15 ticks (20 px up at the start), landing 90 px on", () => {
    const game = carrying();
    standAt(game, 400.5, 217);
    // The press starts the wind-up; the key is still in hand until the release on the 10th tick.
    step(game, 1, Button.Action);
    expect(game.adventure.keys).toBe(1);
    step(game, 9);
    expect(game.adventure.keys).toBe(1);
    // The release: it's on its first tick of flight (6 px up, 20 px high).
    step(game, 1);
    expect(game.adventure.keys).toBe(0);
    expect(floorKey(game)).toMatchObject({ x: 400.5 * SUBPX, y: 211 * SUBPX, z: 20 * SUBPX });
    // Its fifth tick of flight: 30 px up, 18 px high (the fall 0.1 × k × (k − 1)).
    step(game, 4);
    expect(floorKey(game)).toMatchObject({ x: 400.5 * SUBPX, y: 187 * SUBPX, z: 18 * SUBPX });
    // The fifteenth: on the floor 90 px up, no bounce, the Link free again.
    step(game, 10);
    expect(floorKey(game)).toMatchObject({ x: 400.5 * SUBPX, y: 127 * SUBPX, z: 0 });
    step(game, 3);
    expect(floorKey(game)).toMatchObject({ x: 400.5 * SUBPX, y: 127 * SUBPX, z: 0 });
    expect(game.adventure.keyThrow).toBeNull();
    expect(game.players[0]!.action).toBe("none");
  });

  it("lifts the key again from 18 px below and opens the house's door with it", () => {
    const game = carrying();
    standAt(game, 400.5, 217);
    step(game, 1, Button.Action);
    step(game, 25);
    expect(floorKey(game)?.z).toBe(0);
    // From 18 px below (145 - 127), facing it: the Action press lifts it.
    standAt(game, 400.5, 145);
    step(game, 1, Button.Action);
    expect(game.adventure.keys).toBe(1);
    step(game, KEY_LIFT_TICKS + 2);
    // The house's door (DOOR 0x83 at (384, 96)): walking up into it, the key goes.
    Object.assign(game.players[0]!, { x: 400 * SUBPX, y: 140 * SUBPX, facing: "up" });
    for (let i = 0; i < 40 && game.adventure.keys; i++) step(game, 1, Button.Up);
    expect(game.adventure.keys).toBe(0);
    expect(game.adventure.opening).not.toBeNull();
  });

  it("thrown into the house's wall it stops against it, drifts back and lands 5 px on from the wall", () => {
    const game = carrying();
    standAt(game, 400.5, 146.5);
    step(game, 1, Button.Action);
    // Its fifth tick of flight would be at y 116.5: the wall stops it at 118 (traced in Dolphin).
    step(game, 14);
    expect(floorKey(game)).toMatchObject({ x: 400.5 * SUBPX, y: 118 * SUBPX, z: 18 * SUBPX });
    // Then 0.5 px a tick back (traced: 123 on the landing's tick), the fall as before.
    step(game, 10);
    expect(floorKey(game)).toMatchObject({ x: 400.5 * SUBPX, y: 123 * SUBPX, z: 0 });
  });
});
