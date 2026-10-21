import { describe, expect, it } from "vitest";
import { linkFrame } from "./actions.ts";
import { CARRY_HEIGHT, ESCAPE_PRESSES, HOLD_HEIGHT_LINK, LIFT_TICKS, LINK_FLIGHT, SLAM_LINK_TICK, THROW_TICKS, THROWN_LAND_DAMAGE } from "./carry.ts";
import { FALL_TICKS, fighterFrame, fighterHeight, HEART, KNOCK_SLOW, PIT_DAMAGE, SWORD_DAMAGE, vulnerable } from "./combat.ts";
import { battleWorld, entityById } from "./entities.ts";
import { stepGame } from "./game.ts";
import { CARRY, EMPTY_LIFT, HELD, LIFT, ROLL, THROW, THROW_RELEASE_TICK, THROWN } from "./moveframes.ts";
import { Button, STAND_FRAME, SUBPX, WALK_SPEED } from "./player.ts";
import { THROWN_DAMAGE, THROWN_LINK_DAMAGE } from "./projectiles.ts";
import { EMPTY_LIFT_TICKS, ROLL_SPEED, ROLL_STEER, ROLL_TICKS } from "./roll.ts";
import { arena, press, px, run, RULES, start, until } from "./testarena.ts";
import { isSolidAt } from "./world.ts";

const FULL = RULES.hearts * HEART;

