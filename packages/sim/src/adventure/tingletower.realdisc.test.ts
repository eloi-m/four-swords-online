// Tingle's Tower played by its scripted route (tingletower.ts) from the stage's start to its goal, milestone by
// milestone, with the four Links (skips without extracted/).
import { existsSync, readFileSync } from "node:fs";
import { decompressYaz0, Dol, isYaz0, loadActorTypes, parseBmg, parseRarc, readTileTypes, Stage } from "@fso/formats";
import { describe, expect, it } from "vitest";
import { hashGame } from "../hash.ts";
import { cloneAdventure, createAdventure, stepAdventure, type AdventureGame } from "./adventure.ts";
import { messageBook } from "./dialogue.ts";
import { RoutePlayer } from "./drive.ts";
import { GEM_QUOTA } from "./pickups.ts";
import { actorStats, AdventureStage } from "./stage.ts";
import { TINGLE_TOWER_MILESTONES } from "./tingletower.ts";
import { FLYING_STATE } from "./traps.ts";
import { Button, SUBPX } from "../player.ts";

const root = new URL("../../../../extracted/", import.meta.url);
const load = (path: string) => parseRarc(decompressYaz0(readFileSync(new URL(`files/GC4Sword_usa/${path}`, root))));

/** The room and area each milestone ends in (the river's rooms in order), and the last one's stage clear. */
const ENDS: readonly { room: number; area: number; check?: (game: AdventureGame) => boolean }[] = [
  { room: 0, area: 0 },
  { room: 1, area: 0 },
  { room: 2, area: 0, check: (g) => g.adventure.gems >= 300 },
  { room: 3, area: 0, check: (g) => g.adventure.gems >= 600 },
  { room: 4, area: 0 },
  { room: 5, area: 0 },
  { room: 6, area: 0 },
  { room: 7, area: 0 },
  { room: 8, area: 0 },
  { room: 9, area: 0 },
  { room: 10, area: 0 },
  { room: 10, area: 0, check: (g) => g.adventure.cleared > 0 && g.adventure.gems >= GEM_QUOTA },
];

describe.skipIf(!existsSync(root))("Tingle's Tower by its route", () => {
  if (!existsSync(root)) return void it.skip("needs extracted/", () => {});
  const tileTypes = readTileTypes(new Dol(readFileSync(new URL("sys/main.dol", root))));
  const stats = actorStats(loadActorTypes(load("data.arc"))!);
  const stage = new AdventureStage(new Stage(load("Boss/boss012.arc")), tileTypes, stats);
  const bmg = load("msgus.arc").files.find((f) => f.path.endsWith("_e.bmg"))!.data;
  stage.messages = messageBook(parseBmg(isYaz0(bmg) ? decompressYaz0(bmg) : bmg));
  const game = createAdventure(stage, { players: 4 });
  let snapshot: AdventureGame | null = null;
  const run = (g: AdventureGame, n: number) => {
    const player = new RoutePlayer(TINGLE_TOWER_MILESTONES[n]!.goals);
    while (!player.done) {
      const buttons = player.next(g, stage);
      if (player.done) break;
      stepAdventure(g, [buttons], stage);
    }
  };

  TINGLE_TOWER_MILESTONES.forEach((m, n) => {
    it(`${n}: ${m.name}`, () => {
      if (n === 3) snapshot = cloneAdventure(game);
      run(game, n);
      const end = ENDS[n];
      if (!end) return;
      expect([game.adventure.room, game.adventure.area]).toEqual([end.room, end.area]);
      if (end.check) expect(end.check(game)).toBe(true);
      expect(game.battle.fighters[0]!.hearts).toBeGreaterThan(0);
    });
  });

  it("is deterministic: the rest of the route played again on a clone ends in the same state", () => {
    expect(snapshot).not.toBeNull();
    const again = snapshot!;
    for (let n = 3; n < TINGLE_TOWER_MILESTONES.length; n++) run(again, n);
    expect(again.tick).toBe(game.tick);
    expect(hashGame(again)).toBe(hashGame(game));
  }, 90_000); // ~17 s alone; past 30 s when the whole suite runs in parallel
});

describe.skipIf(!existsSync(root))("Tingle's Tower room 10's flying tiles (FLYO)", () => {
  if (!existsSync(root)) return void it.skip("needs extracted/", () => {});
  const tileTypes = readTileTypes(new Dol(readFileSync(new URL("sys/main.dol", root))));
  const stage = new AdventureStage(new Stage(load("Boss/boss012.arc")), tileTypes, actorStats(loadActorTypes(load("data.arc"))!));

  it("lift on switch 16 one after the other, rise, hover and strike the leader held by the pads (traced)", () => {
    // The leader pushing up at the right pad short of the quota (Dolphin: (259.1, 73.1)), the floor switches' 16 on.
    const game = createAdventure(stage, { room: 10, x: 259, y: 74, facing: "up" });
    game.battle.switches |= 1 << 16;
    const tile = (order: number) => game.adventure.enemies.find((e) => e.type === "FLYO" && e.frame === order);
    const lifted: (number | undefined)[] = [];
    const hearts = game.battle.fighters[0]!.hearts;
    let struck = -1;
    for (let t = 1; t <= 330 && struck < 0; t++) {
      stepAdventure(game, [Button.Up], stage);
      for (const order of [0, 1]) if (lifted[order] === undefined && tile(order)?.shot === FLYING_STATE.lift) lifted[order] = t;
      if (game.battle.fighters[0]!.hearts < hearts) struck = t;
      // (Pushing up at the pad all along: its box holds him below it.)
      expect(game.players[0]!.y).toBeGreaterThanOrEqual(73 * SUBPX);
    }
    // Dolphin: counting from frame 118 (switch 16 on), lifts at 179 and 180; the second tile strikes 23 ticks into its flight
    // (291; the first broke on it at 285).
    expect(lifted).toEqual([62, 63]); // (the switch seen on tick 1, counting from it)
    expect(struck - lifted[1]! - 90).toBeGreaterThanOrEqual(20);
    expect(struck - lifted[1]! - 90).toBeLessThanOrEqual(25);
    expect(game.battle.fighters[0]!.hearts).toBe(hearts - 2);
  });
});
