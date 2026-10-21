// Side view (siderooms.ts; the Tower of Winds' TV, its gallery, the rooms under the holes): gravity for Links and for
// things, ladders, the Tower of Winds' gates, throws, and determinism through clones, hashes and a rollback. The
// timings are the traced ones (docs/measurements/side-rooms.md "Side rooms"; dolphin-battle-traces.json replays the traces).
import { describe, expect, it } from "vitest";
import { SIDE_THROW_SPEED } from "./carry.ts";
import { KNOCK_DEFAULT } from "./combat.ts";
import { spawnEntity } from "./entities.ts";
import { cloneGame, stepGame, type GameState } from "./game.ts";
import { hashGame } from "./hash.ts";
import { Button, SUBPX, WALK_SPEED } from "./player.ts";
import type { ArenaProps } from "./props.ts";
import {
  CLIMB_SPEED,
  decodeWarps,
  FALL_HALF,
  GATE_STEP,
  SIDE_FALL_SPEED,
  SIDE_GRAVITY,
  sideRoomY,
  screenAt,
  WARP_ENTER_TICKS,
  WARP_STAND_TICKS,
  WARP_TICKS,
  WARP_WALK_TICKS,
} from "./siderooms.ts";
import { press, px, run, start, until, worldFrom } from "./testarena.ts";

/**
 * A 320×240 px side-view screen: a floor at y 192 (rows 24-25), a ledge at y 120-135 (cells 4-14), a ladder (cells 16-17,
 * y 80-191) by the ledge's right end; and side room 1 laid out the same way below it (siderooms.ts sideRoomY).
 */
function screenRows(): string[] {
  return Array.from({ length: 30 }, (_, y) =>
    Array.from({ length: 40 }, (_, x) => {
      if (x === 0 || x === 39 || y === 0 || y >= 24) return "#";
      if ((y === 15 || y === 16) && x >= 4 && x <= 14) return "#";
      if (y >= 10 && x >= 16 && x <= 17) return "H";
      return ".";
    }).join(""),
  );
}
const world = worldFrom([...screenRows(), ...Array.from({ length: sideRoomY(1) / 8 - 30 }, () => "#".repeat(40)), ...screenRows()]);
/** The Tower of Winds' first gate, on the TV and in the gallery (boss500 room 2's WARPs at (56, 176), style 21). */
const GATES = decodeWarps(
  [
    { sublayer: 0, x: 56, y: 176, params: 0x01071615 },
    { sublayer: 1, x: 56, y: 176, params: 0x00071615 },
  ],
  () => true,
);
const PROPS: ArenaProps = { actors: [], bushes: [], warps: GATES, sideRooms: 1 << 1, sideViews: 0b11 };
/** Where a Link stands on the floor (his anchor 7.5 px over it: the sensors' backing off, as traced: 184.5 to 185). */
const FLOOR_Y = 184.5;

const on = (game: GameState, i = 0) => ({ p: game.players[i]!, f: game.battle!.fighters[i]! });

