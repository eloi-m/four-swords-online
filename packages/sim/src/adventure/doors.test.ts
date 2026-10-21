// The doorway figure (doors.ts goneDoorwayFigures): Lake Hylia room 3's ZSLJ in the house's locked door, gone once the
// key opens it.
import "../index.ts"; // (before ./adventure.ts: its modules import the battle's in an order that needs this one first)
import { describe, expect, it } from "vitest";
import { actorKey } from "./adventure.ts";
import { goneDoorwayFigures } from "./doors.ts";
import type { AreaActor } from "./stage.ts";

// Room 3's list as placed: DOOR 0x83 at (384, 96) (its box's middle (396, 108)), ZSLJ at (400, 112), another one away.
const actors: AreaActor[] = [
  { id: "DOOR", x: 384, y: 96, params: 0x83, index: 5 },
  { id: "ZSLJ", x: 400, y: 112, params: 0x11, index: 7 },
  { id: "ZSLJ", x: 200, y: 200, params: 0x11, index: 9 },
];

describe("goneDoorwayFigures", () => {
  it("keeps the figure while its door is shut", () => {
    expect([...goneDoorwayFigures([], 3, actors)]).toEqual([]);
  });

  it("takes the figure standing in an opened door's box, not one elsewhere", () => {
    expect([...goneDoorwayFigures([actorKey(3, 5)], 3, actors)]).toEqual([7]);
  });

  it("reads the opened doors of its own room only", () => {
    expect([...goneDoorwayFigures([actorKey(4, 5)], 3, actors)]).toEqual([]);
  });
});