describe("lifting and throwing Links", () => {
  it("lifts the Link in front along the measured path, carries him at walking speed, and throws him", () => {
    const world = arena();
    const game = start(world, [{ x: 100, y: 100, facing: "right" }, { x: 116, y: 100, facing: "up" }]);
    const p0 = game.players[0]!, p1 = game.players[1]!;
    const f0 = game.battle!.fighters[0]!, f1 = game.battle!.fighters[1]!;
    press(game, world, 0, Button.Action);
    // The press tick decides; the lift shows from the next tick. The held Link waits 16 px in front, 2 px up and 2 px
    // lower on the ground than a load would (traced).
    expect([f0.move, f1.move, f1.heldBy, f0.carryLink]).toEqual(["lift", "held", 0, 1]);
    expect(fighterFrame(p0, f0, linkFrame)).toBe(STAND_FRAME.right);
    expect(fighterFrame(p1, f1, linkFrame)).toBe(HELD.frames[0]);
    expect(vulnerable(f1)).toBe(false);
    expect([px(p1.x) - px(p0.x), px(p1.y) - px(p0.y), fighterHeight(f1)]).toEqual([16, 2, 2]);
    run(game, world, 1);
    expect(fighterFrame(p0, f0, linkFrame)).toBe(LIFT.frames.right[0]);
    run(game, world, 15);
    expect([px(p1.x) - px(p0.x), fighterHeight(f1)]).toEqual([12, 10]); // P+16
    run(game, world, 8);
    expect([f0.move, px(p1.x) - px(p0.x), fighterHeight(f1)]).toEqual(["lift", 0, 18]); // P+24
    run(game, world, 1);
    expect([f0.move, f1.z]).toEqual(["carry", HOLD_HEIGHT_LINK]); // P+25
    expect([LIFT_TICKS, HOLD_HEIGHT_LINK]).toEqual([24, 20 * SUBPX]);

    // Carrying moves from the first input tick, at walking speed; the held Link bobs.
    const x0 = p0.x;
    run(game, world, 10, [Button.Right, 0]);
    expect(p0.x - x0).toBe(10 * WALK_SPEED);
    expect([p1.x, p1.y]).toEqual([p0.x, p0.y + 2 * SUBPX]);
    expect(CARRY.walk.right).toContain(fighterFrame(p0, f0, linkFrame));
    expect(fighterHeight(f1) - HOLD_HEIGHT_LINK / SUBPX).toBe(CARRY.bob[Math.floor(p0.walkTicks / 3) % 8]);
    run(game, world, 1);
    expect(fighterFrame(p0, f0, linkFrame)).toBe(CARRY.stand.right);

    // Throw: the Link goes 6 px behind, back on the head, and leaves on the 11th tick.
    press(game, world, 0, Button.Action);
    expect([f0.move, fighterFrame(p0, f0, linkFrame)]).toEqual(["throw", CARRY.stand.right]); // the press tick carries
    run(game, world, 1);
    expect([fighterFrame(p0, f0, linkFrame), px(p0.x) - px(p1.x), fighterHeight(f1)]).toEqual([THROW.frames.right[0], 6, 17]);
    run(game, world, THROW_RELEASE_TICK - 1);
    expect([f1.move, f1.thrower, f0.carryLink, f1.heldBy]).toEqual(["held", -1, 1, 0]);
    const releasedAt = p0.x;
    run(game, world, 1); // P+11: off, 3.3 px along from 18 px up
    expect([f1.move, f1.thrower, f0.carryLink, f1.heldBy, p1.x - releasedAt, f1.z]).toEqual(["thrown", 0, -1, -1, LINK_FLIGHT.speed, LINK_FLIGHT.height]);
    expect(fighterFrame(p1, f1, linkFrame)).toBe(THROWN.frame);
    const flight = 1 + until(game, world, () => f1.z === 0, 60);
    expect(THROW_TICKS).toBe(24);
    // Traced: down on its 13th tick, 42.9 px out, unhurt; standing (facing the way he flew) from the next tick.
    expect([flight, Math.round((p1.x - releasedAt) / 25.6) / 10]).toEqual([13, 42.9]);
    run(game, world, 1);
    expect([f1.move, f1.mode, f1.hearts, f1.invincible, p1.facing]).toEqual(["none", "active", FULL, 0, "right"]);
    expect(THROWN_LAND_DAMAGE).toBe(0);
  });

  it("a Link thrown over a pit falls in where he lands", () => {
    const world = arena([17, 1, 12, 28, "O"]); // pit from px 136: he comes down at 142.9
    const game = start(world, [{ x: 100, y: 100, facing: "right" }, { x: 116, y: 100, facing: "up" }]);
    const f1 = game.battle!.fighters[1]!;
    press(game, world, 0, Button.Action);
    run(game, world, LIFT_TICKS + 1);
    press(game, world, 0, Button.Action);
    until(game, world, () => f1.move === "thrown", 20);
    until(game, world, () => f1.move !== "thrown", 60);
    expect([f1.mode, f1.hearts]).toEqual(["falling", FULL]);
    until(game, world, () => f1.mode !== "falling", FALL_TICKS + 1);
    expect(f1.hearts).toBe(FULL - PIT_DAMAGE);
  });

  it("a thrown Link bowls over the Link he flies into, and flies on", () => {
    const world = arena();
    const game = start(world, [
      { x: 100, y: 100, facing: "right" },
      { x: 116, y: 100, facing: "up" },
      { x: 131, y: 100, facing: "up" },
    ]);
    const [, f1, f2] = game.battle!.fighters;
    press(game, world, 0, Button.Action);
    run(game, world, LIFT_TICKS + 1);
    press(game, world, 0, Button.Action);
    until(game, world, () => f2!.mode === "hurt", 40);
    // Traced: 2 life, 0.75 px/tick with a 4.0 hop (a thrown Link's hit, type 4).
    expect([f2!.hearts, f2!.vz, Math.abs(f2!.pushX)]).toEqual([FULL - THROWN_LINK_DAMAGE, KNOCK_SLOW.hop, KNOCK_SLOW.speed]);
    expect(game.battle!.hits).toContainEqual({ attacker: 0, victim: 2, blocked: false, damage: THROWN_LINK_DAMAGE, cause: "thrown" });
    expect([f1!.move, f1!.flyX > 0, f1!.thrower]).toEqual(["thrown", true, -1]); // flying on; it hits once
  });

  it("a held Link is held until his 17th press of a direction: then he hops off, unhurt", () => {
    const world = arena();
    const game = start(world, [{ x: 100, y: 100, facing: "right" }, { x: 116, y: 100, facing: "up" }]);
    const [p0, p1] = game.players, [f0, f1] = game.battle!.fighters;
    press(game, world, 0, Button.Action);
    run(game, world, 500);
    expect(f1!.move).toBe("held"); // no time limit (500 ticks traced)
    for (let n = 0; n < 20; n++) {
      stepGame(game, [0, Button.Sword | Button.Item], world); // buttons don't count
      stepGame(game, [0, 0], world);
    }
    for (let n = 0; n < ESCAPE_PRESSES - 1; n++) stepGame(game, [0, n % 2 ? Button.Left : Button.Right], world);
    expect(f1!.move).toBe("held");
    stepGame(game, [0, Button.Up], world);
    expect([f1!.move, f1!.thrower, f0!.carryLink, f0!.move, p1!.x, p1!.y]).toEqual(["thrown", -1, -1, "none", p0!.x, p0!.y]);
    until(game, world, () => f1!.move === "none", 60);
    expect([f1!.mode, f1!.hearts, f1!.invincible, px(p1!.x - p0!.x)]).toEqual(["active", FULL, 0, 42]); // along the carrier's facing
  });

  it("a carrier who gets hit drops the Link he holds", () => {
    const world = arena();
    const game = start(world, [
      { x: 100, y: 100, facing: "right" },
      { x: 116, y: 100, facing: "up" },
      { x: 82, y: 100, facing: "right" },
    ]);
    const [f0, f1] = game.battle!.fighters;
    press(game, world, 0, Button.Action);
    run(game, world, LIFT_TICKS + 1);
    press(game, world, 2, Button.Sword); // a stab in the back
    until(game, world, () => f0!.mode === "hurt", 20);
    expect(f0!.hearts).toBe(FULL - SWORD_DAMAGE);
    run(game, world, 1);
    expect([f0!.carryLink, f1!.move, f1!.thrower]).toEqual([-1, "thrown", -1]);
    until(game, world, () => f1!.move === "none", 60);
    expect(f1!.hearts).toBe(FULL);
  });

  it("the Sword while carrying slams the load down in front, then carrying goes on", () => {
    const world = arena();
    const game = start(world, [
      { x: 100, y: 100, facing: "right" },
      { x: 116, y: 100, facing: "up" },
      { x: 116, y: 160, facing: "up" },
    ]);
    const [f0, f1, f2] = game.battle!.fighters;
    press(game, world, 0, Button.Action);
    run(game, world, LIFT_TICKS + 1);
    expect(f0!.carryLink).toBe(1);
    game.players[2]!.y = 100 * SUBPX; // steps in under the slam (the Links' pushes don't reach one held up high)
    press(game, world, 0, Button.Sword);
    // Traced: the held Link comes down on the slam's 9th tick and stuns the Link there, unhurt (so is he).
    expect(until(game, world, () => f2!.mode === "stunned", 20)).toBe(SLAM_LINK_TICK + 1);
    expect([f2!.hearts, f1!.hearts, f1!.move]).toEqual([FULL, FULL, "held"]);
    until(game, world, () => f0!.move === "carry", 30);
  });

  it("can't lift an invincible Link", () => {
    const world = arena();
    const game = start(world, [{ x: 100, y: 100, facing: "right" }, { x: 116, y: 100, facing: "up" }]);
    game.battle!.fighters[1]!.invincible = 30;
    press(game, world, 0, Button.Action);
    expect(game.battle!.fighters[0]!.move).toBe("ready"); // nothing liftable: a roll or an empty lift
  });
});

