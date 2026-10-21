// The switch network (switches.ts), Above the Clouds' colored panels (panels.ts) and the tiles they show
// (arenatiles.ts), with the arenas' own params.
import { describe, expect, it } from "vitest";
import { tileOverrides, CRYSTAL_LIT_TILE, CRYSTAL_UNLIT_TILE } from "./arenatiles.ts";
import { ROUND_OVER_TICKS } from "./battle.ts";
import { BOMB_FUSE } from "./bombs.ts";
import { FALL_TICKS, HEART, SWORD_DAMAGE } from "./combat.ts";
import { isRemoved, spawnEntity, type Entity } from "./entities.ts";
import type { GameState } from "./game.ts";
import { PANEL_DEFAULT_PERIOD, PANEL_TILE, panelColor } from "./panels.ts";
import { SUBPX } from "./player.ts";
import type { ArenaProps, Prop } from "./props.ts";
import { GEN3_SPAWN_TICK, RNSW_PERIOD_UNIT, setSwitch, switchOn, CRYSTAL_LOCKOUT } from "./switches.ts";
import { strikeEntity } from "./strike.ts";
import { arena, run, RULES, start, until } from "./testarena.ts";

const props = (...actors: Prop[]): ArenaProps => ({ actors, bushes: [] });
const of = (game: GameState, kind: Entity["kind"]) => game.battle!.entities.filter((e) => e.kind === kind && e.hp >= 0);
const on = (game: GameState, ...n: number[]) => n.map((s) => switchOn(game.battle!, s));
const TWO = [
  { x: 40, y: 200, facing: "up" },
  { x: 280, y: 200, facing: "up" },
] as const;

describe("switch logic", () => {
  it("SWOR is on while any input is (Tower of Flames 0x5a52f784: 11 = 9 or 15)", () => {
    const world = arena();
    const game = start(world, [...TWO], props({ id: "SWOR", x: 0, y: 0, params: 0x5a52f784 }));
    const b = game.battle!;
    run(game, world, 1);
    expect(on(game, 11)).toEqual([false]);
    setSwitch(b, 15, true);
    run(game, world, 1);
    expect(on(game, 11)).toEqual([true]);
    setSwitch(b, 15, false);
    setSwitch(b, 9, true);
    run(game, world, 1);
    expect(on(game, 11)).toEqual([true]);
    setSwitch(b, 9, false);
    run(game, world, 1);
    expect(on(game, 11)).toEqual([false]);
  });

  it("RNSW turns on one of its outputs every period, the others off (Above the Clouds 0x00443228: 1-4 every 400)", () => {
    const world = arena();
    const game = start(world, [...TWO], props({ id: "RNSW", x: 0, y: 0, params: 0x00443228 }));
    const period = (0x28 & 0x3f) * RNSW_PERIOD_UNIT;
    expect(period).toBe(400);
    run(game, world, period - 1);
    expect(on(game, 1, 2, 3, 4)).toEqual([false, false, false, false]);
    const picks = new Set<number>();
    for (let k = 0; k < 12; k++) {
      run(game, world, k ? period : 1);
      const lit = [1, 2, 3, 4].filter((s) => switchOn(game.battle!, s));
      expect(lit).toHaveLength(1);
      picks.add(lit[0]!);
    }
    expect(picks.size).toBeGreaterThan(2);
  });

  it("CKSW picks one of four switches at once; a WTSW sets its own a delay after its input (the clouds' center orb)", () => {
    const world = arena();
    // CKSW 0x018e8480: one of 6, 7, 8, 9 at load; WTSW 0x2… set 5 after 1, 121, 241 or 361 ticks.
    const waits = [
      [6, 1],
      [7, 121],
      [8, 241],
      [9, 361],
    ].map(([input, delay]) => ({ id: "WTSW", x: 0, y: 0, params: ((5 << 27) | (input! << 22) | delay!) >>> 0 }));
    const delays = new Set<number>();
    for (let seed = 1; seed <= 16; seed++) {
      const game = start(world, [...TWO], props({ id: "CKSW", x: 0, y: 0, params: 0x018e8480 }, ...waits), RULES, seed);
      const picked = [6, 7, 8, 9].filter((s) => switchOn(game.battle!, s));
      expect(picked).toHaveLength(1);
      delays.add(until(game, world, () => switchOn(game.battle!, 5), 400));
      expect(of(game, "logic")).toHaveLength(3); // the CKSW and the WTSW that fired are done
    }
    expect([...delays].every((d) => [1, 121, 241, 361].includes(d))).toBe(true);
    expect(delays.size).toBeGreaterThan(1);
  });

  it("CHSW: a rising edge of its switch, a delay, then its target set and its own switch cleared (a pulse)", () => {
    const world = arena();
    // Tower of Winds 0x8c640080: trigger 17, after 128 ticks clear 17 (and set target 17: the same switch, so off wins).
    const game = start(world, [...TWO], props({ id: "CHSW", x: 0, y: 0, params: 0x8c640080 }));
    setSwitch(game.battle!, 17, true);
    run(game, world, 128); // the edge is seen on the first tick, then 128 more
    expect(on(game, 17)).toEqual([true]);
    run(game, world, 1);
    expect(on(game, 17)).toEqual([false]);
  });

  it("SWT4 turns on when all four inputs are on, and off when one goes off", () => {
    const world = arena();
    // Tower of Winds 0xb94a6300: 23 = 5 & 5 & 6 & 6.
    const game = start(world, [...TWO], props({ id: "SWT4", x: 0, y: 0, params: 0xb94a6300 }));
    setSwitch(game.battle!, 5, true);
    run(game, world, 1);
    expect(on(game, 23)).toEqual([false]);
    setSwitch(game.battle!, 6, true);
    run(game, world, 1);
    expect(on(game, 23)).toEqual([true]);
    setSwitch(game.battle!, 5, false);
    run(game, world, 1);
    expect(on(game, 23)).toEqual([false]);
  });

  it("OFFS mode 0 clears a switch on each rising edge of its trigger", () => {
    const world = arena();
    const game = start(world, [...TWO], props({ id: "OFFS", x: 0, y: 0, params: (22 << 27) | (14 << 22) }));
    setSwitch(game.battle!, 14, true);
    run(game, world, 2);
    expect(on(game, 14)).toEqual([true]);
    setSwitch(game.battle!, 22, true);
    run(game, world, 1);
    expect(on(game, 14)).toEqual([false]);
    setSwitch(game.battle!, 14, true);
    run(game, world, 1);
    expect(on(game, 14)).toEqual([true]); // no new edge
  });

  it("the switches and the logic start over each round", () => {
    const world = arena();
    const game = start(world, [...TWO], props({ id: "CKSW", x: 0, y: 0, params: (14 << 22) | (14 << 17) | (14 << 12) | (14 << 7) }));
    expect(on(game, 14)).toEqual([true]);
    setSwitch(game.battle!, 3, true);
    game.battle!.fighters[1]!.hearts = 0; // P1 wins the round
    until(game, world, () => game.battle!.phase === "countdown", ROUND_OVER_TICKS + 10);
    expect(on(game, 14, 3)).toEqual([true, false]);
  });
});

