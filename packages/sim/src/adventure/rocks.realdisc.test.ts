// A two-Link rock in Lake Hylia's house back room (skips without extracted/): who lifts it (main.dol's RCK2: the two Links
// nearest it whose lift points are on it, side by side or not), the box formation walking into it as one (no Link left
// stacked on another: a capture of the user's had the pair lift it as one Link on screen), and the carry: the pair walks
// together (a lifter held by a wall holds the leader, and the leader can walk back to him), and the rock doesn't leave its
// area through the house's door (rocks.ts, the carry; not checked in Dolphin).
import { existsSync, readFileSync } from "node:fs";
import { decompressYaz0, Dol, loadActorTypes, parseRarc, readTileTypes, Stage } from "@fso/formats";
import { describe, expect, it } from "vitest";
import { Button, SUBPX } from "../player.ts";
import { createAdventure, enterArea, stepAdventure, type AdventureGame } from "./adventure.ts";
import { FORMATION_BUTTONS, FORMATION_SLOTS } from "./formation.ts";
import { tryHeavyLift } from "./rocks.ts";
import { actorStats, AdventureStage } from "./stage.ts";

const root = new URL("../../../../extracted/", import.meta.url);
const load = (path: string) => parseRarc(decompressYaz0(readFileSync(new URL(`files/GC4Sword_usa/${path}`, root))));

