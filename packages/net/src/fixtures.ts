// Node-only fixtures for the tests and the bench: the real packages/sim game as a RollbackGame, on a synthetic world
// or on Lake Hylia read from extracted/ (when present).
import { existsSync, readFileSync } from "node:fs";
import { decompressYaz0, Dol, parseRarc, readTileTypes, Stage } from "@fso/formats";
import { buildWorld, cloneGame, createGame, hashGame, HITBOX, ROOM_H, ROOM_W, stepGame, type GameState, type World } from "@fso/sim";
import type { RollbackGame } from "./types.ts";

export const simGame = (world: World): RollbackGame<GameState> => ({
  clone: cloneGame,
  step: (state, inputs) => stepGame(state, inputs, world),
  hash: hashGame,
});

/** One 512×384 room of open floor with a few walls and pillars. */
export function syntheticWorld(): World {
  const widthCells = ROOM_W / 8, heightCells = ROOM_H / 8;
  const solid = new Uint8Array(widthCells * heightCells);
  for (let x = 0; x < widthCells; x++) solid[x] = solid[(heightCells - 1) * widthCells + x] = 1;
  for (let y = 0; y < heightCells; y++) {
    solid[y * widthCells] = solid[y * widthCells + widthCells - 1] = 1;
    if (y > 10 && y < 30) solid[y * widthCells + 32] = 1;
  }
  for (const [x, y] of [[12, 12], [20, 30], [45, 15], [50, 36]] as const) solid[y * widthCells + x] = 1;
  return { widthCells, heightCells, solid, surface: new Uint8Array(solid.length), rooms: Int16Array.from([0]) };
}

const extracted = new URL("../../../extracted/", import.meta.url);
export const hasExtracted = existsSync(new URL("files/GC4Sword_usa/Boss/boss010.arc", extracted));

/** Lake Hylia (boss010) and its start room origin, from extracted/. */
export function lakeHylia(): { world: World; origin: { x: number; y: number } } {
  const load = (path: string) => {
    const bytes = readFileSync(new URL(`files/GC4Sword_usa/${path}`, extracted));
    return parseRarc(bytes[0] === 0x59 ? decompressYaz0(bytes) : bytes);
  };
  const stage = new Stage(load("Boss/boss010.arc"));
  const world = buildWorld(stage, readTileTypes(new Dol(readFileSync(new URL("sys/main.dol", extracted)))));
  return { world, origin: { x: stage.layout.startX * ROOM_W, y: stage.layout.startY * ROOM_H } };
}

/** `count` free standing spots spread around a point (deterministic). */
export function spawns(world: World, around: { x: number; y: number }, count: number): { x: number; y: number }[] {
  const free = (x: number, y: number) =>
    [HITBOX.left, HITBOX.right].every((dx) => [HITBOX.top, HITBOX.bottom].every((dy) => world.solid[Math.floor((y + dy) / 8) * world.widthCells + Math.floor((x + dx) / 8)] === 0));
  const out: { x: number; y: number }[] = [];
  for (let r = 0; r < 200 && out.length < count; r += 8) {
    for (let a = 0; a < 16 && out.length < count; a++) {
      const x = Math.round(around.x + r * Math.cos((a * Math.PI) / 8)), y = Math.round(around.y + r * Math.sin((a * Math.PI) / 8));
      if (free(x, y) && out.every((p) => Math.abs(p.x - x) + Math.abs(p.y - y) >= 24)) out.push({ x, y });
    }
  }
  if (out.length < count) throw new Error("no room to spawn");
  return out;
}

export function initialGame(world: World, around: { x: number; y: number }, players: number): GameState {
  return createGame(world, spawns(world, around, players));
}

/** JSON with sorted keys: equal strings for equal states whatever the key order. */
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v) && !ArrayBuffer.isView(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v,
  );
}