describe("GEN3 spawners", () => {
  it("spawn soldiers with their kind's life: kind 0x1B's 16 takes four stabs (traced: 4 each), kind 3's 1 one", () => {
    const world = arena();
    const game = start(world, [...TWO], props({ id: "GEN3", x: 100, y: 100, params: 0x0811001b }, { id: "GEN3", x: 200, y: 100, params: 0x10110003 }));
    setSwitch(game.battle!, 1, true);
    setSwitch(game.battle!, 2, true);
    run(game, world, GEN3_SPAWN_TICK + 1);
    expect(of(game, "soldier").map((e) => e.hp)).toEqual([16, 1]);
    const [tough] = of(game, "soldier");
    const stab = () => ((tough!.phase = "rest"), strikeEntity(game.battle!, tough!, SWORD_DAMAGE, tough!.x - 20 * SUBPX, tough!.y));
    for (let n = 0; n < 3; n++) stab();
    expect(tough!.hp).toBe(4);
    stab();
    expect(isRemoved(tough!)).toBe(true);
  });

  it("drop a lit bomb (kind 0x16) or a sword soldier on each rising edge of their switch", () => {
    const world = arena();
    const game = start(world, [...TWO], props({ id: "GEN3", x: 160, y: 100, params: 0xb8110096 }, { id: "GEN3", x: 100, y: 100, params: 0x08110003 }));
    run(game, world, 10);
    expect([of(game, "bomb").length, of(game, "soldier").length]).toEqual([0, 0]);
    setSwitch(game.battle!, 23, true);
    setSwitch(game.battle!, 1, true);
    run(game, world, GEN3_SPAWN_TICK + 1);
    const [bomb] = of(game, "bomb");
    expect([bomb!.x / SUBPX, bomb!.y / SUBPX, bomb!.timer > BOMB_FUSE - 5]).toEqual([160, 100, true]);
    expect(of(game, "soldier")).toHaveLength(1);
    run(game, world, 20);
    expect(of(game, "bomb")).toHaveLength(1); // once per edge
    setSwitch(game.battle!, 23, false);
    run(game, world, 1);
    setSwitch(game.battle!, 23, true);
    run(game, world, GEN3_SPAWN_TICK + 1);
    expect(of(game, "bomb")).toHaveLength(2);
  });
});

