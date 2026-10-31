// Hyrule Castle by its route as far as it goes (hyrulecastle.ts), its machinery on the way (a Link thrown on a side
// view: sidecarry.ts; the drawbridge and the spikes: logic.ts; room 5's pedestals, arrow through a door and cracked
// wall: gear.ts, bow.ts, doors.ts; room 9's big handle: pullswitch.ts; room 10's throne and curtain: rocks.ts,
// doors.ts; a shot from one side view into another: adventure.ts), and room 11's Phantom Ganon fought from its way in
// (phantomganon.ts) (skips without extracted/).
import { existsSync, readFileSync } from "node:fs";
import { decompressYaz0, Dol, isYaz0, loadActorTypes, parseBmg, parseRarc, readTileTypes, Stage } from "@fso/formats";
import { describe, expect, it } from "vitest";
import { hashGame } from "../hash.ts";
import { isSolidAt } from "../world.ts";
import { actorKey, areaWorld, cloneAdventure, createAdventure, enterArea, SHOT_INTO_HOLD_TICKS, stepAdventure, type AdventureGame } from "./adventure.ts";
import { messageBook, pageTyped } from "./dialogue.ts";
import { BALL_SOLDIER, BALL_SOLDIER_CASTLE, ironBallHand, ironBallOf } from "./soldiers.ts";
import { hurtEnemy } from "./enemies.ts";
import { drawnPedestalItem, giveGear } from "./gear.ts";
import { spawnEntity } from "../entities.ts";
import { holdUntil, readOn, RoutePlayer, type Goal } from "./drive.ts";
import { HYRULE_CASTLE_MILESTONES, PHANTOM_GANON_MILESTONES } from "./hyrulecastle.ts";
import { BRIDGE_TICKS, GATE_TICKS } from "./logic.ts";
import { BIG_PULL_FULL, PULL_FULL, PULL_UNIT, pullOut, spawnPulls } from "./pullswitch.ts";
import { Button } from "../player.ts";
import { actorStats, AdventureStage } from "./stage.ts";
import { FAIRY_TICKS } from "./zoras.ts";
import { EXPLOSION_TICKS } from "../bombs.ts";
import { GEM_QUOTA } from "./pickups.ts";
import { STAIRS_TICKS, stairsLeadTo } from "./stairs.ts";
import { CROSS_SPIN_TICKS, linkAttack } from "./whirl.ts";
import { ATTACK_BOXES, type Dir8 } from "../attacks.ts";

const root = new URL("../../../../extracted/", import.meta.url);
const load = (path: string) => parseRarc(decompressYaz0(readFileSync(new URL(`files/GC4Sword_usa/${path}`, root))));

