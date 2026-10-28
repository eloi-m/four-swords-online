// The four-Link switch (YNSW) on Lake Hylia's real stage (skips without extracted/): room 2's cave against Dolphin
// (dolphin-adventure-four.json, from ref/adv/room2-cave5.sav: the slopes walked up, the box formation onto the switch,
// the snap and its pose; tools/dolphin fixture.ts --four), then the route's milestones 0-1 and the cave's goals with the
// spot walk bent.
import { existsSync, readFileSync } from "node:fs";
import { decompressYaz0, Dol, isYaz0, loadActorTypes, parseBmg, parseRarc, readTileTypes, Stage } from "@fso/formats";
import { describe, expect, it } from "vitest";
import { Button, SUBPX } from "../player.ts";
import { switchOn } from "../switches.ts";
import { isSolidAt } from "../world.ts";
import { cloneAdventure, createAdventure, stepAdventure, type AdventureGame } from "./adventure.ts";
import { messageBook } from "./dialogue.ts";
import { type Goal, RoutePlayer, wait, walkTo } from "./drive.ts";
import { FORMATION_BUTTONS } from "./formation.ts";
import { LAKE_HYLIA_MILESTONES } from "./lakehylia.ts";
import { FOUR_SWITCH_ON_TICK } from "./logic.ts";
import { adventureFrame, FOUR_SNAP_TICKS } from "./motion.ts";
import { actorStats, AdventureStage } from "./stage.ts";

const root = new URL("../../../../extracted/", import.meta.url);
const load = (path: string) => parseRarc(decompressYaz0(readFileSync(new URL(`files/GC4Sword_usa/${path}`, root))));

/** The door's switch (the cave's YNSW sets it; room 2's cave door opens on it). */
const DOOR_SWITCH = 16;
/** Milestone 2's goals (room 2's cave): into area 5 is goal 8, the box formation goal 15, the spot walk goal 16
 *  (lakehylia.ts). */
const INTO_CAVE = 8;
const SPOT = 16;

interface FourCase {
  name: string;
  script: string;
  frames: [x: number, y: number, spriteFrame: number, state: number][][];
}
const fixture = JSON.parse(readFileSync(new URL("./dolphin-adventure-four.json", import.meta.url), "utf8")) as { cases: FourCase[] };

