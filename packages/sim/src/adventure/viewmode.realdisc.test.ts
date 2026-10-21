// The GBA-screen areas' top-layer modes (VWMD params bits 12-13, logic.ts) on the real stages (skips without
// extracted/): Lake Hylia room 5's area 2 under the bridge, whose top layer is the filler over its right half, only
// shades what is under it, and the underwater passages' water is seen through.
import { existsSync, readFileSync } from "node:fs";
import { decompressYaz0, Dol, loadActorTypes, parseRarc, readTileTypes, Stage } from "@fso/formats";
import { describe, expect, it } from "vitest";
import { setSwitch } from "../switches.ts";
import { createAdventure } from "./adventure.ts";
import { TOP_MODE_BLEND, topModeOf } from "./logic.ts";
import { actorStats, AdventureStage } from "./stage.ts";

const root = new URL("../../../../extracted/", import.meta.url);
const load = (path: string) => parseRarc(decompressYaz0(readFileSync(new URL(`files/GC4Sword_usa/${path}`, root))));

describe.skipIf(!existsSync(root))("the GBA areas' top-layer modes", () => {
  const tileTypes = readTileTypes(new Dol(readFileSync(new URL("sys/main.dol", root))));
  const stats = actorStats(loadActorTypes(load("data.arc"))!);
  const stageOf = (id: string) => new AdventureStage(new Stage(load(`Boss/${id}.arc`)), tileTypes, stats);

  it("shades Lake Hylia room 5's area 2 under its cover, the filler over the Links' way in from the right", () => {
    const stage = stageOf("boss010");
    const area = stage.area(5, 2);
    expect([area.topMode, area.topModeGate]).toEqual([2, 0]);
    // The right-hand warps (TV x 336, style 0x1C) arrive at area x 336, under the cover: its tile is the filler.
    const arrivals = stage.area(5, 0).doors.filter((d) => d.to.area === 2 && d.to.x === 336);
    expect(arrivals.length).toBeGreaterThan(0);
    for (const d of arrivals) expect(area.top![(d.to.y >> 4) * 32 + (d.to.x >> 4)]! & 0x3ff).toBe(0x00a);
    const game = createAdventure(stage, { players: 1 });
    expect(topModeOf(game, area)).toBe(2);
    // The filler's color counts for nothing: what is under it is drawn at 14/16.
    expect(TOP_MODE_BLEND[2]).toEqual({ eva: 0, evb: 14 });
    // The areas without a VWMD draw theirs as it is.
    expect(stage.area(3, 3).topMode).toBe(0);
    expect(TOP_MODE_BLEND[topModeOf(game, stage.area(3, 3))]).toBeNull();
  });

  it("sees through the underwater passages' water (mode 1), and a gated mode only while its switch is on", () => {
    const lake = stageOf("boss010");
    for (const [room, sub] of [[3, 5], [6, 5], [6, 7]] as const) {
      const area = lake.area(room, sub);
      expect(area.topMode, `room ${room} area ${sub}`).toBe(1);
      expect(area.sideView).toBe(true);
      expect(TOP_MODE_BLEND[topModeOf(createAdventure(lake, { players: 1 }), area)]).toEqual({ eva: 8, evb: 15 });
    }
    // Tingle's Tower room 7's area 5: VWMD 0x08001000, mode 1 while switch 1 is on.
    const tower = stageOf("boss012"), area = tower.area(7, 5);
    expect([area.topMode, area.topModeGate]).toEqual([1, 1]);
    const game = createAdventure(tower, { players: 1 });
    setSwitch(game.battle, 1, false);
    expect(topModeOf(game, area)).toBe(0);
    setSwitch(game.battle, 1, true);
    expect(topModeOf(game, area)).toBe(1);
  });

  it("finds mode 2 in Lake Hylia room 5's area 2 alone, mode 1 in the others", () => {
    const modes: string[] = [];
    for (let w = 1; w <= 8; w++) {
      for (let s = 0; s <= 3; s++) {
        const id = `boss0${w}${s}`, stage = stageOf(id);
        for (const room of stage.rooms) {
          for (let sub = 1; sub <= 7; sub++) {
            if (!stage.hasArea(room, sub)) continue;
            const mode = stage.area(room, sub).topMode;
            if (mode) modes.push(`${id} ${room}/${sub} ${mode}`);
          }
        }
      }
    }
    expect(modes.filter((m) => !m.endsWith(" 1"))).toEqual(["boss010 5/2 2"]);
    expect(modes.length).toBeGreaterThan(20);
  });
});