describe("bushes", () => {
  // A bush tile at (128, 96)-(143, 111): tile index 6 * 32 + 8. Its cells are solid in the arena's collision.
  const BUSH = 6 * 32 + 8;
  const props = { actors: [], bushes: [BUSH] };
  const world = () => arena([16, 12, 2, 2, "#"]);

  it("lifting a bush cuts its tile (walkable again); thrown, it flies 80 px and breaks, hurting who it hits", () => {
    const w = world();
    const game = start(w, [{ x: 116, y: 104, facing: "right" }, { x: 60, y: 200, facing: "up" }], props);
    const b = game.battle!;
    expect(isSolidAt(battleWorld(w, b), 132, 100)).toBe(true);
    press(game, w, 0, Button.Action);
    expect(b.cut).toEqual([BUSH]);
    expect(isSolidAt(battleWorld(w, b), 132, 100)).toBe(false);
    const bush = entityById(b, b.fighters[0]!.carryEntity)!;
    expect([bush.kind, bush.phase, bush.param]).toEqual(["bush", "held", BUSH]);
    run(game, w, LIFT_TICKS + 1);
    expect(bush.z).toBe(CARRY_HEIGHT);
    // Put the other Link in the way, facing away, and throw.
    Object.assign(game.players[1]!, { x: 170 * SUBPX, y: 104 * SUBPX });
    press(game, w, 0, Button.Action);
    until(game, w, () => b.fighters[1]!.mode === "hurt", 40);
    expect(b.fighters[1]!.hearts).toBe(FULL - THROWN_DAMAGE.bush!);
    expect(b.entities.some((e) => e.kind === "bush")).toBe(false);
    expect(b.entities.some((e) => e.kind === "debris")).toBe(true);

    // Without anyone in the way it breaks on its 20th tick, 80 px out.
    const again = start(w, [{ x: 116, y: 104, facing: "right" }, { x: 60, y: 200, facing: "up" }], props);
    press(again, w, 0, Button.Action);
    run(again, w, LIFT_TICKS + 1);
    press(again, w, 0, Button.Action);
    until(again, w, () => again.battle!.entities.some((e) => e.kind === "bush" && e.phase === "flying"), 20);
    const flying = again.battle!.entities.find((e) => e.kind === "bush")!;
    const from = flying.x - flying.vx;
    const ticks = 1 + until(again, w, () => flying.hp < 0, 40);
    expect([ticks, px(flying.x - from)]).toEqual([20, 80]);
  });

  it("a sword cuts a bush tile", () => {
    const w = world();
    const game = start(w, [{ x: 118, y: 104, facing: "right" }, { x: 60, y: 200, facing: "up" }], props);
    press(game, w, 0, Button.Sword);
    run(game, w, 8);
    expect(game.battle!.cut).toEqual([BUSH]);
  });
});

