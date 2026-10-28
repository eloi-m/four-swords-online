// The adventure's stage machinery on the real stages (skips without extracted/): Lake Hylia's soldier ambush (room 9).
// The floor switch at the entrance (SWTH kind 7, switch 18) stakes the way out (PNPCs, tile 0x1A5); beating the
// soldiers turns the ZNSW's switch 16 on, the FOCS then 17, and grass (0x1B0) replaces the stakes and opens a way west.
import { existsSync, readFileSync } from "node:fs";
import { decompressYaz0, Dol, loadActorTypes, parseRarc, readTileTypes, Stage } from "@fso/formats";
import { describe, expect, it } from "vitest";
import { SUBPX } from "../player.ts";
import { switchOn } from "../switches.ts";
import { isSolidAt } from "../world.ts";
import { areaWorld, createAdventure, stepAdventure, type AdventureGame } from "./adventure.ts";
import { KEY_LIFT_TICKS } from "./doors.ts";
import { FOCUS_ARRIVE_TICKS, rewrittenTiles } from "./logic.ts";
import { actorStats, AdventureStage } from "./stage.ts";

const root = new URL("../../../../extracted/", import.meta.url);
const load = (path: string) => parseRarc(decompressYaz0(readFileSync(new URL(`files/GC4Sword_usa/${path}`, root))));

