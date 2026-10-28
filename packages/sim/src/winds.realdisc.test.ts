// The Tower of Winds and the bombchus on the real arenas (extracted/), as traced in Dolphin (docs/measurements/side-rooms.md "Side
// rooms"): its TV is side view, its gates lead to its gallery, the gallery's bomb rain (switches 19 and 20) falls onto
// its platform and doesn't light its crystals, the giant-bomb Shadow Link (switch 21) knocks out everyone on the TV;
// the Tower of Flames' eight bombchus (switch 30) and the Dark Tower of Winds' two from its wall holes.
import { existsSync, readFileSync } from "node:fs";
import { decompressYaz0, Dol, parseRarc, readTileTypes, Stage } from "@fso/formats";
import { describe, expect, it } from "vitest";
import { buildArenaWorld } from "./arena.ts";
import { BOMBCHU_SPEED } from "./bombchus.ts";
import { addCpus, cpuInputs } from "./cpu.ts";
import { COUNTDOWN_TICKS, createBattle } from "./battle.ts";
import { isqrt } from "./entities.ts";
import { stepGame, type GameState } from "./game.ts";
import { BIG_BOMB } from "./giantbomb.ts";
import { Button, SUBPX } from "./player.ts";
import { arenaProps } from "./props.ts";
import { screenAt, sideRoomY, WARP_TICKS } from "./siderooms.ts";
import { setSwitch, switchOn } from "./switches.ts";
import type { World } from "./world.ts";

const root = new URL("../../../extracted/", import.meta.url);
const boss500 = new URL("files/GC4Sword_usa/Boss/boss500.arc", root);
const dol = new URL("sys/main.dol", root);

