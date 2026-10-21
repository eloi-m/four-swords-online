// Lake Hylia's puzzles for one player with the four Links, against Dolphin traces (docs/measurements/adventure-lake-hylia.md "Adventure:
// room 58's caves, the raft, area 7"; skips without extracted/): room 58 played as its alone variant (room 8), the
// middle room's four switches held by the Links apart (switch 16 for good), the one in control leaving the area alone
// and Y bringing the others from there, and the side views' walk off a ledge and off a ladder.
import { existsSync, readFileSync } from "node:fs";
import { decompressYaz0, Dol, loadActorTypes, parseRarc, readTileTypes, Stage } from "@fso/formats";
import { describe, expect, it } from "vitest";
import { Button, SUBPX } from "../player.ts";
import { AWAY_PX, createAdventure, stepAdventure, type AdventureGame } from "./adventure.ts";
import { goTo, holdUntil, RoutePlayer, travelTo, type Goal } from "./drive.ts";
import { GATHER_BUTTON, SEPARATE_BUTTON, selectButtons } from "./formation.ts";
import { actorStats, AdventureStage } from "./stage.ts";

const root = new URL("../../../../extracted/", import.meta.url);
const load = (path: string) => parseRarc(decompressYaz0(readFileSync(new URL(`files/GC4Sword_usa/${path}`, root))));

