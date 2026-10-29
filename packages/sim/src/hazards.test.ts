import { describe, expect, it } from "vitest";
import { ARENA_W } from "./arena.ts";
import { standing } from "./battle.ts";
import { BOMB_FUSE, BOMB_REGROW_TICKS } from "./bombs.ts";
import { LIFT_TICKS } from "./carry.ts";
import { HEART, type Fighter } from "./combat.ts";
import { battleWorld, trapdoorTiles, type Entity } from "./entities.ts";
import { type GameState } from "./game.ts";
import {
  BEE_BUZZ_TICKS,
  BEE_DAMAGE,
  fireballs,
  FLAME_DAMAGE,
  FLAME_KNOCK,
  FLAME_SWITCH,
  JET_DAMAGE,
  JET_KNOCK,
  jetSize,
  angleTo,
  SOLDIER_AIM_TICKS,
  SOLDIER_DAMAGE,
  SOLDIER_FIRST_AIM,
  SOLDIER_LOOK_TICKS,
  SOLDIER_PATROL_SPEED,
  SOLDIER_SIGHT,
  SOLDIER_SPEED,
  SOLDIER_WINDUP_TICKS,
  TRAPDOOR_CLOSING_TICKS,
  TRAPDOOR_MIN_OPEN_TICKS,
  TRAPDOOR_OPENING_TICKS,
} from "./hazards.ts";
import { Button, SUBPX } from "./player.ts";
import type { ArenaProps, Prop } from "./props.ts";
import { sideRoomY } from "./siderooms.ts";
import { BEE_WAKE_TICKS, SOLDIER_FIRST_LOOK, SOLDIER_STUN_TICKS } from "./strike.ts";
import { setSwitch, switchOn } from "./switches.ts";
import { arena, press, px, run, RULES, start, until } from "./testarena.ts";
import { GIANT_BOMB_TICKS, VAATI_ENTER_TICKS, VAATI_LEAVE_TICK, VAATI_TICKS } from "./timeup.ts";
import { surfaceAt } from "./world.ts";

const FULL = RULES.hearts * HEART;
const of = (game: GameState, kind: Entity["kind"]) => game.battle!.entities.filter((e) => e.kind === kind);
const fighter = (game: GameState, i: number): Fighter => game.battle!.fighters[i]!;
const props = (...actors: Prop[]): ArenaProps => ({ actors, bushes: [] });
const FAR = { x: 40, y: 220, facing: "up" } as const;

