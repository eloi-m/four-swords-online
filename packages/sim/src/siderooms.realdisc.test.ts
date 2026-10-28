// The side rooms on the real arenas (extracted/): The Field's house as traced in Dolphin; Above the Clouds' hole, the
// room under it, its cannon and ladder, its crystal (the fire bars' turn); the Tower of Flames' basement (the lava
// stripes) and north room, whose floor switch lights the eternal flames on the TV (traced: switch 14 on while P1 stood
// on it); Hyrule Castle's magic circle to its dark side and back, as traced.
import { existsSync, readFileSync } from "node:fs";
import { decompressYaz0, Dol, parseRarc, readTileTypes, Stage } from "@fso/formats";
import { describe, expect, it } from "vitest";
import { ARENA_H, buildArenaWorld } from "./arena.ts";
import { COUNTDOWN_TICKS, createBattle } from "./battle.ts";
import { EXPLOSION_TICKS } from "./bombs.ts";
import { isRemoved, lavaTiles, spawnEntity, tileIndexAt, type Entity } from "./entities.ts";
import { BOMB_THROW_SPEED } from "./carry.ts";
import { BOOMERANG_OUT } from "./items.ts";
import { ARROW_SPEED, SEED_SPEED, shoot } from "./projectiles.ts";
import { strikeEntity } from "./strike.ts";
import { SWORD_DAMAGE } from "./combat.ts";
import { stepGame, type GameState } from "./game.ts";
import { CIRCLE_GROW_TICKS, firebarSpeed } from "./hazards.ts";
import { MESSAGE } from "./messages.ts";
import { Button, SUBPX } from "./player.ts";
import { arenaProps } from "./props.ts";
import { CIRCLE_TICKS, DARK_TICKS, HOLE_TICKS, launchFlying, screenAt, sideRoomY, SPOT_STYLE, WARP_TICKS } from "./siderooms.ts";
import { setSwitch, switchOn } from "./switches.ts";
import type { World } from "./world.ts";

const root = new URL("../../../extracted/", import.meta.url);
const boss500 = new URL("files/GC4Sword_usa/Boss/boss500.arc", root);
const dol = new URL("sys/main.dol", root);

