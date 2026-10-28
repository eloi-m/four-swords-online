// The arenas' props read from the user's disc (extracted/), and a bot match with items and hazards on each arena.
import { existsSync, readFileSync } from "node:fs";
import { decompressYaz0, Dol, parseRarc, readTileTypes, Stage } from "@fso/formats";
import { describe, expect, it } from "vitest";
import { ARENA_H, ARENA_ROOMS, arenaName, arenaSpawns, buildArenaWorld } from "./arena.ts";
import { createBattle } from "./battle.ts";
import { botInputs } from "./battlebots.ts";
import { cloneGame, stepGame, type GameState } from "./game.ts";
import { hashGame } from "./hash.ts";
import { SUBPX } from "./player.ts";
import { arenaProps } from "./props.ts";
import { screenAt, sideRoomY } from "./siderooms.ts";

const root = new URL("../../../extracted/", import.meta.url);
const boss500 = new URL("files/GC4Sword_usa/Boss/boss500.arc", root);
const dol = new URL("sys/main.dol", root);

describe.skipIf(!existsSync(boss500) || !existsSync(dol))("arena props (boss500)", () => {
  if (!existsSync(boss500) || !existsSync(dol)) return void it.skip("needs extracted/", () => {});
  const stage = new Stage(parseRarc(decompressYaz0(readFileSync(boss500))));
  const tileTypes = readTileTypes(new Dol(readFileSync(dol)));
  /** The props of a room by type: the TV's (screen 0), or a side room's (siderooms.ts). */
  const count = (room: number, screen = 0) => {
    const props = arenaProps(stage, tileTypes, room);
    const n: Record<string, number> = { bushes: props.bushes.filter((t) => Math.floor(t / 32 / 32) === screen).length };
    for (const a of props.actors) if (screenAt(a.y * SUBPX) === screen) n[a.id] = (n[a.id] ?? 0) + 1;
    return n;
  };

  it("finds each arena's hazards on the TV screen and in its side rooms", () => {
    expect(count(0)).toMatchObject({ HBMB: 1, TFLR: 1, SWTH: 1, BEEE: 2, CRGN: 2, bushes: 7 });
    // The Field's house (s2): a socket bomb, a crystal and soldier spawners; its cave (s5): a crystal.
    expect(count(0, 2)).toMatchObject({ HBMB: 1, ONOF: 1, GEN3: 2 });
    expect(count(0, 5)).toMatchObject({ ONOF: 1, GEN3: 2 });
    // The Tower of Flames' north room: the eternal flames' switch (14).
    expect(arenaProps(stage, tileTypes, 1).actors.filter((a) => screenAt(a.y * SUBPX) === 2 && a.id === "SWTH").map((a) => [a.x, a.y - sideRoomY(2), a.params >>> 27])).toEqual([[144, 32, 14]]);
    expect(arenaProps(stage, tileTypes, 0).warps?.map((w) => [w.x, w.y, w.toX, w.toY, w.style])).toEqual([
      [144, 88, 80, 2560 + 136, 0], // the cave (s5)…
      [80, 2560 + 136, 144, 88, 1], // …and the way back out
      [256, 168, 80, 1024 + 136, 0], // the house (s2)…
      [80, 1024 + 136, 256, 168, 1],
    ]);
    expect(arenaProps(stage, tileTypes, 1).sideRooms).toBe(0b101100); // the Tower of Flames' rooms 2, 3 and 5
    expect(arenaProps(stage, tileTypes, 2).sideViews).toBe(0b11); // the Tower of Winds (TV and gallery) is side view
    expect(count(1)).toMatchObject({ HBMB: 32, BLZ2: 20, FLME: 4, SWTH: 4, CRGN: 4 });
    // The Tower of Flames' switches hide under its four pots (tile 0x43, solid); The Field's under a bush (0x6a).
    const switches = (room: number) => arenaProps(stage, tileTypes, room).actors.filter((a) => a.id === "SWTH" && a.y < ARENA_H);
    expect(switches(1).map((s) => [s.onSolid, s.tile])).toEqual([[true, 0x43], [true, 0x43], [true, 0x43], [true, 0x43]]);
    expect(switches(0).map((s) => [s.onSolid ?? false, s.tile, arenaProps(stage, tileTypes, 0).bushes.includes((s.y / 16) * 32 + s.x / 16)])).toEqual([[false, 0x6a, true]]);
    expect(switches(6).map((s) => s.tile)).toEqual([0x43, 0x43, 0x12, 0x43, 0x43, 0x12]); // + two bare floor switches
    expect(switches(7).map((s) => s.tile)).toEqual([0x46, 0x46, 0x46, 0x46]); // the Tower of Winds' pots
    expect([1, 2, 6, 7].map((room) => arenaProps(stage, tileTypes, room).pots?.length)).toEqual([4, 2, 4, 4]);
    expect(count(1)).toMatchObject({ SWOR: 4, RNSW: 1, SWT4: 2, CHSW: 2 });
    expect(count(3)).toMatchObject({ SLR1: 4, CIRC: 4, GEN3: 14 });
    expect(count(4)).toMatchObject({ FBMR: 2, RBPN: 76, CRGN: 5, CKSW: 1, WTSW: 4, RNSW: 1 });
    expect(count(9)).toMatchObject({ FBMR: 4 }); // Dark World: 4 arms
    expect(count(6).HBMB).toBeUndefined(); // the Dark World Tower of Flames has no bombs on the TV screen
    // …but four crystals, on unlit crystal tiles.
    expect(arenaProps(stage, tileTypes, 6).actors.filter((a) => a.id === "ONOF" && a.y < ARENA_H).map((a) => a.tile)).toEqual([0xbf, 0xbf, 0xbf, 0xbf]);
  });

  it("a 4-bot match on every arena is deterministic and survives a JSON snapshot", () => {
    for (const room of ARENA_ROOMS) {
      const world = buildArenaWorld(stage, tileTypes, room);
      const props = arenaProps(stage, tileTypes, room);
      const make = () => createBattle(room, arenaSpawns(stage, room), { hearts: 3, timeLimit: 30 * 60, wins: 3 }, props, room + 1);
      const run = (game: GameState, seed: { s: number }, n: number, log: number[]) => {
        for (let t = 0; t < n; t++) {
          stepGame(game, botInputs(game, seed), world);
          log.push(hashGame(game));
        }
      };
      const a: number[] = [], seedA = { s: 3 };
      const game = make();
      run(game, seedA, 1500, a);
      const copy = JSON.parse(JSON.stringify(cloneGame(game))) as GameState;
      const seedB = { ...seedA };
      run(game, seedA, 1500, a);
      const b: number[] = a.slice(0, 1500);
      run(copy, seedB, 1500, b);
      expect(b, arenaName(room)).toEqual(a);
      expect(game.battle!.entities.length + game.battle!.fighters.length).toBeGreaterThan(0);
    }
  }, 120_000); // (slow when the machine is busy) 10 arenas × 4500 ticks, hashed every tick
});
