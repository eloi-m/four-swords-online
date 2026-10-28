// Swimming and ledge jumps against Dolphin traces (dolphin-adventure-motion.json, from tools/dolphin trace.ts +
// fixture.ts; skips without extracted/): Lake Hylia room 2's river from its north pier (in, gliding, turning, a
// diagonal into the big rock, out again), room 5's ledge into the river and room 2's westward ledge.
import { existsSync, readFileSync } from "node:fs";
import { decompressYaz0, Dol, loadActorTypes, parseRarc, readTileTypes, Stage } from "@fso/formats";
import { describe, expect, it } from "vitest";
import { Button, SUBPX } from "../player.ts";
import { ROOM_H, ROOM_W } from "../world.ts";
import { createAdventure, stepAdventure } from "./adventure.ts";
import { JUMP_TICKS } from "./ledge.ts";
import { FALLS_FOOT } from "./falls.ts";
import { GATHER_BUTTON, SEPARATE_BUTTON, selectButtons } from "./formation.ts";
import { motionFrame } from "./motion.ts";
import { actorStats, AdventureStage } from "./stage.ts";

interface Case {
  name: string;
  frames: [buttons: number, x: number, y: number, spriteFrame: number, state: number][];
}
const fixture = JSON.parse(readFileSync(new URL("./dolphin-adventure-motion.json", import.meta.url), "utf8")) as { cases: Case[] };
const byName = (name: string) => fixture.cases.find((c) => c.name === name)!;

const root = new URL("../../../../extracted/", import.meta.url);
const load = (path: string) => parseRarc(decompressYaz0(readFileSync(new URL(`files/GC4Sword_usa/${path}`, root))));

/** The game's Link states the sim's motions stand for. */
const STATE = { walk: [0, 2, 13], swim: [74], jump: [56] } as const;

