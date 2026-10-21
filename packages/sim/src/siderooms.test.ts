// The side rooms' doors (siderooms.ts): decoding the WARP actors, the door walk's measured timing, the latch, rooms
// kept apart, and determinism through clones, hashes and a rollback; Hyrule Castle's magic circles to its dark side and
// back (the timings traced in Dolphin).
import { describe, expect, it } from "vitest";
import { SWORD_DAMAGE } from "./combat.ts";
import { cloneGame, stepGame, type GameState } from "./game.ts";
import { hashGame } from "./hash.ts";
import { Button, SUBPX } from "./player.ts";
import type { ArenaProps } from "./props.ts";
import { CIRCLE_GROW_TICKS } from "./hazards.ts";
import {
  CIRCLE_ARRIVE_TICK,
  CIRCLE_BACK_Y,
  CIRCLE_HOLD,
  CIRCLE_SETTLE,
  CIRCLE_TICKS,
  DARK_TICKS,
  decodeWarps,
  inSideRoom,
  screenAt,
  sideRoomY,
  SPOT_ARRIVE_TICK,
  SPOT_TICKS,
  WARP_ENTER_TICKS,
  WARP_STAND_TICKS,
  WARP_TICKS,
  type Warp,
} from "./siderooms.ts";
import { setSwitch } from "./switches.ts";
import { press, px, RULES, run, start, until, worldFrom } from "./testarena.ts";
import type { World } from "./world.ts";

/** The Field's two doors as listed (boss500 room 0): the cave (to s5) and the house (to s2), both style 25. */
const FIELD_WARPS = [
  { sublayer: 0, x: 136, y: 80, params: 0x05091019 },
  { sublayer: 0, x: 248, y: 160, params: 0x02091019 },
];

describe("decodeWarps", () => {
  it("turns The Field's style-25 doors into a door up into each room and a door back down out of it", () => {
    const warps = decodeWarps(FIELD_WARPS);
    const brief = (w: Warp) => [w.x, w.y, w.toX, w.toY, w.style, w.top / SUBPX, w.bottom / SUBPX];
    expect(warps.map(brief)).toEqual([
      [144, 88, 80, sideRoomY(5) + 136, 0, -20, 4],
      [80, sideRoomY(5) + 136, 144, 88, 1, -4, 20],
      [256, 168, 80, sideRoomY(2) + 136, 0, -20, 4], // traced: in at (767.5, 562) world, out at (80, 136) on screen 9
      [80, sideRoomY(2) + 136, 256, 168, 1, -4, 20], // traced: back at (768, 552) world = (256, 168)
    ]);
  });

  it("reads holes, gates and styles from the params", () => {
    // Above the Clouds' hole (to s2 (144, 0)) and its side room's way up (style 3), the Tower of Winds' gate (style 21).
    const [hole, up, gateTv, gateSide] = decodeWarps(
      [
        { sublayer: 0, x: 240, y: 160, params: 0x02120004 },
        { sublayer: 2, x: 64, y: 0, params: 0x001e1403 },
        { sublayer: 0, x: 56, y: 176, params: 0x01071615 },
        { sublayer: 1, x: 56, y: 176, params: 0x00071615 },
      ],
      (k) => k === 1,
    );
    expect([hole!.x, hole!.y, hole!.toX, hole!.toY, hole!.style, hole!.right / SUBPX]).toEqual([248, 168, 152, sideRoomY(2) + 8, 4, 1]);
    expect([up!.toX, up!.toY, up!.style]).toEqual([248, 168, 3]);
    expect([gateTv!.top / SUBPX, gateTv!.bottom / SUBPX, gateSide!.top / SUBPX, gateSide!.bottom / SUBPX]).toEqual([-20, 4, -4, 4]); // side view: ±4
  });
});

/**
 * A 320×240 px arena (40×30 cells) with a wall border, and below it, at sublayer k's place (2 by default), a walled
 * 320×240 side room: the rows between them solid.
 */