describe("Tower of Flames", () => {
  it("a socket bomb lights when lifted, goes off, and a new one grows in its socket", () => {
    const world = arena();
    const game = start(world, [{ x: 136, y: 100, facing: "right" }, FAR], props({ id: "HBMB", x: 150, y: 100, params: 0x101 }));
    const [bomb] = of(game, "bomb");
    expect([bomb!.timer, bomb!.home]).toEqual([0, 0]);
    press(game, world, 0, Button.Action);
    expect([bomb!.phase, bomb!.timer]).toEqual(["held", BOMB_FUSE - 1]); // lit, and burning from this tick
    run(game, world, LIFT_TICKS + 1);
    press(game, world, 0, Button.Action);
    until(game, world, () => of(game, "explosion").length > 0, BOMB_FUSE);
    expect(game.battle!.respawn[0]).toBe(BOMB_REGROW_TICKS); // counting from the blast's tick
    run(game, world, BOMB_REGROW_TICKS - 1);
    expect(of(game, "bomb")).toEqual([]);
    run(game, world, 1); // 60 ticks after the blast, as measured
    const [again] = of(game, "bomb");
    expect([px(again!.x), px(again!.y), again!.timer, again!.phase]).toEqual([150, 100, 0, "rest"]);
  });

  it("eternal flames are out until their switch (14) is on, then burn on contact", () => {
    const world = arena();
    const game = start(world, [{ x: 120, y: 100, facing: "right" }, FAR], props({ id: "BLZ2", x: 150, y: 100, params: 0x70000013 }));
    const [flame] = of(game, "flame");
    run(game, world, 40, [Button.Right]); // walks through the unlit flame
    expect([flame!.phase, fighter(game, 0).hearts]).toEqual(["rest", FULL]);
    run(game, world, 30, [Button.Left]);
    setSwitch(game.battle!, FLAME_SWITCH, true);
    until(game, world, () => fighter(game, 0).mode === "hurt", 60, [Button.Right]);
    expect([flame!.phase, fighter(game, 0).hearts, game.battle!.hits[0]!.cause]).toEqual(["active", FULL - FLAME_DAMAGE, "flame"]);
    expect([FLAME_DAMAGE, fighter(game, 0).pushX, fighter(game, 0).vz]).toEqual([1, -FLAME_KNOCK.speed, FLAME_KNOCK.hop]); // hit type 7
    expect(game.players[0]!.x).toBeLessThan(150 * SUBPX);
  });

  // Room 1's wiring: the switch under the top-left pot (15 here) → SWOR 0x53dfff84 (switch 10 = 15 or 31) → the jet up.
  it("standing on a floor switch makes a fire-pit flame shoot out through its OR gate, for as long as he stays", () => {
    const world = arena();
    const jets = [0x58000001, 0x50030001].map((params) => ({ id: "FLME", x: 160, y: 200, params })); // right (11), up (10)
    const game = start(world, [{ x: 104, y: 50, facing: "down" }, { x: 160, y: 140, facing: "up" }], props({ id: "SWTH", x: 96, y: 64, params: 0x78000000 }, { id: "SWOR", x: 0, y: 0, params: 0x53dfff84 }, ...jets));
    const [right, up] = of(game, "jet");
    expect([right!.facing, up!.facing]).toEqual(["right", "up"]);
    until(game, world, () => switchOn(game.battle!, 15), 30, [Button.Down]);
    run(game, world, 1); // the gate runs before the switch in the actor list: a tick later
    expect([switchOn(game.battle!, 10), switchOn(game.battle!, 11)]).toEqual([true, false]);
    const ticks = until(game, world, () => fighter(game, 1).mode === "hurt", 30);
    expect(ticks).toBeGreaterThanOrEqual(10); // it grows a tenth of the way per tick and burns once past 0.7
    expect([fighter(game, 1).hearts, right!.phase, jetSize(right!)]).toEqual([FULL - JET_DAMAGE, "rest", 0]);
    expect([JET_DAMAGE, fighter(game, 1).vz]).toEqual([4, JET_KNOCK.hop]); // FLME's atcp 4, hit type 9
    until(game, world, () => !switchOn(game.battle!, 15), 30, [Button.Up]); // off the switch
    run(game, world, 2);
    expect(up!.phase).toBe("rest");
  });

  it("a jet knocks a Link away from the middle of its flame (measured: beside the upward jet, off to the left)", () => {
    const world = arena();
    const jet = { id: "FLME", x: 160, y: 200, params: 0x50030001 }; // up, on switch 10
    // As in the Tower of Flames trace: 15 px left of the jet, 43 px above its anchor (2 below its flame's middle).
    const game = start(world, [{ x: 145, y: 157, facing: "right" }, FAR], props(jet));
    setSwitch(game.battle!, 10, true);
    until(game, world, () => fighter(game, 0).mode === "hurt", 30);
    const f = fighter(game, 0);
    expect(f.hearts).toBe(FULL - JET_DAMAGE);
    expect(f.pushX).toBeLessThan(-6 * Math.abs(f.pushY)); // (-1.483, 0.225) px/frame in the game
    expect(f.pushY).toBeGreaterThanOrEqual(0);
  });

  it("a pot hides a switch: lift it, and the switch under it works", () => {
    const world = arena([12, 8, 2, 2, "#"]); // the pot's tile (96, 64)-(111, 79), tile 4 * 32 + 6
    const game = start(world, [{ x: 104, y: 96, facing: "up" }, FAR], {
      actors: [{ id: "SWTH", x: 96, y: 64, params: 0x48000000, tile: 0x43, onSolid: true }],
      bushes: [],
      pots: [4 * 32 + 6],
    });
    const [sw] = of(game, "switch");
    run(game, world, 30, [Button.Up]); // the pot blocks the way
    expect([switchOn(game.battle!, 9), px(game.players[0]!.y)]).toEqual([false, 87]);
    press(game, world, 0, Button.Action);
    expect(of(game, "pot")[0]!.phase).toBe("held");
    expect(game.battle!.cut).toEqual([4 * 32 + 6]);
    run(game, world, LIFT_TICKS + 1);
    until(game, world, () => sw!.phase === "active", 30, [Button.Up]);
    expect(switchOn(game.battle!, 9)).toBe(true);
  });
});

