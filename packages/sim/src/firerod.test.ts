import { describe, expect, it } from "vitest";
import type { Fighter } from "./combat.ts";
import { isRemoved, tileIndexAt } from "./entities.ts";
import { BLAZE, BURNING, FIRE_ROD, STREAM_WAIT } from "./firerod.ts";
import type { GameState } from "./game.ts";
import { moveFrame } from "./moveframes.ts";
import { Button, SUBPX } from "./player.ts";
import { NO_PROPS } from "./props.ts";
import { arena, run, start, until } from "./testarena.ts";
import { SURFACE_CODES } from "./world.ts";

const fighter = (game: GameState, i: number): Fighter => game.battle!.fighters[i]!;
const fireballs = (game: GameState) => game.battle!.entities.filter((e) => e.kind === "fireball" && !isRemoved(e));
const blazes = (game: GameState) => game.battle!.entities.filter((e) => e.kind === "blaze" && !isRemoved(e));

describe("the Fire Rod", () => {
  it("a tap: the 13-tick pose, a fireball on its 12th tick that eases to 2 px a tick, and a BLZE where a wall bursts it", () => {
    const world = arena();
    const game = start(world, [{ x: 100, y: 100, facing: "down" }, { x: 200, y: 200, facing: "up" }]);
    fighter(game, 0).item = "fireRod";
    run(game, world, 1, [Button.Item]); // the press tick
    const frames: number[] = [];
    for (let t = 0; t < FIRE_ROD.pose; t++) {
      run(game, world, 1);
      frames.push(moveFrame(game.players[0]!, fighter(game, 0))!);
      if (t === FIRE_ROD.fire) expect(fireballs(game)[0]!.y).toBe(108 * SUBPX + 154); // 8 px ahead, and 0.6 px on
    }
    expect(frames).toEqual([407, 407, 408, 409, 410, 410, 410, 410, 410, 410, 411, 412, 412]); // (traced facing right)
    expect(fireballs(game)[0]!.y).toBe(108 * SUBPX + 154 + 262); // 1.02 px on
    run(game, world, 1);
    expect(fighter(game, 0).move).toBe("none");
    run(game, world, 30);
    expect(fireballs(game)[0]!.param).toBe(2 * SUBPX);
    // Down to the arena's bottom wall (y 232), where it bursts: a BLZE on the tile beyond, for 30 ticks.
    until(game, world, () => fireballs(game)[0]?.phase === "rest", 400);
    expect(blazes(game).map((e) => [e.x / SUBPX, e.y / SUBPX])).toEqual([[104, 240]]);
    run(game, world, BLAZE.ticks);
    expect(blazes(game).length).toBe(0);
    run(game, world, FIRE_ROD.burst);
    expect(fireballs(game).length).toBe(0);
  });

  it("sets a Link alight: 2 life, he turns away, hops, runs 2 px a tick, and sets alight a Link he runs into", () => {
    const world = arena();
    const game = start(world, [{ x: 100, y: 100, facing: "right" }, { x: 140, y: 100, facing: "left" }, { x: 240, y: 100, facing: "up" }]);
    fighter(game, 0).item = "fireRod";
    fighter(game, 1).hearts = 12;
    run(game, world, 1, [Button.Item]);
    until(game, world, () => fighter(game, 1).move === "burning", 40);
    expect(fighter(game, 1).hearts).toBe(12 - FIRE_ROD.damage);
    expect(game.players[1]!.facing).toBe("left"); // the hit tick shows him as he was
    expect(fireballs(game).length).toBe(0); // spent on him
    run(game, world, 1);
    expect(game.players[1]!.facing).toBe("right"); // away from the fireball
    // The hop on the spot, then the run.
    const x0 = game.players[1]!.x;
    until(game, world, () => fighter(game, 1).z === 0 && fighter(game, 1).vz === 0, 40);
    expect(game.players[1]!.x).toBe(x0);
    run(game, world, 10);
    expect(game.players[1]!.x).toBe(x0 + 10 * BURNING.speed);
    // The stick turns him at once.
    run(game, world, 1, [0, Button.Down]);
    expect(game.players[1]!.facing).toBe("down");
    run(game, world, 1);
    expect(game.players[1]!.y).toBe(100 * SUBPX + BURNING.speed);
    run(game, world, 1, [0, Button.Up]);
    run(game, world, 1);
    // P3 in his way catches fire too.
    until(game, world, () => fighter(game, 2).move === "burning", 60, [0, Button.Right]);
    expect(fighter(game, 2).hearts).toBe(fighter(game, 0).hearts - FIRE_ROD.damage);
    until(game, world, () => fighter(game, 1).move === "none", BURNING.ticks + 10);
  });

  it("shallow water puts a burning Link out", () => {
    const world = arena();
    const shallow = SURFACE_CODES.indexOf("shallow");
    for (let y = 0; y < 30; y++) for (let x = 25; x < 39; x++) world.surface[y * world.widthCells + x] = shallow; // x ≥ 200
    const game = start(world, [{ x: 100, y: 100, facing: "right" }, { x: 140, y: 100, facing: "left" }]);
    fighter(game, 0).item = "fireRod";
    run(game, world, 1, [Button.Item]);
    until(game, world, () => fighter(game, 1).move === "burning", 40);
    until(game, world, () => fighter(game, 1).move !== "burning", 200);
    expect(game.players[1]!.x).toBe(200 * SUBPX);
  });

  it("held through the pose: a stream of flame trailing a tick, the Link walking slowly; let go, no fireball", () => {
    const world = arena();
    const game = start(world, [{ x: 100, y: 100, facing: "right" }, { x: 170, y: 100, facing: "up" }]);
    fighter(game, 0).item = "fireRod";
    run(game, world, 1 + FIRE_ROD.fire + 1, [Button.Item]);
    expect(fighter(game, 0).move).toBe("fireRod");
    expect(moveFrame(game.players[0]!, fighter(game, 0))).toBe(466); // the rod held out
    run(game, world, 8, [Button.Item | Button.Right]);
    expect(game.players[0]!.x).toBe(100 * SUBPX + 8 * 288); // 1.125 px/tick
    expect(fighter(game, 1).move).toBe("none"); // the stream's reach (18…54 px ahead) from where he stood a tick ago
    run(game, world, 1, [Button.Item | Button.Right]);
    expect(fighter(game, 1).move).toBe("burning");
    run(game, world, 2);
    expect(fighter(game, 0).move).toBe("fireRod"); // the pose's last two ticks
    run(game, world, 1);
    expect(fighter(game, 0).move).toBe("none");
    expect(fireballs(game).length).toBe(0);
  });

  it("a stream into a wall: a BLZE at its middle, the flame back 60 ticks later; let go meanwhile, a fireball", () => {
    const world = arena();
    const game = start(world, [{ x: 270, y: 100, facing: "right" }, { x: 100, y: 200, facing: "up" }]);
    fighter(game, 0).item = "fireRod";
    run(game, world, 1 + FIRE_ROD.fire + 1, [Button.Item]); // the stream's first tick: its box (288…324) meets the wall
    expect(blazes(game).map((e) => [e.x / SUBPX, e.y / SUBPX])).toEqual([[306, 100]]);
    run(game, world, STREAM_WAIT, [Button.Item]);
    expect(blazes(game).length).toBe(0); // (the first one gone, the flame still out)
    run(game, world, 1, [Button.Item]);
    expect(blazes(game).length).toBe(1);
    run(game, world, 1); // let go
    expect(fireballs(game).length).toBe(1);
  });

  it("a fireball burns the bushes it passes: a BLZE on each, the tile cleared, and it flies on", () => {
    const world = arena([18, 10, 2, 2, "#"]); // the bush tile at (144, 80)
    const bush = tileIndexAt(144, 80);
    const game = start(world, [{ x: 100, y: 88, facing: "right" }, { x: 100, y: 200, facing: "up" }], { ...NO_PROPS, bushes: [bush] });
    fighter(game, 0).item = "fireRod";
    run(game, world, 1, [Button.Item]);
    until(game, world, () => blazes(game).length > 0, 60);
    expect(game.battle!.cut).toContain(bush);
    expect(blazes(game).map((e) => [e.x / SUBPX, e.y / SUBPX])).toEqual([[152, 88]]);
    run(game, world, 20);
    expect(fireballs(game)[0]!.phase).toBe("flying");
    expect(fireballs(game)[0]!.x).toBeGreaterThan(160 * SUBPX);
  });
});
