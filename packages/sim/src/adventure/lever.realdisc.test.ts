// The four-Link chain lever (lever.ts) in the Cave of No Return's room 11 (skips without extracted/; Shadow Link, room
// 4: shadowlink.realdisc.test.ts).
import { existsSync, readFileSync } from "node:fs";
import { decompressYaz0, Dol, loadActorTypes, parseRarc, readTileTypes, Stage } from "@fso/formats";
import { describe, expect, it } from "vitest";
import { Button, SUBPX, type Facing } from "../player.ts";
import { switchOn } from "../switches.ts";
import { createAdventure, currentArea, stepAdventure, type AdventureGame } from "./adventure.ts";
import { FORMATION_BUTTONS, gatherOnLeader } from "./formation.ts";
import { LEVER_BACK_SPEED, LEVER_DONE_STEP, LEVER_DONE_TICKS, LEVER_FULL, LEVER_NOTCH_SPEED, LEVER_SLIP_TICKS } from "./lever.ts";
import { actorStats, AdventureStage } from "./stage.ts";

const root = new URL("../../../../extracted/", import.meta.url);
const load = (path: string) => parseRarc(decompressYaz0(readFileSync(new URL(`files/GC4Sword_usa/${path}`, root))));

describe.skipIf(!existsSync(root))("the Cave of No Return's chain levers", () => {
  const tileTypes = readTileTypes(new Dol(readFileSync(new URL("sys/main.dol", root))));
  const stats = actorStats(loadActorTypes(load("data.arc"))!);
  const stage = new AdventureStage(new Stage(load("Boss/boss011.arc")), tileTypes, stats);
  const step = (game: AdventureGame, n = 1, buttons = 0) => {
    for (let i = 0; i < n; i++) stepAdventure(game, [buttons], stage);
  };
  /** The four in `room` at (x, y), the leader facing `facing`. */
  const start = (room: number, x: number, y: number, facing: Facing) => {
    const game = createAdventure(stage, { room, x, y, facing, players: 4 });
    // (Off the start room the others appear in the middle: stacked on the leader instead, as after a door.)
    gatherOnLeader(game);
    step(game, 2);
    return game;
  };
  /** Under room 11's east lever (switch 20), the four in the column behind the leader. */
  const underLever = () => {
    const game = start(11, 336, 41, "up");
    step(game, 1, FORMATION_BUTTONS.long);
    step(game, 20);
    return game;
  };

  it("room 11's levers: the west one's switch 21 (the heart's chest), the east one's 20 (the door north)", () => {
    const game = start(11, 256, 100, "up");
    const actors = currentArea(game, stage).actors;
    expect(game.adventure.levers.map((l) => actors.find((a) => a.index === l.actor)!.params >>> 27)).toEqual([21, 20]);
    expect(game.adventure.levers.every((l) => l.pull === 0 && l.done < 0)).toBe(true);
    expect(game.adventure.grab).toBe(-1);
  });

  it("the four in a column pull it down 40 px, crawling over each notch; its switch 94 ticks after", () => {
    const game = underLever();
    const leader = game.players[0]!, y0 = leader.y;
    step(game, 10, Button.Action | Button.Down);
    expect(game.adventure.grab).toBe(1);
    // The first notch: 0.03 px a tick (from the tick it is grabbed).
    const lever = game.adventure.levers[1]!;
    expect(lever.pull).toBe(10 * LEVER_NOTCH_SPEED);
    let ticks = 10;
    while (lever.done < 0 && ticks < 1000) {
      step(game, 1, Button.Action | Button.Down);
      ticks++;
    }
    expect(lever.pull).toBe(LEVER_FULL);
    // Four notches of ~67 ticks, 34 px at 0.5 px a tick.
    expect(ticks).toBeGreaterThan(330);
    expect(ticks).toBeLessThan(350);
    expect(leader.y - y0).toBe(40 * SUBPX);
    expect(switchOn(game.battle, 20)).toBe(false);
    step(game, LEVER_DONE_TICKS - 1, Button.Action | Button.Down);
    expect(switchOn(game.battle, 20)).toBe(false);
    step(game, 1, Button.Action | Button.Down);
    expect(switchOn(game.battle, 20)).toBe(true);
    expect(switchOn(game.battle, 21)).toBe(false);
  });

  it("fewer than four holding it, it doesn't move; let go, it goes back up", () => {
    // The leader alone (the others trailing, not in the column).
    const alone = start(11, 336, 41, "up");
    step(alone, 60, Button.Action | Button.Down);
    expect(alone.adventure.grab).toBe(1);
    expect(alone.adventure.levers[1]!.pull).toBe(0);
    // Pulled a while by the four, then let go.
    const game = underLever();
    step(game, 120, Button.Action | Button.Down);
    const pulled = game.adventure.levers[1]!.pull;
    expect(pulled).toBeGreaterThan(1000);
    step(game, 4);
    expect(game.adventure.grab).toBe(-1);
    expect(game.adventure.levers[1]!.pull).toBe(pulled - 4 * LEVER_BACK_SPEED);
  });

  it("the grab: from 41 px under the east lever, not from 42 (measured: 41.5 grabs, 42 doesn't)", () => {
    for (const [y, grab] of [[41, 1], [42, -1]] as const) {
      const game = start(11, 336, y, "up");
      step(game, 2, Button.Action);
      expect(game.adventure.grab).toBe(grab);
    }
  });

  it("Down let go while holding a pulled lever: it goes back up dragging the leader, who lets go on its 3rd tick", () => {
    const game = underLever();
    step(game, 120, Button.Action | Button.Down);
    const lever = game.adventure.levers[1]!, leader = game.players[0]!;
    const pulled = lever.pull, y0 = leader.y;
    step(game, LEVER_SLIP_TICKS - 1, Button.Action);
    expect(game.adventure.grab).toBe(1);
    expect(lever.pull).toBe(pulled - (LEVER_SLIP_TICKS - 1) * LEVER_BACK_SPEED);
    expect(leader.y).toBeLessThan(y0);
    step(game, 1, Button.Action);
    expect(game.adventure.grab).toBe(-1);
  });

  it("pulled full: the four step back 7 px the next tick, hold on whatever the pad, and let go with its switch", () => {
    const game = underLever();
    const lever = game.adventure.levers[1]!, leader = game.players[0]!;
    for (let t = 0; lever.done < 0 && t < 1000; t++) step(game, 1, Button.Action | Button.Down);
    const y0 = leader.y;
    step(game, 1);
    expect(leader.y - y0).toBe(LEVER_DONE_STEP * SUBPX);
    step(game, LEVER_DONE_TICKS - 2);
    expect(game.adventure.grab).toBe(1);
    expect(switchOn(game.battle, 20)).toBe(false);
    step(game, 1, Button.Action | Button.Down);
    expect(switchOn(game.battle, 20)).toBe(true);
    expect(game.adventure.grab).toBe(-1);
    // Then it goes back up.
    step(game, 1, Button.Action | Button.Down);
    expect(lever.pull).toBe(LEVER_FULL - LEVER_BACK_SPEED);
  });
});