describe("Above the Clouds", () => {
  it("fire-bar arms (8 fireballs 48-160 px out) turn clockwise, a turn every 1024 ticks, and burn what they sweep", () => {
    const world = arena();
    const bars = [0x42220008, 0x42220108, 0x42220208, 0x42220308].map((params) => ({ id: "FBMR", x: 160, y: 120, params }));
    const game = start(world, [{ x: 160, y: 190, facing: "up" }, FAR], props(...bars));
    const arms = of(game, "firebar");
    expect(arms.map((a) => a.angle)).toEqual([0, 0x8000, 0x4000, 0xc000]); // right, left, down, up; still until the countdown ends
    run(game, world, 1);
    expect(arms[0]!.angle).toBe(64);
    const balls = fireballs(game.battle!, { ...arms[0]!, angle: 0 });
    expect(balls.map((ball) => px(ball.x) - 160)).toEqual([48, 64, 80, 96, 112, 128, 144, 160]);
    expect(px(fireballs(game.battle!, { ...arms[0]!, angle: 0x4000 })[0]!.y)).toBe(120 + 48); // a quarter turn: below (clockwise)
    // The "down" arm sweeps over him (70 px below the middle) at once.
    until(game, world, () => fighter(game, 0).mode === "hurt", 30);
    expect(game.battle!.hits[0]!.cause).toBe("firebar");
  });
});

describe("The Field", () => {
  it("the trick floor's switch hides under a bush: cut it, step on it, and the floor opens", () => {
    const world = arena([12, 8, 2, 2, "#"]); // the bush tile (96, 64)-(111, 79), tile 4 * 32 + 6
    const game = start(
      world,
      [{ x: 104, y: 92, facing: "up" }, { x: 190, y: 130, facing: "up" }],
      { actors: [{ id: "SWTH", x: 96, y: 64, params: 0x10000000 }, { id: "TFLR", x: 160, y: 96, params: 0x11000106 }], bushes: [4 * 32 + 6] },
    );
    const [door] = of(game, "trapdoor");
    run(game, world, 30, [Button.Up]); // the bush blocks the way
    expect([door!.timer, px(game.players[0]!.y)]).toEqual([0, 87]);
    press(game, world, 0, Button.Sword);
    run(game, world, 10);
    expect(game.battle!.cut).toEqual([4 * 32 + 6]);
    until(game, world, () => door!.timer > 0, 30, [Button.Up]);
    expect(fighter(game, 0).mode).toBe("active");
  });

  it("the trick floor opens into a pit while its switch is held, and closes when nobody's near", () => {
    const world = arena();
    const game = start(
      world,
      [{ x: 104, y: 60, facing: "down" }, { x: 190, y: 130, facing: "up" }],
      props({ id: "SWTH", x: 96, y: 64, params: 0x10000000 }, { id: "TFLR", x: 160, y: 96, params: 0x11000106 }),
    );
    fighter(game, 1).spawnX = 60; // he comes back out of the pit away from the trapdoor
    fighter(game, 1).spawnY = 200;
    const [door] = of(game, "trapdoor");
    expect(trapdoorTiles(door!)).toContain(8 * 32 + 11); // (176, 128)
    const opened = until(game, world, () => door!.timer > 0, 30, [Button.Down]);
    expect(opened).toBeGreaterThanOrEqual(TRAPDOOR_OPENING_TICKS);
    expect(surfaceAt(battleWorld(world, game.battle!), 190, 134)).toBe("pit");
    until(game, world, () => fighter(game, 1).mode === "falling", 2);
    run(game, world, TRAPDOOR_MIN_OPEN_TICKS * 2); // he stays on the switch: it stays open
    expect(door!.phase).toBe("active");
    until(game, world, () => door!.phase === "return", 60, [Button.Up]); // he steps off
    run(game, world, TRAPDOOR_CLOSING_TICKS);
    expect([door!.phase, door!.timer]).toEqual(["rest", 0]);
    expect(surfaceAt(battleWorld(world, game.battle!), 190, 134)).toBe("floor");
  });

  it("a Link walking onto the open floor from below jumps back out a pixel further than off its tiles", () => {
    const world = arena();
    const game = start(
      world,
      [{ x: 104, y: 60, facing: "down" }, { x: 190, y: 172, facing: "up" }],
      props({ id: "SWTH", x: 96, y: 64, params: 0x10000000 }, { id: "TFLR", x: 160, y: 96, params: 0x11000106 }),
    );
    const [door] = of(game, "trapdoor");
    until(game, world, () => door!.timer > 0, 30, [Button.Down]);
    run(game, world, TRAPDOOR_OPENING_TICKS);
    until(game, world, () => fighter(game, 1).mode === "falling", 30, [Button.Down, Button.Up]);
    until(game, world, () => fighter(game, 1).mode === "active", 200, [Button.Down]);
    // The tiles end at y 159; the jump lands 7 px past the floor's first pixel, which is 161 here (traced: 280, not 279).
    expect(px(game.players[1]!.y)).toBe(168);
  });

  it("bees swarm the nearest Link when a boots crash lands by their tree, not for a sword", () => {
    const world = arena();
    const game = start(world, [{ x: 160, y: 24, facing: "up" }, FAR], props({ id: "BEEE", x: 200, y: 40, params: 0x08000000 }));
    const [bee] = of(game, "bee");
    press(game, world, 0, Button.Sword);
    run(game, world, 30);
    expect(bee!.phase).toBe("rest");
    fighter(game, 0).item = "boots";
    until(game, world, () => fighter(game, 0).move === "crash", 30, [Button.Item, 0]);
    until(game, world, () => bee!.phase === "chase", 3);
    // Traced: out of the tree and hovering 92 ticks, then off at 0.2, 0.38, 0.54 … px a tick, up to 2. (Woken by the
    // crash in the tick's Link pass, its first tick of them is already over.)
    const [x0, y0] = [bee!.x, bee!.y];
    run(game, world, BEE_WAKE_TICKS - 1);
    expect([bee!.x, bee!.y]).toEqual([x0, y0]);
    const speeds: number[] = [];
    for (let t = 0; t < 3; t++) {
      const [x, y] = [bee!.x, bee!.y];
      run(game, world, 1);
      speeds.push(Math.round(Math.hypot(bee!.x - x, bee!.y - y)));
    }
    [51, 97, 139].forEach((v, k) => expect(Math.abs(speeds[k]! - v)).toBeLessThanOrEqual(2)); // (1/256 px a tick)
    until(game, world, () => fighter(game, 0).mode === "hurt", 300);
    expect(game.battle!.hits.find((h) => h.victim === 0)).toMatchObject({ damage: BEE_DAMAGE, cause: "bee" });
    // A sting: it buzzes there 121 ticks, then comes at him again.
    const [sx, sy] = [bee!.x, bee!.y];
    run(game, world, BEE_BUZZ_TICKS);
    expect([bee!.x, bee!.y]).toEqual([sx, sy]);
    run(game, world, 1);
    expect(bee!.x !== sx || bee!.y !== sy).toBe(true);
  });
});

