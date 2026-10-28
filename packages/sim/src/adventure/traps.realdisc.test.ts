// The traps (traps.ts): the Cave of No Return's fireball traps against the Dolphin traces (docs/measurements/
// adventure-world1.md "The fireball traps"), and Hyrule Castle's blade traps as main.dol reads (skips without
// extracted/).
import { existsSync, readFileSync } from "node:fs";
import { decompressYaz0, Dol, loadActorTypes, parseRarc, readTileTypes, Stage } from "@fso/formats";
import { describe, expect, it } from "vitest";
import { Button, SUBPX } from "../player.ts";
import { createAdventure, enterArea, stepAdventure, type AdventureGame } from "./adventure.ts";
import type { Enemy } from "./enemies.ts";
import { actorStats, AdventureStage } from "./stage.ts";
import { BLADE_STATE, BLADE_TRAP, FIRE_TRAP, FIRE_TRAP_KIND } from "./traps.ts";

const root = new URL("../../../../extracted/", import.meta.url);
const load = (path: string) => parseRarc(decompressYaz0(readFileSync(new URL(`files/GC4Sword_usa/${path}`, root))));
const px = (v: number) => v / SUBPX;

describe.skipIf(!existsSync(root))("the traps", () => {
  if (!existsSync(root)) return void it.skip("needs extracted/", () => {});
  const tileTypes = readTileTypes(new Dol(readFileSync(new URL("sys/main.dol", root))));
  const stats = actorStats(loadActorTypes(load("data.arc"))!);
  const cave = new AdventureStage(new Stage(load("Boss/boss011.arc")), tileTypes, stats);
  const castle = new AdventureStage(new Stage(load("Boss/boss013.arc")), tileTypes, stats);
  const step = (game: AdventureGame, stage: AdventureStage, n = 1, buttons = 0) => {
    for (let i = 0; i < n; i++) stepAdventure(game, [buttons], stage);
  };
  const shots = (game: AdventureGame) => game.adventure.enemies.filter((e) => e.type === "OKTM" && e.kind === FIRE_TRAP_KIND);
  const fireTrap = (game: AdventureGame, x: number, y: number) => game.adventure.enemies.find((e) => e.type === "FBGE" && e.x === x * SUBPX && e.y === y * SUBPX)!;

  /** The Cave's room 1, one Link at (x, y) facing `facing`, the trap at (248, 40) ready to shoot (the savestate's 1). */
  const room1 = (x: number, y: number, facing: "up" | "down" | "left" | "right" = "right"): AdventureGame => {
    const game = createAdventure(cave, { room: 1, players: 1, x, y, facing });
    for (const e of game.adventure.enemies) if (e.type === "FBGE") e.timer = 1;
    return game;
  };

  it("are there: five fireball traps in the Cave's room 1, invisible, not enemies to beat", () => {
    const game = room1(80, 136);
    expect(game.adventure.enemies.filter((e) => e.type === "FBGE").map((e) => [px(e.x), px(e.y)])).toEqual([[248, 40], [440, 136], [440, 184], [440, 232], [248, 344]]);
  });

  it("shoots at a Link within 112 px: 1.5 px/tick straight at him, from its spot, moving from the next tick (traced)", () => {
    // Dolphin: the Links put at (230, 140), the shot made at (248, 40) that frame, (-0.266, 1.476) px/tick.
    const game = room1(230, 140);
    step(game, cave);
    const [shot] = shots(game);
    expect(shot).toBeDefined();
    expect([px(shot!.x), px(shot!.y), shot!.z]).toEqual([248, 40, 0]);
    expect([px(shot!.vx), px(shot!.vy)].map((v) => +v.toFixed(2))).toEqual([-0.27, 1.48]);
    step(game, cave);
    expect([px(shot!.x), px(shot!.y)].map((v) => +v.toFixed(1))).toEqual([247.7, 41.5]);
    // Its countdown: the next shot 120 ticks after this one.
    expect(fireTrap(game, 248, 40).timer).toBe(FIRE_TRAP.every - 1);
  });

  it("doesn't shoot at a Link farther than 112 px", () => {
    // (Dolphin: the Links at (153, 152), 147 px off, drew no shot in 300 frames; nor at (223, 153), 116 px.)
    const game = room1(223, 153);
    step(game, cave, 30);
    expect(shots(game)).toHaveLength(0);
    expect(fireTrap(game, 248, 40).timer).toBe(1);
  });

  it("hurts the Link it reaches: 2, knocked 1.5 px/tick away from it for 25 ticks, 60 invincible; the shot is gone (traced)", () => {
    // Dolphin: hit on frame 69, 63 frames after the shot (the sim's body, ±7 against its ±2, a frame earlier); the life
    // 12 → 10, (-0.27, 1.48) px/tick away, up and down again over 25 frames, 60 invincible.
    const game = room1(230, 140, "right");
    const hearts = game.battle.fighters[0]!.hearts;
    let hitAt = -1;
    for (let t = 1; t <= 70 && hitAt < 0; t++) {
      step(game, cave);
      if (game.battle.hits.length) hitAt = t;
    }
    expect(hitAt).toBeGreaterThanOrEqual(62);
    expect(hitAt).toBeLessThanOrEqual(63);
    const f = game.battle.fighters[0]!;
    expect(game.battle.hits[0]).toMatchObject({ victim: 0, damage: FIRE_TRAP.damage, blocked: false });
    expect(f.hearts).toBe(hearts - 2);
    expect(f.invincible).toBe(60);
    expect(shots(game)).toHaveLength(0);
    const y0 = game.players[0]!.y;
    step(game, cave);
    expect(px(game.players[0]!.y - y0)).toBeCloseTo(1.48, 1);
  });

  it("is stopped by a shield facing it", () => {
    const game = room1(230, 140, "up");
    const hearts = game.battle.fighters[0]!.hearts;
    step(game, cave, 70);
    expect(game.battle.fighters[0]!.hearts).toBe(hearts);
    expect(shots(game)).toHaveLength(0);
  });

  it("knocks a key carried overhead out of the Link's hands: thrown on along his facing from 18 px up, no wind-up (traced)", () => {
    // Dolphin: the leader carrying the key at (392, 232.5) facing up, struck by the trap at (440, 232)'s shot: the
    // key at (392, 226.5) 18 px up the next frame, (392, 220.5) 17.8 the one after (6 px a tick, the throw's fall).
    const game = room1(392, 232.5, "up");
    for (const e of game.adventure.enemies) if (e.type === "FBGE") e.timer = e.x === 440 * SUBPX && e.y === 232 * SUBPX ? 1 : 999;
    Object.assign(game.adventure, { keys: 1, carried: { key: -1, actor: -1, kind: 0 } });
    // (The pot over the key's floor point, (384, 208), lifted off as there.)
    game.battle.cut.push(13 * 32 + 24);
    let t = 0;
    while (!game.battle.hits.length && t++ < 60) step(game, cave);
    expect(game.battle.hits[0]).toMatchObject({ victim: 0, blocked: false });
    expect(game.adventure.keyThrow).toMatchObject({ dropped: true });
    step(game, cave);
    // (The room's own key still lies hidden under its pot: the knocked one is the last made.)
    const key = () => game.adventure.pickups.filter((p) => p.type === "key").at(-1)!;
    expect(game.adventure.keys).toBe(0);
    expect([px(key().x), px(key().y), px(key().z)]).toEqual([392, 226.5, 18]);
    step(game, cave);
    expect([px(key().x), px(key().y), +px(key().z).toFixed(1)]).toEqual([392, 220.5, 17.8]);
    // He's knocked back meanwhile (not held for a throw). The wall above stops it at 214, it drifts back ½ px a tick
    // and lands at 219 on its 14th tick (all as traced).
    expect(game.battle.fighters[0]!.mode).toBe("hurt");
    step(game, cave);
    expect(px(key().y)).toBe(214.5);
    step(game, cave);
    expect(px(key().y)).toBe(214);
    step(game, cave, 10);
    expect([px(key().y), +px(key().z).toFixed(1)]).toEqual([219, 0]);
    expect(game.adventure.keyThrow).toBeNull();
  });

  /** Hyrule Castle's room 9 area 2, one Link at (x, y), the two blade traps (72, 184) and (184, 184). */
  const yard = (x: number, y: number): AdventureGame => {
    const game = createAdventure(castle, { room: 9, players: 1, x, y, facing: "up" });
    enterArea(game, castle, 9, 2, 0, 0);
    Object.assign(game.players[0]!, { x: x * SUBPX, y: y * SUBPX, facing: "up" });
    return game;
  };
  const blades = (game: AdventureGame): Enemy[] => game.adventure.enemies.filter((e) => e.type === "TRAP");

  it("blade traps: wait for a Link within 22 px across their way, turn toward him, slide, meet in the middle and go back", () => {
    // Out of their row (26 px below): nothing.
    const out = yard(128, 210);
    step(out, castle, 20);
    expect(blades(out).map((e) => e.shot)).toEqual([BLADE_STATE.wait, BLADE_STATE.wait]);
    // In it (16 px below): both off at him, the left one right, the right one left, easing up to 3 px/tick.
    const game = yard(128, 200);
    step(game, castle);
    const [a, b] = blades(game);
    expect([a!.shot, a!.facing, b!.shot, b!.facing]).toEqual([BLADE_STATE.slide, "right", BLADE_STATE.slide, "left"]);
    step(game, castle, 12);
    expect(a!.vx).toBeGreaterThan(BLADE_TRAP.speed - 16);
    expect(a!.vx).toBeLessThanOrEqual(BLADE_TRAP.speed);
    // They stop where they meet (their ±6 boxes), short of him: unhurt.
    for (let t = 0; t < 40 && a!.shot === BLADE_STATE.slide; t++) step(game, castle);
    expect([a!.shot, b!.shot]).toEqual([BLADE_STATE.back, BLADE_STATE.back]);
    expect(px(b!.x - a!.x)).toBeLessThanOrEqual(2 * BLADE_TRAP.half);
    expect(game.battle.hits).toHaveLength(0);
    // Home at 0.5 px/tick, then 10 ticks before they can go again.
    const x0 = a!.x;
    step(game, castle, 10);
    expect(px(x0 - a!.x)).toBe(5);
    for (let t = 0; t < 300 && a!.shot !== BLADE_STATE.wait; t++) step(game, castle);
    expect([px(a!.x), px(a!.y), a!.timer]).toEqual([72, 184, BLADE_TRAP.cool - 1]);
  });

  it("blade traps hurt a Link in their way (2, hit type 1) and a sword clanks on them", () => {
    const game = yard(110, 184);
    const hearts = game.battle.fighters[0]!.hearts;
    for (let t = 0; t < 30 && !game.battle.hits.length; t++) step(game, castle);
    expect(game.battle.hits[0]).toMatchObject({ victim: 0, damage: 2, blocked: false });
    expect(game.battle.fighters[0]!.hearts).toBe(hearts - 2);
    // A swing at one at rest: it's pushed back, unhurt (nothing beats it).
    const swing = yard(72, 200);
    const [trap] = blades(swing);
    trap!.timer = 999;
    step(swing, castle, 1, Button.Up);
    step(swing, castle, 3, Button.Sword);
    expect(swing.players[0]!.action).toBe("tink");
    expect(trap!.life).toBe(1);
  });
});