describe.skipIf(!existsSync(boss500) || !existsSync(dol))("side rooms on the real arenas", () => {
  if (!existsSync(boss500) || !existsSync(dol)) return void it.skip("needs extracted/", () => {});
  const stage = new Stage(parseRarc(decompressYaz0(readFileSync(boss500))));
  const tileTypes = readTileTypes(new Dol(readFileSync(dol)));
  const match = (room: number, spawns: { x: number; y: number }[]): { game: GameState; world: World } => {
    const world = buildArenaWorld(stage, tileTypes, room);
    const game = createBattle(room, spawns.map((s) => ({ ...s, facing: "down" as const })), { hearts: 3, timeLimit: 0, wins: 3 }, arenaProps(stage, tileTypes, room), 1);
    for (let t = 0; t < COUNTDOWN_TICKS; t++) stepGame(game, [], world);
    return { game, world };
  };
  /** Steps with P1 holding `buttons` until `done`, at most `max` ticks; returns the ticks. */
  const walk = (game: GameState, world: World, buttons: number, done: () => boolean, max = 400) => {
    for (let t = 0; t < max; t++) {
      if (done()) return t;
      stepGame(game, [buttons, 0], world);
    }
    throw new Error("never got there");
  };

  it("The Field's house: in at the traced spot, out where the trace came out", () => {
    // The trace's P1 start (200, 280) and walk: right to x 255.5, then up; in Dolphin the door took him at y 178.
    const { game, world } = match(0, [{ x: 200, y: 280 }, { x: 312, y: 280 }]);
    const p = game.players[0]!, f = game.battle!.fighters[0]!;
    walk(game, world, Button.Right, () => p.x >= 255 * SUBPX);
    // The shut door stops him at y 183; 20 ticks walking into it, then he pushes, and on the push's 12th tick it opens
    // (both halves, tiles (15, 10) and (16, 10): main.dol) and he walks on (traced: stopped on frame 26, pushing from
    // 47, moving again on 59).
    walk(game, world, Button.Up, () => p.y <= 183 * SUBPX);
    const stopped = game.tick;
    expect(walk(game, world, Button.Up, () => game.battle!.cut.length > 0)).toBe(20 + 12); // (the 21st tick is the push's first)
    expect([[...game.battle!.cut].sort(), p.y / SUBPX, game.tick - stopped]).toEqual([[10 * 32 + 15, 10 * 32 + 16], 183, 32]);
    walk(game, world, Button.Up, () => f.move === "warp");
    expect(p.y / SUBPX).toBe(178.5); // traced: 181.5, 180, 178.5, then the door walk (178 on the next frame)
    walk(game, world, 0, () => f.move === "none", WARP_TICKS + 1);
    expect([p.x / SUBPX, p.y / SUBPX - sideRoomY(2), screenAt(p.y)]).toEqual([80, 116, 2]); // traced: (80, 116) on screen 9
    walk(game, world, Button.Down, () => f.move === "warp");
    expect(p.y / SUBPX - sideRoomY(2)).toBe(125); // traced: the way out took him at y 125
    walk(game, world, 0, () => f.move === "none", WARP_TICKS + 1);
    expect([p.x / SUBPX, p.y / SUBPX]).toEqual([256, 188]); // traced: (768, 572) world
  });

  describe("things thrown or shot into a door or a hole (traced: docs/measurements.md)", () => {
    // P1 at (256, 186) facing up under The Field's house door (its warp at (256, 168), out at (80, 136) in the house).
    const field = (open = true) => {
      const m = match(0, [{ x: 256, y: 186 }, { x: 100, y: 300 }]);
      const p = m.game.players[0]!;
      p.facing = "up";
      if (open) m.game.battle!.cut.push(10 * 32 + 15, 10 * 32 + 16);
      return { ...m, b: m.game.battle!, p };
    };
    const at = (e: Entity) => [e.x / SUBPX, e.y / SUBPX - sideRoomY(screenAt(e.y)), screenAt(e.y)];

    it("an arrow: out of the house door at its spot, flying on (and not through the shut door)", () => {
      const { game, world, b, p } = field();
      const arrow = shoot(b, "arrow", 0, p, 0, -ARROW_SPEED);
      const seen: number[][] = [];
      for (let t = 0; t < 4; t++) stepGame(game, [0, 0], world), seen.push(at(arrow));
      // traced: (254, 181), 176, 171, then (80, 131) on screen 9
      expect(seen).toEqual([[254, 181, 0], [254, 176, 0], [254, 171, 0], [80, 131, 2]]);
      const shut = field(false);
      const other = shoot(shut.b, "arrow", 0, shut.p, 0, -ARROW_SPEED);
      for (let t = 0; t < 8; t++) stepGame(shut.game, [0, 0], shut.world);
      expect(screenAt(other.y)).toBe(0); // (the game's stuck in the shut door's tiles; here they're open: arena.ts)
    });

    it("a seed keeps its offset from the door; a thrown bomb comes out on the spot, as high as it went in", () => {
      const { game, world, b, p } = field();
      const seed = shoot(b, "seed", 0, p, 0, -SEED_SPEED);
      stepGame(game, [0, 0], world);
      stepGame(game, [0, 0], world);
      expect(at(seed)).toEqual([78, 144, 2]); // traced: (254, 181) is (-2, +13) from the door: (78, 149), then 5 up
      const bomb = spawnEntity(b, "bomb", 256 * SUBPX, 192 * SUBPX, { phase: "flying", z: 28 * SUBPX, vy: -BOMB_THROW_SPEED, timer: 245, owner: 0 });
      stepGame(game, [0, 0], world);
      expect(at(bomb)).toEqual([80, 130, 2]); // traced: (80, 130) the tick it was thrown from (256, 192), 28 px up
      expect(bomb.z).toBeGreaterThan(27 * SUBPX);
    });

    it("a boomerang goes through, and comes back the same way to its thrower", () => {
      const { game, world, b, p } = field();
      const boomerang = shoot(b, "boomerang", 0, p, 0, 0, BOOMERANG_OUT, 1);
      stepGame(game, [0, 0], world);
      expect(at(boomerang)).toEqual([256, 180, 0]); // traced
      stepGame(game, [0, 0], world);
      expect(at(boomerang)).toEqual([80, 142, 2]); // traced: (80, 136) + 12, then 6 up
      let back = 0;
      for (let t = 2; t < 80 && !back; t++) {
        stepGame(game, [0, 0], world);
        if (screenAt(boomerang.y) === 0) back = t;
      }
      // Traced: back where it went in, shown there for a tick. (In Dolphin it flew up the house to y 43.6 and was back
      // 45 ticks after it appeared; here the house's row at y 93 that stops arrows stops it too: 17 ticks.)
      expect(at(boomerang)).toEqual([256, 180, 0]);
      expect(back).toBeGreaterThan(10);
      stepGame(game, [0, 0], world);
      expect(boomerang.phase).toBe("rest"); // caught
    });

    it("a pot thrown up into the Tower of Flames' north door (traced: not at 106 px 13 px up, at 100 11.75 up)", () => {
      const { game, world } = match(1, [{ x: 136, y: 232 }, { x: 376, y: 232 }]);
      const pot = spawnEntity(game.battle!, "pot", 224.5 * SUBPX, 106 * SUBPX, { phase: "flying", z: 13.25 * SUBPX, vy: -BOMB_THROW_SPEED, vz: -1.35 * SUBPX, owner: 0 });
      stepGame(game, [0, 0], world);
      expect(at(pot)).toEqual([224.5, 100, 0]);
      stepGame(game, [0, 0], world);
      expect(at(pot)).toEqual([80, 114, 2]); // traced: (80, 120) on screen 9, then 6 up
    });

    it("a bomb bouncing into Above the Clouds' hole: in the room under it, then up its top edge 20 ticks later, gone", () => {
      const { game, world } = match(4, [{ x: 104, y: 72 }, { x: 392, y: 312 }]);
      const bomb = spawnEntity(game.battle!, "bomb", 248 * SUBPX, 179 * SUBPX, { phase: "flying", z: 5 * SUBPX, vy: -461, vz: -SUBPX, param: 2, timer: 220, owner: 0 });
      stepGame(game, [0, 0], world);
      expect(at(bomb)).toEqual([248, 177.19921875, 0]); // traced: 177.2, 3 px up: not yet (over 4 px up before)
      stepGame(game, [0, 0], world);
      expect([bomb.x / SUBPX, Math.round(bomb.y / SUBPX - sideRoomY(2)), bomb.z]).toEqual([152, 6, 0]); // traced: (152, 6.2)
      let gone = 0;
      for (let t = 1; t < 40 && !gone; t++) {
        stepGame(game, [0, 0], world);
        if (isRemoved(bomb) || !game.battle!.entities.includes(bomb)) gone = t;
      }
      expect(gone).toBeGreaterThanOrEqual(19); // traced: on the TV 21 ticks after, into the hole
      expect(gone).toBeLessThanOrEqual(22);
    });
  });

  it("The Field's cave cucco: its tenth hit, 'Angry Cuccos! Run away!' and cuccos flying across the TV (traced)", () => {
    const { game, world } = match(0, [{ x: 200, y: 280 }, { x: 312, y: 280 }]);
    const b = game.battle!, hen = b.entities.find((e) => e.kind === "hen")!;
    expect([hen.x / SUBPX, hen.y / SUBPX - sideRoomY(5), hen.param]).toEqual([120, 40, 10]);
    for (let n = 0; n < 10; n++) {
      strikeEntity(b, hen, SWORD_DAMAGE, hen.x, hen.y + 16 * SUBPX);
      for (let t = 0; t < 15; t++) stepGame(game, [0, 0], world);
    }
    expect(b.messages?.some((m) => m.id === MESSAGE.angryCuccos)).toBe(true);
    const angry = () => b.entities.filter((e) => e.kind === "angryCucco");
    expect(angry().length).toBeGreaterThan(0);
    expect(angry().every((e) => screenAt(e.y) === 0 || e.y < 0)).toBe(true); // (on the TV, coming in from its edges)
    for (let t = 0; t < 240 && b.fighters[1]!.hearts === 12; t++) stepGame(game, [0, 0], world);
    expect(b.fighters[1]!.hearts).toBe(11); // traced: 1 a sting
    for (let t = 0; t < 300; t++) stepGame(game, [0, 0], world);
    expect([angry().length, hen.param, hen.timer]).toEqual([0, 10, 0]); // over, and counting again
  });

  it("The Field's trick floor opening under a Link: back out behind him, past the nearer edge ahead (traced)", () => {
    // Its tiles (224-287, 208-271) open on switch 2. Dolphin: P2 walked right onto it to (229.5, 240), was put 8 px in
    // (232) and jumped back to (216, 240); walking up onto it to (240, 221.5) (13.5 px from its top edge) he jumped back
    // down to (240, 280) (its pit reaches a pixel past its tiles on that side: world.ts widePits).
    const fallFrom = (x: number, y: number, buttons: number, ticks: number) => {
      const { game, world } = match(0, [{ x: 200, y: 280 }, { x, y }]);
      const p = game.players[1]!, f = game.battle!.fighters[1]!;
      for (let t = 0; t < ticks; t++) stepGame(game, [0, buttons], world);
      const stood = [p.x / SUBPX, p.y / SUBPX];
      setSwitch(game.battle!, 2, true);
      walk(game, world, 0, () => f.mode === "falling", 20);
      const fell = [p.x / SUBPX, p.y / SUBPX];
      walk(game, world, 0, () => f.mode === "active", 200);
      return [stood, fell, [p.x / SUBPX, p.y / SUBPX], f.hearts];
    };
    expect(fallFrom(216, 240, Button.Right, 10)).toEqual([[229.5, 240], [232, 240], [216, 240], 10]);
    expect(fallFrom(240, 286, Button.Up, 44)).toEqual([[240, 221.5], [240, 221.5], [240, 280], 10]);
  });

  it("Above the Clouds' hole: in without a scratch, down into the cannon, shot back up; back in without steering (measured)", () => {
    const { game, world } = match(4, [{ x: 248, y: 190 }, { x: 104, y: 312 }]);
    const p = game.players[0]!, f = game.battle!.fighters[0]!;
    walk(game, world, Button.Up, () => f.move === "hole");
    expect([p.x / SUBPX, p.y / SUBPX]).toEqual([248, 168]); // traced: (760, 552) world, on the frame it took him
    expect(walk(game, world, 0, () => f.move === "none", HOLE_TICKS + 1)).toBe(HOLE_TICKS); // traced: 119 frames
    expect([p.x / SUBPX, p.y / SUBPX - sideRoomY(2)]).toEqual([152, 8]); // traced: (152, 8) on screen 9
    expect(walk(game, world, 0, () => f.move === "cannon")).toBe(23); // traced: 4 px a frame to y 100, then in
    expect(p.y / SUBPX - sideRoomY(2)).toBe(96);
    stepGame(game, [Button.Item, 0], world); // the GBA's A fires it
    stepGame(game, [0, 0], world);
    expect([f.move, p.y / SUBPX - sideRoomY(2)]).toEqual(["launch", 83]); // traced: 96 → 83 on the first tick
    walk(game, world, 0, () => launchFlying(f), 200);
    expect([p.x / SUBPX, p.y / SUBPX, screenAt(p.y)]).toEqual([248, 168, 0]); // out of the hole on the TV
    walk(game, world, 0, () => f.move === "hole", 200);
    expect(f.hearts).toBe(12); // no steering: back in (traced), and no life lost either time
    // This time he steers out of it in the air, and lands beside it.
    walk(game, world, 0, () => f.move === "cannon", 400);
    walk(game, world, 0, () => launchFlying(f), 400);
    walk(game, world, Button.Down, () => f.move === "none", 200);
    expect([screenAt(p.y), f.hearts, f.mode]).toEqual([0, 12, "active"]);
    expect(p.y / SUBPX).toBeGreaterThan(180);
  });

  it("Above the Clouds' room: with its cannon taken, the next Link lands on the floor, climbs the ladder and is out", () => {
    const { game, world } = match(4, [{ x: 104, y: 72 }, { x: 392, y: 312 }]);
    const b = game.battle!, p = game.players[0]!, q = game.players[1]!;
    [q.x, q.y] = [152 * SUBPX, (sideRoomY(2) + 90) * SUBPX]; // P2 drops into the cannon
    walk(game, world, 0, () => b.fighters[1]!.move === "cannon", 10);
    [p.x, p.y] = [152 * SUBPX, (sideRoomY(2) + 40) * SUBPX]; // P1 after him: past it, onto the floor
    walk(game, world, 0, () => p.y > (sideRoomY(2) + 130) * SUBPX && b.fighters[0]!.move === "none", 40);
    stepGame(game, [0, 0], world);
    expect(Math.floor(p.y / SUBPX) - sideRoomY(2)).toBe(136); // on the floor (row 9 is solid from y 144)
    walk(game, world, Button.Left, () => p.x <= 72 * SUBPX, 100);
    walk(game, world, Button.Up, () => b.fighters[0]!.move === "warp", 200); // up the ladder into its top's door (style 3)
    walk(game, world, 0, () => b.fighters[0]!.move === "none", WARP_TICKS + 1);
    expect([p.x / SUBPX, p.y / SUBPX, screenAt(p.y)]).toEqual([248, 148, 0]); // out of the hole, 20 px up (by the fire bars)
  });

  it("Above the Clouds' room: a blast on its crystal turns the fire bars round (switch 16), the next one back", () => {
    const { game, world } = match(4, [{ x: 104, y: 72 }, { x: 392, y: 312 }]);
    const b = game.battle!;
    const bars = b.entities.filter((e) => e.kind === "firebar");
    const turn = () => bars.map((e) => Math.sign(firebarSpeed(b, e)));
    const before = turn();
    const crystal = b.entities.find((e) => e.kind === "crystal" && screenAt(e.y) === 2)!;
    const blast = () => spawnEntity(b, "explosion", crystal.x + 10 * SUBPX, crystal.y, { phase: "active", timer: EXPLOSION_TICKS });
    blast();
    walk(game, world, 0, () => switchOn(b, 16), 3);
    expect(turn()).toEqual(before.map((s) => -s));
    walk(game, world, 0, () => !b.entities.some((e) => e.kind === "explosion"), 60);
    for (let t = 0; t < 30; t++) stepGame(game, [0, 0], world); // the crystal's lockout
    blast();
    walk(game, world, 0, () => !switchOn(b, 16), 3);
    expect(turn()).toEqual(before);
  });

  it("the Tower of Flames' basement: a floor switch there turns its stripe of the TV's floor into lava (PNPC)", () => {
    const { game, world } = match(1, [{ x: 136, y: 232 }, { x: 184, y: 120 }]);
    const b = game.battle!, p = game.players[0]!;
    // P1 on the basement's platform over the switch at (160, 208) (side view: he drops onto it), P2 on the TV on a
    // PNPC tile of switch 3.
    [p.x, p.y] = [168 * SUBPX, (sideRoomY(5) + 200) * SUBPX];
    walk(game, world, 0, () => switchOn(b, 3), 20);
    expect(lavaTiles(b)).toContain(tileIndexAt(184, 120));
    const q = game.players[1]!;
    stepGame(game, [0, 0], world);
    expect(b.fighters[1]!.mode).toBe("falling"); // into the lava
    expect(Math.floor(q.y / SUBPX)).toBeLessThan(ARENA_H);
    // Off the switch, the floor comes back.
    p.x += 40 * SUBPX;
    walk(game, world, 0, () => !switchOn(b, 3), 20);
    expect(lavaTiles(b)).toEqual([]);
  });

  it("the Tower of Flames' north room: its switch lights the eternal flames on the TV while someone stands on it", () => {
    const { game, world } = match(1, [{ x: 256, y: 100 }, { x: 136, y: 232 }]);
    const p = game.players[0]!, b = game.battle!;
    const flames = () => b.entities.filter((e) => e.kind === "flame" && e.phase === "active").length;
    walk(game, world, Button.Up, () => b.fighters[0]!.move === "warp");
    walk(game, world, 0, () => b.fighters[0]!.move === "none", WARP_TICKS + 1);
    expect([p.x / SUBPX, p.y / SUBPX - sideRoomY(2)]).toEqual([112, 100]); // traced: (112, 100) on screen 9
    expect([switchOn(b, 14), flames()]).toEqual([false, 0]);
    walk(game, world, Button.Right, () => p.x >= 152 * SUBPX);
    const q = game.players[1]!;
    [q.x, q.y] = [160 * SUBPX, 264 * SUBPX]; // P2 8 px from the flame at (168, 264)
    walk(game, world, Button.Up, () => switchOn(b, 14));
    stepGame(game, [0, 0], world);
    expect([flames(), b.fighters[1]!.hearts]).toEqual([20, 12]); // every BLZ2 flame on the TV, burning from the next tick
    stepGame(game, [0, 0], world);
    expect(b.fighters[1]!.hearts).toBe(11); // traced: hurt two ticks after the switch, 1 life
    walk(game, world, Button.Down, () => !switchOn(b, 14), 30);
    stepGame(game, [0, 0], world);
    expect(flames()).toBe(0);
  });

  it("Hyrule Castle: an open magic circle takes him to the dark side (s1) and sends him back 16 px over it (traced)", () => {
    // The trace: switch 18 poked on, P1 from (200, 184) left to x 168.5, then up; taken at (168, 168) on frame 93.
    const { game, world } = match(3, [{ x: 200, y: 184 }, { x: 200, y: 280 }]);
    const b = game.battle!, p = game.players[0]!, f = b.fighters[0]!;
    expect((b.props.sideRooms ?? 0) & 2).toBe(2);
    expect(b.props.warps?.filter((w) => w.style === SPOT_STYLE).map((w) => [w.x, w.y - sideRoomY(1), w.toX, w.toY])).toEqual([[256, 208, 256, 208]]);
    setSwitch(b, 18, true);
    const opened = game.tick;
    for (let t = 0; t < 66; t++) stepGame(game, [0, 0], world); // (the trace's wait: the circle grows open, then settles)
    expect(switchOn(b, 18)).toBe(true);
    // Full size 50 ticks on, it asks for "You got 10 Dark World seconds!" (Dolphin: the window in place 19 ticks after).
    // (Another circle of the castle opens a few ticks later and asks too: the window shows the notice only once.)
    expect(b.messages?.[0]).toEqual({ id: MESSAGE.darkWorld, player: -1, tick: opened + CIRCLE_GROW_TICKS });
    const asked = b.messages!.length;
    walk(game, world, Button.Left, () => p.x <= 168.5 * SUBPX);
    walk(game, world, Button.Up, () => f.move === "circle", 40);
    expect([p.x / SUBPX, p.y / SUBPX]).toEqual([168, 168]);
    walk(game, world, 0, () => f.move === "none", CIRCLE_TICKS);
    expect([p.x / SUBPX, p.y / SUBPX - sideRoomY(1), screenAt(p.y)]).toEqual([160, 160, 1]); // traced: (160, 160) on screen 8
    // (The soldiers would knock P2 out meanwhile and end the round: his life is kept up, as the trace's pokes did.)
    walk(game, world, 0, () => ((b.fighters[1]!.hearts = 12), f.move === "circleBack"), DARK_TICKS + 1);
    walk(game, world, 0, () => f.move === "none", CIRCLE_TICKS);
    expect([p.x / SUBPX, p.y / SUBPX, screenAt(p.y)]).toEqual([168, 152, 0]); // traced: (680, 536) world
    // Once a round per circle (they stayed open or opened again meanwhile): the {notice} requests are kept, no new one.
    expect(b.messages?.length).toBe(asked);
  });
});