function twoRooms(k = 2): World {
  const room = (y: number) => Array.from({ length: 40 }, (_, x) => (x === 0 || y === 0 || x === 39 || y === 29 ? "#" : ".")).join("");
  const rows: string[] = [];
  for (let y = 0; y < sideRoomY(k) / 8 + 30; y++) rows.push(y < 30 ? room(y) : y < sideRoomY(k) / 8 ? "#".repeat(40) : room(y - sideRoomY(k) / 8));
  return worldFrom(rows);
}

/** A door up into the side room at (160, 104) (its anchor; it leads to (80, 136) there) and the way back down. */
const DOORS: ArenaProps = { actors: [], bushes: [], warps: decodeWarps([{ sublayer: 0, x: 152, y: 96, params: 0x02091019 }]) };

const door = DOORS.warps![0]!, back = DOORS.warps![1]!;

describe("going through a door", () => {
  const world = twoRooms();

  it("walks into the door 40 ticks, comes out of the other one, stands 30, walks out 40, then has control (measured)", () => {
    const game = start(world, [{ x: 160, y: 140, facing: "up" }, { x: 40, y: 40, facing: "down" }], DOORS);
    const p = game.players[0]!, f = game.battle!.fighters[0]!;
    // Up toward the door: its box reaches 4 px below its anchor, so the ±7 px body meets it at y = 104 + 4 + 7.
    let ticks = 0;
    while (f.move !== "warp") {
      stepGame(game, [Button.Up], world);
      if (++ticks > 60) throw new Error("never went through the door");
    }
    expect(px(p.y)).toBeLessThanOrEqual(115);
    const y0 = p.y, x0 = door.x * SUBPX;
    stepGame(game, [Button.Down], world); // input is ignored from here
    expect([p.x, p.y, p.facing]).toEqual([x0, y0 - SUBPX / 2, "up"]); // lined up on the door, 0.5 px in
    run(game, world, WARP_ENTER_TICKS - 2, [Button.Down]);
    expect(p.y).toBe(y0 - (WARP_ENTER_TICKS - 1) * (SUBPX / 2)); // 39 steps of 0.5 px
    expect(screenAt(p.y)).toBe(0);
    stepGame(game, [Button.Down], world);
    expect([px(p.x), px(p.y), inSideRoom(game, 0)]).toEqual([80, sideRoomY(2) + 136, true]); // out of the other door
    run(game, world, WARP_STAND_TICKS, [Button.Down]);
    expect([px(p.x), px(p.y)]).toEqual([80, sideRoomY(2) + 136]); // stood 30 ticks
    run(game, world, WARP_TICKS - WARP_ENTER_TICKS - WARP_STAND_TICKS, [Button.Down]);
    expect([px(p.y), f.move]).toEqual([sideRoomY(2) + 116, "none"]); // walked 20 px in; free
    stepGame(game, [Button.Down], world); // the turn tick, then walking
    stepGame(game, [Button.Down], world);
    expect(p.facing).toBe("down");
    expect(p.y).toBeGreaterThan((sideRoomY(2) + 116) * SUBPX);
  });

  it("doesn't take a Link who just came out back in (the latch), but does once he left its box and comes back", () => {
    const game = start(world, [{ x: 160, y: 140, facing: "up" }, { x: 40, y: 40, facing: "down" }], DOORS);
    const p = game.players[0]!, f = game.battle!.fighters[0]!;
    run(game, world, 30, [Button.Up]);
    run(game, world, WARP_TICKS, []);
    expect([f.move, inSideRoom(game, 0)]).toEqual(["none", true]);
    // Standing just inside the way back's box after coming out of it is fine; walking down into it takes him out.
    let ticks = 0;
    while (f.move !== "warp") {
      stepGame(game, [Button.Down], world);
      if (++ticks > 40) throw new Error("never went back out");
    }
    run(game, world, WARP_TICKS, []);
    expect([inSideRoom(game, 0), px(p.x), px(p.y), p.facing]).toEqual([false, back.toX, back.toY + 20, "down"]);
  });

  it("keeps the rooms apart: a sword on the TV doesn't reach into the side room; two Links inside fight as usual", () => {
    // P1 in the side room right under P2's position on the TV, P2 swinging down: nothing. Then P3 inside swings at P1.
    const game = start(world, [{ x: 100, y: 100, facing: "up" }, { x: 100, y: 84, facing: "down" }, { x: 100, y: 120, facing: "up" }], DOORS);
    game.players[0]!.y += sideRoomY(2) * SUBPX;
    press(game, world, 1, Button.Sword);
    run(game, world, 20);
    expect(game.battle!.fighters[0]!.hearts).toBe(RULES.hearts * 4);
    game.players[2]!.y = game.players[0]!.y + 18 * SUBPX;
    press(game, world, 2, Button.Sword);
    run(game, world, 3);
    expect(game.battle!.fighters[0]!.hearts).toBe(RULES.hearts * 4 - SWORD_DAMAGE); // measured: two Links in The Field's house
  });

  it("is deterministic: a clone and a JSON copy taken mid-walk replay to the same hashes, and so does a rollback", () => {
    const script = (t: number) => (t < 30 ? [Button.Up] : t < 160 ? [] : t < 200 ? [Button.Down] : [Button.Down | Button.Sword]);
    const game = start(world, [{ x: 160, y: 140, facing: "up" }, { x: 40, y: 40, facing: "down" }], DOORS);
    const hashes: number[] = [];
    let mid: GameState | null = null;
    for (let t = 0; t < 360; t++) {
      if (t === 60) mid = cloneGame(game);
      stepGame(game, script(t), world);
      hashes.push(hashGame(game));
    }
    const replay = (from: GameState) => {
      const out: number[] = [];
      for (let t = 60; t < 360; t++) {
        stepGame(from, script(t), world);
        out.push(hashGame(from));
      }
      return out;
    };
    expect(mid!.battle!.fighters[0]!.move).toBe("warp");
    expect(replay(JSON.parse(JSON.stringify(mid)) as GameState)).toEqual(hashes.slice(60));
    // A rollback: from the snapshot, other inputs for 8 ticks, then back to the snapshot and the real ones.
    const branch = cloneGame(mid!);
    for (let t = 0; t < 8; t++) stepGame(branch, [Button.Left | Button.Item], world);
    expect(replay(cloneGame(mid!))).toEqual(hashes.slice(60));
  });
});