describe("Hyrule Castle", () => {
  it("sword soldiers chase the nearest Link and hit on contact; a sword stroke beats one, and it doesn't come back", () => {
    const world = arena();
    const game = start(world, [{ x: 150, y: 100, facing: "left" }, FAR], props({ id: "SLR1", x: 220, y: 100, params: 0x1002 }));
    const [soldier] = of(game, "soldier");
    until(game, world, () => fighter(game, 0).mode === "hurt", 600); // (it wobbles round him: its touch reaches 9-13 px)
    expect(fighter(game, 0).hearts).toBe(FULL - SOLDIER_DAMAGE);
    expect(px(soldier!.x)).toBeLessThan(220);
    until(game, world, () => fighter(game, 0).mode === "active" && fighter(game, 0).invincible === 0, 120);
    // Face it and stab (it comes at any angle: turn toward it before each stab).
    let ticks = 0;
    while (of(game, "soldier").length && ticks++ < 300) {
      const dx = soldier!.x - game.players[0]!.x, dy = soldier!.y - game.players[0]!.y;
      const face = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? Button.Right : Button.Left) : dy > 0 ? Button.Down : Button.Up;
      press(game, world, 0, ticks % 12 === 0 ? face : ticks % 12 === 1 ? Button.Sword : 0);
    }
    expect(of(game, "soldier")).toEqual([]);
    run(game, world, 1200); // (traced: the castle's new ones come from its GEN3 spawners)
    expect(of(game, "soldier")).toEqual([]);
  });

  it("a soldier's touch goes through the shield, with its own box: 11 px across, 13 below the Link, 9 above (traced)", () => {
    const touches = (dx: number, dy: number, facing: "left" | "right" | "up" | "down") => {
      const world = arena();
      const game = start(world, [{ x: 150, y: 100, facing }, FAR], props({ id: "SLR1", x: 150, y: 150, params: 0x1002 }));
      const [soldier] = of(game, "soldier");
      // Stopping where it's put (its velocity halving), far from its wind-up's end.
      Object.assign(soldier!, { phase: "active", timer: 100, vx: 0, vy: 0, x: (150 + dx) * SUBPX, y: (100 + dy) * SUBPX });
      run(game, world, 1);
      return fighter(game, 0).hearts === FULL - SOLDIER_DAMAGE;
    };
    expect([touches(11, 0, "right"), touches(11.25, 0, "right"), touches(-11, 0, "left"), touches(-11.25, 0, "left")]).toEqual([true, false, true, false]);
    expect([touches(0, 13, "down"), touches(0, 13.25, "down"), touches(0, -9, "up"), touches(0, -9.25, "up")]).toEqual([true, false, true, false]);
  });

  it("a soldier that sees a Link winds up, stands, then steers at him at about 1 px a tick (measured: seen on 47, moving on 89)", () => {
    const world = arena();
    const game = start(world, [{ x: 150, y: 170, facing: "left" }, FAR], props({ id: "SLR1", x: 220, y: 100, params: 0x1002 }));
    const [soldier] = of(game, "soldier");
    const home = { x: soldier!.x, y: soldier!.y };
    run(game, world, 1);
    expect(soldier!.phase).toBe("active"); // noticed (98 px away)
    run(game, world, SOLDIER_WINDUP_TICKS + SOLDIER_FIRST_AIM - 1);
    expect([soldier!.phase, soldier!.x, soldier!.y]).toEqual(["chase", home.x, home.y]); // 42 ticks without a step
    run(game, world, 1);
    const step = Math.hypot(soldier!.x - home.x, soldier!.y - home.y);
    expect(step).toBeGreaterThan(0.25 * SOLDIER_SPEED); // 3/10 of the way to its aim
    expect(step).toBeLessThan(0.35 * SOLDIER_SPEED);
    run(game, world, SOLDIER_AIM_TICKS - 1);
    expect(Math.hypot(soldier!.vx, soldier!.vy)).toBeGreaterThan(0.9 * SOLDIER_SPEED);
    expect(angleTo(0, 0, 10, 0)).toBe(0);
    expect(angleTo(0, 0, 0, 10)).toBe(0x4000); // clockwise, y down
    expect(angleTo(0, 0, -7, -7)).toBe(0xa000);
  });
});