describe("side view: walking, falling, ladders", () => {
  it("falls 4 px a tick off a ledge, lands on the ground; Up and Down only turn him off a ladder", () => {
    const game = start(world, [{ x: 100, y: 112, facing: "right" }, { x: 290, y: 184, facing: "left" }], PROPS);
    const { p, f } = on(game);
    expect(px(p.y)).toBe(112); // on the ledge (its top at 120)
    until(game, world, () => p.y > 113 * SUBPX, 80, [Button.Left]); // off its left end (x 32), sliding off its corner
    const ys = [p.y];
    until(game, world, () => (ys.push(p.y), ys.length > 2 && p.y === ys[ys.length - 2] && p.y === ys[ys.length - 3]), 40);
    expect(Math.max(...ys.slice(1).map((y, k) => y - ys[k]!))).toBe(SIDE_FALL_SPEED);
    expect(px(p.y)).toBe(184); // on the floor (its top at 192)
    run(game, world, 10, [Button.Up]);
    expect([px(p.y), p.facing, f.move]).toEqual([184, "up", "none"]); // turned, not moved (traced)
    run(game, world, 10, [Button.Down]);
    expect([px(p.y), p.facing]).toEqual([184, "down"]);
  });

  it("climbs a ladder at walking speed both ways (traced) up to its top, and stays level stepping onto it", () => {
    const game = start(world, [{ x: 132, y: 112, facing: "right" }, { x: 290, y: 184, facing: "left" }], PROPS);
    const { p } = on(game);
    // From the ledge onto the ladder's column at the ledge's level: no fall (traced on the Tower of Winds).
    until(game, world, () => px(p.x) >= 136, 20, [Button.Right]);
    expect(px(p.y)).toBe(112);
    const y0 = p.y;
    run(game, world, 4, [Button.Down]);
    expect(p.y - y0).toBe(4 * CLIMB_SPEED);
    expect(CLIMB_SPEED).toBe(WALK_SPEED);
    until(game, world, () => p.y === FLOOR_Y * SUBPX, 100, [Button.Down]); // down to the floor
    const y1 = p.y;
    run(game, world, 4, [Button.Up]);
    expect(y1 - p.y).toBe(4 * CLIMB_SPEED);
    until(game, world, () => p.y < 76 * SUBPX, 200, [Button.Up]); // to its top (y 80): his feet on it
    run(game, world, 10, []);
    expect(px(p.y)).toBeGreaterThanOrEqual(72);
    expect(px(p.y)).toBeLessThan(80);
  });

  it("knocked off a ledge he falls while the knockback and its hop go on (traced)", () => {
    const game = start(world, [{ x: 100, y: 112, facing: "right" }, { x: 112, y: 112, facing: "down" }], PROPS);
    const { p: p2, f: f2 } = on(game, 1);
    p2.x = 116 * SUBPX; // at the ledge's right end (x 120)
    until(game, world, () => f2.mode === "hurt", 10, [Button.Sword]);
    expect(f2.pushX).toBe(KNOCK_DEFAULT.speed);
    const ys: number[] = [];
    until(game, world, () => (ys.push(p2.y), f2.z === 0 && f2.mode === "active"), 40);
    expect(Math.max(...ys.slice(1).map((y, k) => y - ys[k]!))).toBe(SIDE_FALL_SPEED); // falling at 4 px a tick meanwhile
    expect(px(p2.x)).toBeGreaterThanOrEqual(116 + 37); // 25 ticks of 1.5 px, and off the corner (traced: 3.3 px a tick)
    until(game, world, () => px(p2.y) === 184, 40); // then on down to the floor
  });
});

describe("side view: things fall", () => {
  it("a bomb with nothing under it falls 0.15, 0.30 … px a tick and stops with its box on the ground (traced)", () => {
    const game = start(world, [{ x: 40, y: 184, facing: "right" }, { x: 290, y: 184, facing: "left" }], PROPS);
    const bomb = spawnEntity(game.battle!, "bomb", 200 * SUBPX, 140 * SUBPX, { timer: 300 });
    const ys = [bomb.y];
    for (let t = 0; t < 40; t++) (stepGame(game, [], world), ys.push(bomb.y));
    expect(ys[1]! - ys[0]!).toBe(SIDE_GRAVITY);
    expect(ys[2]! - ys[1]!).toBe(2 * SIDE_GRAVITY);
    expect(px(bomb.y)).toBe(192 - FALL_HALF); // its box's last row over the floor's (traced: 201 over the gallery's 208)
    expect(bomb.vy).toBe(0);
  });

  it("a pot thrown leaves at its height as screen y, 6 px a tick, falling as a bomb does, and breaks on the floor (traced)", () => {
    const pot = 11 * 32 + 6; // the 16 px tile at (96, 176): on the floor
    const rows = screenRows();
    rows[22] = rows[22]!.slice(0, 12) + "##" + rows[22]!.slice(14);
    rows[23] = rows[23]!.slice(0, 12) + "##" + rows[23]!.slice(14);
    const potWorld = worldFrom(rows);
    const game = start(potWorld, [{ x: 80, y: 184, facing: "right" }, { x: 290, y: 184, facing: "left" }], { ...PROPS, pots: [pot] });
    const { p, f } = on(game);
    press(game, potWorld, 0, Button.Action);
    until(game, potWorld, () => f.move === "carry", 40);
    press(game, potWorld, 0, Button.Action);
    const thrown = game.battle!.entities.find((e) => e.kind === "pot")!;
    until(game, potWorld, () => thrown.phase === "flying", 20);
    expect([thrown.z, thrown.vx, px(p.y) - px(thrown.y)]).toEqual([0, SIDE_THROW_SPEED, 20]); // (traced: 328.9 → 308.95)
    const x0 = thrown.x;
    stepGame(game, [], potWorld);
    expect(thrown.x - x0).toBe(SIDE_THROW_SPEED);
    until(game, potWorld, () => thrown.hp < 0, 30);
    expect(game.battle!.entities.some((e) => e.kind === "debris")).toBe(true); // broken where it landed
  });
});

