// The Cave of No Return played by its scripted route (cavenoreturn.ts) from the stage's start, milestone by milestone,
// with the four Links: each milestone must end where it says (skips without extracted/).
import { existsSync, readFileSync } from "node:fs";
import { decompressYaz0, Dol, isYaz0, loadActorTypes, parseBmg, parseRarc, readTileTypes, Stage } from "@fso/formats";
import { describe, expect, it } from "vitest";
import { hashGame } from "../hash.ts";
import { cloneAdventure, createAdventure, stepAdventure, type AdventureGame } from "./adventure.ts";
import { CAVE_OF_NO_RETURN_MILESTONES } from "./cavenoreturn.ts";
import { messageBook } from "./dialogue.ts";
import { RoutePlayer } from "./drive.ts";
import { savedSwitches } from "./logic.ts";
import { GEM_QUOTA } from "./pickups.ts";
import { actorStats, AdventureStage } from "./stage.ts";

const root = new URL("../../../../extracted/", import.meta.url);
const load = (path: string) => parseRarc(decompressYaz0(readFileSync(new URL(`files/GC4Sword_usa/${path}`, root))));

/** Where each milestone ends: the room and area, and what the Links have by then. */
const ENDS: readonly { room: number; area: number; gear?: string; check?: (game: AdventureGame) => boolean }[] = [
  { room: 6, area: 0 },
  { room: 7, area: 0, gear: "lamp" },
  { room: 13, area: 0, check: (g) => g.adventure.keys === 0 },
  // Room 13's five blocks all pushed (each goes once), the key used on the door east.
  { room: 0, area: 0, check: (g) => g.adventure.keys === 0 && g.adventure.sunk.length === 5 * 4 },
  // Through room 0's color blocks alone, the others called after; the lamp still held (room 0's pedestal draws it).
  { room: 2, area: 0, gear: "lamp", check: (g) => g.adventure.formation !== "apart" && !g.adventure.away },
  { room: 1, area: 0 },
  { room: 9, area: 0, check: (g) => g.adventure.keys === 1 },
  // Into room 3 alone with the bow from room 8's island (room 9's cell played alone), the others left in room 9.
  { room: 3, area: 0, gear: "bow", check: (g) => g.adventure.keys === 0 && g.adventure.away?.room === 9 },
  // Room 3's four candles, its crystal (the bridge) and its Keese all beaten (the door north), the others called.
  // (The crystal struck again for the winged gems: the bridge, switch 16, is gone.)
  { room: 11, area: 0, gear: "bow", check: (g) => [19, 21].every((n) => (savedSwitches(g, 3) >>> n) & 1) && !g.adventure.away && g.adventure.gems >= 1500 },
  // Room 11's two chain levers pulled (the heart's chest, the door north), its four chests.
  { room: 4, area: 0, check: (g) => [20, 21].every((n) => (savedSwitches(g, 11) >>> n) & 1) && g.adventure.opened.length >= 5 },
  // Shadow Link beaten (the door north), the others called.
  { room: 5, area: 0, check: (g) => ((savedSwitches(g, 4) >>> 16) & 1) === 1 && g.adventure.formation === "trail" },
  // On the goal with the quota: cleared.
  { room: 5, area: 0, check: (g) => g.adventure.cleared > 0 && g.adventure.gems >= GEM_QUOTA },
];

describe.skipIf(!existsSync(root))("the Cave of No Return by its route", () => {
  if (!existsSync(root)) return void it.skip("needs extracted/", () => {});
  const tileTypes = readTileTypes(new Dol(readFileSync(new URL("sys/main.dol", root))));
  const stats = actorStats(loadActorTypes(load("data.arc"))!);
  const stage = new AdventureStage(new Stage(load("Boss/boss011.arc")), tileTypes, stats);
  const bmg = load("msgus.arc").files.find((f) => f.path.endsWith("_e.bmg"))!.data;
  stage.messages = messageBook(parseBmg(isYaz0(bmg) ? decompressYaz0(bmg) : bmg));
  const game = createAdventure(stage, { players: 4 });
  let snapshot: AdventureGame | null = null;
  const run = (g: AdventureGame, n: number) => {
    const player = new RoutePlayer(CAVE_OF_NO_RETURN_MILESTONES[n]!.goals);
    while (!player.done) {
      const buttons = player.next(g, stage);
      if (player.done) break;
      stepAdventure(g, [buttons], stage);
    }
  };

  CAVE_OF_NO_RETURN_MILESTONES.forEach((m, n) => {
    it(`${n}: ${m.name}`, () => {
      if (n === 1) snapshot = cloneAdventure(game);
      run(game, n);
      const end = ENDS[n];
      if (!end) return;
      expect([game.adventure.room, game.adventure.area]).toEqual([end.room, end.area]);
      if (end.gear) expect(game.adventure.gear).toBe(end.gear);
      if (end.check) expect(end.check(game)).toBe(true);
      expect(game.battle.fighters[0]!.hearts).toBeGreaterThan(0);
    });
  });

  it("is deterministic: the rest of the route played again on a clone ends in the same state", () => {
    expect(snapshot).not.toBeNull();
    const again = snapshot!;
    for (let n = 1; n < CAVE_OF_NO_RETURN_MILESTONES.length; n++) run(again, n);
    expect(again.tick).toBe(game.tick);
    expect(hashGame(again)).toBe(hashGame(game));
  }, 60_000); // (slow when the machine is busy)
});
