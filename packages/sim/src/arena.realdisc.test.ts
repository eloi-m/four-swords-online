import { existsSync, readFileSync } from "node:fs";
import { decompressYaz0, Dol, parseRarc, readTileTypes, Stage } from "@fso/formats";
import { describe, expect, it } from "vitest";
import { ARENA_H, ARENA_ROOMS, ARENA_W, arenaName, arenaSpawns, buildArenaWorld, moreSpawns } from "./arena.ts";
import { COUNTDOWN_TICKS, createBattle, MAX_LINKS } from "./battle.ts";
import { HURTBOX } from "./combat.ts";
import { addCpus, cpuInputs, CPU_LEVELS } from "./cpu.ts";
import { TILE, TRAPDOOR_TILES } from "./entities.ts";
import { stepGame } from "./game.ts";
import { hashGame } from "./hash.ts";
import { Button, HITBOX, SUBPX } from "./player.ts";
import { arenaProps } from "./props.ts";
import { isSolidAt, surfaceAt } from "./world.ts";

const root = new URL("../../../extracted/", import.meta.url);
const boss500 = new URL("files/GC4Sword_usa/Boss/boss500.arc", root);
const dol = new URL("sys/main.dol", root);

describe.skipIf(!existsSync(boss500) || !existsSync(dol))("Shadow Battle arenas (boss500)", () => {
  const stage = new Stage(parseRarc(decompressYaz0(readFileSync(boss500))));
  const tileTypes = readTileTypes(new Dol(readFileSync(dol)));

  it("every arena has 4 player starts on open floor, facing the middle", () => {
    for (const room of ARENA_ROOMS) {
      const world = buildArenaWorld(stage, tileTypes, room);
      const spawns = arenaSpawns(stage, room);
      expect(spawns.length, arenaName(room)).toBe(4);
      for (const s of spawns) {
        for (const dx of [HITBOX.left, HITBOX.right]) for (const dy of [HITBOX.top, HITBOX.bottom]) expect(isSolidAt(world, s.x + dx, s.y + dy)).toBe(false);
        expect(surfaceAt(world, s.x, s.y + 4)).toBe("floor");
      }
      // Players 0/2 start on the left, 1/3 on the right.
      expect(spawns.map((s) => s.facing)).toEqual(["right", "left", "right", "left"]);
      expect(isSolidAt(world, -1, 100) && isSolidAt(world, ARENA_W, 100) && isSolidAt(world, 100, ARENA_H)).toBe(true);
    }
  });

  it("pits surround the Tower of Flames and Above the Clouds, not the Field or the castle", () => {
    const pits = (room: number) => {
      const world = buildArenaWorld(stage, tileTypes, room);
      let n = 0;
      for (let y = 0; y < ARENA_H; y += 8) for (let x = 0; x < ARENA_W; x += 8) if (surfaceAt(world, x, y) === "pit") n++;
      return n;
    };
    expect([0, 1, 2, 3, 4].map(pits).map((n) => n > 0)).toEqual([false, true, false, false, true]);
  });

  it("the Field's invisible wall actors (TOMI) block their tiles", () => {
    const world = buildArenaWorld(stage, tileTypes, 0);
    const walls = stage.actors(0).filter((a) => a.id === "TOMI");
    expect(walls.length).toBe(11);
    for (const a of walls) expect(isSolidAt(world, a.x * 8 + 15, a.y * 8 + 15)).toBe(true);
  });

  it("The Field and Hyrule Castle take 8 Links: moreSpawns' starts stand clear of walls, pits, the trick floor and each other", () => {
    for (const room of [0, 3, 5, 8]) {
      const world = buildArenaWorld(stage, tileTypes, room);
      const spawns = moreSpawns(arenaSpawns(stage, room));
      expect(spawns.length, arenaName(room)).toBe(MAX_LINKS);
      expect(spawns.slice(0, 4)).toEqual(arenaSpawns(stage, room));
      const traps = arenaProps(stage, tileTypes, room).actors.filter((a) => a.id === "TFLR");
      if (room % 5 === 0) expect(traps.length).toBe(1);
      for (const [i, s] of spawns.entries()) {
        for (const dx of [HITBOX.left, HITBOX.right]) for (const dy of [HITBOX.top, HITBOX.bottom]) expect(isSolidAt(world, s.x + dx, s.y + dy), `${arenaName(room)} ${i}`).toBe(false);
        expect(surfaceAt(world, s.x, s.y)).toBe("floor");
        for (const t of traps) {
          const size = TRAPDOOR_TILES * TILE, clear = s.x + HURTBOX.right < t.x || s.x + HURTBOX.left >= t.x + size || s.y + HURTBOX.bottom < t.y || s.y + HURTBOX.top >= t.y + size;
          expect(clear, `${arenaName(room)} ${i} on the trick floor`).toBe(true);
        }
        for (const o of spawns.slice(i + 1)) expect(Math.abs(s.x - o.x) > 2 * HURTBOX.right || Math.abs(s.y - o.y) > 2 * HURTBOX.bottom, `${arenaName(room)} ${i}`).toBe(true);
      }
    }
  });

  it("8 CPUs fight a match to its end on The Field, the same on every run", () => {
    const world = buildArenaWorld(stage, tileTypes, 0), props = arenaProps(stage, tileTypes, 0);
    const play = () => {
      const game = createBattle(0, moreSpawns(arenaSpawns(stage, 0)), { hearts: 2, timeLimit: 0, wins: 1 }, props, 77);
      addCpus(game, game.players.map((_, player) => ({ player, level: CPU_LEVELS[player % 3]! })));
      let t = 0;
      for (; t < 20_000 && game.battle!.phase !== "matchOver"; t++) stepGame(game, cpuInputs(game, world, []), world);
      return { game, t };
    };
    const { game, t } = play();
    expect(game.battle!.phase, `not over after ${t} ticks`).toBe("matchOver");
    expect(game.battle!.matchWinner).toBeGreaterThanOrEqual(0);
    expect(game.players.every((p) => p.x >= 0 && p.x < ARENA_W * SUBPX && p.y >= 0 && p.y < ARENA_H * SUBPX)).toBe(true);
    const again = play();
    expect([again.t, hashGame(again.game)]).toEqual([t, hashGame(game)]);
  }, 60_000);

  it("Links stay inside their arena", () => {
    for (const room of ARENA_ROOMS) {
      const world = buildArenaWorld(stage, tileTypes, room);
      const game = createBattle(room, arenaSpawns(stage, room), { hearts: 6, timeLimit: 0, wins: 9 });
      const dirs = [Button.Left, Button.Up, Button.Right, Button.Down];
      for (let t = 0; t < COUNTDOWN_TICKS + 1200; t++) stepGame(game, game.players.map((_, i) => dirs[(i + (t >> 8)) & 3]! | (t & 16 ? Button.Sword : 0)), world);
      for (const p of game.players) {
        expect(p.x / SUBPX).toBeGreaterThanOrEqual(0);
        expect(p.x / SUBPX).toBeLessThan(ARENA_W);
        expect(p.y / SUBPX).toBeGreaterThanOrEqual(0);
        expect(p.y / SUBPX).toBeLessThan(ARENA_H);
      }
    }
  });
});
