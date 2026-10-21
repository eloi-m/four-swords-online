// Actor lists and the Shadow Battle layout, checked against the real extracted disc; skipped when extracted/ is absent.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Dol } from "../dol.ts";
import { parseRarc, type RarcArchive } from "../rarc.ts";
import { decompressYaz0, isYaz0 } from "../yaz0.ts";
import { ACTOR_RECORD_SIZE, loadActorTypes, parseActors } from "./actors.ts";
import { battleArenaName, Stage } from "./stage.ts";
import { readTileTypes, solidMask } from "./tiletypes.ts";

const root = new URL("../../../../extracted/files/GC4Sword_usa/", import.meta.url);
const sys = new URL("../../../../extracted/sys/", import.meta.url);
const present = existsSync(root);
const unwrap = (data: Uint8Array) => (isYaz0(data) ? decompressYaz0(data) : data);

describe.skipIf(!present)("real disc: actor lists", () => {
  const load = (path: string) => parseRarc(decompressYaz0(readFileSync(new URL(path, root))));
  const stages = present
    ? readdirSync(new URL("Boss/", root)).filter((n) => n.endsWith(".arc")).map((n) => load(`Boss/${n}`))
    : [];
  const actorFiles = (a: RarcArchive) => a.files.filter((f) => /d_enemy_map\d+_\d+\.bin$/.test(f.path));

  it("every room list is whole 11-byte records ended by one terminator", () => {
    let files = 0, actors = 0;
    for (const archive of stages) {
      for (const f of actorFiles(archive)) {
        const bytes = unwrap(f.data);
        expect(bytes.length % ACTOR_RECORD_SIZE, f.path).toBe(0);
        const list = parseActors(bytes);
        expect(list.length, f.path).toBe(bytes.length / ACTOR_RECORD_SIZE - 1);
        for (const a of list) {
          expect(a.sublayer).toBeLessThan(8);
          expect(Math.max(a.x, a.y)).toBeLessThan(64);
        }
        files++;
        actors += list.length;
      }
    }
    expect([files, actors]).toEqual([1564, 38330]);
  });

  it("every actor ID but one is in data.arc's enemyparam.csv", () => {
    const types = loadActorTypes(load("data.arc"))!;
    expect(types.size).toBe(352);
    const used = new Set(stages.flatMap((a) => actorFiles(a).flatMap((f) => parseActors(unwrap(f.data)).map((x) => x.id))));
    expect(used.size).toBe(285);
    expect([...used].filter((id) => !types.has(id))).toEqual(["GSCK"]);
  });

  it("positions are half-tiles: signs and graves sit on solid tiles of their own sublayer", () => {
    const types = readTileTypes(new Dol(readFileSync(new URL("main.dol", sys))));
    let checked = 0;
    for (const archive of stages) {
      let stage: Stage;
      try {
        stage = new Stage(archive);
      } catch {
        continue; // archives without a map of their own (boss991, bossN…)
      }
      for (const room of stage.roomNumbers) {
        for (const a of stage.actors(room).filter((x) => x.id === "KNBN" || x.id === "GRVE")) {
          const base = stage.layer(room, 1, a.sublayer)!;
          expect(solidMask(types[base[(a.y >> 1) * 32 + (a.x >> 1)]! & 0x3ff]!), `${archive.rootName} room ${room}`).not.toBe(0);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it("boss500 has 10 battle rooms: 5 arenas, then the same arenas with a lighting controller", () => {
    const stage = new Stage(load("Boss/boss500.arc"));
    expect(stage.battleRooms!.map((r) => r.tilesetIndex)).toEqual([13, 3, 9, 4, 24, 13, 3, 9, 4, 24]);
    expect(stage.layout.rooms.slice(0, 2)).toEqual([[0, 1, 2, 3, 4, null, null, null, null, null], [5, 6, 7, 8, 9, null, null, null, null, null]]);
    expect(stage.roomNumbers.every((r) => stage.layer(r, 1, 0))).toBe(true);
    expect(battleArenaName(4)).toBe("Above the Clouds");
    for (const room of stage.roomNumbers) {
      const actors = stage.actors(room);
      // four player starts, parameter = player index
      expect(actors.filter((a) => a.id === "PLAS").map((a) => a.params).sort()).toEqual([0, 1, 2, 3]);
      expect(actors.some((a) => a.id === "BFIN")).toBe(true);
      if (room >= 5) expect(actors.some((a) => a.id === "LTEV")).toBe(true);
    }
  });
});