describe("rolling", () => {
  it("Action while walking rolls from the third tick: 2 px/tick along the facing plus 1 along the stick, 21 ticks", () => {
    const world = arena();
    const game = start(world, [{ x: 60, y: 100, facing: "right" }, { x: 60, y: 200, facing: "up" }]);
    const p = game.players[0]!, f = game.battle!.fighters[0]!;
    run(game, world, 3, [Button.Right]);
    const x0 = p.x;
    press(game, world, 0, Button.Right | Button.Action);
    run(game, world, 2, [Button.Right]); // P+1, P+2: still walking; decided on P+2
    expect([f.move, p.x - x0]).toEqual(["roll", 3 * WALK_SPEED]);
    const xr = p.x;
    run(game, world, 1, [Button.Right]);
    expect(fighterFrame(p, f, linkFrame)).toBe(ROLL.frames.right[0]);
    run(game, world, ROLL_TICKS - 1, [Button.Right]);
    expect([f.move, p.x - xr]).toEqual(["roll", ROLL_TICKS * (ROLL_SPEED + ROLL_STEER)]); // 63 px
    run(game, world, 1, [Button.Right]); // still holding the way he rolled: he walks on at once (traced in battle)
    expect([f.move, p.x - xr]).toEqual(["none", 63 * SUBPX + WALK_SPEED]);
  });

  it("the stick against the roll slows it to 1 px/tick; the roll keeps its starting facing", () => {
    const world = arena();
    const game = start(world, [{ x: 160, y: 100, facing: "right" }, { x: 60, y: 200, facing: "up" }]);
    const p = game.players[0]!;
    run(game, world, 3, [Button.Right]);
    press(game, world, 0, Button.Right | Button.Action);
    run(game, world, 2, [Button.Right]);
    const xr = p.x;
    run(game, world, ROLL_TICKS, [Button.Left]);
    expect([p.x - xr, p.facing]).toEqual([ROLL_TICKS * (ROLL_SPEED - ROLL_STEER), "right"]);
  });

  it("Action standing still with nothing in front is an empty lift", () => {
    const world = arena();
    const game = start(world, [{ x: 60, y: 100, facing: "right" }, { x: 60, y: 200, facing: "up" }]);
    const p = game.players[0]!, f = game.battle!.fighters[0]!;
    press(game, world, 0, Button.Action);
    run(game, world, 2);
    expect(f.move).toBe("emptyLift");
    run(game, world, 1);
    expect(fighterFrame(p, f, linkFrame)).toBe(EMPTY_LIFT.frames.right[0]);
    run(game, world, EMPTY_LIFT_TICKS - 1);
    expect(f.move).toBe("emptyLift");
    run(game, world, 1);
    expect(f.move).toBe("none");
  });

  it("a roll stops at a wall and plays out there; one into a Link pushes him along, unhurt and in control", () => {
    const world = arena([15, 1, 1, 10, "#"]); // wall at px 120
    const game = start(world, [{ x: 90, y: 40, facing: "right" }, { x: 60, y: 120, facing: "up" }, { x: 100, y: 120, facing: "up" }]);
    const [p0] = game.players, [f0, , f2] = game.battle!.fighters;
    run(game, world, 2, [Button.Right]);
    press(game, world, 0, Button.Right | Button.Action);
    run(game, world, 12, [Button.Right]);
    expect(f0!.move).toBe("roll");
    expect(px(p0!.x) + 7).toBe(119); // against the wall, still rolling in place

    const p1 = game.players[1]!, p2 = game.players[2]!, f1 = game.battle!.fighters[1]!;
    run(game, world, 2, [0, Button.Right]);
    press(game, world, 1, Button.Right | Button.Action);
    const x2 = p2.x;
    until(game, world, () => p2.x > x2, 20, [0, Button.Right]);
    // The Links' pushes (traced): bodies within 14 px on both axes step 1 px apart, again while they still touch.
    expect([f1.move, f2!.mode, f2!.hearts, f2!.slideX]).toEqual(["roll", "active", FULL, 0]);
    until(game, world, () => f1.move !== "roll", 30, [0, Button.Right]);
    expect(p2.x - x2).toBeGreaterThan(10 * SUBPX); // pushed along
    expect(p1.x).toBeLessThan(p2.x);
  });
});

