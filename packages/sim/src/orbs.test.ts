// Orb generators against the Dolphin traces (docs/measurements/battle-arenas.md "Battle measurements: arenas, orbs and camera"):
// frames there count from the round's first frame of play, ticks here from the end of the countdown.
import { describe, expect, it } from "vitest";
import type { Entity } from "./entities.ts";
import type { GameState } from "./game.ts";
import { ORB_FIRST_TICKS, ORB_LIFETIME, PICKUP_POP, TAKE_GIVE_TICK, TAKE_TICKS } from "./orbs.ts";
import { Button } from "./player.ts";
import type { ArenaProps } from "./props.ts";
import { setSwitch } from "./switches.ts";
import { arena, press, run, start, until } from "./testarena.ts";

const alive = (game: GameState, kind: Entity["kind"]) => game.battle!.entities.filter((e) => e.kind === kind && e.hp >= 0);

/** Each generator orb or item seen over `ticks` ticks: the tick it appeared on and the last tick it was there. */
function lives(game: GameState, world: ReturnType<typeof arena>, kind: Entity["kind"], ticks: number, before?: (t: number) => void) {
  const seen = new Map<number, { from: number; to: number }>();
  for (let t = 0; t < ticks; t++) {
    before?.(t);
    run(game, world, 1);
    for (const e of alive(game, kind)) if (e.home >= 0) seen.set(e.id, { from: seen.get(e.id)?.from ?? t, to: t });
  }
  return [...seen.values()];
}

describe("orb generators (measured)", () => {
  const world = arena();
  const spawns = [{ x: 40, y: 40, facing: "down" as const }, { x: 280, y: 200, facing: "down" as const }];
  const generator = (params: number): ArenaProps => ({ actors: [{ id: "CRGN", x: 160, y: 100, params }], bushes: [] });

  it("kind 1: an orb 450 ticks in, lying 899 ticks, the next 1500 ticks after the last (The Field: frames 458, 1958)", () => {
    const game = start(world, spawns, generator(1));
    expect(lives(game, world, "orb", 3200)).toEqual([
      { from: 449, to: 449 + 898 },
      { from: 449 + 1500, to: 449 + 1500 + 898 },
    ]);
  });

  it("kind 2: an item 150 ticks in, lying 599 ticks, the next 900 ticks after the last (Tower of Winds: 157, 1057)", () => {
    const game = start(world, spawns, generator(0x1e2));
    expect(lives(game, world, "pickup", 2000)).toEqual([
      { from: 149, to: 149 + 598 },
      { from: 149 + 900, to: 149 + 900 + 598 },
      { from: 149 + 1800, to: 1999 },
    ]);
  });

  it("an item taken on tick F: its generator restarts on F + 1, the next item on F + 301 (Tower of Winds: 203 → 504)", () => {
    const game = start(world, spawns, generator(0x1e2));
    run(game, world, 196);
    const [item] = alive(game, "pickup");
    // Facing it 13 px away, Action: taken on tick 196 (traced: R seen on 203, the item gone on 204), his 45 ticks later.
    Object.assign(game.players[0]!, { x: item!.x, y: item!.y + 13 * 256, facing: "up" });
    press(game, world, 0, Button.Action);
    const f = game.battle!.fighters[0]!;
    expect([alive(game, "pickup").length, f.move, f.item]).toEqual([0, "take", ""]);
    run(game, world, TAKE_GIVE_TICK + 1); // (the press tick is the move's -1)
    expect([f.item, f.itemLevel, f.invincible]).toEqual([item!.item, item!.param, 61]);
    run(game, world, TAKE_TICKS - TAKE_GIVE_TICK);
    expect(f.move).toBe("none");
    game.players[0]!.x = 40 * 256; // (away from the next one)
    const [next] = lives(game, world, "pickup", 400);
    expect(197 + TAKE_TICKS + 1 + next!.from).toBe(196 + 301);
  });

  it("items pop up (13 px, 2.7 px/tick up, 0.3 down) off a Link standing there; orbs drop from 10 px and bounce", () => {
    const game = start(world, [{ x: 160, y: 100, facing: "down" }, spawns[1]!], generator(0x1e2));
    run(game, world, 150);
    const [item] = alive(game, "pickup");
    // Traced (The Field, P1 on the generator): z 13 on its first tick, pushed 7 px up at once, then 4, 2, 1 once low.
    expect([item!.z, item!.phase, item!.y]).toEqual([13 * 256, "drop", 93 * 256]);
    run(game, world, 1);
    expect(item!.z).toBe(13 * 256 + PICKUP_POP.vz);
    const landed = 151 + until(game, world, () => item!.phase === "rest", 40);
    expect([landed - 150, item!.y / 256]).toEqual([23, 87]);
    run(game, world, 1);
    expect(item!.y / 256).toBe(86); // 14 px off his anchor
    const orbs = start(world, spawns, generator(1));
    run(orbs, world, ORB_FIRST_TICKS);
    const [orb] = alive(orbs, "orb");
    expect([orb!.z, orb!.phase]).toEqual([10 * 256, "drop"]);
    expect(until(orbs, world, () => orb!.phase === "rest", 40)).toBe(29); // traced: 458 → 487
    expect(Math.hypot(orb!.x - 160 * 256, orb!.y - 100 * 256) / 256).toBeCloseTo(6, 0);
  });

  it("a gated generator counts only while its switch is on (Tower of Flames: switch 2 on at tick 599, an item at 748)", () => {
    const game = start(world, spawns, generator((2 << 27) | 0x1e2));
    const seen = lives(game, world, "pickup", 800, (t) => t === 599 && setSwitch(game.battle!, 2, true));
    expect(seen.map((l) => l.from)).toEqual([748]);
  });

  it("an orb's lifetime only runs while it lies there (CRTL +0x278 stopped at the lift)", () => {
    const game = start(world, [{ x: 144, y: 100, facing: "right" }, spawns[1]!], generator(1));
    run(game, world, ORB_FIRST_TICKS + 100);
    const [orb] = alive(game, "orb");
    expect(orb!.timer).toBe(ORB_LIFETIME - 101);
    press(game, world, 0, Button.Action);
    expect(orb!.phase).toBe("held");
    run(game, world, 200);
    expect(orb!.timer).toBe(ORB_LIFETIME - 101);
  });
});