/**
 * Hyrule Castle's first magic circle (boss500 room 3: switch 18, to s1 (160, 160)) at (100, 100) of the test arena, and
 * the dark side's middle spot (s1 (248, 200) listed, style 6, out to the TV's (256, 208)).
 */
const CASTLE: ArenaProps = {
  actors: [{ id: "CIRC", x: 100, y: 100, params: 0x91131325 }],
  bushes: [],
  warps: decodeWarps([{ sublayer: 1, x: 248, y: 200, params: 0x001f1906 }]),
  sideRooms: 1 << 1,
};

describe("Hyrule Castle's magic circles", () => {
  const world = twoRooms(1);
  /** P1 under the circle, P2 out of the way; the circle opened (switch 18) and settled. */
  const opened = () => {
    const game = start(world, [{ x: 100, y: 130, facing: "up" }, { x: 40, y: 40, facing: "down" }], CASTLE);
    const circle = game.battle!.entities.find((e) => e.kind === "circle")!;
    run(game, world, 30, [Button.Up]); // closed while its switch is off: he walks over it
    expect(game.battle!.fighters[0]!.move).toBe("none");
    expect(px(game.players[0]!.y)).toBeLessThan(100 - 8);
    game.players[0]!.y = 130 * SUBPX;
    setSwitch(game.battle!, 18, true);
    run(game, world, CIRCLE_GROW_TICKS + CIRCLE_SETTLE);
    expect(circle.timer).toBe(CIRCLE_GROW_TICKS);
    return { game, circle, p: game.players[0]!, f: game.battle!.fighters[0]! };
  };

  it("takes a Link onto its middle, to the dark side on the 119th tick, and back 16 px over it 600 ticks later (measured)", () => {
    const { game, circle, p, f } = opened();
    until(game, world, () => f.move === "circle", 40, [Button.Up]);
    expect([px(p.x), px(p.y), f.circle]).toEqual([100, 100, circle.home]); // onto its middle on that tick
    setSwitch(game.battle!, 18, false);
    run(game, world, CIRCLE_ARRIVE_TICK - 1, [Button.Left]); // no control
    expect([px(p.x), px(p.y)]).toEqual([100, 100]);
    stepGame(game, [], world);
    expect([px(p.x), px(p.y) - sideRoomY(1), screenAt(p.y)]).toEqual([160, 160, 1]); // traced: (160, 160) on screen 8
    expect(until(game, world, () => f.move === "none", CIRCLE_TICKS)).toBe(CIRCLE_TICKS - 1 - CIRCLE_ARRIVE_TICK);
    expect(f.dark).toBe(DARK_TICKS);
    stepGame(game, [], world);
    expect(f.dark).toBe(DARK_TICKS - 1); // traced: 599 on his first tick on his own
    // The circle stayed open 180 ticks after it took him, its switch off, then closed.
    expect(circle.timer).toBe(CIRCLE_GROW_TICKS);
    run(game, world, CIRCLE_HOLD);
    expect(circle.timer).toBeLessThan(CIRCLE_GROW_TICKS);
    expect(until(game, world, () => f.move === "circleBack", DARK_TICKS)).toBe(DARK_TICKS - 1 - CIRCLE_HOLD);
    run(game, world, CIRCLE_ARRIVE_TICK);
    expect([px(p.x), px(p.y), screenAt(p.y)]).toEqual([100, 100 - CIRCLE_BACK_Y, 0]); // traced: (680, 536) world
    expect(until(game, world, () => f.move === "none", CIRCLE_TICKS)).toBe(CIRCLE_TICKS - 1 - CIRCLE_ARRIVE_TICK);
    expect([f.dark, f.circle]).toEqual([0, -1]);
  });

  it("lets him out sooner by the dark side's middle spot: spinning up, then down onto the TV (measured)", () => {
    const { game, p, f } = opened();
    until(game, world, () => f.move === "circle", 40, [Button.Up]);
    until(game, world, () => f.move === "none", CIRCLE_TICKS);
    until(game, world, () => px(p.x) >= 254, 100, [Button.Right]);
    until(game, world, () => f.move === "spot", 60, [Button.Down]);
    expect([px(p.x), px(p.y) - sideRoomY(1)]).toEqual([256, 208]); // onto it on that tick (traced)
    const turns: string[] = [];
    for (let t = 1; t <= 12; t++) {
      stepGame(game, [], world);
      turns.push(p.facing);
    }
    expect(turns.join(" ")).toBe("down down down left left left left up up up up right"); // a facing every 4 ticks
    run(game, world, 60 - 12);
    expect(f.z).toBe(4 * SUBPX); // rising 4 px a tick from the 60th
    run(game, world, SPOT_ARRIVE_TICK - 1 - 60);
    expect(f.z).toBe(128 * SUBPX);
    stepGame(game, [], world);
    expect([px(p.x), px(p.y), f.z]).toEqual([256, 208, 0]); // on the TV on the 92nd (traced: (768, 592) world)
    expect(until(game, world, () => f.move === "none", SPOT_TICKS)).toBe(SPOT_TICKS - 1 - SPOT_ARRIVE_TICK);
    expect([f.dark, f.circle, f.z, p.facing]).toEqual([0, -1, 0, "down"]);
  });

  it("is deterministic on the dark side: a JSON copy replays to the same hashes", () => {
    const { game, f } = opened();
    until(game, world, () => f.move === "circle", 40, [Button.Up]);
    run(game, world, CIRCLE_TICKS + 30);
    const copy = JSON.parse(JSON.stringify(cloneGame(game))) as GameState;
    const a: number[] = [], b: number[] = [];
    for (let t = 0; t < DARK_TICKS; t++) {
      const buttons = t % 50 < 25 ? Button.Right : Button.Down | (t % 7 === 0 ? Button.Sword : 0);
      stepGame(game, [buttons], world);
      stepGame(copy, [buttons], world);
      a.push(hashGame(game));
      b.push(hashGame(copy));
    }
    expect(b).toEqual(a);
  });
});
