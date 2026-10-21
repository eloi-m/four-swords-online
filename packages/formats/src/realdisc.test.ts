// Checks against the real extracted disc; skipped when extracted/ is absent (e.g. in CI).
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createImage, drawLayer, LAYER_PIXELS } from "./fsa/bg.ts";
import { Dol } from "./dol.ts";
import { loadOverlay } from "./fsa/overlay.ts";
import { loadSob } from "./fsa/sprites.ts";
import { readTileTypes, solidMask, TileType } from "./fsa/tiletypes.ts";
import { loadTileset, Stage } from "./fsa/stage.ts";
import { parseRarc } from "./rarc.ts";
import { decompressYaz0 } from "./yaz0.ts";

const root = new URL("../../../extracted/files/GC4Sword_usa/", import.meta.url);
const sys = new URL("../../../extracted/sys/", import.meta.url);
const present = existsSync(root);

describe.skipIf(!present)("real disc: stage archives", () => {
  const load = (path: string) => parseRarc(decompressYaz0(readFileSync(new URL(path, root))));

  it("boss010 (Lake Hylia) has a 10x10 room grid and 16 tile layers per room", () => {
    const stage = load("Boss/boss010.arc");
    expect(stage.rootName).toBe("boss010");
    const csv = new TextDecoder().decode(stage.files.find((f) => f.path === "map/map010.csv")!.data);
    const lines = csv.trim().split(/\r?\n/);
    expect(lines[0]!.startsWith("map010,")).toBe(true);
    expect(lines.slice(1, 11).every((l) => l.split(",").length === 10)).toBe(true);

    const layers = stage.files.filter((f) => f.path.startsWith("szs/"));
    const rooms = new Set(layers.map((f) => f.path.match(/d_map010_(\d+)_/)![1]));
    expect(layers.length).toBe(rooms.size * 16);
    for (const layer of layers) expect(decompressYaz0(layer.data).length).toBe(2048);
  });

  it("data.arc holds the shared tile, palette and sprite folders", () => {
    const data = load("data.arc");
    for (const dir of ["sch", "scl", "sob", "spl", "smp", "timg", "j3d"]) expect(data.dirs).toContain(dir);
  });

  it("renders Lake Hylia room 1 identically (regression hash; visually checked against Dolphin)", () => {
    const stage = new Stage(load("Boss/boss010.arc"));
    expect(stage.layout.tilesetIndex).toBe(12);
    expect(stage.layout.rooms[stage.layout.startY]![stage.layout.startX]).toBe(0);
    const tileset = loadTileset(load("data.arc"), stage.layout.tilesetIndex);
    const image = createImage(LAYER_PIXELS, LAYER_PIXELS);
    for (const group of [1, 2] as const) drawLayer(image, tileset, stage.layer(1, group)!);
    expect(createHash("sha1").update(image.data).digest("hex")).toMatchInlineSnapshot(`"b27de72c9c3a6e2e7714db9fa08aface94876bdf"`);
  });

  it("every overlay ID used by a stage (1-9) resolves to a 128x128 filter texture", () => {
    const data = load("data.arc");
    for (let id = 1; id <= 9; id++) {
      const overlay = loadOverlay(data, id);
      expect(overlay && [overlay.width, overlay.height]).toEqual([128, 128]);
    }
    expect(loadOverlay(data, 0)).toBeNull();
  });

  it("player_sob has 981 frames; walk cycles are 8 frames per direction", () => {
    const frames = loadSob(load("data.arc"), "player_sob.bin");
    expect(frames.length).toBe(981);
    expect(frames.slice(0, 32).every((f) => f.length > 0)).toBe(true);
  });

  it("reads the tile type table from main.dol", () => {
    const types = readTileTypes(new Dol(readFileSync(new URL("main.dol", sys))));
    const count = (t: number) => types.filter((x) => x === t).length;
    expect([count(TileType.Floor), count(TileType.Solid), count(TileType.DeepWater), count(TileType.ShallowWater)]).toEqual([153, 584, 18, 27]);
    // Lake Hylia room 1: fence posts and the river are where the map shows them.
    const stage = new Stage(load("Boss/boss010.arc"));
    const base = stage.layer(1, 1)!;
    const at = (x: number, y: number) => types[base[y * 32 + x]! & 0x3ff]!;
    expect(at(3, 0)).toBe(TileType.DeepWater);
    expect(solidMask(at(0, 0))).not.toBe(0);
  });
});
