// The adventure on the real stages (skips without extracted/): every stage loads and starts on its PLAS starts, and
// Dolphin traces replay (dolphin-adventure-traces.json, from tools/dolphin trace.ts + fixture.ts): room changes up and
// down, a house's door both ways.
import { existsSync, readFileSync } from "node:fs";
import { decompressYaz0, Dol, loadActorTypes, parseRarc, readTileTypes, Stage } from "@fso/formats";
import { describe, expect, it } from "vitest";
import { hashGame } from "../hash.ts";
import { playerFrame, SUBPX } from "../player.ts";
import { ROOM_H, ROOM_W } from "../world.ts";
import { cloneAdventure, createAdventure, stepAdventure, WARP_TICKS, type AdventureGame } from "./adventure.ts";
import { actorStats, AdventureStage } from "./stage.ts";

interface Case {
  name: string;
  frames: [buttons: number, x: number, y: number, spriteFrame: number, state: number][];
}
const fixture = JSON.parse(readFileSync(new URL("./dolphin-adventure-traces.json", import.meta.url), "utf8")) as { cases: Case[] };
const byName = (name: string) => fixture.cases.find((c) => c.name === name)!;

const root = new URL("../../../../extracted/", import.meta.url);
const load = (path: string) => parseRarc(decompressYaz0(readFileSync(new URL(`files/GC4Sword_usa/${path}`, root))));