describe("pots", () => {
  // A pot tile at (128, 96)-(143, 111), as the bush's: tile index 6 * 32 + 8. A lifted stone (Lake Hylia's 0x72) is one
  // too: its entity's param is the tile it came from, which apps/battle draws the stone by.
  const POT = 6 * 32 + 8;
  const props = { actors: [], bushes: [], pots: [POT] };
  const world = () => arena([16, 12, 2, 2, "#"]);

  it("a thrown pot keeps the tile it was lifted from while it flies, and breaks where it lands", () => {
    const w = world();
    const game = start(w, [{ x: 116, y: 104, facing: "right" }, { x: 60, y: 200, facing: "up" }], props);
    const b = game.battle!;
    press(game, w, 0, Button.Action);
    const pot = entityById(b, b.fighters[0]!.carryEntity)!;
    expect([pot.kind, pot.phase, pot.param]).toEqual(["pot", "held", POT]);
    run(game, w, LIFT_TICKS + 1);
    press(game, w, 0, Button.Action);
    until(game, w, () => pot.phase === "flying", 20);
    expect([pot.kind, pot.param]).toEqual(["pot", POT]);
    until(game, w, () => pot.hp < 0, 60);
    expect(b.entities.some((e) => e.kind === "pot")).toBe(false);
    expect(b.entities.some((e) => e.kind === "debris")).toBe(true);
  });

  it("a carrier hit drops the pot where he stands, still on its tile", () => {
    const w = world();
    const game = start(w, [
      { x: 116, y: 104, facing: "right" },
      { x: 60, y: 200, facing: "up" },
      { x: 98, y: 104, facing: "right" },
    ], props);
    const b = game.battle!;
    press(game, w, 0, Button.Action);
    const pot = entityById(b, b.fighters[0]!.carryEntity)!;
    run(game, w, LIFT_TICKS + 1);
    press(game, w, 2, Button.Sword); // a stab in the back
    until(game, w, () => b.fighters[0]!.mode === "hurt", 20);
    run(game, w, 1);
    expect([b.fighters[0]!.carryEntity, pot.phase, pot.param]).toEqual([0, "flying", POT]);
  });
});