describe("the Tower of Winds' gates (style 21)", () => {
  /** P1 standing in the TV gate's box, facing right. */
  const atGate = () => {
    const game = start(world, [{ x: 72, y: 184, facing: "left" }, { x: 290, y: 184, facing: "left" }], PROPS);
    run(game, world, 4);
    return { game, ...on(game) };
  };

  it("doesn't take a Link walking past it, nor one who kept Up held from before; a new press takes him", () => {
    const game = start(world, [{ x: 120, y: 184, facing: "left" }, { x: 290, y: 184, facing: "left" }], PROPS);
    const { p, f } = on(game);
    until(game, world, () => px(p.x) <= 20, 120, [Button.Left]); // past it to the wall
    expect(f.move).toBe("none");
    run(game, world, 10, [Button.Up]); // pressed out of its box (x 60-68 ± 7)
    until(game, world, () => px(p.x) >= 64, 40, [Button.Up | Button.Right]);
    run(game, world, 3, [Button.Up]);
    expect(f.move).toBe("none");
    stepGame(game, [0], world);
    stepGame(game, [Button.Up], world); // a new press, his body in the box
    expect(f.move).toBe("warp");
    expect(screenAt(p.y)).toBe(0);
  });

  it("walks him into it 1/32 px a tick for 40 ticks, out of the gallery's 1.25 px under it, free on the 111th (traced)", () => {
    const { game, p, f } = atGate();
    stepGame(game, [Button.Up], world);
    expect([f.move, p.facing]).toEqual(["warp", "up"]); // (traced: Up on frame 71, state 28 from 72)
    const y0 = p.y;
    run(game, world, WARP_ENTER_TICKS - 1, [Button.Left]);
    expect([px(p.x), y0 - p.y]).toEqual([64, (WARP_ENTER_TICKS - 1) * GATE_STEP]); // lined up on it, walking in
    stepGame(game, [], world);
    expect([px(p.x), p.y]).toEqual([64, (sideRoomY(1) + 184) * SUBPX]); // the gallery's gate (traced: (64, 184) on screen 8)
    stepGame(game, [], world);
    expect(p.y).toBe((sideRoomY(1) + 185.25) * SUBPX); // (traced: 185.25)
    run(game, world, WARP_STAND_TICKS + WARP_WALK_TICKS - 2);
    expect(p.y).toBe((sideRoomY(1) + 184) * SUBPX + GATE_STEP);
    stepGame(game, [], world);
    expect([f.move, p.y, p.facing]).toEqual(["none", (sideRoomY(1) + 184) * SUBPX, "up"]);
  });

  it("back from the gallery he walks down out of the TV's gate, facing down (main.dol)", () => {
    const { game, p, f } = atGate();
    stepGame(game, [Button.Up], world);
    run(game, world, WARP_TICKS + 5);
    stepGame(game, [0], world);
    stepGame(game, [Button.Down], world);
    expect([f.move, p.facing, screenAt(p.y)]).toEqual(["warp", "down", 1]);
    run(game, world, WARP_TICKS);
    expect([f.move, screenAt(p.y), px(p.x), p.facing]).toEqual(["none", 0, 64, "down"]);
    expect(p.y).toBe(184 * SUBPX);
  });

  it("is deterministic: a clone and a JSON copy replay to the same hashes through gates, ladders and falls, and a rollback", () => {
    const script = (t: number) =>
      t < 20 ? [Button.Left] : t === 22 ? [Button.Up] : t < 200 ? [] : t < 260 ? [Button.Right] : t % 3 ? [Button.Down] : [Button.Up | Button.Sword];
    const game = start(world, [{ x: 100, y: 184, facing: "left" }, { x: 132, y: 112, facing: "right" }], PROPS);
    spawnEntity(game.battle!, "bomb", 200 * SUBPX, 40 * SUBPX, { timer: 250 });
    const hashes: number[] = [];
    let mid: GameState | null = null;
    for (let t = 0; t < 400; t++) {
      if (t === 60) mid = cloneGame(game);
      stepGame(game, [...script(t), t % 40 < 20 ? Button.Right : Button.Down], world);
      hashes.push(hashGame(game));
    }
    const replay = (from: GameState) => {
      const out: number[] = [];
      for (let t = 60; t < 400; t++) {
        stepGame(from, [...script(t), t % 40 < 20 ? Button.Right : Button.Down], world);
        out.push(hashGame(from));
      }
      return out;
    };
    expect(mid!.battle!.fighters[0]!.move).toBe("warp");
    expect(replay(JSON.parse(JSON.stringify(mid)) as GameState)).toEqual(hashes.slice(60));
    const branch = cloneGame(mid!);
    for (let t = 0; t < 8; t++) stepGame(branch, [Button.Up, Button.Left | Button.Sword], world);
    expect(replay(cloneGame(mid!))).toEqual(hashes.slice(60));
  });
});