describe.skipIf(!existsSync(root))("the adventure on the real stages", () => {
  const tileTypes = readTileTypes(new Dol(readFileSync(new URL("sys/main.dol", root))));
  const stats = actorStats(loadActorTypes(load("data.arc"))!);
  const stageOf = (id: string) => new AdventureStage(new Stage(load(`Boss/${id}.arc`)), tileTypes, stats);

  it("loads every stage and starts the Links on its start room's PLAS starts", () => {
    for (let w = 1; w <= 8; w++) {
      for (let s = 0; s <= 3; s++) {
        const stage = stageOf(`boss0${w}${s}`);
        const game = createAdventure(stage, { players: 4 });
        expect(game.room, `boss0${w}${s}`).toBe(stage.start().room);
        for (const room of stage.rooms) expect(stage.area(room).world.widthCells).toBe(64);
        for (let i = 0; i < 60; i++) stepAdventure(game, [0, 0, 0, 0], stage);
      }
    }
  });

  /** The leader's position as the game records it: world px on the TV, area px in a GBA-screen area. */
  const traced = (game: AdventureGame, stage: AdventureStage) => {
    const p = game.players[0]!, a = game.adventure;
    if (a.area) return { x: p.x / SUBPX, y: p.y / SUBPX };
    const cell = stage.cellOf(a.room)!;
    return { x: p.x / SUBPX + cell.cx * ROOM_W, y: p.y / SUBPX + cell.cy * ROOM_H };
  };

  function replay(c: Case, stage: AdventureStage) {
    const [, x0, y0, frame0, state0] = c.frames[0]!;
    const cx = Math.floor(x0 / ROOM_W), cy = Math.floor(y0 / ROOM_H);
    const room = stage.roomAtCell(cx, cy);
    const facing = ({ 62: "down", 63: "up", 24: "up", 16: "down" } as const)[frame0 as 62] ?? "down";
    const game = createAdventure(stage, { room, x: Math.floor(x0 - cx * ROOM_W), y: Math.floor(y0 - cy * ROOM_H), facing });
    const p = game.players[0]!;
    p.x = Math.round((x0 - cx * ROOM_W) * SUBPX);
    p.y = Math.round((y0 - cy * ROOM_H) * SUBPX);
    if (state0 === 2) [p.moving, p.walkTicks] = [true, 1]; // mid-walk (after a teleport) on the cycle's first tick
    let maxError = 0, worst = 0;
    const sprites: number[] = [];
    for (let i = 1; i < c.frames.length; i++) {
      const [buttons, x, y, sprite, state] = c.frames[i]!;
      const [, px, py] = c.frames[i - 1]!;
      stepAdventure(game, [buttons], stage);
      const at = traced(game, stage);
      const error = Math.max(Math.abs(at.x - x), Math.abs(at.y - y));
      if (error > maxError) [maxError, worst] = [error, i];
      // As measured.test.ts: the game still shows a walk frame on the tick Link stops (walking or after a room change).
      const stopTick = (state === 2 || state === 27) && x === px && y === py;
      if (sprite < 64 && !stopTick && playerFrame(p) !== sprite) sprites.push(i);
    }
    return { maxError, worst, sprites, game };
  }

  it("changes rooms up and down like the game (Lake Hylia rooms 2 and 3)", () => {
    const r = replay(byName("vertical"), stageOf("boss010"));
    expect(r.maxError, `frame ${r.worst}`).toBeLessThan(0.06);
    expect(r.sprites).toEqual([]);
  });

  it("goes into a house and out again like the game (Lake Hylia room 1, area 2)", () => {
    const r = replay(byName("house"), stageOf("boss010"));
    expect(r.maxError, `frame ${r.worst}`).toBeLessThan(0.06);
    expect(r.sprites).toEqual([]);
    expect(r.game.adventure.area).toBe(0);
    expect(WARP_TICKS).toBe(110);
  });

  it("walks the formation like the game (the other three Links on the leader's trail, 18 px apart)", () => {
    const stage = stageOf("boss010");
    const frames = (fixture as unknown as { formation: { frames: number[][] } }).formation.frames;
    const [, ...first] = frames[0]!;
    const ox = 4 * ROOM_W, oy = 4 * ROOM_H; // room 1's cell (4, 4)
    const game = createAdventure(stage, { room: 1, x: 0, y: 0, players: 4, facing: "down" });
    game.players.forEach((p, i) => {
      p.x = Math.round((first[2 * i]! - ox) * SUBPX);
      p.y = Math.round((first[2 * i + 1]! - oy) * SUBPX);
      p.facing = "down";
    });
    game.adventure.trails = game.players.slice(0, -1).map((p) => [p.x, p.y]);
    // Before the savestate the followers had trails of their own (the third and fourth first walk where the Links ahead
    // came from): compare the second all along, the others once they're on the trail.
    const settled = [0, 0, 45, 150];
    const worst = [0, 0, 0, 0];
    for (let f = 1; f < frames.length; f++) {
      const row = frames[f]!;
      stepAdventure(game, [row[0]!], stage);
      game.players.forEach((p, i) => {
        if (f < settled[i]!) return;
        const e = Math.max(Math.abs(p.x / SUBPX + ox - row[1 + 2 * i]!), Math.abs(p.y / SUBPX + oy - row[2 + 2 * i]!));
        worst[i] = Math.max(worst[i]!, e);
      });
    }
    expect(worst[0]).toBeLessThan(0.01);
    expect(worst[1], "second Link").toBeLessThan(0.1);
    expect(worst[2], "third Link").toBeLessThan(0.1);
    expect(worst[3], "fourth Link").toBeLessThan(0.1);
  });

  // The black-box playtest's capture 20261018-164259-633 (room 1 at (60, 320)): the followers started on the room's
  // middle and walked their trail (straight at the leader, no collision) through the garden's fence and bushes.
  it("starts all four on a start spot, as a door stacks them", () => {
    const stage = stageOf("boss010");
    const game = createAdventure(stage, { room: 1, x: 60, y: 320, players: 4 });
    for (let i = 0; i < 60; i++) stepAdventure(game, [0], stage);
    expect(game.players.map((p) => [p.x / SUBPX, p.y / SUBPX])).toEqual(Array(4).fill([60, 320]));
  });

  it("starts all four on the leader in a room given without a spot (its middle)", () => {
    const stage = stageOf("boss010");
    const game = createAdventure(stage, { room: 3, players: 4 });
    const leader = [game.players[0]!.x, game.players[0]!.y];
    expect(game.players.map((p) => [p.x, p.y])).toEqual(Array(4).fill(leader));
    for (let i = 0; i < 60; i++) stepAdventure(game, [0], stage);
    expect(game.players.map((p) => [p.x, p.y])).toEqual(Array(4).fill(leader));
  });

  it("stays deterministic through clones", () => {
    const stage = stageOf("boss010");
    const a = createAdventure(stage, { players: 4, seed: 7 });
    let x = 12345;
    const inputs: number[] = [];
    for (let i = 0; i < 1500; i++) {
      x = (x * 1103515245 + 12345) >>> 0;
      inputs.push((x >>> 16) & 0x7f);
    }
    for (let i = 0; i < 700; i++) stepAdventure(a, [inputs[i]!], stage);
    const b = cloneAdventure(a);
    for (let i = 700; i < 1500; i++) {
      stepAdventure(a, [inputs[i]!], stage);
      stepAdventure(b, [inputs[i]!], stage);
    }
    expect(hashGame(b)).toBe(hashGame(a));
    expect(JSON.parse(JSON.stringify(b))).toEqual(JSON.parse(JSON.stringify(a)));
  });
});
