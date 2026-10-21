// Regression against the real game: replays the per-frame input FSA read (Dolphin RAM traces in dolphin-traces.json,
// made with tools/dolphin trace.ts + fixture.ts) through the sim and compares the leader's position and sprite frame.
// The open-field case runs on an empty world; the others need the real boss010 collision and skip without extracted/.
import { existsSync, readFileSync } from "node:fs";
import { decompressYaz0, Dol, MAP_GRID, parseRarc, readTileTypes, Stage } from "@fso/formats";
import { describe, expect, it } from "vitest";
import { createGame, stepGame } from "./game.ts";
import { playerFrame, SUBPX, type Facing } from "./player.ts";
import { buildWorld, CELL, ROOM_H, ROOM_W, type World } from "./world.ts";

interface Case {
  name: string;
  script: string;
  frames: [buttons: number, x: number, y: number, spriteFrame: number, state: number][];
}
const fixture = JSON.parse(readFileSync(new URL("./dolphin-traces.json", import.meta.url), "utf8")) as { cases: Case[] };
const byName = (name: string) => fixture.cases.find((c) => c.name === name)!;

const STATE = { idle: 0, walk: 2, push: 13, roomChange: 27 } as const;
const FACING_OF_STAND: Record<number, Facing> = { 60: "right", 61: "left", 62: "down", 63: "up" };

/** Replays a case; returns the largest position error and the frames whose sprite differs. */
function replay(c: Case, world: World) {
  const [, x0, y0, frame0] = c.frames[0]!;
  const game = createGame(world, [{ x: x0, y: y0 }]);
  const p = game.players[0]!;
  p.x = Math.round(x0 * SUBPX); // createGame takes whole pixels' worth of any float; keep the exact start
  p.y = Math.round(y0 * SUBPX);
  p.facing = FACING_OF_STAND[frame0]!;
  let maxError = 0, worst = 0;
  const spriteMismatches: number[] = [];
  for (let i = 1; i < c.frames.length; i++) {
    const [buttons, x, y, sprite, state] = c.frames[i]!;
    const [, px, py] = c.frames[i - 1]!;
    stepGame(game, [buttons], world);
    const error = Math.max(Math.abs(p.x / SUBPX - x), Math.abs(p.y / SUBPX - y));
    if (error > maxError) [maxError, worst] = [error, i];
    // On the tick Link stops the game still shows a walk frame (its walk state lingers a tick); the sim stands at once.
    // Pushing (a wall for 20+ ticks) has its own animation, which the sim doesn't have.
    const stopTick = (state === STATE.walk || state === STATE.roomChange) && x === px && y === py;
    if (state !== STATE.push && sprite < 64 && !stopTick && playerFrame(p) !== sprite) spriteMismatches.push(i);
  }
  return { maxError, worst, spriteMismatches };
}

function openWorld(): World {
  const widthCells = MAP_GRID * (ROOM_W / CELL), heightCells = MAP_GRID * (ROOM_H / CELL);
  const solid = new Uint8Array(widthCells * heightCells);
  return { widthCells, heightCells, solid, surface: new Uint8Array(solid.length), rooms: new Int16Array(MAP_GRID * MAP_GRID).fill(-1) };
}

describe("sim vs Dolphin traces", () => {
  it("walks like the game on open ground (starts, stops, taps, reversals, diagonals)", () => {
    const r = replay(byName("open"), openWorld());
    expect(r.maxError).toBeLessThan(0.1); // diagonals: 272/256 per axis vs the game's 1.5/√2
    expect(r.spriteMismatches).toEqual([]);
  });

  const root = new URL("../../../extracted/", import.meta.url);
  describe.skipIf(!existsSync(root))("on boss010's collision", () => {
    const load = (path: string) => parseRarc(decompressYaz0(readFileSync(new URL(`files/GC4Sword_usa/${path}`, root))));
    const world = () => buildWorld(new Stage(load("Boss/boss010.arc")), readTileTypes(new Dol(readFileSync(new URL("sys/main.dol", root)))));

    it("stops against walls where the game does", () => {
      const r = replay(byName("walls"), world());
      expect(r.maxError).toBeLessThan(0.01);
      expect(r.spriteMismatches).toEqual([]);
    });

    it("changes rooms like the game (trigger, auto-walk, control back)", () => {
      const r = replay(byName("rooms"), world());
      expect(r.maxError).toBeLessThan(0.06); // auto-walk speed rounded to 1/256 px
      expect(r.spriteMismatches).toEqual([]);
    });

    it("slides around corners like the game", () => {
      for (const name of ["cornerUp", "cornerLeft"]) {
        const r = replay(byName(name), world());
        expect(r.maxError, name).toBeLessThan(0.01);
        expect(r.spriteMismatches, name).toEqual([]);
      }
    });
  });
});