describe.skipIf(!existsSync(root))("swimming and ledges like the game", () => {
  if (!existsSync(root)) return void it.skip("needs extracted/", () => {});
  const tileTypes = readTileTypes(new Dol(readFileSync(new URL("sys/main.dol", root))));
  const stats = actorStats(loadActorTypes(load("data.arc"))!);
  const stage = new AdventureStage(new Stage(load("Boss/boss010.arc")), tileTypes, stats);

  function replay(c: Case, setup?: (game: ReturnType<typeof createAdventure>) => void) {
    const [, x0, y0, frame0] = c.frames[0]!;
    const cx = Math.floor(x0 / ROOM_W), cy = Math.floor(y0 / ROOM_H);
    const facing = ({ 62: "down", 63: "up", 60: "right", 61: "left" } as const)[frame0 as 62] ?? "down";
    const game = createAdventure(stage, { room: stage.roomAtCell(cx, cy), x: Math.floor(x0 - cx * ROOM_W), y: Math.floor(y0 - cy * ROOM_H), facing });
    const p = game.players[0]!;
    p.x = Math.round((x0 - cx * ROOM_W) * SUBPX);
    p.y = Math.round((y0 - cy * ROOM_H) * SUBPX);
    setup?.(game);
    let maxError = 0, worst = 0;
    const states: number[] = [], sprites: number[] = [];
    for (let i = 1; i < c.frames.length; i++) {
      const [buttons, x, y, sprite, state] = c.frames[i]!;
      stepAdventure(game, [buttons], stage);
      const error = Math.max(Math.abs(p.x / SUBPX + cx * ROOM_W - x), Math.abs(p.y / SUBPX + cy * ROOM_H - y));
      if (error > maxError) [maxError, worst] = [error, i];
      const mode = game.adventure.links[0]!.mode;
      const expected = mode === "swim" || mode === "ashore" ? STATE.swim : mode === "jump" || mode === "land" ? STATE.jump : STATE.walk;
      // The game switches state on the tick after the one that decided it: compare with the next frame's state.
      const next = c.frames[i + 1]?.[4] ?? state;
      if (!(expected as readonly number[]).includes(next) && !(expected as readonly number[]).includes(state)) states.push(i);
      const shown = motionFrame(game.adventure.links[0], p);
      if (shown >= 0 && shown !== sprite) sprites.push(i);
    }
    return { maxError, worst, states, sprites, game };
  }

  it("swims in room 2's river: in from the pier, gliding to a stop, turning, against the rock, out again", () => {
    const r = replay(byName("swim"));
    expect(r.maxError, `frame ${r.worst}`).toBeLessThan(0.02);
    expect(r.states).toEqual([]);
    expect(r.sprites).toEqual([]);
    expect(r.game.adventure.links[0]!.mode).toBe("walk");
  });

  it("jumps room 5's ledge into the river and swims (the grey stone lifted first)", () => {
    const r = replay(byName("ledge-north"), (game) => game.battle.cut.push(19 * 32 + 5));
    expect(r.maxError, `frame ${r.worst}`).toBeLessThan(0.02);
    expect(r.states).toEqual([]);
    expect(r.sprites).toEqual([]);
    expect(r.game.adventure.links[0]!.mode).toBe("swim");
  });

  it("pushes room 2's boulder into the river with the four in the wide formation, and crosses on it", () => {
    const frames = (fixture as unknown as { boulder: { frames: number[][] } }).boulder.frames;
    const ox = 3 * ROOM_W, oy = 4 * ROOM_H; // room 2's cell (3, 4)
    const f0 = frames[0]!;
    const game = createAdventure(stage, { room: 2, x: f0[1]! - ox, y: f0[2]! - oy, players: 4, facing: "up" });
    game.players.forEach((p, i) => Object.assign(p, { x: Math.round((f0[1 + 2 * i]! - ox) * SUBPX), y: Math.round((f0[2 + 2 * i]! - oy) * SUBPX), facing: "up" }));
    game.adventure.formation = "wide";
    let rockError = 0, linkError = 0, sunkAt = -1, gameSunkAt = -1;
    for (let k = 1; k < frames.length; k++) {
      const row = frames[k]!;
      stepAdventure(game, [row[0]!], stage);
      const rock = game.adventure.rocks.find((r) => r.type === "RCK3")!;
      if (rock.state === "sunk" && sunkAt < 0) sunkAt = k;
      if (row[10] && gameSunkAt < 0) gameSunkAt = k;
      if (gameSunkAt >= 0) continue;
      rockError = Math.max(rockError, Math.abs(rock.y / SUBPX + oy - row[9]!));
      game.players.forEach((p, i) => (linkError = Math.max(linkError, Math.abs(p.y / SUBPX + oy - row[2 + 2 * i]!))));
    }
    expect(rockError).toBeLessThan(0.01);
    // The pushers keep a pixel's contact with its box (the game's box edge is at a half px: 0.5 px nearer).
    expect(linkError).toBeLessThan(1.2);
    expect(Math.abs(sunkAt - gameSunkAt)).toBeLessThanOrEqual(1);
    // On it, then over the river onto the north pier.
    for (let k = 0; k < 60; k++) stepAdventure(game, [1], stage);
    expect(game.players[0]!.y / SUBPX).toBeLessThan(176);
    expect(game.adventure.links[0]!.mode).toBe("walk");
  });

  it("jumps room 2's westward ledge, landing beside a wall", () => {
    const r = replay(byName("ledge-west"));
    expect(r.maxError, `frame ${r.worst}`).toBeLessThan(0.02);
    expect(r.states).toEqual([]);
    expect(r.sprites).toEqual([]);
    expect(JUMP_TICKS).toBe(27);
  });

  // `falls1` (docs/measurements/adventure-lake-hylia.md "Adventure: waterfalls"): 11 ticks swimming over room 7's falls, then the four at
  // its foot on that screen (y 368) until Down; the walk into room 6 down to 40.25, a drop to 120.25, swimming 14 ticks on.
  it("goes over room 7's waterfall into room 6's pool", () => {
    const game = createAdventure(stage, { room: 7, x: 300, y: 36, players: 4 });
    const at = () => ({ room: game.adventure.room, y: game.players[0]!.y / SUBPX, mode: game.adventure.links[0]!.mode });
    for (let t = 0; t < 12; t++) stepAdventure(game, [0], stage);
    expect(at()).toEqual({ room: 7, y: FALLS_FOOT, mode: "fall" });
    expect(game.players.every((p) => p.y / SUBPX === FALLS_FOOT)).toBe(true);
    for (let t = 0; t < 60; t++) stepAdventure(game, [0], stage);
    expect(at()).toEqual({ room: 7, y: FALLS_FOOT, mode: "fall" });
    let walkedTo = 0;
    for (let t = 0; t < 60 && game.adventure.links[0]!.mode !== "swim"; t++) {
      stepAdventure(game, [Button.Down], stage);
      if (game.adventure.edge) walkedTo = game.players[0]!.y / SUBPX;
    }
    expect(walkedTo).toBeCloseTo(40.25, 5);
    expect(at()).toEqual({ room: 6, y: 120.25, mode: "swim" });
  });

  // `free1`…`free5`: X sends the others a step away to stand; the D-pad hands the controls over; Y calls them back.
  it("moves the Links apart, hands the controls to another one, calls them back", () => {
    const game = createAdventure(stage, { room: 0, players: 4 });
    for (let t = 0; t < 30; t++) stepAdventure(game, [0], stage);
    stepAdventure(game, [SEPARATE_BUTTON], stage);
    for (let t = 0; t < 10; t++) stepAdventure(game, [0], stage);
    expect(game.adventure.formation).toBe("apart");
    const red = { x: game.players[1]!.x, y: game.players[1]!.y };
    stepAdventure(game, [selectButtons(1)], stage);
    expect(game.adventure.colors[0]).toBe(1);
    const green = game.adventure.colors.indexOf(0), before = { ...game.players[green]! };
    for (let t = 0; t < 20; t++) stepAdventure(game, [Button.Left], stage);
    expect(game.players[0]!.x).toBeLessThan(red.x);
    expect(game.players[0]!.y).toBe(red.y);
    expect([game.players[green]!.x, game.players[green]!.y]).toEqual([before.x, before.y]);
    stepAdventure(game, [GATHER_BUTTON], stage);
    for (let t = 0; t < 40; t++) stepAdventure(game, [0], stage);
    expect(game.adventure.formation).toBe("trail");
  });
});