describe.skipIf(!existsSync(root))("Hyrule Castle", () => {
  if (!existsSync(root)) return void it.skip("needs extracted/", () => {});
  const tileTypes = readTileTypes(new Dol(readFileSync(new URL("sys/main.dol", root))));
  const stats = actorStats(loadActorTypes(load("data.arc"))!);
  const stage = new AdventureStage(new Stage(load("Boss/boss013.arc")), tileTypes, stats);
  const bmg = load("msgus.arc").files.find((f) => f.path.endsWith("_e.bmg"))!.data;
  stage.messages = messageBook(parseBmg(isYaz0(bmg) ? decompressYaz0(bmg) : bmg));
  // Ticks a Link was out of hearts (dying, or dead: the sim gets them up again where they came in, adventure.ts revive).
  let downed = 0;
  const step = (g: AdventureGame, buttons = 0, n = 1) => {
    for (let i = 0; i < n; i++) stepAdventure(g, [buttons], stage);
  };
  const run = (g: AdventureGame, goals: readonly Goal[]) => {
    const player = new RoutePlayer(goals);
    while (!player.done) {
      const buttons = player.next(g, stage);
      if (player.done) break;
      stepAdventure(g, [buttons], stage);
      if (g.battle.fighters.some((f) => f.hearts <= 0 || f.mode === "dying" || f.mode === "dead")) downed++;
    }
  };

  it("by its route: room 1's garden and side views, a Link thrown over area 6's gap, the bridge, the crystal on the walls, the drawbridge, room 2's soldiers, into room 3; nobody dies on the way", () => {
    const game = createAdventure(stage, { players: 4 });
    downed = 0;
    const on = (n: number) => ((game.battle.switches >>> n) & 1) === 1;
    run(game, HYRULE_CASTLE_MILESTONES[0]!.goals);
    expect(game.adventure.room).toBe(1);
    run(game, HYRULE_CASTLE_MILESTONES[1]!.goals);
    expect([game.adventure.room, game.adventure.area]).toEqual([1, 5]);
    run(game, HYRULE_CASTLE_MILESTONES[2]!.goals);
    expect([game.adventure.room, game.adventure.area]).toEqual([1, 6]);
    run(game, HYRULE_CASTLE_MILESTONES[3]!.goals);
    // Out on the walls alone, the bridge's switch held for good; the other three left in area 6.
    expect([game.adventure.room, game.adventure.area, on(19)]).toEqual([1, 0, true]);
    expect(game.adventure.away?.area).toBe(6);
    run(game, HYRULE_CASTLE_MILESTONES[4]!.goals);
    expect([1, 2, 3, 16, 17].map(on)).toEqual([true, true, true, true, true]);
    run(game, HYRULE_CASTLE_MILESTONES[5]!.goals);
    expect(game.adventure.room).toBe(2);
    const gems = game.adventure.gems;
    run(game, HYRULE_CASTLE_MILESTONES[6]!.goals);
    expect(game.adventure.room).toBe(3);
    expect(game.adventure.gems).toBeGreaterThan(gems);
    expect(game.battle.fighters[0]!.hearts).toBeGreaterThan(0);
    // Room 3: the right-hand handle pulled out (5), the camera (7) and 128 ticks on (6) make 24, the gate 25.
    run(game, HYRULE_CASTLE_MILESTONES[7]!.goals);
    expect([game.adventure.room, game.adventure.area]).toEqual([3, 2]);
    expect([5, 6, 7, 24, 25].map(on)).toEqual([true, true, true, true, true]);
    run(game, HYRULE_CASTLE_MILESTONES[8]!.goals);
    expect(game.adventure.room).toBe(5);
    const gems5 = game.adventure.gems;
    run(game, HYRULE_CASTLE_MILESTONES[9]!.goals);
    expect([game.adventure.room, game.adventure.area]).toEqual([5, 2]);
    expect(game.adventure.gems).toBeGreaterThan(gems5);
    // Room 5: the bow from the gatehouse's pedestal, the crystal lit through the door (17), out into the garden.
    run(game, HYRULE_CASTLE_MILESTONES[10]!.goals);
    expect([game.adventure.room, game.adventure.area, game.adventure.gear, on(17)]).toEqual([5, 0, "bow", true]);
    expect(game.players[0]!.y / 256).toBeGreaterThan(240);
    // The cracked wall bombed open, into the tower.
    run(game, HYRULE_CASTLE_MILESTONES[11]!.goals);
    expect([game.adventure.room, game.adventure.area]).toEqual([5, 5]);
    // The tower's cannons: the key from the niche's chest, out at the top onto the yard beside its hole.
    run(game, HYRULE_CASTLE_MILESTONES[12]!.goals);
    expect([game.adventure.room, game.adventure.area, game.adventure.keys]).toEqual([5, 0, 1]);
    expect([Math.round(game.players[0]!.x / 256), Math.round(game.players[0]!.y / 256)]).toEqual([39, 100]);
    // Back into room 3, the key spent on area 2's top door, up through area 6 onto the TV's north corridor.
    run(game, HYRULE_CASTLE_MILESTONES[13]!.goals);
    expect([game.adventure.room, game.adventure.area, game.adventure.keys]).toEqual([3, 0, 0]);
    expect(game.adventure.opened).toContain(actorKey(3, stage.area(3, 2).actors.find((a) => a.id === "DOOR")!.index));
    expect(game.battle.fighters[0]!.hearts).toBeGreaterThan(0);
    // Room 6: its kill counters (3: the gate; 4: the gates' timers; 52: the way north), into room 57.
    run(game, HYRULE_CASTLE_MILESTONES[14]!.goals);
    expect(game.adventure.room).toBe(57);
    expect(game.adventure.roomSwitches).toBeDefined();
    // Room 57's lower band east into room 9.
    run(game, HYRULE_CASTLE_MILESTONES[15]!.goals);
    expect([game.adventure.room, game.adventure.area]).toEqual([9, 0]);
    expect(game.battle.fighters[0]!.hearts).toBeGreaterThan(0);
    // Room 9: the big handle pulled by the four in a row (17), the camera (16) lowers the tower.
    run(game, HYRULE_CASTLE_MILESTONES[16]!.goals);
    expect([16, 17].map(on)).toEqual([true, true]);
    expect(isSolidAt(areaWorld(game, stage), 128, 232)).toBe(false);
    // Through it into area 2, the bombs from its pedestal, area 3's cracked wall bombed open, into area 5.
    run(game, HYRULE_CASTLE_MILESTONES[17]!.goals);
    expect([game.adventure.room, game.adventure.area]).toEqual([9, 2]);
    run(game, HYRULE_CASTLE_MILESTONES[18]!.goals);
    expect([game.adventure.room, game.adventure.area, game.adventure.gear]).toEqual([9, 3, "bombs"]);
    run(game, HYRULE_CASTLE_MILESTONES[19]!.goals);
    expect([game.adventure.room, game.adventure.area]).toEqual([9, 5]);
    // Area 5's fragile blocks bombed, the escort Zora met; with it back into room 57, where it sets 18.
    run(game, HYRULE_CASTLE_MILESTONES[20]!.goals);
    expect(game.adventure.escort?.sw).toBe(18);
    run(game, HYRULE_CASTLE_MILESTONES[21]!.goals);
    expect([game.adventure.room, game.adventure.escort, on(18), on(16)]).toEqual([57, null, true, false]);
    // Room 58: the spin in the cross formation lights its four crystals together (9), the tower lowered (16), area 2.
    run(game, HYRULE_CASTLE_MILESTONES[22]!.goals);
    expect(game.adventure.room).toBe(58);
    run(game, HYRULE_CASTLE_MILESTONES[23]!.goals);
    expect([9, 16].map(on)).toEqual([true, true]);
    run(game, HYRULE_CASTLE_MILESTONES[24]!.goals);
    expect([game.adventure.room, game.adventure.area]).toEqual([58, 2]);
    expect(game.battle.fighters[0]!.hearts).toBeGreaterThan(0);
    // Area 2: a Link thrown up the lane lands past its pits where Dolphin's did (160, 129.6), nobody hurt.
    const hearts58 = game.battle.fighters[0]!.hearts;
    run(game, HYRULE_CASTLE_MILESTONES[25]!.goals);
    expect([game.players[0]!.x / 256, Math.round(game.players[0]!.y / 25.6) / 10]).toEqual([160, 129.6]);
    expect(game.battle.fighters[0]!.hearts).toBe(hearts58);
    // The pot lifted off the floor switch (17), the top door, area 3's Zora met at 46.7 px (traced: (128, 86)).
    run(game, HYRULE_CASTLE_MILESTONES[26]!.goals);
    expect([game.adventure.room, game.adventure.area, on(17)]).toEqual([58, 3, true]);
    run(game, HYRULE_CASTLE_MILESTONES[27]!.goals);
    expect(game.adventure.escort).toMatchObject({ sw: 19, area: 2 });
    // Y over the pits, the Zora dashing after them, out onto the TV; back in room 57 it sets 19, the fairy 16.
    run(game, HYRULE_CASTLE_MILESTONES[28]!.goals);
    expect([game.adventure.area, game.adventure.formation, game.adventure.escort?.area]).toEqual([0, "trail", 0]);
    run(game, HYRULE_CASTLE_MILESTONES[29]!.goals);
    expect([game.adventure.room, game.adventure.escort, on(16), on(18), on(19)]).toEqual([57, null, true, true, true]);
    // Past the barrier, round areas 2 and 3 to the two platforms' switch pairs (24, 25: the checkerboard), north into 10.
    run(game, HYRULE_CASTLE_MILESTONES[30]!.goals);
    run(game, HYRULE_CASTLE_MILESTONES[31]!.goals);
    expect(on(24)).toBe(true);
    run(game, HYRULE_CASTLE_MILESTONES[32]!.goals);
    expect([24, 25].map(on)).toEqual([true, true]);
    run(game, HYRULE_CASTLE_MILESTONES[33]!.goals);
    expect(game.adventure.room).toBe(10);
    expect(game.battle.fighters[0]!.hearts).toBeGreaterThan(0);
    // Room 10: a pot off its floor point (17: the generator), 32 kills (16: the door), into area 2.
    run(game, HYRULE_CASTLE_MILESTONES[34]!.goals);
    expect([game.adventure.room, game.adventure.area, on(16), on(17)]).toEqual([10, 2, true, true]);
    expect(game.battle.fighters[0]!.hearts).toBeGreaterThan(0);
    // Area 2: the throne pushed 64 px right, the curtain behind it cut, into area 7; its cannons and area 6's up onto
    // the TV, north into room 11.
    run(game, HYRULE_CASTLE_MILESTONES[35]!.goals);
    expect([game.adventure.room, game.adventure.area]).toEqual([10, 7]);
    expect(game.adventure.sunk).toContain(actorKey(10, stage.area(10, 2).actors.find((a) => a.id === "STBL")!.index));
    run(game, HYRULE_CASTLE_MILESTONES[36]!.goals);
    expect([game.adventure.room, game.adventure.area]).toEqual([11, 0]);
    // Phantom Ganon beaten, the staircase's switch; the Force Gems his end flung out (a GOLD worth 80) gathered, and
    // what's left of his two falls' (99 each): flung gems go 830 ticks after they were made (pickups.ts GEM_LIFE), and
    // the route gathers them once he's beaten.
    const beforeGanon = game.adventure.gems;
    run(game, HYRULE_CASTLE_MILESTONES[37]!.goals);
    expect([game.adventure.room, game.adventure.ganon?.gone, on(16)]).toEqual([11, true, true]);
    expect(game.battle.fighters[0]!.hearts).toBeGreaterThan(0);
    expect(game.adventure.gems - beforeGanon).toBe(154); // 80 + what's left of 99 + 99 (the Links hurt once a grace: fewer spilled)
    // Down the staircase into room 12, onto the goal with the quota (room 6's gem rain, room 10's throne room and
    // cannon columns: 2,523; Phantom Ganon's: 2,801): the stage cleared. (The totals are rolled: the rain's gems are
    // green, blue or red at random, as are the soldiers' drops, and the route's changes since move the random
    // generator: 2,605 and 2,883 when Phantom Ganon came in, room 2 then gathering 48 fewer and room 6 135 more.)
    expect(game.adventure.gems).toBeGreaterThanOrEqual(GEM_QUOTA + 50 + 278);
    run(game, HYRULE_CASTLE_MILESTONES[38]!.goals);
    expect(HYRULE_CASTLE_MILESTONES).toHaveLength(39);
    expect(game.adventure.room).toBe(12);
    expect(game.adventure.cleared).toBeGreaterThan(0);
    // The fights played without a Link dying (rooms 2 and 6 by the leader alone, the captain's lunges sidestepped).
    expect(downed).toBe(0);
  }, 30_000);

  it("room 11's staircase (RASN kind 5, 0x80A09005) leads 512 px west and 272 up: room 12's (256, 48), walked down out of; the Cave's (kind 4, 0x9A0D84) to its room 6's (352, 272), as measured", () => {
    const cave = new AdventureStage(new Stage(load("Boss/boss011.arc")), tileTypes, stats);
    const caveStairs = cave.area(12, 0).actors.find((a) => a.id === "RASN")!;
    expect(stairsLeadTo(cave, 12, caveStairs)).toEqual({ room: 6, x: 352, y: 272, dir: -1 });
    const stairs = stage.area(11, 0).actors.find((a) => a.id === "RASN")!;
    expect(stairsLeadTo(stage, 11, stairs)).toEqual({ room: 12, x: 256, y: 48, dir: 1 });
    // Not there till Phantom Ganon's fall sets 16; then walked down into, the four come out below its foot in room 12.
    const game = createAdventure(stage, { room: 11, x: 256, y: 296, facing: "down", players: 4 });
    game.adventure.ganon = null;
    game.adventure.enemies = [];
    for (let t = 0; t < 30; t++) stepAdventure(game, [Button.Down], stage);
    expect([game.adventure.stairs, game.players[0]!.y / 256 > 330]).toEqual([null, true]);
    for (let t = 0; t < 30; t++) stepAdventure(game, [Button.Up], stage);
    game.battle.switches |= 1 << 16;
    for (let t = 0; t < 30 && !game.adventure.stairs; t++) stepAdventure(game, [Button.Down], stage);
    expect(game.adventure.stairs).not.toBeNull();
    for (let t = 0; t < STAIRS_TICKS && game.adventure.stairs; t++) stepAdventure(game, [0], stage);
    expect([game.adventure.room, game.adventure.stairs]).toEqual([12, null]);
    expect(game.players.map((p) => [p.x / 256, p.y / 256, p.facing])).toEqual([232, 248, 264, 280].map((x) => [x, 68, "down"]));
  });

  it("room 10's throne (STBL): the four in the long formation walking into its side push it 64 px in four legs, the leader moving from the 29th tick, standing 12 ticks between legs (traced: within 4 ticks); the curtain (DOOR kind 8) behind it holds a Link at y 39 until a sword swing cuts it", () => {
    const game = createAdventure(stage, { room: 10, players: 4 });
    enterArea(game, stage, 10, 2, 0, 0);
    game.adventure.enemies = [];
    game.adventure.formation = "long";
    game.players.forEach((p, i) => Object.assign(p, { x: 209.5 * 256, y: (39.25 + 16 * i) * 256, facing: "right" }));
    const moved: number[] = [];
    let x = game.players[0]!.x;
    for (let t = 1; t <= 450; t++) {
      stepAdventure(game, [t > 5 ? Button.Right : 0], stage);
      if (game.players[0]!.x !== x && t > 20) moved.push(t);
      x = game.players[0]!.x;
    }
    const throne = game.adventure.rocks.find((r) => r.type === "STBL")!;
    expect([throne.state, throne.x / 256, throne.y / 256]).toEqual(["set", 320, 64]);
    // Traced: the leader moving with it from tick 34, legs resuming on 105, 195 and 285, still from 383.
    const resumes = moved.filter((t, i) => i > 0 && t - moved[i - 1]! > 5);
    expect(Math.abs(moved[0]! - 34)).toBeLessThanOrEqual(1);
    resumes.forEach((t, i) => expect(Math.abs(t - [105, 195, 285][i]!)).toBeLessThanOrEqual(4));
    expect(Math.abs(moved.at(-1)! - 383)).toBeLessThanOrEqual(4);
    // The curtain: walking up into it the leader is held at y 39; a swing up cuts it, then he walks through.
    for (let t = 0; t < 10; t++) stepAdventure(game, [0], stage);
    Object.assign(game.players[0]!, { x: 256 * 256, y: 60 * 256, facing: "up" });
    game.adventure.formation = "trail";
    for (let t = 0; t < 40; t++) stepAdventure(game, [Button.Up], stage);
    expect(game.players[0]!.y / 256).toBe(39);
    for (let t = 0; t < 20; t++) stepAdventure(game, [t < 2 ? Button.Sword : 0], stage);
    for (let t = 0; t < 120 && game.adventure.area === 2; t++) stepAdventure(game, [Button.Up], stage);
    expect(game.adventure.area).toBe(7);
  });

  it("a cannon's shot out of area 7's top goes on in area 6: held 20 ticks at its bottom, then up at the speed it left with, 8.5 px/tick, to y 356 (traced)", () => {
    const game = createAdventure(stage, { room: 10, players: 1 });
    enterArea(game, stage, 10, 7, 0, 0);
    Object.assign(game.players[0]!, { x: 168 * 256, y: 150 * 256 });
    for (let t = 0; t < 120 && game.adventure.links[0]!.mode !== "cannon"; t++) stepAdventure(game, [0], stage);
    expect(game.adventure.links[0]!.mode).toBe("cannon");
    stepAdventure(game, [Button.Item], stage);
    let t = 0, arrived = -1, first = 0, top = Infinity;
    for (; t < 200; t++) {
      stepAdventure(game, [0], stage);
      const y = game.players[0]!.y / 256;
      if (arrived < 0 && game.adventure.area === 6) arrived = t;
      if (arrived >= 0 && !first && y < 504) first = t - arrived;
      if (arrived >= 0 && first) top = Math.min(top, y);
    }
    expect(first).toBe(SHOT_INTO_HOLD_TICKS);
    expect(Math.abs(top - 356)).toBeLessThanOrEqual(1);
  });

  it("room 7's barrier (BARI, switch 16) holds the Links below it; both escort Zoras' arrival points waiting (18, 19), the great fairy comes 240 ticks on and 16 takes it away (read from main.dol)", () => {
    const game = createAdventure(stage, { room: 57, x: 256, y: 220, facing: "up", players: 1 });
    const on = (n: number) => ((game.battle.switches >>> n) & 1) === 1;
    for (let t = 0; t < 120; t++) stepAdventure(game, [Button.Up], stage);
    expect(game.players[0]!.y / 256).toBeGreaterThan(184);
    game.battle.switches |= 1 << 18;
    for (let t = 0; t < 300; t++) stepAdventure(game, [0], stage);
    expect(on(16)).toBe(false);
    game.battle.switches |= 1 << 19;
    for (let t = 0; t < FAIRY_TICKS - 1; t++) stepAdventure(game, [0], stage);
    expect(on(16)).toBe(false);
    stepAdventure(game, [0], stage);
    expect(on(16)).toBe(true);
    for (let t = 0; t < 120; t++) stepAdventure(game, [Button.Up], stage);
    expect(game.adventure.area !== 0 || game.players[0]!.y / 256 < 168).toBe(true);
  });

  /** Room 58's four in the cross formation, the leader at (x, y) facing up, the sword charged (B held 62 ticks, as
   *  traced) and let go: on the spin's first tick, the whirl's. */
  const chargedCross = (x: number, y: number) => {
    const game = createAdventure(stage, { room: 58, players: 4 });
    enterArea(game, stage, 58, 0, 0, 0);
    game.adventure.enemies = [];
    game.adventure.formation = "cross";
    const places = [[0, 0, "up"], [-16, 16, "left"], [16, 16, "right"], [0, 32, "down"]] as const;
    game.players.forEach((p, i) => Object.assign(p, { x: (x + places[i]![0]) * 256, y: (y + places[i]![1]) * 256, facing: places[i]![2] }));
    for (let t = 0; t < 62; t++) stepAdventure(game, [Button.Sword], stage);
    for (let t = 0; t < 5 && game.players[0]!.action !== "spin"; t++) stepAdventure(game, [0], stage);
    return game;
  };

  it("room 58: the cross formation's spin is a 34-tick whirl round the diamond's middle that lights the four crystals as traced (5, 6, 8 on its 5th tick, 7 on its 14th)", () => {
    // Traced from `w1-013-room58` (measurements/adventure-world1.md "Hyrule Castle room 58: the cross formation's
    // spin"), the 16 still frames from 9's frame left out: each tick's four Links (x, y, px) and their box directions
    // (attacks.ts Dir8, clockwise from right).
    const TRACE = [
      [232, 296, 221.5, 314.3, 242.5, 309.7, 234.3, 322.5], [232, 296, 227.1, 316.6, 236.9, 307.4, 236.6, 316.9],
      [232, 296, 233.1, 317.1, 230.9, 306.9, 237.1, 310.9], [232, 296, 239.1, 317.5, 224.9, 306.5, 237.5, 304.9],
      [232, 296, 245, 318, 219, 306, 238, 299], [232, 296, 246.8, 318.1, 217.2, 305.9, 238.1, 297.2],
      [232, 296, 243.4, 323.1, 220.6, 300.9, 243.1, 300.6], [232, 296, 237.9, 325.5, 226.1, 298.5, 245.5, 306.1],
      [232, 296, 232, 324.7, 232, 299.3, 244.7, 312], [232, 296, 227.3, 321, 236.7, 303, 241, 316.7],
      [236.1, 296.5, 223.4, 315.7, 240.6, 308.3, 235.7, 320.6], [240, 298.1, 221, 309.4, 243, 314.6, 229.4, 323],
      [243.3, 300.7, 221, 302.5, 243, 321.5, 222.5, 323], [245.8, 304, 224, 298.2, 240, 325.8, 218.2, 320],
      [247.4, 307.8, 227.8, 296.6, 236.2, 327.4, 216.6, 316.2], [248, 312, 232, 296, 232, 328, 216, 312],
      [247.5, 316.1, 236.1, 296.5, 227.9, 327.5, 216.5, 307.9], [245.9, 320, 240, 298.1, 224, 325.9, 218.1, 304],
      [243.3, 323.3, 243.3, 300.7, 220.7, 323.3, 220.7, 300.7], [240, 325.8, 245.8, 304, 218.2, 320, 224, 298.2],
      [236.2, 327.4, 247.4, 307.8, 216.6, 316.2, 227.8, 296.6], [232, 328, 248, 312, 216, 312, 232, 296],
      [227.9, 327.5, 247.5, 316.1, 216.5, 307.9, 236.1, 296.5], [224, 325.9, 245.9, 320, 218.1, 304, 240, 298.1],
      [220.7, 323.3, 243.3, 323.3, 220.7, 300.7, 243.3, 300.7], [218.2, 320, 240, 325.8, 224, 298.2, 245.8, 304],
      [216.6, 316.2, 236.2, 327.4, 227.8, 296.6, 247.4, 307.8], [216, 312, 232, 328, 232, 296, 248, 312],
      [216.5, 307.9, 227.9, 327.5, 236.1, 296.5, 247.5, 316.1], [218.1, 304, 224, 325.9, 240, 298.1, 245.9, 320],
      [220.7, 300.7, 220.7, 323.3, 243.3, 300.7, 243.3, 323.3], [223.9, 298.2, 218.2, 320.1, 245.8, 303.9, 240.1, 325.8],
      [227.8, 296.6, 216.6, 316.2, 247.4, 307.8, 236.2, 327.4], [232, 296, 216, 312, 248, 312, 232, 328],
    ];
    const DIRS = "3157 3157 3157 3157 3157 3157 3157 4260 5371 6402 6402 7513 7513 7513 0624 0624 0624 1735 1735 1735 2046 2046 2046 3157 3157 3157 4260 4260 4260 5371 5371 5371 6402 6402".split(" ");
    const at = [[232, 296, "up"], [216, 312, "left"], [248, 312, "right"], [232, 328, "down"]] as const;
    const game = chargedCross(232, 296);
    const on = (n: number) => ((game.battle.switches >>> n) & 1) === 1;
    const lit: Record<number, number> = {};
    // The worst distance from the trace (px) per stretch of ticks (by their first tick).
    const off: Record<number, number> = {};
    let before = at.map(([x, y]) => [x * 256, y * 256]);
    for (let n = 1; n <= CROSS_SPIN_TICKS; n++) {
      if (n > 1) {
        before = game.players.map((p) => [p.x, p.y]);
        stepAdventure(game, [0], stage);
      }
      expect(game.players.map((p) => [p.action, p.actionTick])).toEqual(game.players.map(() => ["spin", n]));
      game.players.forEach((p, i) => {
        // The boxes: the traced direction's, where he stood the tick before.
        const [inner] = ATTACK_BOXES[Number(DIRS[n - 1]![i]) as Dir8], box = linkAttack(game, i)!.boxes[0];
        expect([n, i, box.left, box.top]).toEqual([n, i, before[i]![0]! + inner[0] * 256, before[i]![1]! + inner[1] * 256]);
        const d = Math.hypot(p.x / 256 - TRACE[n - 1]![i * 2]!, p.y / 256 - TRACE[n - 1]![i * 2 + 1]!);
        const from = [1, 3, 7, 11, 15].findLast((t) => t <= n)!;
        off[from] = Math.max(off[from] ?? 0, Math.round(d * 100) / 100);
      });
      for (const s of [5, 6, 7, 8, 9]) if (on(s) && !lit[s]) lit[s] = n;
    }
    // On it but where the game's followers jostle as they cross the middle (ticks 3-6: their steps turned off the
    // straight line, one held) and after (7-10: their dashes from there), and where they catch up with the circle (11-14:
    // the game's steps 6.6-6.9 px, pushed off one another, the sim's 6): whirl.ts.
    expect(off).toEqual({ 1: 0.04, 3: 6.27, 7: 0.23, 11: 2.35, 15: 0.11 });
    // (SWT4's 9 the same tick in the sim; the game's comes on the next: its monitor updated before the crystals, not
    // modelled.)
    expect(lit).toEqual({ 5: 5, 6: 5, 8: 5, 7: 14, 9: 14 });
    // Then they stand in the cross again, facing out.
    stepAdventure(game, [0], stage);
    expect(game.adventure.crossSpin).toBeNull();
    expect(game.players.map((p) => [p.action, p.x / 256, p.y / 256, p.facing])).toEqual(at.map(([x, y, f]) => ["none", x, y, f]));
  });

  it("room 58: the whirl lights the four crystals from 8 px off the route's spot either way (traced: x ±3, ±8; y ±3, ±8)", () => {
    for (const [dx, dy] of [[0, -3], [0, 3], [-3, 0], [3, 0], [0, -8], [0, 8], [-8, 0], [8, 0]] as const) {
      const game = chargedCross(232 + dx, 296 + dy);
      for (let t = 1; t < CROSS_SPIN_TICKS; t++) stepAdventure(game, [0], stage);
      expect([dx, dy, (game.battle.switches >>> 9) & 1]).toEqual([dx, dy, 1]);
    }
  });

  it("room 9's area 5: its fragile blocks hold until a bomb's blast meets them; the escort Zora goes with the Link who meets it", () => {
    const game = createAdventure(stage, { room: 9, players: 1 });
    enterArea(game, stage, 9, 5, 0, 0);
    Object.assign(game.players[0]!, { x: 40 * 256, y: 136 * 256, facing: "right" });
    expect(isSolidAt(areaWorld(game, stage), 100, 136)).toBe(true);
    spawnEntity(game.battle, "explosion", 104 * 256, 128 * 256, { phase: "active", timer: EXPLOSION_TICKS });
    stepAdventure(game, [0], stage);
    expect(isSolidAt(areaWorld(game, stage), 100, 136)).toBe(false);
    expect(game.adventure.broken.length).toBeGreaterThanOrEqual(2);
    game.players[0]!.x = 180 * 256;
    stepAdventure(game, [0], stage);
    expect(game.adventure.escort).toMatchObject({ sw: 18, room: 9, area: 5 });
  });

  it("room 9's area 5: the escort Zora's greeting opens as he meets the Link (0x2B4, then 0x2B3), holding the Links until both are read; the Zora then goes with them", () => {
    const game = createAdventure(stage, { room: 9, players: 1 });
    enterArea(game, stage, 9, 5, 0, 0);
    Object.assign(game.players[0]!, { x: 40 * 256, y: 136 * 256, facing: "right" });
    game.players[0]!.x = 180 * 256;
    stepAdventure(game, [0], stage);
    expect(game.adventure.escort).toMatchObject({ sw: 18, room: 9, area: 5 });
    expect([game.adventure.talk?.message, game.adventure.talk?.style, game.adventure.talk?.after]).toEqual([0x2b4, "balloon", [0x2b3]]);
    // Held: pushing right doesn't move him while the greeting is on show.
    const x = game.players[0]!.x;
    step(game, Button.Right, 60);
    expect(game.players[0]!.x).toBe(x);
    // Read through, a fast reader's way (each page as it types): about 270 ticks for the two messages (assumed timing).
    let ticks = 60, pressed = false;
    while (game.adventure.talk && ticks < 2000) {
      const turn: boolean = !pressed && pageTyped(game.adventure.talk, stage);
      stepAdventure(game, [turn ? Button.Item : 0], stage);
      pressed = turn;
      ticks++;
    }
    expect(game.adventure.talk).toBeNull();
    expect(ticks).toBeGreaterThan(240);
    expect(ticks).toBeLessThan(300);
    // The Zora goes on with them: it walks up behind him once the Links are free.
    run(game, [holdUntil("walk on", Button.Right, (g) => g.players[0]!.x > 200 * 256, 120)]);
    expect(game.adventure.escort).not.toBeNull();
  });

  it("room 0: the owl talks as the Links come up to y 204.5, holding them until its five pages are read; then they go on", () => {
    const game = createAdventure(stage, { players: 4 });
    run(game, [holdUntil("up to the owl", Button.Up, (g) => g.adventure.talk !== null, 400)]);
    const talk = game.adventure.talk!;
    expect([game.adventure.room, game.adventure.area, talk.message, talk.style]).toEqual([0, 0, 0x2bb, "balloon"]);
    expect(game.players[0]!.y / 256).toBe(204.5);
    // Held: pushing up doesn't move the Links while the message types and its pages wait.
    step(game, Button.Up, 60);
    expect(game.players[0]!.y / 256).toBe(204.5);
    expect(game.adventure.talk).not.toBeNull();
    // Each typed page turned by the talk button (one press a page); the last one closes the box and the Links are free.
    let pages = 0, pressed = false;
    for (let i = 0; i < 2000 && game.adventure.talk; i++) {
      const t = game.adventure.talk;
      const turn: boolean = !pressed && pageTyped(t, stage);
      if (turn && t.page === pages) pages++;
      stepAdventure(game, [turn ? Button.Item : 0], stage);
      pressed = turn;
    }
    expect(pages).toBe(5);
    expect(game.adventure.talk).toBeNull();
    // Read once: going on up doesn't open it again.
    run(game, [holdUntil("on up past the owl's place", Button.Up, (g) => g.players[0]!.y < 150 * 256, 300)]);
    expect(game.adventure.talk).toBeNull();
    expect(game.adventure.talked).toHaveLength(1);
  });

  it("room 9's big handle (PSWB) moves only with the four on it: 0.05, 0.125, then 0.05 px a tick to 14 px (184 ticks), out for good, its switch 17; alone it doesn't move", () => {
    const handle = stage.area(9, 0).actors.find((a) => a.id === "PSWB")!;
    const alone = createAdventure(stage, { room: 9, x: 304, y: 152, facing: "up", players: 1 });
    stepAdventure(alone, [Button.Action | Button.Down], stage);
    expect(pullOut(alone, handle.index)).toBe(0);
    const game = createAdventure(stage, { room: 9, x: 304, y: 152, facing: "up", players: 4 });
    game.adventure.enemies = [];
    game.adventure.formation = "wide";
    game.players.forEach((p, i) => Object.assign(p, { x: (304 + 16 * i) * 256, y: 152 * 256, facing: "up" }));
    for (let t = 0; t < 10; t++) stepAdventure(game, [0], stage);
    let ticks = 0;
    while (!((game.battle.switches >>> 17) & 1) && ticks < 400) {
      stepAdventure(game, [Button.Action | Button.Down], stage);
      ticks++;
    }
    expect(ticks).toBe(184);
    expect(pullOut(game, handle.index)).toBe(BIG_PULL_FULL / PULL_UNIT);
    expect(game.players.map((p) => p.y / 256)).toEqual([166, 166, 166, 166]);
    for (let t = 0; t < 30; t++) stepAdventure(game, [0], stage);
    expect(pullOut(game, handle.index)).toBe(14);
  });

  it("room 6's iron-ball soldier (SLR3, life 24 in Hyrule Castle) waits for the gate's switch 16, then walks at the leader, 0.3 px/tick eased 3/10 a tick (traced)", () => {
    const game = createAdventure(stage, { room: 6, x: 256, y: 295, facing: "up", players: 1 });
    game.adventure.enemies = game.adventure.enemies.filter((e) => e.type !== "SLR1");
    const ball = game.adventure.enemies.find((e) => e.type === "SLR3")!;
    expect([ball.x / 256, ball.y / 256, ball.life]).toEqual([256, 48, BALL_SOLDIER_CASTLE.life]);
    for (let t = 0; t < 10; t++) stepAdventure(game, [0], stage);
    expect([ball.x / 256, ball.y / 256]).toEqual([256, 48]);
    game.battle.switches |= 1 << 16;
    const vys: number[] = [];
    for (let t = 0; t < 30; t++) {
      stepAdventure(game, [0], stage);
      if (ball.vy) vys.push(ball.vy);
    }
    // Traced: 0.090, 0.153, 0.197, 0.228 … 0.300 px/tick.
    expect(vys.slice(0, 4).map((v) => +(v / 256).toFixed(2))).toEqual([0.09, 0.15, 0.2, 0.23]);
    expect(vys.at(-1)).toBe(BALL_SOLDIER.walk);
    expect(ball.x / 256).toBe(256);
  });

  it("room 6's iron-ball soldier swings its ball out on a 70 px chain (2 to a Link it meets), struck reels it in for 30 ticks and swings faster (battle's rules)", () => {
    const game = createAdventure(stage, { room: 6, x: 256, y: 200, facing: "up", players: 1 });
    game.adventure.enemies = game.adventure.enemies.filter((e) => e.type !== "SLR1");
    const s = game.adventure.enemies.find((e) => e.type === "SLR3")!;
    game.battle.switches |= 1 << 16;
    for (let t = 0; t < 40; t++) stepAdventure(game, [0], stage);
    expect([s.state, s.shot]).toEqual(["chase", BALL_SOLDIER.reach]);
    const [bx, by] = ironBallOf(s), [hx, hy] = ironBallHand(s);
    expect(Math.round(Math.hypot(bx - hx, by - hy) / 256)).toBe(70);
    // Struck: 4 off its life, knocked away, nothing hurts it while it reels its ball in.
    hurtEnemy(s, 4, s.x, s.y + 20 * 256, game);
    expect([s.life, s.timer, s.turn, s.vy < -10 * 256]).toEqual([BALL_SOLDIER_CASTLE.life - 4, BALL_SOLDIER.reelTicks, 760, true]);
    hurtEnemy(s, 4, s.x, s.y + 20 * 256, game);
    expect(s.life).toBe(BALL_SOLDIER_CASTLE.life - 4);
    for (let t = 0; t < 25; t++) stepAdventure(game, [0], stage);
    expect(Math.round(s.shot / 256)).toBe(BALL_SOLDIER.reeled / 256);
    // Its ball on the leader: 2 (in quarter hearts), knocked away.
    const f = game.battle.fighters[0]!, before = f.hearts, p = game.players[0]!;
    [s.timer, s.shot] = [0, BALL_SOLDIER.reach];
    [p.x, p.y] = ironBallOf(s);
    stepAdventure(game, [0], stage);
    expect(f.hearts).toBe(before - BALL_SOLDIER.ballDamage);
    // A sword meeting the ball clanks on it: the Link recoils, the soldier unharmed.
    for (let t = 0; t < 120; t++) stepAdventure(game, [0], stage);
    s.turn = 0;
    const life = s.life, [cx, cy] = ironBallOf(s);
    Object.assign(p, { x: cx, y: cy + 24 * 256, facing: "up" });
    const actions: string[] = [];
    for (let t = 0; t < 4; t++) {
      stepAdventure(game, [t < 2 ? Button.Sword : 0], stage);
      actions.push(p.action);
    }
    expect(actions).toContain("tink");
    expect(s.life).toBe(life);
  });

  it("room 5's gatehouse pedestals give the items drawn on them (bombs on the left, the bow on the right: traced)", () => {
    const area = stage.area(5, 2);
    expect(drawnPedestalItem(area, (32 >> 4) * 32 + (32 >> 4))).toBe("bombs");
    expect(drawnPedestalItem(area, (32 >> 4) * 32 + (208 >> 4))).toBe("bow");
    const game = createAdventure(stage, { room: 5, x: 40, y: 175, players: 1 });
    enterArea(game, stage, 5, 2, 0, 0);
    Object.assign(game.players[0]!, { x: 201 * 256, y: 41 * 256, facing: "right" });
    stepAdventure(game, [Button.Action], stage);
    expect(game.adventure.gear).toBe("bow");
  });

  it("an arrow shot down over the gatehouse's pit goes on through its south door and lights the crystal below it on the TV, 20 ticks after it left the bow (traced)", () => {
    const game = createAdventure(stage, { room: 5, x: 40, y: 175, players: 1 });
    enterArea(game, stage, 5, 2, 0, 0);
    Object.assign(game.players[0]!, { x: Math.round(128.2 * 256), y: Math.round(72.7 * 256), facing: "down" });
    giveGear(game, "bow");
    let shot = -1, lit = -1;
    for (let t = 0; t < 80 && lit < 0; t++) {
      stepAdventure(game, [t < 3 ? Button.Item : 0], stage);
      if (shot < 0 && game.battle.entities.some((e) => e.kind === "arrow")) shot = t;
      if ((game.battle.switches >>> 17) & 1) lit = t;
    }
    expect(shot).toBeGreaterThanOrEqual(0);
    expect(lit - shot).toBe(20);
    // Gone through the door: no arrow left in sight.
    expect(game.battle.entities.some((e) => e.kind === "arrow" && e.x >= 0)).toBe(false);
  });

  it("room 5's cracked wall (DOOR kind 2) holds a Link walking up into it at y 279 until a bomb's blast meets it (traced)", () => {
    const game = createAdventure(stage, { room: 5, x: 96, y: 300, facing: "up", players: 1 });
    for (let t = 0; t < 40; t++) stepAdventure(game, [Button.Up], stage);
    expect([game.adventure.area, Math.round(game.players[0]!.y / 256)]).toEqual([0, 279]);
    spawnEntity(game.battle, "explosion", 96 * 256, 262 * 256, { phase: "active", timer: 32 });
    stepAdventure(game, [0], stage);
    for (let t = 0; t < 120 && game.adventure.area !== 5; t++) stepAdventure(game, [Button.Up], stage);
    expect(game.adventure.area).toBe(5);
  });

  it("room 3's pull switch (PLSW): 56 ticks of pulling bring it out for good (switch 5), let go early it slides back; out at the start once its switch is on", () => {
    const game = createAdventure(stage, { room: 3, x: 408, y: 282, facing: "up", players: 1 });
    const handle = stage.area(3, 0).actors.find((a) => a.id === "PLSW" && a.x === 408)!;
    // The bush under it cut (as the route does).
    game.battle.cut.push((272 >> 4) * 32 + (408 >> 4));
    for (let t = 0; t < 10; t++) stepAdventure(game, [Button.Action | Button.Down], stage);
    expect(pullOut(game, handle.index)).toBe(2.5);
    expect(game.players[0]!.y / 256).toBe(264 + 2.5 + 16);
    stepAdventure(game, [0], stage);
    expect(pullOut(game, handle.index)).toBe(2.25);
    let ticks = 0;
    while (!((game.battle.switches >>> 5) & 1) && ticks < 200) {
      stepAdventure(game, [Button.Action | Button.Down], stage);
      ticks++;
    }
    // From 2.25 px: 7 ticks to 4, then 40 to 8.
    expect(ticks).toBe(47);
    expect(pullOut(game, handle.index)).toBe(PULL_FULL / PULL_UNIT);
    for (let t = 0; t < 30; t++) stepAdventure(game, [0], stage);
    expect(pullOut(game, handle.index)).toBe(8);
    const again = createAdventure(stage, { room: 3, x: 256, y: 300, players: 1 });
    again.battle.switches |= 1 << 5;
    spawnPulls(again, stage);
    expect(pullOut(again, handle.index)).toBe(8);
  });

  it("room 3's gate (SPBG kind 1) sets 25 31 ticks after 24 (measured), and its tiles open", () => {
    const game = createAdventure(stage, { room: 3, x: 256, y: 300, players: 1 });
    expect(isSolidAt(areaWorld(game, stage), 256, 184)).toBe(true);
    game.battle.switches |= 1 << 24;
    let at = -1;
    for (let t = 0; t < 100 && at < 0; t++) {
      stepAdventure(game, [0], stage);
      if ((game.battle.switches >>> 25) & 1) at = t;
    }
    expect(at).toBe(GATE_TICKS);
    expect(isSolidAt(areaWorld(game, stage), 256, 184)).toBe(false);
  });

  it("area 6: a Link lifted on a side view and thrown over the gap flies level, comes back off a pot, lands on the far ledge and waits there; the same on a clone", () => {
    const game = createAdventure(stage, { players: 4 });
    for (const m of HYRULE_CASTLE_MILESTONES.slice(0, 3)) run(game, m.goals);
    const goals = HYRULE_CASTLE_MILESTONES[3]!.goals, thrown = goals.findIndex((g) => g.name === "thrown, down");
    const carried = goals.findIndex((g) => g.name === "carried");
    run(game, goals.slice(0, carried + 1));
    // The leader holds the Link who stood just ahead of him over his head.
    const held = game.battle.fighters[0]!.carryLink;
    expect(held).toBeGreaterThan(0);
    expect(game.battle.fighters[held]!.move).toBe("held");
    const y = game.players[0]!.y, snapshot = cloneAdventure(game);
    let flewX = Infinity, sank = false;
    const player = new RoutePlayer(goals.slice(carried + 1, thrown + 1));
    while (!player.done) {
      const buttons = player.next(game, stage);
      if (player.done) break;
      stepAdventure(game, [buttons], stage);
      const f = game.battle.fighters[held]!, q = game.players[held]!;
      if (f.move === "thrown") flewX = Math.min(flewX, q.x / 256);
      if (f.move === "thrown" && q.y !== y) sank = true;
    }
    const q = game.players[held]!;
    expect(sank).toBe(false);
    // Stopped by the pot at x 80-95, sent back, down on the floor between it and the gap (x 96-111).
    expect(flewX).toBeLessThan(104);
    expect(q.x / 256).toBeGreaterThan(flewX);
    expect(q.x / 256).toBeLessThan(112);
    expect(q.y).toBe(y);
    expect(game.battle.fighters[held]!.move).toBe("none");
    run(snapshot, goals.slice(carried + 1, thrown + 1));
    expect(hashGame(snapshot)).toBe(hashGame(game));
  });

  it("room 1's drawbridge (SPBG) sets switch 17 121 ticks after its switch 16, and the gate's tiles open", () => {
    const game = createAdventure(stage, { room: 1, x: 256, y: 300, facing: "up", players: 1 });
    const shut = isSolidAt(areaWorld(game, stage), 256, 168);
    expect(shut).toBe(true);
    game.battle.switches |= 1 << 16;
    let at = -1;
    for (let t = 0; t < 200 && at < 0; t++) {
      stepAdventure(game, [0], stage);
      if ((game.battle.switches >>> 17) & 1) at = t;
    }
    expect(at).toBe(BRIDGE_TICKS);
    expect(isSolidAt(areaWorld(game, stage), 256, 168)).toBe(false);
  });

  it("room 2's spikes (THRN) shut its ways out until its enemies are beaten", () => {
    const game = createAdventure(stage, { room: 2, x: 256, y: 344, facing: "up", players: 1 });
    expect(isSolidAt(areaWorld(game, stage), 256, 8)).toBe(true);
    stepAdventure(game, [0], stage);
    expect(isSolidAt(areaWorld(game, stage), 256, 8)).toBe(true);
    for (const e of game.adventure.enemies) e.life = 0;
    game.adventure.enemies = [];
    stepAdventure(game, [0], stage);
    expect(isSolidAt(areaWorld(game, stage), 256, 8)).toBe(false);
    expect(isSolidAt(areaWorld(game, stage), 256, 376)).toBe(false);
  });

  it("room 11: Phantom Ganon struck down by his own ball, beaten, the staircase's switch; the same on a clone", () => {
    const game = createAdventure(stage, { room: 11, x: 256, y: 330, facing: "up", players: 4 });
    expect(game.adventure.ganon?.hp).toBe(210);
    // Half way through, a copy plays the rest again: the same end (determinism through clones).
    const goals = PHANTOM_GANON_MILESTONES[0]!.goals;
    run(game, goals.slice(0, 1));
    const snapshot = cloneAdventure(game);
    run(game, goals.slice(1));
    expect(game.adventure.ganon?.gone).toBe(true);
    expect((game.battle.switches >>> 16) & 1).toBe(1);
    expect(game.battle.fighters[0]!.hearts).toBeGreaterThan(0);
    run(snapshot, goals.slice(1));
    expect(snapshot.tick).toBe(game.tick);
    expect(hashGame(snapshot)).toBe(hashGame(game));
  });
});
