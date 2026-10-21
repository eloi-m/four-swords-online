import { describe, expect, it } from "vitest";
import type { Fighter } from "./combat.ts";
import type { GameState } from "./game.ts";
import { HAMMER, hammerFrame } from "./hammer.ts";
import { moveFrame } from "./moveframes.ts";
import { Button } from "./player.ts";
import type { ArenaProps } from "./props.ts";
import { switchOn } from "./switches.ts";
import { arena, run, start, until } from "./testarena.ts";

const fighter = (game: GameState, i: number): Fighter => game.battle!.fighters[i]!;

describe("the Magic Hammer", () => {
  it("a tap pounds 5 ticks after the press, flattening a Link in front: 2 life, no knockback, the Action button dead", () => {
    const world = arena();
    // P2 20 px right of P1: in the pound's box (±8 around (20, 7)) with his ±7 body.
    const game = start(world, [{ x: 100, y: 100, facing: "right" }, { x: 120, y: 105, facing: "up" }, { x: 100, y: 200, facing: "up" }]);
    fighter(game, 0).item = "hammer";
    fighter(game, 1).hearts = 12;
    const frames: number[] = [];
    run(game, world, 1, [Button.Item]); // the press tick
    for (let t = 0; t < HAMMER.end; t++) {
      run(game, world, 1);
      frames.push(moveFrame(game.players[0]!, fighter(game, 0))!);
      if (t < HAMMER.pound - 1) expect(fighter(game, 1).hearts).toBe(12);
      if (t === HAMMER.pound - 1) expect(fighter(game, 1).move).toBe("squash");
    }
    // The measured down pose's timings, facing right (291 + index).
    expect(frames).toEqual([292, 292, 293, 293, 296, 296, 296, 296, 296, 296, 296, 296, 297, 297, 297, 297, 297]);
    expect(fighter(game, 1).hearts).toBe(12 - HAMMER.damage);
    expect(fighter(game, 1).mode).toBe("active");
    expect(game.players[1]!.x).toBe(120 * 256); // not knocked back
    expect(fighter(game, 2).hearts).toBe(fighter(game, 0).hearts); // P3 far off: untouched
    run(game, world, 1);
    expect(fighter(game, 0).move).toBe("none"); // free on the tick after the pose
    expect(fighter(game, 1).squash).toBe(HAMMER.flatHeight);
    // Flat: the Action button does nothing (no roll, no lift).
    run(game, world, 3, [0, Button.Action]);
    expect(fighter(game, 1).move).toBe("none");
    // The flat timer runs out 300 ticks after the hit, then he grows back.
    until(game, world, () => fighter(game, 1).flat === 0, HAMMER.flatTicks);
    run(game, world, 10);
    expect(fighter(game, 1).squash).toBe(100);
  });

  it("held 48 ticks it charges: the big hammer, 4 life, and a ground impact that flips thud switches and makes Links hop", () => {
    const world = arena();
    const dosn: ArenaProps = { actors: [{ id: "DOSN", x: 160, y: 100, params: 4 << 27 }], bushes: [] };
    const game = start(world, [{ x: 100, y: 100, facing: "down" }, { x: 100, y: 112, facing: "up" }, { x: 140, y: 100, facing: "up" }], dosn);
    fighter(game, 0).item = "hammer";
    fighter(game, 1).hearts = 12;
    run(game, world, 1 + HAMMER.charge, [Button.Item]);
    expect(fighter(game, 0).charge).toBe(HAMMER.charge);
    expect(hammerFrame(game.players[0]!, fighter(game, 0))).toBe(363 + 8 * 2); // raised, the big hammer
    until(game, world, () => fighter(game, 1).move === "squash", 10);
    expect(fighter(game, 1).hearts).toBe(12 - HAMMER.damageCharged);
    expect(fighter(game, 1).flat).toBe(HAMMER.flatTicksCharged);
    run(game, world, HAMMER.impact - HAMMER.pound);
    expect(switchOn(game.battle!, 4)).toBe(true); // the DOSN 60 px off
    expect(fighter(game, 2).move).toBe("jolt"); // 40 px off
    until(game, world, () => fighter(game, 0).move === "none", HAMMER.endCharged);
  });

  it("doesn't hit a Link already flat", () => {
    const world = arena();
    const game = start(world, [{ x: 100, y: 100, facing: "right" }, { x: 120, y: 100, facing: "up" }]);
    fighter(game, 0).item = "hammer";
    fighter(game, 1).flat = 100;
    const hearts = fighter(game, 1).hearts;
    run(game, world, 1, [Button.Item]);
    run(game, world, HAMMER.end + 1);
    expect(fighter(game, 1).hearts).toBe(hearts);
  });
});