describe("ONOF crystals (the Dark World Tower of Flames)", () => {
  it("a blast lights a timed crystal: its switch is on for its timer, then it goes out and ignores fire a moment", () => {
    const world = arena();
    const game = start(world, [...TWO], props({ id: "ONOF", x: 80, y: 176, params: 0xb8002180 })); // switch 23, 384 ticks
    const [crystal] = of(game, "crystal");
    expect([crystal!.x / SUBPX, crystal!.y / SUBPX, crystal!.phase]).toEqual([88, 184, "rest"]);
    const b = game.battle!;
    spawnEntity(b, "bomb", 96 * SUBPX, 184 * SUBPX, { timer: 1 });
    run(game, world, 2);
    expect([crystal!.phase, switchOn(b, 23)]).toEqual(["active", true]);
    expect(tileOverrides(b, () => 0).get(Math.floor(184 / 16) * 32 + Math.floor(88 / 16))).toBe(CRYSTAL_LIT_TILE);
    run(game, world, 0x180 - 2);
    expect(crystal!.phase).toBe("active");
    run(game, world, 2);
    expect([crystal!.phase, switchOn(b, 23)]).toEqual(["rest", false]);
    expect(tileOverrides(b, () => 0).get(Math.floor(184 / 16) * 32 + Math.floor(88 / 16))).toBe(CRYSTAL_UNLIT_TILE);
    spawnEntity(b, "bomb", 96 * SUBPX, 184 * SUBPX, { timer: 1 });
    run(game, world, 3);
    expect(crystal!.phase).toBe("rest"); // within the lockout
    run(game, world, CRYSTAL_LOCKOUT);
    spawnEntity(b, "bomb", 96 * SUBPX, 184 * SUBPX, { timer: 1 });
    run(game, world, 2);
    expect(crystal!.phase).toBe("active");
  });
});

describe("Above the Clouds' colored panels", () => {
  // A 2×2-tile patch of panels (params 0, as in rooms 4 and 9) at tiles (4..5, 4..5): (64..95, 64..95).
  const panels = [64, 80].flatMap((y) => [64, 80].map((x): Prop => ({ id: "RBPN", x, y, params: 0 })));

  it("step through the players' colors every 120 ticks and show it", () => {
    const world = arena();
    const game = start(world, [...TWO], props(...panels));
    const b = game.battle!;
    expect(b.panels.map((_, k) => panelColor(b, k))).toEqual([0, 0, 0, 0]);
    run(game, world, PANEL_DEFAULT_PERIOD - 1);
    expect(panelColor(b, 0)).toBe(0);
    run(game, world, 1);
    expect(b.panels.map((_, k) => panelColor(b, k))).toEqual([1, 1, 1, 1]);
    expect(tileOverrides(b, () => 0).get(4 * 32 + 4)).toBe(PANEL_TILE + 1);
    run(game, world, 3 * PANEL_DEFAULT_PERIOD);
    expect(panelColor(b, 3)).toBe(0);
  });

  it("are solid ground only for the Link of their color: the others fall", () => {
    const world = arena();
    const game = start(world, [{ x: 72, y: 70, facing: "down" }, { x: 88, y: 86, facing: "down" }], props(...panels));
    const b = game.battle!;
    until(game, world, () => b.fighters[1]!.mode === "falling", 5);
    expect(b.fighters.map((f) => f.mode)).toEqual(["active", "falling"]); // color 0 = P1's
    expect(b.fighters[1]!.hearts).toBe(RULES.hearts * HEART); // a pit's damage comes when he lands back (combat.ts)
    b.fighters[1]!.spawnX = 200; // he climbs back out away from the panels
    run(game, world, 60);
    run(game, world, PANEL_DEFAULT_PERIOD); // they turn P2's color: now P1 falls (and again where he climbs back out)
    run(game, world, FALL_TICKS);
    expect(b.fighters[0]!.hearts).toBeLessThan(RULES.hearts * HEART);
  });
});
