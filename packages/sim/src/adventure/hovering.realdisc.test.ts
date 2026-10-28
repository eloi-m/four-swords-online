// Hovering Force Gems (HNRY, pickups.ts HOVER_SHUTTLE) against Dolphin: Lake Hylia's room 7, its 0x71000 (kind 7, across)
// read live from ref/places/lake-room7.sav (34 frames after the room came in: at 336.53, timer 166, going right at
// 0.8) and 2 and 5 s on (tools/dolphin compare.ts), with areas 5 and 6's 0x21000 (kind 2) at the same moment. The shuttle rule runs without the game files; the stage's gems
// skip without extracted/.
import { existsSync, readFileSync } from "node:fs";
import { decompressYaz0, Dol, loadActorTypes, parseRarc, readTileTypes, Stage } from "@fso/formats";
import { describe, expect, it } from "vitest";
import { SUBPX } from "../player.ts";
import { createAdventure } from "./adventure.ts";
import { HOVER_HEIGHT, HOVER_HIGH, spawnPickups, stepShuttle, type Pickup, type Shuttle } from "./pickups.ts";
import { actorStats, AdventureStage } from "./stage.ts";

/** A gem at (x, y) px shuttling from its first frame, going `dir` first. */
function gem(x: number, y: number, mid: boolean, dir: number): Pickup & { shuttle: Shuttle } {
  return { id: 1, type: "gem", from: "HNRY", actor: 0, x: x * SUBPX, y: y * SUBPX, z: HOVER_HEIGHT, kind: 4, gate: 0, tick: 0, vz: 0, shuttle: { dir, timer: 0, mid, vx: 0, vy: 0, tvx: 0, tvy: 0 } };
}
const run = (g: ReturnType<typeof gem>, ticks: number) => {
  for (let t = 0; t < ticks; t++) stepShuttle(g, g.shuttle);
};

describe("a shuttling hovering gem", () => {
  it("moves as room 7's did in Dolphin: 336.5 after 34 frames, timer 166, then 337.3, 352.3, 257.3", () => {
    const g = gem(312, 176, true, 0);
    run(g, 34);
    expect(g.x / SUBPX).toBeCloseTo(336.53, 0);
    expect(g.shuttle.timer).toBe(166);
    expect(g.shuttle.vx / SUBPX).toBeCloseTo(0.8, 1);
    for (const [ticks, x] of [[1, 337.3], [120, 352.3], [180, 257.3]] as const) {
      run(g, ticks);
      expect(Math.abs(g.x / SUBPX - x)).toBeLessThan(0.3);
    }
    expect(g.y).toBe(176 * SUBPX);
  });

  it("swings ±80 px about its place every 400 frames (kinds 6, 7): Dolphin's 232.7 to 389.4 going left first", () => {
    const g = gem(312, 176, true, 1);
    let lo = Infinity, hi = -Infinity;
    for (let t = 0; t < 800; t++) {
      stepShuttle(g, g.shuttle);
      lo = Math.min(lo, g.x / SUBPX);
      hi = Math.max(hi, g.x / SUBPX);
    }
    expect(Math.abs(lo - 232.7)).toBeLessThan(0.5);
    expect(Math.abs(hi - 389.4)).toBeLessThan(0.5);
  });

  it("goes ~158 px the other way and back (kinds 1, 2: it turns on its first frame); 1 and 6 up and down", () => {
    // Room 7 areas 5 and 6's 0x21000 at the same place: 97.07 going left, 142.93 going right (from 120).
    for (const [dir, x] of [[0, 97.07], [1, 142.93]] as const) {
      const g = gem(120, 296, false, dir);
      run(g, 34);
      expect(g.x / SUBPX).toBeCloseTo(x, 0);
      expect(g.shuttle.timer).toBe(166);
    }
    const g = gem(120, 304, false, 0);
    let lo = Infinity;
    for (let t = 0; t < 400; t++) stepShuttle(g, g.shuttle), (lo = Math.min(lo, g.x / SUBPX));
    expect(lo).toBeGreaterThan(-40);
    expect(lo).toBeLessThan(-36);
    expect(Math.abs(g.x / SUBPX - 120)).toBeLessThan(4);
    const v = gem(200, 80, true, 2);
    run(v, 50);
    expect(v.x).toBe(200 * SUBPX);
    expect(v.y).toBeGreaterThan(80 * SUBPX);
  });
});

const root = new URL("../../../../extracted/", import.meta.url);
const load = (path: string) => parseRarc(decompressYaz0(readFileSync(new URL(`files/GC4Sword_usa/${path}`, root))));

describe.skipIf(!existsSync(root))("Lake Hylia's hovering gems", () => {
  if (!existsSync(root)) return void it.skip("needs extracted/", () => {});
  const tileTypes = readTileTypes(new Dol(readFileSync(new URL("sys/main.dol", root))));
  const stage = new AdventureStage(new Stage(load("Boss/boss010.arc")), tileTypes, actorStats(loadActorTypes(load("data.arc"))!));

  it("room 7's shuttles across, rooms 2 and 3's stay; all 8 px up (params bit 12)", () => {
    const g = createAdventure(stage, { room: 7, x: 48, y: 344, players: 1 });
    const [it7] = g.adventure.pickups.filter((p) => p.from === "HNRY");
    expect(it7?.shuttle?.mid).toBe(true);
    expect(it7!.shuttle!.dir).toBeLessThan(2);
    expect(it7!.z).toBe(HOVER_HEIGHT);
    const g3 = createAdventure(stage, { room: 3, x: 280, y: 341, players: 1 });
    expect(g3.adventure.pickups.filter((p) => p.from === "HNRY" && (p.shuttle || p.z !== HOVER_HEIGHT))).toEqual([]);
    expect(HOVER_HIGH).toBe(24 * SUBPX);
  });

  it("on a side view stands 8 px higher on the ground (room 7 area 5's at y 296, Dolphin's)", () => {
    const area = stage.area(7, 5);
    expect(area.sideView).toBe(true);
    const g = createAdventure(stage, { room: 7, x: 48, y: 344, players: 1 });
    g.adventure.area = 5;
    spawnPickups(g, stage);
    const [p] = g.adventure.pickups.filter((x) => x.from === "HNRY");
    expect(p).toMatchObject({ x: 120 * SUBPX, y: 296 * SUBPX, z: 0 });
    expect(p!.shuttle?.mid).toBe(false);
  });
});