describe("Hyrule Castle's soldiers' patrol, sight and stun", () => {
  const soldierAt = (link: { x: number; y: number }, params = 0x1002) => {
    const world = arena();
    const game = start(world, [{ ...link, facing: "left" }, FAR], props({ id: "SLR1", x: 220, y: 100, params }));
    return { world, game, soldier: of(game, "soldier")[0]! };
  };

  it("standing, it sees 100 px the way it looks (main.dol: SLR1 state 3)", () => {
    const near = soldierAt({ x: 220, y: 100 + SOLDIER_SIGHT }); // straight below, the way it looks first
    run(near.game, near.world, 1);
    expect(near.soldier.phase).toBe("active");
    const far = soldierAt({ x: 220, y: 100 + SOLDIER_SIGHT + 2 });
    run(far.game, far.world, 1);
    expect(far.soldier.phase).toBe("rest");
    // Behind it (up) a Link 40 px off goes unseen through its looks (down, left, down, right).
    const behind = soldierAt({ x: 220, y: 60 });
    run(behind.game, behind.world, SOLDIER_FIRST_LOOK + 4 * SOLDIER_LOOK_TICKS); // (68 ticks: the trace's shorter stand)
    expect([behind.soldier.phase, behind.soldier.x, behind.soldier.y]).toEqual(["rest", 220 * SUBPX, 100 * SUBPX]);
    // Then it turns sideways and walks 0.7 px a tick.
    run(behind.game, behind.world, 1);
    expect([Math.abs(behind.soldier.vx), behind.soldier.vy, behind.soldier.facing === "left" || behind.soldier.facing === "right"]).toEqual([SOLDIER_PATROL_SPEED, 0, true]);
  });

  it("walking, it sees the way it walks from far off", () => {
    const { game, world, soldier } = soldierAt({ x: 220, y: 40 }); // (behind it, then beside its walk)
    run(game, world, SOLDIER_FIRST_LOOK + 4 * SOLDIER_LOOK_TICKS + 1);
    expect([soldier.phase, soldier.vx !== 0]).toEqual(["rest", true]);
    const walking = soldier.facing;
    // Put the Link 150 px ahead of it (beyond its standing sight).
    const p = game.players[0]!;
    [p.x, p.y] = [soldier.x + (walking === "left" ? -150 : 150) * SUBPX, soldier.y];
    run(game, world, 1);
    expect(soldier.phase).toBe("active");
  });

  it("struck and still standing, it's knocked 16 px/tick × 0.78 for 25 ticks, then winds up and chases (traced)", () => {
    const { game, world, soldier } = soldierAt({ x: 198, y: 100 }, 0x1004); // a 16-life soldier, the Link left of it
    press(game, world, 0, Button.Right);
    until(game, world, () => soldier.phase === "stun", 20, [Button.Sword]);
    expect(soldier.hp).toBe(12);
    const x0 = soldier.x;
    run(game, world, 2);
    expect([soldier.x - x0, soldier.y]).toEqual([3194 + 2491, 100 * SUBPX]); // 12.48, then 9.73 px
    run(game, world, SOLDIER_STUN_TICKS - 2);
    expect(soldier.phase).toBe("active");
    expect(px(soldier.x - x0)).toBe(56); // 56.7 px in the game
    run(game, world, SOLDIER_WINDUP_TICKS - 1);
    expect(soldier.phase).toBe("chase");
  });
});

