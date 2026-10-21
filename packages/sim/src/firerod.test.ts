import { describe, expect, it } from "vitest";
import type { Fighter } from "./combat.ts";
import { isRemoved } from "./entities.ts";
import { BURNING, FIRE_ROD } from "./firerod.ts";
import type { GameState } from "./game.ts";
import { moveFrame } from "./moveframes.ts";
import { Button, SUBPX } from "./player.ts";
import { arena, run, start, until } from "./testarena.ts";

const fighter = (game: GameState, i: number): Fighter => game.battle!.fighters[i]!;
const fireballs = (game: GameState) => game.battle!.entities.filter((e) => e.kind === "fireball" && !isRemoved(e));

describe("the Fire Rod", () => {
  it("a tap: the 12-tick pose, a fireball on its last tick that flies on, easing to 2 px a tick, and bursts on a wall", () => {
    const world = arena()
    const game = start(world, [{ x: 100, y: 100, facing: "down" }, { x: 100, y: 300, facing: "up" }]);
    fighter(game, 0).item = "fireRod";
    run(game, world, 1, [Button.Item]); // the press tick
    const frames: number[] = [];
    for (let t = 0; t < FIRE_ROD.pose; t++) {
      run(game, world, 1);
      frames.push(moveFrame(game.players[0]!, fighter(game, 0))!);
    }
    expect(frames).toEqual([407, 407, 408, 409, 410, 410, 410, 410, 410, 410, 411, 412]); // measured
    expect(fireballs(game).length).toBe(1);
    expect(fireballs(game)[0]!.y).toBe(108 * SUBPX); // 8 px ahead
    run(game, world, 1);
    expect(fighter(game, 0).move).toBe("none");
    expect(fireballs(game)[0]!.y).toBe(108 * SUBPX + FIRE_ROD.startSpeed); // (it showed where it appeared first)
    run(game, world, 30);
    expect(fireballs(game)[0]!.param).toBeGreaterThan(2 * SUBPX - 8);
    // Down to the arena's bottom wall, where it bursts, and goes.
    until(game, world, () => fireballs(game)[0]?.phase === "rest", 400);
    expect(fireballs(game)[0]!.y).toBeLessThan(game.players[1]!.y + 40 * SUBPX);
    run(game, world, FIRE_ROD.burst);
    expect(fireballs(game).length).toBe(0);
  });

  it("sets a Link alight: 2 life, he hops, runs away from the fire 2 px a tick, and sets alight a Link he runs into", () => {
    const world = arena();
    const game = start(world, [{ x: 100, y: 100, facing: "right" }, { x: 140, y: 100, facing: "left" }, { x: 240, y: 100, facing: "up" }]);
    fighter(game, 0).item = "fireRod";
    fighter(game, 1).hearts = 12;
    run(game, world, 1, [Button.Item]);
    until(game, world, () => fighter(game, 1).move === "burning", 40);
    expect(fighter(game, 1).hearts).toBe(12 - FIRE_ROD.damage);
    expect(game.players[1]!.facing).toBe("right"); // away from the fireball
    expect(fireballs(game).length).toBe(0); // spent on him
    // The hop on the spot, then the run.
    const x0 = game.players[1]!.x;
    until(game, world, () => fighter(game, 1).z === 0 && fighter(game, 1).vz === 0, 40);
    expect(game.players[1]!.x).toBe(x0);
    run(game, world, 10);
    expect(game.players[1]!.x).toBe(x0 + 10 * BURNING.speed);
    // P3 in his way catches fire too.
    until(game, world, () => fighter(game, 2).move === "burning", 60);
    expect(fighter(game, 2).hearts).toBe(fighter(game, 0).hearts - FIRE_ROD.damage);
    until(game, world, () => fighter(game, 1).move === "none", BURNING.ticks + 10);
  });

  it("held through the pose: a stream of flame in front while the button is held, the Link walking slowly, no fireball", () => {
    const world = arena();
    const game = start(world, [{ x: 100, y: 100, facing: "right" }, { x: 170, y: 100, facing: "up" }]);
    fighter(game, 0).item = "fireRod";
    run(game, world, FIRE_ROD.pose + 1, [Button.Item]);
    expect(fighter(game, 0).move).toBe("fireRod");
    run(game, world, 8, [Button.Item | Button.Right]);
    expect(game.players[0]!.x).toBe(100 * SUBPX + 8 * 288); // 1.125 px/tick
    expect(fighter(game, 1).move).toBe("burning"); // 70 px off: in the stream's reach (18…54 px ahead) once he walked up
    run(game, world, 2);
    expect(fighter(game, 0).move).toBe("none");
    expect(fireballs(game).length).toBe(0);
  });
});
