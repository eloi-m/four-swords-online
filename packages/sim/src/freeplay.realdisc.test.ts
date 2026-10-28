// The free-play map on the real stage 4-2 (needs extracted/): its field's four screens from the origin, walkable from
// end to end, and where free play puts its Links.
import { existsSync, readFileSync } from "node:fs";
import { decompressYaz0, Dol, isYaz0, parseRarc, readTileTypes, Stage } from "@fso/formats";
import { describe, expect, it } from "vitest";
import { DEFAULT_RULES, MAX_LINKS } from "./battle.ts";
import { HEART } from "./combat.ts";
import { createFreePlay, FREE_H, FREE_ROOMS, FREE_STAGE, FREE_W, freeSpawns, freeWorld, islandAt, standsAt } from "./freeplay.ts";
import { stepGame } from "./game.ts";
import { hashGame } from "./hash.ts";
import { Button, HITBOX, SUBPX } from "./player.ts";
import { CELL, isSolidAt, roomAt, surfaceAt, type World } from "./world.ts";

const root = new URL("../../../extracted/", import.meta.url);
const arc = new URL(`files/GC4Sword_usa/Boss/${FREE_STAGE}.arc`, root);
const dol = new URL("sys/main.dol", root);

/** Per room of the block (FREE_ROOMS row by row), how many of its walkable cells are 1 in `cells`, and of how many. */
function perRoom(world: World, cells: Uint8Array): { reached: number; floor: number }[] {
  const out = FREE_ROOMS.flat().map(() => ({ reached: 0, floor: 0 }));
  for (let cy = 0; cy < FREE_H / CELL; cy++) {
    for (let cx = 0; cx < FREE_W / CELL; cx++) {
      const i = cy * world.widthCells + cx, room = out[Math.floor(cy / 48) * FREE_ROOMS[0]!.length + Math.floor(cx / 64)]!;
      if (world.solid[i] || surfaceAt(world, cx * CELL, cy * CELL) === "pit") continue;
      room.floor++;
      if (cells[i]) room.reached++;
    }
  }
  return out;
}

describe.skipIf(!existsSync(arc) || !existsSync(dol))("Free play on stage 4-2's field (extracted/)", () => {
  if (!existsSync(arc) || !existsSync(dol)) return void it.skip("needs extracted/", () => {});
  const raw = readFileSync(arc);
  const stage = new Stage(parseRarc(isYaz0(raw) ? decompressYaz0(raw) : raw));
  const tileTypes = readTileTypes(new Dol(readFileSync(dol)));
  const world = freeWorld(stage, tileTypes);
  const spawns = freeSpawns(world, MAX_LINKS);

  it("is the block's four rooms from the origin, walled all round", () => {
    expect([FREE_W, FREE_H]).toEqual([1024, 768]);
    expect(FREE_ROOMS.flat().every((room) => stage.layout.rooms.flat().includes(room))).toBe(true);
    expect([roomAt(world, 10, 10), roomAt(world, 1000, 10), roomAt(world, 10, 700), roomAt(world, 1000, 700)]).toEqual(FREE_ROOMS.flat());
    expect([isSolidAt(world, -1, 100), isSolidAt(world, FREE_W, 100), isSolidAt(world, 100, FREE_H), isSolidAt(world, 100, -1)]).toEqual([true, true, true, true]);
  });

  it("puts 8 Links on distinct spots to stand on in the middle of the field, all on its one walkable island", () => {
    expect(spawns).toEqual(freeSpawns(freeWorld(stage, tileTypes), MAX_LINKS));
    const island = islandAt(world, spawns[0]!.x, spawns[0]!.y);
    for (const [i, s] of spawns.entries()) {
      for (const dx of [HITBOX.left, HITBOX.right]) for (const dy of [HITBOX.top, HITBOX.bottom]) expect(isSolidAt(world, s.x + dx, s.y + dy), JSON.stringify(s)).toBe(false);
      expect(surfaceAt(world, s.x, s.y)).not.toBe("pit");
      expect(island[Math.floor(s.y / CELL) * world.widthCells + Math.floor(s.x / CELL)]).toBe(1);
      for (const t of spawns.slice(i + 1)) expect(Math.abs(s.x - t.x) + Math.abs(s.y - t.y)).toBeGreaterThanOrEqual(32);
      // Around the four rooms' corner, well clear of room 3's house (its top left, px 144-240 × 80-176).
      expect(Math.abs(s.x - FREE_W / 2) + Math.abs(s.y - FREE_H / 2), JSON.stringify(s)).toBeLessThan(120);
    }
  });

  it("lets a Link walk from the spawns into all four rooms: nearly all of each room's floor", () => {
    const rooms = perRoom(world, islandAt(world, spawns[0]!.x, spawns[0]!.y));
    for (const [k, r] of rooms.entries()) expect(r.reached / r.floor, `room ${FREE_ROOMS.flat()[k]}`).toBeGreaterThan(0.9);
  });

  it("keeps the Links who stand somewhere already, and finds the others a spot away from them", () => {
    const kept = [null, { x: 540, y: 388, facing: "left" as const }, { x: 300, y: 600, facing: "up" as const }, { x: 200, y: 120, facing: "down" as const }];
    expect(standsAt(world, 200, 120)).toBe(false); // (the house)
    const game = createFreePlay(world, 5, 3, kept);
    const at = game.players.map((p) => ({ x: p.x / SUBPX, y: p.y / SUBPX, facing: p.facing }));
    expect(at.slice(1, 3)).toEqual(kept.slice(1, 3));
    for (const [i, p] of at.entries()) {
      expect(standsAt(world, p.x, p.y), `P${i + 1}`).toBe(true);
      for (const q of at.slice(i + 1)) expect(Math.abs(p.x - q.x) + Math.abs(p.y - q.y)).toBeGreaterThanOrEqual(32);
    }
  });

  it("createFreePlay: 8 Links fighting for a minute, nobody hurt for good, the same on every run", () => {
    const play = () => {
      const game = createFreePlay(world, MAX_LINKS, 42);
      for (let t = 0; t < 3600; t++) {
        stepGame(game, game.players.map((_, i) => (((t >> 4) + i) % 5 === 0 ? Button.Sword : [Button.Right, Button.Up, Button.Left, Button.Down][((t >> 6) + i) % 4]!)), world);
      }
      return game;
    };
    const game = play();
    expect(game.battle!.phase).toBe("free");
    expect(game.room).toBe(roomAt(world, spawns[0]!.x, spawns[0]!.y));
    expect(game.battle!.fighters.every((f) => f.hearts === DEFAULT_RULES.hearts * HEART && f.mode !== "dead")).toBe(true);
    expect(hashGame(play())).toBe(hashGame(game));
  });
});