describe("time-out", () => {
  it("Vaati flies in from the right, loops over the arena and leaves to the left (measured path)", () => {
    const world = arena();
    const game = start(world, [{ x: 60, y: 100, facing: "right" }, { x: 206, y: 102, facing: "up" }], props(), { ...RULES, timeLimit: 10 });
    run(game, world, 10);
    const [vaati] = of(game, "giantBomb");
    expect([px(vaati!.x), px(vaati!.y), px(vaati!.z)]).toEqual([ARENA_W + 64, 288, 100]);
    run(game, world, VAATI_ENTER_TICKS);
    expect(px(vaati!.x)).toBe(ARENA_W + 64 - 2 * VAATI_ENTER_TICKS); // 2 px/tick for 60 ticks (576 → 456)
    const xs: number[] = [];
    for (let t = VAATI_ENTER_TICKS; t < VAATI_TICKS - 1; t++, run(game, world, 1)) xs.push(px(vaati!.x));
    expect(Math.min(...xs.slice(0, VAATI_LEAVE_TICK - VAATI_ENTER_TICKS))).toBeGreaterThan(100); // loops over the arena
    expect(xs[xs.length - 1]).toBeLessThan(0); // then away to the left
    run(game, world, 1);
    expect(game.battle!.phase).toBe("roundOver"); // 454 ticks after the time-out
  });

  it("Vaati knocks out every Link, one in a side room too (measured: no shelter)", () => {
    const world = arena();
    const rules = { ...RULES, timeLimit: 60 };
    const game = start(world, [{ x: 60, y: 100, facing: "right" }, { x: 206, y: 102, facing: "up" }], props(), rules);
    game.players[1]!.y += sideRoomY(2) * SUBPX; // P2 in a house (a side room below the arena)
    run(game, world, 60);
    expect([game.battle!.phase, game.battle!.timeUp, game.battle!.timeLeft]).toEqual(["play", GIANT_BOMB_TICKS, 0]);
    expect(of(game, "giantBomb").length).toBe(1);
    run(game, world, GIANT_BOMB_TICKS - 1);
    expect(game.battle!.phase).toBe("play");
    run(game, world, 1);
    expect([game.battle!.phase, game.battle!.roundWinner, fighter(game, 0).mode, fighter(game, 1).mode, standing(game.battle!)]).toEqual(["roundOver", -1, "dying", "dying", []]);
  });

  it("so it's a draw", () => {
    const world = arena();
    const game = start(world, [{ x: 60, y: 100, facing: "right" }, { x: 206, y: 102, facing: "up" }], props(), { ...RULES, timeLimit: 30 });
    run(game, world, 30 + GIANT_BOMB_TICKS);
    expect([game.battle!.phase, game.battle!.roundWinner, standing(game.battle!)]).toEqual(["roundOver", -1, []]);
  });
});
