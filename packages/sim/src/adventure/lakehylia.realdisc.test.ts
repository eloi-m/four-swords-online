// Lake Hylia played by its scripted route (lakehylia.ts) from the stage's start, milestone by milestone, with the four
// Links to the goal: each milestone must end where it says (skips without extracted/). The same route runs in the browser
// (tools/e2e/src/game.ts, window.fso.route).
import { existsSync, readFileSync } from "node:fs";
import { decompressYaz0, Dol, isYaz0, loadActorTypes, parseBmg, parseRarc, readTileTypes, Stage } from "@fso/formats";
import { describe, expect, it } from "vitest";
import { hashGame } from "../hash.ts";
import { cloneAdventure, createAdventure, stepAdventure, type AdventureGame } from "./adventure.ts";
import { messageBook } from "./dialogue.ts";
import { RoutePlayer } from "./drive.ts";
import { LAKE_HYLIA_MILESTONES } from "./lakehylia.ts";
import { savedSwitches } from "./logic.ts";
import { actorStats, AdventureStage } from "./stage.ts";

const root = new URL("../../../../extracted/", import.meta.url);
const load = (path: string) => parseRarc(decompressYaz0(readFileSync(new URL(`files/GC4Sword_usa/${path}`, root))));

/** Where each milestone ends: the room and area, and what the Links have by then (the Force Gems with a margin: a gem
 *  rain's gems and the enemies' drops are rolled, RYRN's types 2 / 1 / 0 and the drop classes, so the count moves
 *  with every change upstream: room 4's rain gave 140-210 in the runs seen, room 5's ambush 314-356). */
const ENDS: readonly { room: number; area: number; gear?: string; check?: (game: AdventureGame) => boolean }[] = [
  { room: 2, area: 0 },
  { room: 2, area: 0, check: (g) => g.adventure.rocks.some((r) => r.type === "RCK3" && r.state === "sunk") },
  { room: 3, area: 0, gear: "boomerang" },
  { room: 3, area: 0, gear: "fireRod" },
  { room: 3, area: 0, gear: "fireRod", check: (g) => g.adventure.burnt.length >= 6 },
  { room: 5, area: 0, check: (g) => g.adventure.links[0]!.mode === "swim" && ((g.battle.switches >>> 16) & 1) === 0 && g.adventure.gems >= 100 },
  { room: 7, area: 0, check: (g) => g.adventure.gems >= 300 },
  { room: 58, area: 0, check: (g) => g.adventure.gems >= 400 },
  // Room 58's caves: the right-hand cave's way out, the four together again (Y from another area).
  { room: 58, area: 0, check: (g) => g.adventure.gems >= 500 && g.adventure.formation === "trail" && g.players[0]!.x > 380 * 256 },
  // (Room 58's big gem waits for switch 18, its enemies beaten: its Zora, which the route leaves.)
  { room: 6, area: 6, check: (g) => g.adventure.gems >= 900 },
  { room: 6, area: 0, check: (g) => g.adventure.gems >= 1000 && ((g.battle.switches >>> 16) & 1) === 1 },
  { room: 6, area: 0, check: (g) => g.players[0]!.x < 100 * 256 },
  { room: 9, area: 0, check: (g) => g.adventure.gems >= 1300 && ((savedSwitches(g, 5) >>> 16) & 1) === 1 },
  // The goal: the quota met, the stage cleared.
  { room: 10, area: 0, check: (g) => g.adventure.gems >= 2000 && g.adventure.cleared > 0 },
];

describe.skipIf(!existsSync(root))("Lake Hylia by its route", () => {
  if (!existsSync(root)) return void it.skip("needs extracted/", () => {});
  const tileTypes = readTileTypes(new Dol(readFileSync(new URL("sys/main.dol", root))));
  const stats = actorStats(loadActorTypes(load("data.arc"))!);
  const stage = new AdventureStage(new Stage(load("Boss/boss010.arc")), tileTypes, stats);
  // The signs and villagers talk, as in the browser (dialogue.ts): the route must not open one by chance.
  const bmg = load("msgus.arc").files.find((f) => f.path.endsWith("_e.bmg"))!.data;
  stage.messages = messageBook(parseBmg(isYaz0(bmg) ? decompressYaz0(bmg) : bmg));
  const game = createAdventure(stage, { players: 4 });
  let snapshot: AdventureGame | null = null;
  // Ticks a Link was out of hearts (dying, or dead: the sim gets them up again where they came in, adventure.ts revive),
  // and the goals they fell in.
  let downed = 0;
  const downAt = new Map<string, number>();
  const run = (g: AdventureGame, n: number) => {
    const player = new RoutePlayer(LAKE_HYLIA_MILESTONES[n]!.goals);
    while (!player.done) {
      const buttons = player.next(g, stage);
      if (player.done) break;
      stepAdventure(g, [buttons], stage);
      if (g.battle.fighters.some((f) => f.hearts <= 0 || f.mode === "dying" || f.mode === "dead")) {
        downed++;
        downAt.set(player.current, (downAt.get(player.current) ?? 0) + 1);
      }
    }
  };

  LAKE_HYLIA_MILESTONES.forEach((m, n) => {
    it(`${n}: ${m.name}`, () => {
      // Before the cave, a copy to play the rest of the route on again (determinism through clones).
      if (n === 2) snapshot = cloneAdventure(game);
      run(game, n);
      const end = ENDS[n];
      if (!end) return;
      expect([game.adventure.room, game.adventure.area]).toEqual([end.room, end.area]);
      if (end.gear) expect(game.adventure.gear).toBe(end.gear);
      if (end.check) expect(end.check(game)).toBe(true);
      expect(game.battle.fighters[0]!.hearts).toBeGreaterThan(0);
    });
  });

  it("the fights played without a Link out of hearts (the ticks counted over the whole route)", () => {
    expect(downed, JSON.stringify([...downAt])).toBe(0);
  });

  it("is deterministic: the rest of the route played again on a clone ends in the same state", () => {
    expect(snapshot).not.toBeNull();
    const again = snapshot!;
    for (let n = 2; n < LAKE_HYLIA_MILESTONES.length; n++) run(again, n);
    expect(again.tick).toBe(game.tick);
    expect(hashGame(again)).toBe(hashGame(game));
  });
});