/** A trace script's inputs, one a frame ("150 up; 6 c-up": the stick, the C stick's formations). */
function scriptInputs(script: string): number[] {
  const inputs: number[] = [];
  for (const seg of script.split(";").map((s) => s.trim()).filter(Boolean)) {
    const [n, label] = seg.split(/\s+/) as [string, string];
    const b = ({ up: Button.Up, down: Button.Down, left: Button.Left, right: Button.Right, "c-up": FORMATION_BUTTONS.box } as Record<string, number>)[label] ?? 0;
    for (let i = 0; i < Number(n); i++) inputs.push(b);
  }
  return inputs;
}

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

  /** Milestone 2's goals up to the spot walk, which is replaced by `spot`, then the snap's time (the door's switch is
   *  watched per tick). */
  const caveGoals = (spot: Goal): Goal[] => {
    const goals = LAKE_HYLIA_MILESTONES[2]!.goals.slice(0, SPOT + 1);
    goals[SPOT] = spot;
    return [...goals, wait(120)];
  };

  /** From the route's way into the cave, the four put where the trace starts, then its inputs: per frame the four. */
  const replayCave = () => {
    const c = fixture.cases.find((k) => k.name === "cave-switch")!;
    const game = atCave(), player = new RoutePlayer(LAKE_HYLIA_MILESTONES[2]!.goals.slice(0, INTO_CAVE + 1));
    while (!player.done) {
      const buttons = player.next(game, stage);
      if (player.done) break;
      stepAdventure(game, [buttons], stage);
    }
    for (let t = 0; t < 10; t++) stepAdventure(game, [0], stage);
    expect([game.adventure.room, game.adventure.area]).toEqual([2, 5]);
    game.players.forEach((p, i) => Object.assign(p, { x: Math.round(c.frames[0]![i]![0] * SUBPX), y: Math.round(c.frames[0]![i]![1] * SUBPX) }));
    const inputs = scriptInputs(c.script), ours: { at: number[][]; frames: number[]; door: boolean }[] = [{ at: [], frames: [], door: false }];
    for (let k = 1; k < c.frames.length; k++) {
      stepAdventure(game, [inputs[k - 1]!], stage);
      ours.push({ at: game.players.map((p) => [p.x / SUBPX, p.y / SUBPX]), frames: game.players.map((_, i) => adventureFrame(game, i)), door: switchOn(game.battle, DOOR_SWITCH) });
    }
    return { c, ours };
  };

  it("against Dolphin: the leader walking up into the slopes (types 0x0A, then 0x0B) slides along them as traced", () => {
    const { c, ours } = replayCave();
    // Up from (128, 332.5): deflected left along two 0x0A tiles, then right along a 0x0B one, to (119.1, 140.5).
    let worst = 0;
    for (let k = 1; k <= 160; k++) worst = Math.max(worst, Math.hypot(ours[k]!.at[0]![0]! - c.frames[k]![0]![0], ours[k]!.at[0]![1]! - c.frames[k]![0]![1]));
    expect(worst).toBeLessThan(0.5); // (a fifth's 0.3 px: our 1/256 px steps against Dolphin's floats)
    for (const k of [30, 60, 100, 120, 160]) {
      expect(ours[k]!.at[0]![0]).toBeCloseTo(c.frames[k]![0]![0], 1);
      expect(ours[k]!.at[0]![1]).toBeCloseTo(c.frames[k]![0]![1], 1);
    }
  });

  it("against Dolphin: the box formation is snapped round the switch's box, 2.5 px up of it, and holds the pose 95 ticks", () => {
    const { c, ours } = replayCave();
    // In the box formation (from frame 165) the four are where Dolphin has them, through the walk, the snap and the pose.
    for (let k = 165; k < c.frames.length; k++) {
      for (let i = 0; i < 4; i++) {
        expect(ours[k]!.at[i]![0], `frame ${k} Link ${i}`).toBeCloseTo(c.frames[k]![i]![0], 1);
        expect(ours[k]!.at[i]![1], `frame ${k} Link ${i}`).toBeCloseTo(c.frames[k]![i]![1], 1);
      }
    }
    // Caught at frame 286 (the bottom Links' bodies in the box since frame 280): onto (128 ± 8, 93.5 ± 8).
    const snap = c.frames.findIndex((f) => f[0]![2] === 232);
    expect(snap).toBe(286);
    expect(ours[snap]!.at).toEqual([[120, 85.5], [136, 85.5], [120, 101.5], [136, 101.5]]);
    // The pose: 232 45 ticks, 220-231 two ticks each, 232 to the end, as Dolphin's.
    for (let k = snap; k < snap + FOUR_SNAP_TICKS; k++) expect(ours[k]!.frames, `frame ${k}`).toEqual(c.frames[k]!.map((l) => l[2]));
    expect(ours[snap + FOUR_SNAP_TICKS]!.frames[0]).not.toBe(232);
    // Its switch on 79 ticks in (main.dol: as 232 comes back, 10 ticks on).
    expect(ours[snap + FOUR_SWITCH_ON_TICK - 1]!.door).toBe(false);
    expect(ours[snap + FOUR_SWITCH_ON_TICK]!.door).toBe(true);
  });

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

  it("the box formation stopping 2 px below the route's spot presses it, the four snapped onto the box's corners", () => {
    const game = atCave();
    expect(switchOn(game.battle, DOOR_SWITCH)).toBe(false);
    const pressed = play(game, caveGoals(walkTo(128, 98, 0.75)));
    expect(pressed).not.toBeNull();
    // Round the box's middle (128, 93.5): the leader top-left, then top-right, bottom-left, bottom-right (the box
    // formation's places), the pose's last sprite on by then.
    expect(pressed!.places).toEqual([[120, 85.5], [136, 85.5], [120, 101.5], [136, 101.5]]);
    expect(pressed!.frames[0]).toBe(232);
  });

  it("the box formation 6 px below the route's spot is out of the box (its bottom Links' bodies past it): no press", () => {
    const game = atCave();
    expect(play(game, caveGoals(walkTo(128, 102, 0.75)))).toBeNull();
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