describe.skipIf(!existsSync(boss500) || !existsSync(dol))("the Tower of Winds and the bombchus on the real arenas", () => {
  if (!existsSync(boss500) || !existsSync(dol)) return void it.skip("needs extracted/", () => {});
  const stage = new Stage(parseRarc(decompressYaz0(readFileSync(boss500))));
  const tileTypes = readTileTypes(new Dol(readFileSync(dol)));
  const match = (room: number, spawns: { x: number; y: number }[]): { game: GameState; world: World } => {
    const world = buildArenaWorld(stage, tileTypes, room);
    const game = createBattle(room, spawns.map((s) => ({ ...s, facing: "down" as const })), { hearts: 3, timeLimit: 0, wins: 3 }, arenaProps(stage, tileTypes, room), 1);
    for (let t = 0; t < COUNTDOWN_TICKS; t++) stepGame(game, [], world);
    return { game, world };
  };
  const steps = (game: GameState, world: World, n: number, buttons: number[] = []) => {
    for (let t = 0; t < n; t++) stepGame(game, buttons, world);
  };

  it("its TV is side view: the Links stand on their ledges, and its gate takes P1 into the gallery and back (traced)", () => {
    const { game, world } = match(2, [{ x: 152, y: 184 }, { x: 360, y: 280 }]);
    expect(arenaProps(stage, tileTypes, 2).sideViews! & 0b11).toBe(0b11); // the TV and the gallery
    const p = game.players[0]!, f = game.battle!.fighters[0]!;
    steps(game, world, 2);
    expect(p.y / SUBPX).toBe(184.5); // on his ledge (traced: 184.5 to 185, the game's jitter)
    let t = 0;
    while (p.x > 65 * SUBPX) (stepGame(game, [Button.Left], world), t++);
    expect(t).toBe(59); // (traced: from 664 to 577 world px in 59 frames, the first one a turn)
    stepGame(game, [Button.Up], world);
    expect(f.move).toBe("warp");
    steps(game, world, WARP_TICKS);
    expect([p.x / SUBPX, p.y / SUBPX - sideRoomY(1), screenAt(p.y), f.move]).toEqual([64, 184, 1, "none"]); // (traced)
    steps(game, world, 3);
    stepGame(game, [Button.Down], world);
    steps(game, world, WARP_TICKS);
    expect([p.x / SUBPX, screenAt(p.y), p.facing]).toEqual([64, 0, "down"]);
  });

  it("the gallery's rain: 128 ticks of switches 19 and 20 drop ten lit bombs onto its platforms; its crystals stay dark", () => {
    const { game, world } = match(2, [{ x: 152, y: 184 }, { x: 360, y: 280 }]);
    const b = game.battle!;
    setSwitch(b, 3, true); // the TV pot's floor switch, stood on (CKSW → 19, then CHSW's 128-tick pulse)
    steps(game, world, 1);
    setSwitch(b, 4, true);
    steps(game, world, 5);
    const bombs = b.entities.filter((e) => e.kind === "bomb" && screenAt(e.y) === 1);
    expect(bombs.length).toBe(10);
    const first = bombs.find((e) => e.x === 240 * SUBPX)!;
    expect(first.y / SUBPX - sideRoomY(1)).toBeCloseTo(135, 0); // (traced: (240, 135))
    steps(game, world, 31);
    expect(first.y / SUBPX - sideRoomY(1)).toBe(201); // on the middle platform (traced: 201 on its 30th tick)
    steps(game, world, 300);
    expect([8, 9, 10, 11].map((n) => switchOn(b, n))).toEqual([false, false, false, false]); // (traced)
    expect(switchOn(b, 21)).toBe(false);
  });

  it("the giant-bomb Shadow Link: his bomb lands on the TV and goes off, knocking out both Links there (traced: 1021 frames)", () => {
    const { game, world } = match(2, [{ x: 152, y: 184 }, { x: 360, y: 280 }]);
    const b = game.battle!;
    setSwitch(b, 21, true);
    let t = 0;
    while (!b.entities.some((e) => e.kind === "bigBomb" && e.param === BIG_BOMB.burning) && t < 600) (stepGame(game, [], world), t++);
    expect(t).toBeGreaterThan(400);
    while (b.phase === "play" && t < 1200) (stepGame(game, [], world), t++);
    expect(b.fighters.map((f) => f.hearts)).toEqual([0, 0]);
    expect(Math.abs(t - 1021)).toBeLessThanOrEqual(3); // the trace: switch on frame 5, both out on 1026
    expect([b.phase, b.roundWinner]).toEqual(["roundOver", -1]); // a draw
  });

  it("the Tower of Flames' eight bombchus (switch 30): one from each spawner by the walls, 2.5 px a tick, gone by 333 ticks", () => {
    const { game, world } = match(1, [{ x: 376, y: 232 }, { x: 136, y: 232 }]);
    const b = game.battle!;
    setSwitch(b, 30, true);
    steps(game, world, 5);
    const chus = b.entities.filter((e) => e.kind === "bombchu");
    const at = chus.map((e) => [e.homeX / SUBPX, e.homeY / SUBPX]).sort((u, v) => u[0]! - v[0]! || u[1]! - v[1]!);
    expect(at).toEqual([[24, 168], [24, 216], [72, 88], [72, 296], [440, 88], [440, 296], [488, 168], [488, 216]]); // (main.dol's eight GEN3s)
    for (const e of chus) expect(Math.abs(isqrt(e.vx * e.vx + e.vy * e.vy) - BOMBCHU_SPEED)).toBeLessThanOrEqual(2);
    steps(game, world, 330);
    expect(b.entities.filter((e) => e.kind === "bombchu" && e.hp >= 0)).toEqual([]); // (traced: all gone by frame 355)
  });

  it("the Dark Tower of Winds: its pot's switch sends a bombchu out of the wall hole, crawling along the TV", () => {
    const { game, world } = match(7, [{ x: 152, y: 184 }, { x: 360, y: 280 }]);
    const b = game.battle!;
    setSwitch(b, 1, true); // the pot at (48, 128)'s floor switch (CKSW → 17, a 128-tick pulse)
    steps(game, world, 6);
    const chu = b.entities.find((e) => e.kind === "bombchu")!;
    expect([chu.homeX / SUBPX, chu.homeY / SUBPX]).toEqual([48, 224]);
    steps(game, world, 60);
    expect(chu.hp).toBeGreaterThanOrEqual(0);
    expect(screenAt(chu.y)).toBe(0);
    expect(chu.param & 32).toBe(32); // on a surface, crawling (bombchus.ts)
  });

  it("a CPU follows a rival who stays in a side room (the gallery through a gate, The Field's house through its door) and wins", () => {
    for (const [room, at] of [
      [2, { x: 64, y: sideRoomY(1) + 184 }], // the gallery's left gate
      [0, { x: 80, y: sideRoomY(2) + 116 }], // the house, inside its door
    ] as const) {
      const { game, world } = match(room, [{ x: 152, y: 184 }, { x: 360, y: 280 }]);
      addCpus(game, [{ player: 1, level: "normal" }]);
      Object.assign(game.players[0]!, { x: at.x * SUBPX, y: at.y * SUBPX });
      let t = 0, followed = false;
      for (; t < 6000 && game.battle!.phase === "play"; t++) {
        stepGame(game, cpuInputs(game, world, [0]), world);
        followed ||= screenAt(game.players[1]!.y) === screenAt(at.y * SUBPX);
      }
      expect([room, followed, game.battle!.roundWinner]).toEqual([room, true, 1]);
      console.log(`arena ${room}: the CPU followed its rival into the side room and won in ${t} ticks`);
    }
  });

  it("a CPU takes shelter in the gallery while the giant bomb burns, and lives through it", () => {
    const { game, world } = match(2, [{ x: 152, y: 184 }, { x: 360, y: 280 }]);
    addCpus(game, [{ player: 1, level: "normal" }]);
    const b = game.battle!;
    setSwitch(b, 21, true);
    for (let t = 0; t < 1300 && b.phase === "play"; t++) stepGame(game, cpuInputs(game, world, [0, 0]), world);
    expect(b.fighters.map((f) => f.hearts > 0)).toEqual([false, true]);
    expect(b.roundWinner).toBe(1);
  });
});