describe.skipIf(!existsSync(root))("the Links apart and Lake Hylia's caves like the game", () => {
  const tileTypes = readTileTypes(new Dol(readFileSync(new URL("sys/main.dol", root))));
  const stats = actorStats(loadActorTypes(load("data.arc"))!);
  const stage = new AdventureStage(new Stage(load("Boss/boss010.arc")), tileTypes, stats);
  const play = (game: AdventureGame, goals: readonly Goal[]) => {
    const player = new RoutePlayer(goals);
    for (;;) {
      const buttons = player.next(game, stage);
      if (player.done) return;
      stepAdventure(game, [buttons], stage);
    }
  };
  const at = (game: AdventureGame, i: number) => [game.players[i]!.x / SUBPX, game.players[i]!.y / SUBPX];
  const step = (game: AdventureGame, buttons: number, ticks = 1) => {
    for (let t = 0; t < ticks; t++) stepAdventure(game, [buttons], stage);
  };

  it("plays room 58 as room 8 alone: switch 17's floor switch this side of its pit, no four-player switches", () => {
    const area = stage.area(58, 5);
    const switches = area.actors.filter((a) => a.id === "SWTH").map((a) => [a.x, a.y, a.params >>> 27]);
    expect(switches).toContainEqual([304, 192, 17]);
    expect(switches.some(([, , n]) => n! >= 5 && n! <= 8)).toBe(false);
    expect(area.actors.some((a) => a.id === "SWT4" && a.params >>> 27 === 18)).toBe(false);
  });

  // `room58-four` (t4): the four apart on the middle room's switches turn switch 16 on (the bridge west); a Link
  // handed the controls off a switch leaves the one before standing on its middle; one stepping off later (t6) leaves
  // the bridge there. `t7`, `t8`: the one in control goes out through the door alone; Y there brings the others on him
  // the next tick.
  it("holds the middle room's four switches with the Links apart, then leaves them there and calls them back", () => {
    const game = createAdventure(stage, { room: 58, x: 104, y: 344, players: 4 });
    play(game, [travelTo(272, 60), goTo(Button.Up, 58, 5), travelTo(240, 240)]);
    step(game, SEPARATE_BUTTON);
    step(game, 0, 4);
    const spots = [[216, 216], [264, 216], [216, 264], [264, 264]] as const;
    for (const [k, [x, y]] of spots.entries()) {
      if (k > 0) {
        // The next one not on a switch (by tunic: slot k holds whoever was handed over last).
        const color = game.adventure.colors[game.players.findIndex((p, i) => i > 0 && !spots.slice(0, k).some(([sx, sy]) => p.x === sx * SUBPX && p.y === sy * SUBPX))]!;
        step(game, selectButtons(color));
        step(game, 0, 4);
      }
      play(game, [travelTo(x, y, { tol: 1 })]);
    }
    step(game, 0, 2);
    expect((game.battle.switches >>> 16) & 1).toBe(1);
    // The others were put on their switches' middles.
    for (let i = 1; i < 4; i++) expect(spots.map(([x, y]) => `${x},${y}`)).toContain(at(game, i).join(","));
    play(game, [travelTo(240, 290)]);
    step(game, 0, 30);
    expect((game.battle.switches >>> 16) & 1).toBe(1);
    // Out alone: the others stay in area 5 (parked out of the way), Y brings them.
    play(game, [travelTo(240, 470), goTo(Button.Down, 58, 0)]);
    expect(game.adventure.away).toMatchObject({ room: 58, area: 5 });
    expect(at(game, 1)).toEqual([AWAY_PX, AWAY_PX]);
    step(game, GATHER_BUTTON);
    for (let i = 1; i < 4; i++) expect(at(game, i)).toEqual(at(game, 0));
    expect(game.adventure.formation).toBe("trail");
  });

  // Lake Hylia room 5's north bank: the bushes cut over three followers' switches (tiles 113-115, x 280-312 at y 56).
  // The one in control walks off west into room 9 and back with them left apart in room 5: the bushes stay cut (the
  // room they're left in keeps them, away.cut), where a regrown bush under a Link would put him in a wall. Not checked
  // in Dolphin (the room the Links apart are left in, its other things: enemies and generators reload as before).
  it("keeps the bushes cut in a room the Links apart are left in, when the one in control comes back", () => {
    const game = createAdventure(stage, { room: 5, x: 24, y: 72, players: 4 });
    const cut = [113, 114, 115];
    expect(cut.every((t) => stage.area(5, 0).props.bushes.includes(t))).toBe(true);
    game.battle.cut.push(...cut);
    game.adventure.formation = "apart";
    [[280, 56], [296, 56], [312, 56]].forEach(([x, y], k) => Object.assign(game.players[k + 1]!, { x: x! * SUBPX, y: y! * SUBPX }));
    play(game, [goTo(Button.Left, 9)]);
    expect(game.adventure.away).toMatchObject({ room: 5, area: 0 });
    play(game, [goTo(Button.Right, 5)]);
    expect(game.adventure.away).toBeNull();
    expect(game.battle.cut).toEqual(cut);
    expect([1, 2, 3].map((i) => at(game, i))).toEqual([[280, 56], [296, 56], [312, 56]]);
  });

  // `t10` (room 7's area 5, walking right off the ledge into the cannon's pit): from the last x he stood at, 3.3 / 2.2,
  // 2.4 / 3.1, 2.0 / 4.0, then 1.5 / 4 a tick. `t11` (halfway down its ladder, Right): walking speed off it, hanging on
  // while his body is over its column (to x 69.8), falling 4 px a tick from x 71.3.
  it("walks off a side view's ledge in an arc and off a ladder hanging on", () => {
    const game = createAdventure(stage, { room: 7, x: 96, y: 290 });
    play(game, [holdUntil("into the lower cave", Button.Up, (g) => g.adventure.area === 5 && !g.adventure.warp, 300)]);
    step(game, 0, 60);
    // Where the trace stood two steps before the edge (the sim walks over the ladder's top on the way without the
    // game's 3.3 px step there).
    game.players[0]!.x = Math.round(92.3 * SUBPX);
    const path: number[][] = [at(game, 0)];
    for (let t = 0; t < 60 && game.adventure.links[0]!.mode === "walk"; t++) {
      step(game, Button.Right);
      path.push(at(game, 0));
    }
    const d = (i: number) => [path[i]![0]! - path[i - 1]![0]!, path[i]![1]! - path[i - 1]![1]!].map((v) => Math.round(v * 10) / 10);
    // (The first tick turns him.)
    expect(path.slice(1, 8).map((_, i) => d(i + 1))).toEqual([[0, 0], [1.5, 0], [1.5, 0], [3.3, 2.2], [2.4, 3.1], [2, 4], [1.5, 4]]);

    const ladder = createAdventure(stage, { room: 7, x: 96, y: 290 });
    play(ladder, [holdUntil("into the lower cave", Button.Up, (g) => g.adventure.area === 5 && !g.adventure.warp, 300)]);
    step(ladder, 0, 60);
    play(ladder, [holdUntil("onto the ladder", Button.Right, (g) => g.players[0]!.x >= 56 * SUBPX, 60), holdUntil("down it", Button.Down, (g) => g.players[0]!.y >= 405 * SUBPX, 60)]);
    const y0 = ladder.players[0]!.y;
    const hang: number[][] = [];
    for (let t = 0; t < 14; t++) {
      step(ladder, Button.Right);
      hang.push([ladder.players[0]!.x / SUBPX, (ladder.players[0]!.y - y0) / SUBPX]);
    }
    // Hanging on (the game nudged him 1 px down at x 65.3, the sim 2 px: its corner sliding), then 4 px a tick.
    for (const [x, dy] of hang) if (x! - 7 < 64) expect(dy, `at x ${x}`).toBeLessThanOrEqual(2);
    const k = hang.findIndex(([x]) => x! - 7 >= 64);
    expect(hang[k]![1]! - hang[k - 1]![1]!).toBe(4);
  });
});