describe.skipIf(!existsSync(root))("the adventure's stage machinery", () => {
  if (!existsSync(root)) return void it.skip("needs extracted/", () => {});
  const tileTypes = readTileTypes(new Dol(readFileSync(new URL("sys/main.dol", root))));
  const stats = actorStats(loadActorTypes(load("data.arc"))!);
  const stage = new AdventureStage(new Stage(load("Boss/boss010.arc")), tileTypes, stats);
  const step = (game: AdventureGame, n = 1) => {
    for (let i = 0; i < n; i++) stepAdventure(game, [0], stage);
  };
  const tileAt = (game: AdventureGame, x: number, y: number) => rewrittenTiles(game, stage).get((y >> 4) * 32 + (x >> 4));

  it("Lake Hylia's ambush: stakes on the entrance switch, grass once the soldiers are beaten", () => {
    const game = createAdventure(stage, { room: 9, x: 472, y: 88, facing: "left" });
    step(game, 2);
    expect(switchOn(game.battle, 18)).toBe(true);
    expect(tileAt(game, 496, 64)).toBe(0x1a5);
    expect(isSolidAt(areaWorld(game, stage), 500, 68)).toBe(true);
    expect(tileAt(game, 48, 160)).toBeUndefined();
    // The soldiers beaten (the captain, SLR4, isn't animated: it doesn't count).
    game.players[0]!.y = 340 * SUBPX;
    for (const e of game.adventure.enemies) e.life = -1;
    step(game);
    expect(switchOn(game.battle, 16)).toBe(true);
    expect(switchOn(game.battle, 17)).toBe(false);
    expect(game.adventure.focus?.x).toBe(48);
    step(game, FOCUS_ARRIVE_TICKS);
    expect(switchOn(game.battle, 17)).toBe(true);
    expect(tileAt(game, 496, 64)).toBe(0x1b0);
    expect(tileAt(game, 48, 160)).toBe(0x1b0);
    expect(isSolidAt(areaWorld(game, stage), 500, 68)).toBe(false);
  });

  it("rains Force Gems once the ambush is over, two a tick, and they can be taken once down", () => {
    const game = createAdventure(stage, { room: 9, x: 472, y: 88, facing: "left" });
    step(game, 2);
    for (const e of game.adventure.enemies) e.life = -1;
    game.players[0]!.y = 340 * SUBPX;
    // The ZNSW's switch and the rain's first two gems on the same tick.
    step(game);
    expect(game.adventure.rains[0]).toMatchObject({ state: "rain", total: 256 });
    expect(game.adventure.pickups.filter((p) => p.actor < 0).length).toBe(2);
    step(game, 220);
    expect(game.adventure.rains[0]!.state).toBe("done");
    const rained = game.adventure.pickups.filter((p) => p.actor < 0);
    expect(rained.length).toBeGreaterThan(200);
    expect(rained.every((p) => p.z === 0 && p.kind <= 2)).toBe(true);
    // Around the RYRN (144, 208) ± 96 px.
    expect(rained.every((p) => Math.abs(p.x / SUBPX - 144) <= 96 && Math.abs(p.y / SUBPX - 208) <= 96)).toBe(true);
    const gems = game.adventure.gems, g = rained[0]!;
    Object.assign(game.players[0]!, { x: g.x, y: g.y });
    step(game);
    expect(game.adventure.gems).toBeGreaterThan(gems);
  });

  it("a Link lifts the key and carries it; a locked door takes it and opens; a chest gives its content", () => {
    // Room 3's key (456, 200): touching it takes nothing; the Action button facing it from 18 px below lifts it (16
    // ticks standing), then he carries it (walking only: his sword does nothing).
    const game = createAdventure(stage, { room: 3, x: 456, y: 218, facing: "up" });
    step(game, 2);
    expect(game.adventure.keys).toBe(0);
    stepAdventure(game, [0x40], stage);
    expect([game.adventure.keys, game.adventure.keyLift]).toEqual([1, KEY_LIFT_TICKS]);
    step(game, KEY_LIFT_TICKS);
    expect(game.adventure.keyLift).toBe(0);
    stepAdventure(game, [0x10], stage);
    expect(game.players[0]!.action).toBe("none");
    // The house's door (DOOR 0x83 at 384,96): shut, then the Link walks up into it.
    expect(isSolidAt(areaWorld(game, stage), 396, 108)).toBe(true);
    Object.assign(game.players[0]!, { x: 400 * SUBPX, y: 140 * SUBPX, facing: "up" });
    for (let i = 0; i < 40 && game.adventure.keys; i++) stepAdventure(game, [1], stage);
    expect(game.adventure.keys).toBe(0);
    expect(game.adventure.opening).not.toBeNull();
    step(game, 20);
    expect(isSolidAt(areaWorld(game, stage), 396, 108)).toBe(false);
    // Room 5's chests appear on switch 17 (PNPC tile 0x30); the one at (320, 48) holds a red Force Gem (content 2).
    const room5 = createAdventure(stage, { room: 5, x: 328, y: 71, facing: "up" });
    room5.battle.switches |= 1 << 17;
    step(room5);
    expect(tileAt(room5, 320, 48)).toBe(0x30);
    // Opened with the Item button (the GC's A) touching it (measured in the Cave of No Return).
    stepAdventure(room5, [0x20], stage);
    expect(room5.adventure.gems).toBe(20);
    expect(room5.adventure.reveal?.content).toBe(2);
    expect(tileAt(room5, 320, 48)).toBe(0x10);
    expect(room5.players[0]!.action).toBe("none");
  });

  it("clears the stage on the goal with the quota", () => {
    const game = createAdventure(stage, { room: 10, x: 212, y: 160, facing: "up" });
    Object.assign(game.players[0]!, { y: 130 * SUBPX });
    step(game, 2);
    expect(game.adventure.cleared).toBe(0);
    game.adventure.gems = 2000;
    step(game);
    expect(game.adventure.cleared).toBeGreaterThan(0);
  });

  it("keeps a room's switches when the Links come back", () => {
    const game = createAdventure(stage, { room: 9, x: 472, y: 88, facing: "left" });
    step(game, 2);
    expect(switchOn(game.battle, 18)).toBe(true);
    // Out through the east edge (room 5) and back.
    game.players[0]!.y = 200 * SUBPX;
    game.players[0]!.x = 510 * SUBPX;
    step(game, 3);
    expect(game.adventure.room).toBe(5);
    while (game.adventure.edge) step(game);
    game.players[0]!.x = 2 * SUBPX;
    step(game, 3);
    expect(game.adventure.room).toBe(9);
    expect(switchOn(game.battle, 18)).toBe(true);
  });
});
