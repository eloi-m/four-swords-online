import { describe, expect, it } from "vitest";
import type { RarcArchive } from "../rarc.ts";
import { actorParamBytes, actorPixel, encodeActors, parseActors, parseActorTypes, type Actor } from "./actors.ts";
import { battleArenaName, parseBattleLayout, Stage } from "./stage.ts";

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

describe("actor lists", () => {
  it("parses 11-byte records up to the terminator", () => {
    const bytes = Uint8Array.from([
      ...ascii("ABCD"), 0, 0x1f, 0x18, 0x12, 0x34, 0x56, 0x78,
      ...ascii("WXYZ"), 3, 0x3f, 0x2f, 0x80, 0, 0, 1,
      ...ascii("    "), 0, 0, 0, 0, 0, 0, 0,
      ...ascii("JUNK"), 0, 0, 0, 0, 0, 0, 0,
    ]);
    expect(parseActors(bytes)).toEqual([
      { id: "ABCD", sublayer: 0, x: 31, y: 24, params: 0x12345678 },
      { id: "WXYZ", sublayer: 3, x: 63, y: 47, params: 0x80000001 },
    ]);
  });

  it("round-trips through encodeActors", () => {
    const actors: Actor[] = [
      { id: "TEST", sublayer: 7, x: 1, y: 2, params: 0xfedcba98 },
      { id: "Abc1", sublayer: 0, x: 40, y: 12, params: 0 },
    ];
    const bytes = encodeActors(actors);
    expect(bytes.length).toBe(33);
    expect(String.fromCharCode(...bytes.subarray(22, 26))).toBe("    ");
    expect(parseActors(bytes)).toEqual(actors);
  });

  it("exposes parameter bytes and pixel positions", () => {
    const actor: Actor = { id: "TEST", sublayer: 0, x: 3, y: 5, params: 0x020f021a };
    expect(actorParamBytes(actor)).toEqual([0x02, 0x0f, 0x02, 0x1a]);
    expect(actorPixel(actor)).toEqual({ x: 24, y: 40 });
  });

  it("parses the actor type table (Shift-JIS)", () => {
    // "テスト" in Shift-JIS
    const name = [0x83, 0x65, 0x83, 0x58, 0x83, 0x67];
    const csv = Uint8Array.from([...ascii("type,name,life,atcp\r\nNULL,x,1,0\r\nABCD,"), ...name, ...ascii(",4,2\r\n")]);
    const types = parseActorTypes(csv);
    expect(types.get("ABCD")).toEqual({ id: "ABCD", name: "テスト", stats: { life: 4, atcp: 2 } });
    expect(types.has("NULL")).toBe(true);
  });
});

describe("Shadow Battle layout", () => {
  const csv = "0,20,1,7,0,3,1,5,0\r\n1,20,1,8,0,4,2,5,1\r\n6,16,1,9,0,6,2,5,0\r\nend,,,,,,,,\r\n";

  it("parses one line of properties per room", () => {
    const rooms = parseBattleLayout(csv);
    expect(rooms.map((r) => [r.room, r.tilesetIndex, r.overlayTextureId])).toEqual([[0, 7, 3], [1, 8, 4], [6, 9, 6]]);
    expect(rooms[1]!.columns).toEqual([20, 1, 8, 0, 4, 2, 5, 1]);
  });

  it("lays rooms out on a 5-wide grid inside a Stage", () => {
    const archive: RarcArchive = {
      rootName: "boss500",
      dirs: ["map", "bin", "bin/b500"],
      files: [
        { path: "map/map500.csv", id: 0, attributes: 0, data: new TextEncoder().encode(csv) },
        { path: "bin/b500/d_enemy_map500_06.bin", id: 1, attributes: 0, data: encodeActors([{ id: "TEST", sublayer: 0, x: 8, y: 9, params: 1 }]) },
      ],
    };
    const stage = new Stage(archive);
    expect(stage.battleRooms).toHaveLength(3);
    expect(stage.layout.rooms[0]!.slice(0, 5)).toEqual([0, 1, null, null, null]);
    expect(stage.layout.rooms[1]!.slice(0, 5)).toEqual([null, 6, null, null, null]);
    expect(stage.roomNumbers).toEqual([0, 1, 6]);
    expect([stage.tilesetIndexOf(6), stage.overlayTextureIdOf(1)]).toEqual([9, 4]);
    expect(stage.actors(6)).toEqual([{ id: "TEST", sublayer: 0, x: 8, y: 9, params: 1 }]);
    expect(stage.actors(0)).toEqual([]);
  });

  it("names the arenas", () => {
    expect(battleArenaName(0)).toBe("The Field");
    expect(battleArenaName(9)).toBe("Above the Clouds (Dark World)");
    expect(battleArenaName(10)).toBeNull();
  });
});
