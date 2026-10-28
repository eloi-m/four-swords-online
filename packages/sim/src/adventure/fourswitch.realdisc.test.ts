// The four-Link switch (YNSW) on Lake Hylia's real stage (skips without extracted/): the box formation walking up onto
// room 2's cave switch, the route's milestones 0-1 first, then the cave's goals with the spot walk bent. The capture
// playtest-bent-cave-switch-y-3-px: the leader stopped 3.75 px below the spot the route walks to (y 100), so the far
// Links stood 15.75 px off the switch's middle, past the ±15 box, and the switch missed.
import { existsSync, readFileSync } from "node:fs";
import { decompressYaz0, Dol, isYaz0, loadActorTypes, parseBmg, parseRarc, readTileTypes, Stage } from "@fso/formats";
import { describe, expect, it } from "vitest";
import { Button, SUBPX } from "../player.ts";
import { switchOn } from "../switches.ts";
import { isSolidAt } from "../world.ts";
import { cloneAdventure, createAdventure, stepAdventure, type AdventureGame } from "./adventure.ts";
import { messageBook } from "./dialogue.ts";
import { type Goal, RoutePlayer, walkTo } from "./drive.ts";
import { LAKE_HYLIA_MILESTONES } from "./lakehylia.ts";
import { adventureFrame } from "./motion.ts";
import { actorStats, AdventureStage } from "./stage.ts";

const root = new URL("../../../../extracted/", import.meta.url);
const load = (path: string) => parseRarc(decompressYaz0(readFileSync(new URL(`files/GC4Sword_usa/${path}`, root))));

/** The door's switch (the cave's YNSW sets it; room 2's cave door opens on it). */
const DOOR_SWITCH = 16;
/** Milestone 2's goals (room 2's cave): the box formation is goal 15, the spot walk goal 16 (lakehylia.ts). */
const SPOT = 16;

describe.skipIf(!existsSync(root))("Lake Hylia's four-Link switch in room 2's cave", () => {
  if (!existsSync(root)) return void it.skip("needs extracted/", () => {});
  const tileTypes = readTileTypes(new Dol(readFileSync(new URL("sys/main.dol", root))));
  const stats = actorStats(loadActorTypes(load("data.arc"))!);
  const stage = new AdventureStage(new Stage(load("Boss/boss010.arc")), tileTypes, stats);
  const bmg = load("msgus.arc").files.find((f) => f.path.endsWith("_e.bmg"))!.data;
  stage.messages = messageBook(parseBmg(isYaz0(bmg) ? decompressYaz0(bmg) : bmg));

  /** The four Links after milestones 0 and 1 (the boulder), at the start of room 2's cave milestone. */
  let base: AdventureGame | null = null;
  const atCave = (): AdventureGame => {
    if (!base) {
      const g = createAdventure(stage, { players: 4 });
      for (const n of [0, 1]) {
        const player = new RoutePlayer(LAKE_HYLIA_MILESTONES[n]!.goals);
        while (!player.done) {
          const buttons = player.next(g, stage);
          if (player.done) break;
          stepAdventure(g, [buttons], stage);
        }
      }
      base = g;
    }
    return cloneAdventure(base);
  };

  /** Milestone 2's goals up to the spot walk, which is replaced by `spot` (the door's switch is watched per tick). */
  const caveGoals = (spot: Goal): Goal[] => {
    const goals = LAKE_HYLIA_MILESTONES[2]!.goals.slice(0, SPOT + 1);
    goals[SPOT] = spot;
    return goals;
  };

  /** Plays the goals; the tick the door's switch turns on, the four Links' places and sprites (null: it never did). */
  const play = (game: AdventureGame, goals: Goal[]) => {
    const player = new RoutePlayer(goals);
    let pressed: { places: number[][]; frames: number[] } | null = null;
    while (!player.done) {
      const buttons = player.next(game, stage);
      if (player.done) break;
      stepAdventure(game, [buttons], stage);
      if (!pressed && switchOn(game.battle, DOOR_SWITCH)) {
        pressed = {
          places: game.players.map((p) => [p.x / SUBPX, p.y / SUBPX]),
          frames: game.players.map((_, i) => adventureFrame(game, i)),
        };
      }
    }
    return pressed;
  };

  it("the box formation arriving 3.75 px below the switch presses it, the four snapped onto their quarters", () => {
    const game = atCave();
    expect(switchOn(game.battle, DOOR_SWITCH)).toBe(false);
    const pressed = play(game, caveGoals(walkTo(128, 103, 0.75)));
    expect(pressed).not.toBeNull();
    // The quarters' middles round the switch's middle (136, 104): the leader top-left, then top-right, bottom-left,
    // bottom-right (the box formation's places).
    expect(pressed!.places).toEqual([[128, 96], [144, 96], [128, 112], [144, 112]]);
    expect(pressed!.frames[0]).toBe(224);
  });

  it("the box formation 6 px below the switch is out of its catch: no press", () => {
    const game = atCave();
    expect(play(game, caveGoals(walkTo(128, 106, 0.75)))).toBeNull();
    expect(switchOn(game.battle, DOOR_SWITCH)).toBe(false);
  });

  // The black-box playtest's capture 20261018-165142-749 took the switch for a push block the Links walked through: it
  // is floor (drawn at floor depth, no box of its own), and the line formation walking right over it doesn't press it.
  it("is floor: the line formation walks right over it, unpressed", () => {
    const game = atCave();
    play(game, [...LAKE_HYLIA_MILESTONES[2]!.goals.slice(0, SPOT - 1), walkTo(120, 102), walkTo(184, 102)]);
    expect(game.adventure.formation).toBe("trail");
    expect(game.players[0]!.x / SUBPX).toBeGreaterThan(180);
    expect(game.players.every((p) => !isSolidAt(stage.area(2, 5).world, p.x / SUBPX, p.y / SUBPX))).toBe(true);
    expect(switchOn(game.battle, DOOR_SWITCH)).toBe(false);
  });
});

// The other one, room 4's (YNSW at (320, 144), its gem rain): the same playtest's capture 20261018-165434-121 took it
// for a big stone block the line walked through (and its fourth Link, blinking after an Octorok's rock, for one drawn
// under it).
describe.skipIf(!existsSync(root))("Lake Hylia's four-Link switch in room 4", () => {
  if (!existsSync(root)) return void it.skip("needs extracted/", () => {});
  const tileTypes = readTileTypes(new Dol(readFileSync(new URL("sys/main.dol", root))));
  const stage = new AdventureStage(new Stage(load("Boss/boss010.arc")), tileTypes, actorStats(loadActorTypes(load("data.arc"))!));

  it("is floor: the leader walks right across it", () => {
    const game = createAdventure(stage, { room: 4, x: 280, y: 148, players: 4, facing: "right" });
    expect(isSolidAt(stage.area(4).world, 320, 144)).toBe(false);
    for (let t = 0; t < 40; t++) stepAdventure(game, [Button.Right], stage);
    expect(game.players[0]!.x / SUBPX).toBeGreaterThan(336);
  });
});