describe.skipIf(!existsSync(root))("the two-Link rock carried in the house's back room", () => {
  if (!existsSync(root)) return void it.skip("needs extracted/", () => {});
  const tileTypes = readTileTypes(new Dol(readFileSync(new URL("sys/main.dol", root))));
  const stats = actorStats(loadActorTypes(load("data.arc"))!);
  const stage = new AdventureStage(new Stage(load("Boss/boss010.arc")), tileTypes, stats);
  /** How far (1/256 px) the leader's walk may open the gap to a lifter's place (rocks.ts CARRY_SLACK). */
  const SLACK = 2 * SUBPX;
  const at = (game: AdventureGame, i: number): [number, number] => [game.players[i]!.x, game.players[i]!.y];
  const walk = (game: AdventureGame, buttons: number, ticks: number) => {
    for (let t = 0; t < ticks; t++) stepAdventure(game, [buttons], stage);
  };

  // Room 3's area 3 (the back room): the two Links in a column west of its rock (176, 96), facing it, lift it; carried.
  const carried = (): AdventureGame => {
    const game = createAdventure(stage, { room: 3, players: 2, x: 154, y: 92, facing: "right", hearts: 20 });
    enterArea(game, stage, 3, 3, 0, 0);
    Object.assign(game.players[0]!, { x: 154 * SUBPX, y: 92 * SUBPX, facing: "right" });
    Object.assign(game.players[1]!, { x: 154 * SUBPX, y: 108 * SUBPX, facing: "right" });
    game.adventure.formation = "long";
    expect(tryHeavyLift(game, Button.Action)).toBe(true);
    for (let t = 0; t < 200 && game.adventure.heavy?.phase !== "carry"; t++) walk(game, 0, 1);
    expect(game.adventure.heavy?.phase).toBe("carry");
    return game;
  };

  const backRoom = (players: number): AdventureGame => {
    const game = createAdventure(stage, { room: 3, players, x: 120, y: 95, facing: "right", hearts: 20 });
    enterArea(game, stage, 3, 3, 0, 0);
    return game;
  };
  const place = (game: AdventureGame, i: number, x: number, y: number) => Object.assign(game.players[i]!, { x: x * SUBPX, y: y * SUBPX, facing: "right" });

  it("two Links side by side facing it, their lift points on it, lift it together", () => {
    const game = backRoom(2);
    place(game, 0, 154, 92);
    place(game, 1, 154, 108);
    expect(tryHeavyLift(game, Button.Action)).toBe(true);
    expect(game.adventure.heavy?.lifters).toBe(0b11);
  });

  it("one Link alone does nothing; a second whose lift point is off its 32 px square doesn't help", () => {
    const game = backRoom(2);
    place(game, 0, 154, 92);
    place(game, 1, 154, 114); // lift point at y 114: past the square's [80, 112)
    expect(tryHeavyLift(game, Button.Action)).toBe(false);
    expect(game.adventure.heavy).toBeNull();
  });

  it("two Links stacked on one spot facing it lift it: RCK2 asks nothing of their gap (main.dol 0x8034CEB0)", () => {
    // What the rock itself allows; the formation's walk is what keeps the four from stacking there (the next case).
    const game = backRoom(2);
    place(game, 0, 154.9, 94.8);
    place(game, 1, 154.9, 94.8);
    expect(tryHeavyLift(game, Button.Action)).toBe(true);
    expect(game.adventure.heavy?.lifters).toBe(0b11);
  });

  it("the box formation walking right into it stops as one where its second Link meets it: the leader isn't stacked on him", () => {
    // The capture's walk (20261018-191449-634-game, tick ~10590): the box from (138.4, 94.8), right into the rock.
    const game = backRoom(4);
    game.adventure.formation = "box";
    FORMATION_SLOTS.box.forEach(([ox, oy], k) => place(game, k + 1, 138.4 + ox, 94.8 + oy));
    place(game, 0, 138.4, 94.8);
    walk(game, Button.Right, 60);
    const [lx] = at(game, 0), [rx, ry] = at(game, 1);
    // The second Link stopped against the rock's left side (x 162); the leader 16 px behind him, not on him.
    expect(rx).toBeLessThan(162 * SUBPX);
    expect(rx - lx).toBe(16 * SUBPX);
    expect(at(game, 0)[1]).toBe(ry);
    // Action: the two whose lift points are on it, the second and fourth Links (the leader's falls short of it), lift it.
    walk(game, Button.Right | Button.Action, 1);
    expect(game.adventure.heavy?.lifters).toBe(0b1010);
    for (let t = 0; t < 200 && game.adventure.heavy?.phase !== "carry"; t++) walk(game, 0, 1);
    expect(game.adventure.heavy?.phase).toBe("carry");
    expect(new Set(game.players.map((p) => `${p.x},${p.y}`)).size).toBe(4);
  });

  it("a lifter held by a wall holds the leader: he walks no farther from him than the carry allows, and walks back to him", () => {
    const game = carried();
    // West along the column, the second Link (his place: 16 px south of the leader) stops at a wall at x 149: the leader
    // stands with him (and would have walked on to x 87 alone).
    walk(game, Button.Left, 80);
    const [lx, ly] = at(game, 0), [mx, my] = at(game, 1);
    expect(Math.abs(mx - lx)).toBeLessThanOrEqual(SLACK);
    expect(my - ly).toBeLessThanOrEqual(16 * SUBPX + SLACK);
    expect(lx).toBeGreaterThan(140 * SUBPX);
    // Back east, the leader walks again (the gap shrinks).
    walk(game, Button.Right, 8);
    expect(at(game, 0)[0]).toBeGreaterThan(lx);
    expect(game.adventure.heavy?.phase).toBe("carry");
  });

  it("a formation pressed while the rock is carried doesn't re-form the Links: their places stay as they lifted", () => {
    const game = carried();
    walk(game, FORMATION_BUTTONS.wide, 1);
    expect(game.adventure.formation).toBe("long");
    expect(game.adventure.heavy?.phase).toBe("carry");
  });

  it("the carried rock doesn't go through the house's door: the leader stands in the back room with it", () => {
    const game = carried();
    // The leader and the second Link (his place, 16 px south) set down by the door (40, 144) of the back room.
    Object.assign(game.players[0]!, { x: 48 * SUBPX, y: 128 * SUBPX, facing: "down" });
    Object.assign(game.players[1]!, { x: 48 * SUBPX, y: 144 * SUBPX, facing: "down" });
    walk(game, Button.Down, 40);
    expect(game.adventure.area).toBe(3);
    expect(game.adventure.warp).toBeNull();
    expect(game.adventure.heavy?.phase).toBe("carry");
  });
});
