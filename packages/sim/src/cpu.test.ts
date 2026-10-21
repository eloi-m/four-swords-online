// CPU opponents (cpu.ts): they win against a Link who does nothing, walk round pits, stay deterministic through
// clones, JSON snapshots and rollbacks, and (with extracted/) finish 4-CPU matches on every real arena, rarely walk
// into a pit, and rank by level.
import { existsSync, readFileSync } from "node:fs";
import { decompressYaz0, Dol, parseRarc, readTileTypes, Stage } from "@fso/formats";
import { describe, expect, it } from "vitest";
import { ARENA_ROOMS, arenaName, arenaSpawns, buildArenaWorld } from "./arena.ts";
import { COUNTDOWN_TICKS, createBattle, restartBattle, type BattleRules, type Spawn } from "./battle.ts";
import { addCpus, cpuInputs, cpuLevel, type CpuLevel } from "./cpu.ts";
import { startRide } from "./epona.ts";
import { navGrid, region, nearestWalkable } from "./cpunav.ts";
import { switchTriggers } from "./cpuswitches.ts";
import { cloneGame, stepGame, type GameState } from "./game.ts";
import { hashGame } from "./hash.ts";
import { giveItem } from "./orbs.ts";
import { Button, SUBPX } from "./player.ts";
import { arenaProps, NO_PROPS, type ArenaProps } from "./props.ts";
import { decodeWarps, launchFlying, screenAt, sideRoomY } from "./siderooms.ts";
import { ownSwitch, switchOn } from "./switches.ts";
import { arena, worldFrom } from "./testarena.ts";
import type { World } from "./world.ts";

/** Plays a battle with CPUs (and `human` for the other players) until the match is over or `max` ticks. */
function play(game: GameState, world: World, max: number, human: (game: GameState) => number[] = () => [], each?: (game: GameState) => void): number {
  let t = 0;
  for (; t < max && game.battle!.phase !== "matchOver"; t++) {
    stepGame(game, cpuInputs(game, world, human(game)), world);
    each?.(game);
  }
  return t;
}

/** Every number in a state is a finite integer (positions, timers, the CPUs' memory). */
function assertIntegers(value: unknown, path = "state"): void {
  if (typeof value === "number") {
    if (!Number.isInteger(value)) throw new Error(`${path} = ${value}`);
  } else if (Array.isArray(value)) value.forEach((v, i) => assertIntegers(v, `${path}[${i}]`));
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) assertIntegers(v, `${path}.${k}`);
}

const SPAWNS_2: Spawn[] = [
  { x: 60, y: 120, facing: "right" },
  { x: 260, y: 120, facing: "left" },
];
const SPAWNS_4: Spawn[] = [
  { x: 60, y: 60, facing: "right" },
  { x: 260, y: 60, facing: "left" },
  { x: 60, y: 180, facing: "right" },
  { x: 260, y: 180, facing: "left" },
];
const RULES: BattleRules = { hearts: 3, timeLimit: 0, wins: 1 };

/** A 320×240 px arena and, at sublayer 2's place below it, a walled 320×240 side room (the rows between solid). */
function twoRooms(): World {
  const room = (y: number) => Array.from({ length: 40 }, (_, x) => (x === 0 || y === 0 || x === 39 || y === 29 ? "#" : ".")).join("");
  const top = sideRoomY(2) / 8, rows: string[] = [];
  for (let y = 0; y < top + 30; y++) rows.push(y < 30 ? room(y) : y < top ? "#".repeat(40) : room(y - top));
  return worldFrom(rows);
}

describe("CPU players", () => {
  it("are part of the state: addCpus, cpuLevel, cloneGame, restartBattle", () => {
    const game = createBattle(0, SPAWNS_4, RULES, NO_PROPS, 5);
    expect(game.battle!.cpus).toBeUndefined();
    addCpus(game, [{ player: 3, level: "hard" }, { player: 1, level: "easy" }]);
    expect(game.battle!.cpus!.map((c) => [c.player, c.level])).toEqual([[1, "easy"], [3, "hard"]]);
    expect([0, 1, 2, 3].map((i) => cpuLevel(game, i))).toEqual([null, "easy", null, "hard"]);
    addCpus(game, [{ player: 1, level: "normal" }]); // replaces P2's
    expect([0, 1, 2, 3].map((i) => cpuLevel(game, i))).toEqual([null, "normal", null, "hard"]);
    const copy = cloneGame(game);
    expect(copy).toEqual(game);
    copy.battle!.cpus![0]!.think = 99;
    expect(game.battle!.cpus![0]!.think).not.toBe(99);
    expect(restartBattle(game).battle!.cpus!.map((c) => c.level)).toEqual(["normal", "hard"]);
    expect(() => addCpus(game, [{ player: 4, level: "easy" }])).toThrow(/no player/);
    expect(() => addCpus(game, [{ player: 0, level: "insane" as CpuLevel }])).toThrow(/level/);
  });

  it("override only their own slots; the humans' buttons pass through, and without CPUs nothing changes", () => {
    const world = arena();
    const game = createBattle(0, SPAWNS_2, RULES);
    const humans = [Button.Up | Button.Sword, Button.Left];
    expect(cpuInputs(game, world, humans)).toBe(humans);
    addCpus(game, [{ player: 1, level: "normal" }]);
    for (let t = 0; t < COUNTDOWN_TICKS + 60; t++) {
      const inputs = cpuInputs(game, world, humans);
      expect(inputs[0]).toBe(humans[0]);
      if (game.battle!.phase === "countdown") expect(inputs[1]).toBe(0);
      stepGame(game, inputs, world);
    }
    expect(game.players[1]!.x).toBeLessThan(260 * 256); // walked toward P1
  });

  for (const level of ["easy", "normal", "hard"] as const) {
    it(`${level}: beats a Link who does nothing (his shield up, facing the CPU's start)`, () => {
      const world = arena();
      const game = addCpus(createBattle(0, SPAWNS_2, RULES, NO_PROPS, 11), [{ player: 1, level }]);
      const ticks = play(game, world, 6000);
      expect(game.battle!).toMatchObject({ phase: "matchOver", matchWinner: 1 });
      console.log(`${level} CPU vs an idle Link: won in ${ticks} ticks`);
    });
  }

  it("use the boots, the hammer and the Fire Rod on a Link who does nothing (dash into him, flatten him, set him alight)", () => {
    const used = (game: GameState) => {
      const f = game.battle!.fighters[1]!, g = game.battle!.fighters[0]!;
      return { boots: f.move === "dash" && g.mode === "hurt", hammer: g.flat > 0, fireRod: g.move === "burning" };
    };
    for (const item of ["boots", "hammer", "fireRod"] as const) {
      for (const level of ["normal", "hard"] as const) {
        const world = arena();
        const game = addCpus(createBattle(0, [{ x: 60, y: 120, facing: "up" }, SPAWNS_2[1]!], RULES, NO_PROPS, 11), [{ player: 1, level }]);
        giveItem(game.battle!.fighters[1]!, item);
        let hits = 0;
        play(game, world, 6000, undefined, (g) => (hits += used(g)[item] ? 1 : 0));
        expect(hits, `${level} with the ${item}`).toBeGreaterThan(0);
        expect(game.battle!, `${level} with the ${item}`).toMatchObject({ phase: "matchOver", matchWinner: 1 });
      }
    }
  });

  it("walks round a pit to its rival, and never into it", () => {
    // A pit wall to wall between them but for a way round at the bottom.
    const world = arena([18, 1, 4, 22, "O"]);
    const game = addCpus(createBattle(0, SPAWNS_2, RULES, NO_PROPS, 3), [{ player: 1, level: "normal" }]);
    let falls = 0;
    play(game, world, 8000, undefined, (g) => (falls += g.battle!.fighters[1]!.mode === "falling" ? 1 : 0));
    expect(falls).toBe(0);
    expect(game.battle!).toMatchObject({ phase: "matchOver", matchWinner: 1 });
  });

  it("mashes free when a human lifts it", () => {
    const world = arena();
    const game = addCpus(createBattle(0, [{ x: 100, y: 120, facing: "right" }, { x: 116, y: 120, facing: "up" }], RULES), [{ player: 1, level: "normal" }]);
    for (let t = 0; t < COUNTDOWN_TICKS; t++) stepGame(game, cpuInputs(game, world, []), world);
    stepGame(game, cpuInputs(game, world, [Button.Action]), world); // P1 lifts the CPU in front of him
    expect(game.battle!.fighters[1]!.move).toBe("held");
    let t = 0;
    while (game.battle!.fighters[1]!.move === "held" && t++ < 400) stepGame(game, cpuInputs(game, world, [0]), world);
    expect(t).toBeLessThan(120); // free by mashing directions (17 presses, 5 ticks apart)
  });

  it("is deterministic: the same seed gives the same states, tick for tick; another seed doesn't", () => {
    const world = arena([10, 12, 3, 3, "O"], [26, 8, 2, 2, "#"]);
    const run = (seed: number) => {
      const game = addCpus(createBattle(0, SPAWNS_4, { hearts: 3, timeLimit: 0, wins: 2 }, NO_PROPS, seed), (["easy", "normal", "hard", "normal"] as const).map((level, player) => ({ player, level })));
      (["bomb", "bow", "boomerang", "slingshot"] as const).forEach((item, i) => giveItem(game.battle!.fighters[i]!, item));
      const hashes: number[] = [];
      play(game, world, 4000, undefined, (g) => hashes.push(hashGame(g)));
      return hashes;
    };
    const a = run(21);
    expect(run(21)).toEqual(a);
    expect(run(22)).not.toEqual(a);
  });

  // Three Links doing nothing far off, and a switch that calls the bombchus (switches.ts GEN3 0x17 on switch 30).
  const IDLE_3: Spawn[] = [{ x: 200, y: 120, facing: "left" }, { x: 290, y: 30, facing: "left" }, { x: 290, y: 210, facing: "left" }, { x: 30, y: 210, facing: "up" }];
  const SPAWNER = { id: "GEN3", x: 160, y: 30, params: 0xf0110097 };
  const bombchus = (g: GameState) => g.battle!.entities.filter((e) => e.kind === "bombchu").length;

  it("hard: stands on a floor switch that calls the bombchus on its rivals; easy doesn't", () => {
    const world = arena();
    const props: ArenaProps = { actors: [{ id: "SWTH", x: 144, y: 112, params: 0xf0000000 }, SPAWNER], bushes: [] };
    for (const level of ["hard", "easy"] as const) {
      const game = addCpus(createBattle(0, IDLE_3, RULES, props, 5), [{ player: 0, level }]);
      let first = -1;
      play(game, world, COUNTDOWN_TICKS + 900, undefined, (g) => {
        if (first < 0 && bombchus(g) > 0) first = g.tick;
      });
      if (level === "easy") expect(first).toBe(-1);
      else expect(first).toBeGreaterThan(0);
    }
  });

  it("hard: lights a crystal with a socket bomb (thrown against it), calling the bombchus", () => {
    // The crystal (timed, switch 30) is a solid tile at (32, 112); the socket bomb at (120, 120).
    const world = arena([4, 14, 2, 2, "#"]);
    const props: ArenaProps = { actors: [{ id: "ONOF", x: 32, y: 112, params: 0xf0002140 }, { id: "HBMB", x: 120, y: 120, params: 1 }, SPAWNER], bushes: [] };
    const game = addCpus(createBattle(0, IDLE_3, RULES, props, 5), [{ player: 0, level: "hard" }]);
    let first = -1, lit = false;
    play(game, world, COUNTDOWN_TICKS + 1500, undefined, (g) => {
      const blast = g.battle!.entities.find((e) => e.kind === "explosion" && e.owner === 0);
      if (blast && Math.abs(blast.x / SUBPX - 40) <= 24) lit = true;
      if (first < 0 && bombchus(g) > 0) first = g.tick;
    });
    expect(lit).toBe(true); // (the CPU's own bomb went off by the crystal)
    expect(first).toBeGreaterThan(0);
  });

  it("normal and hard: light two crystals 80 px apart together (an SWT4 over both, timed 256), a bomb put down by each; easy doesn't", () => {
    // Hyrule Castle's dark side's pair (crystals 23 and 24 → SWT4 25), here calling the bombchus on the TV.
    const world = arena([10, 6, 2, 2, "#"], [20, 6, 2, 2, "#"]);
    const props: ArenaProps = {
      actors: [
        { id: "ONOF", x: 80, y: 48, params: 0xb8002100 },
        { id: "ONOF", x: 160, y: 48, params: 0xc0002100 },
        { id: "SWT4", x: 0, y: 0, params: 0xcdef8c00 },
        { ...SPAWNER, params: 0xc8110097 },
      ],
      bushes: [],
    };
    expect(switchTriggers(props).map((tr) => tr.partners)).toEqual([[1], [0]]);
    for (const level of ["hard", "normal", "easy"] as const) {
      const game = addCpus(createBattle(0, IDLE_3, RULES, props, 5), [{ player: 0, level }]);
      giveItem(game.battle!.fighters[0]!, "bomb");
      let both = -1, volley = false;
      play(game, world, COUNTDOWN_TICKS + 2400, undefined, (g) => {
        if (both < 0 && switchOn(g.battle!, 25)) both = g.tick;
        volley ||= g.battle!.cpus![0]!.plan === "volley";
      });
      console.log(`${level}: both crystals lit at tick ${both}`);
      if (level === "easy") expect([both, volley]).toEqual([-1, false]);
      else expect([both > 0, volley], level).toEqual([true, true]);
    }
  });

  it("hard and normal: throw a bomb through a door at a rival in the side room behind it; easy goes in after him", () => {
    // The TV's door up at (160, 104) leads to (80, 136) in the side room; the rival stands 60 px up from there.
    const world = twoRooms();
    const props: ArenaProps = { actors: [], bushes: [], warps: decodeWarps([{ sublayer: 0, x: 152, y: 96, params: 0x02091019 }]) };
    for (const level of ["hard", "normal", "easy"] as const) {
      const game = addCpus(createBattle(0, [{ x: 160, y: 190, facing: "up" }, { x: 80, y: sideRoomY(2) + 76, facing: "down" }], RULES, props, 3), [{ player: 0, level }]);
      giveItem(game.battle!.fighters[0]!, "bomb");
      let inside = -1, hurt = -1, went = -1, tossed = false;
      play(game, world, COUNTDOWN_TICKS + 1200, undefined, (g) => {
        const b = g.battle!;
        tossed ||= b.cpus![0]!.plan === "toss";
        if (inside < 0 && b.entities.some((e) => e.kind === "bomb" && e.owner === 0 && screenAt(e.y) === 2)) inside = g.tick;
        if (hurt < 0 && b.fighters[1]!.hearts < RULES.hearts * 4) hurt = g.tick;
        if (went < 0 && screenAt(g.players[0]!.y) === 2) went = g.tick;
      });
      console.log(`${level}: a bomb in the side room at tick ${inside}, the rival hurt at ${hurt}, the CPU in at ${went}`);
      if (level === "easy") expect([tossed, went > 0 && (inside < 0 || inside > went)]).toEqual([false, true]); // (its bombs go in with it)
      else {
        expect(inside, level).toBeGreaterThan(0);
        expect(hurt, level).toBeGreaterThan(inside);
        expect(went < 0 || went > hurt, level).toBe(true); // (thrown from the TV, not carried in)
      }
    }
  });

  it("rolls back cleanly: restore a snapshot and re-step (or go through JSON), and every hash matches", () => {
    const world = arena([10, 12, 3, 3, "O"]);
    const game = addCpus(createBattle(0, SPAWNS_4, { hearts: 4, timeLimit: 0, wins: 3 }, NO_PROPS, 8), (["hard", "normal", "easy", "hard"] as const).map((level, player) => ({ player, level })));
    (["bomb", "boomerang", "slingshot", "bow"] as const).forEach((item, i) => giveItem(game.battle!.fighters[i]!, item));
    startRide(game.players[1]!, game.battle!.fighters[1]!); // (on Epona)
    const humansOf = (t: number) => [t % 7 === 0 ? Button.Sword : 0]; // P1 is a CPU too: ignored
    for (let t = 0; t < 3000; t++) {
      if (t % 250 === 125) {
        // An 8-frame rollback: snapshot, step on, restore the snapshot and step the same frames again.
        const snapshot = cloneGame(game), json = JSON.parse(JSON.stringify(game)) as GameState;
        const ahead: number[] = [];
        for (let k = 0; k < 8; k++) (stepGame(game, cpuInputs(game, world, humansOf(t + k)), world), ahead.push(hashGame(game)));
        for (const from of [cloneGame(snapshot), json]) {
          const again: number[] = [];
          for (let k = 0; k < 8; k++) (stepGame(from, cpuInputs(from, world, humansOf(t + k)), world), again.push(hashGame(from)));
          expect(again).toEqual(ahead);
        }
        t += 7;
        continue;
      }
      stepGame(game, cpuInputs(game, world, humansOf(t)), world);
    }
    assertIntegers(game);
  });
});

const root = new URL("../../../extracted/", import.meta.url);
const boss500 = new URL("files/GC4Sword_usa/Boss/boss500.arc", root);
const dol = new URL("sys/main.dol", root);

describe.skipIf(!existsSync(boss500) || !existsSync(dol))("CPU players on the real arenas (extracted/)", () => {
  const stage = new Stage(parseRarc(decompressYaz0(readFileSync(boss500))));
  const tileTypes = readTileTypes(new Dol(readFileSync(dol)));
  const worlds = new Map<number, { world: World; props: ArenaProps }>();
  const arenaOf = (room: number) => worlds.get(room) ?? worlds.set(room, { world: buildArenaWorld(stage, tileTypes, room), props: arenaProps(stage, tileTypes, room) }).get(room)!;
  const LEVELS: CpuLevel[] = ["easy", "normal", "hard", "normal"];

  it("every arena: 4 CPUs finish a match in time, none stuck, the state all integers; they rarely walk into a pit", () => {
    let walkedIn = 0, knocked = 0, rounds = 0, matches = 0;
    for (const room of ARENA_ROOMS) {
      for (const seed of [1, 2]) {
        const { world, props } = arenaOf(room);
        const game = addCpus(createBattle(room, arenaSpawns(stage, room).slice(0, 4), { hearts: 4, timeLimit: 0, wins: 2 }, props, seed * 7919), LEVELS.map((level, player) => ({ player, level })));
        const still = [0, 0, 0, 0], longest = [0, 0, 0, 0], last = game.players.map((p) => p.x * 65536 + p.y), before = game.battle!.fighters.map((f) => `${f.mode}/${f.move}`);
        // (The Tower of Winds is side view, as in the game: knockbacks drop the Links off its ledges and its seeds stun,
        // so its rounds run two or three times as long; so do the fights that move into a side-view side room, the
        // Tower of Flames' basement or the room under Above the Clouds' hole.)
        const ticks = play(game, world, props.sideViews ? 60_000 : 30_000, undefined, (g) => {
          const b = g.battle!;
          g.players.forEach((p, i) => {
            const f = b.fighters[i]!, at = p.x * 65536 + p.y;
            still[i] = b.phase === "play" && f.mode === "active" && at === last[i] ? still[i]! + 1 : 0;
            longest[i] = Math.max(longest[i]!, still[i]!);
            last[i] = at;
            // Walking (or rolling, riding, carrying) into a pit, not knocked, thrown or pushed (a block, a clash) into one.
            if (f.mode === "falling" && !before[i]!.startsWith("falling")) {
              if (/^active\/(none|ready|roll|ride|carry)$/.test(before[i]!)) walkedIn++;
              else knocked++;
            }
            before[i] = f.slideX || f.slideY ? "pushed" : `${f.mode}/${f.move}`;
          });
          if (g.tick % 600 === 0) assertIntegers(g);
        });
        const b = game.battle!;
        expect(b.phase, `${arenaName(room)} seed ${seed}: not over after ${ticks} ticks`).toBe("matchOver");
        expect(Math.max(...longest), `${arenaName(room)} seed ${seed}: a CPU stood still ${Math.max(...longest)} ticks`).toBeLessThan(600);
        assertIntegers(game);
        rounds += b.round;
        matches++;
      }
    }
    console.log(`4 CPUs, ${matches} matches (${rounds} rounds): ${walkedIn} walked into a pit, ${knocked} knocked or thrown in`);
    // (A statistical bound: the count moves by a few with any change to the arenas, the items or the pushes; seeds 1-8,
    // 80 matches, gave 15 walk-ins once pushes slid round corners, 10 before.)
    expect(walkedIn).toBeLessThanOrEqual(8);
  }, 120_000);

  it("a hard CPU beats an easy one more often than not, and a normal one beats a Link who does nothing", () => {
    // The Link "doing nothing" steers out of a hole when he's shot back up (siderooms.ts): with no input at all he'd fall
    // back in every time, as in the game, for as long as the match lasts.
    const passive = (game: GameState) =>
      game.battle!.fighters.map((f, i) => {
        const p = game.players[i]!;
        return launchFlying(f) ? (p.x / SUBPX < f.spawnX ? Button.Right : Button.Left) | (p.y / SUBPX < f.spawnY ? Button.Down : Button.Up) : 0;
      });
    const duel = (levels: (CpuLevel | null)[], room: number, seed: number) => {
      const { world, props } = arenaOf(room);
      const game = createBattle(room, arenaSpawns(stage, room).slice(0, 2), { hearts: 4, timeLimit: 0, wins: 1 }, props, seed * 104729 + room);
      addCpus(game, levels.flatMap((level, player) => (level ? [{ player, level }] : [])));
      play(game, world, 20_000, passive);
      return game.battle!.matchWinner;
    };
    // Six seeds per arena (120 duels): the share is noisy, and small changes to an arena (its side rooms' props, the
    // CPUs keeping out of doors, Hyrule Castle's fewer soldiers in a 2-player match) move a 40-duel count by a few.
    let hard = 0, easy = 0, idleBeaten = 0, n = 0;
    for (const room of ARENA_ROOMS) {
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        // Both ways round: the spawns differ.
        const a = duel(["hard", "easy"], room, seed), z = duel(["easy", "hard"], room, seed);
        hard += (a === 0 ? 1 : 0) + (z === 1 ? 1 : 0);
        easy += (a === 1 ? 1 : 0) + (z === 0 ? 1 : 0);
        idleBeaten += duel([null, "normal"], room, seed) === 1 ? 1 : 0;
        n++;
      }
    }
    console.log(`hard vs easy: ${hard}-${easy} of ${2 * n}; normal vs a Link doing nothing: ${idleBeaten}/${n}`);
    expect(hard).toBeGreaterThan(easy);
    expect(hard).toBeGreaterThanOrEqual(1.05 * n); // 52.5% (57.5% when written; 53% with the items as traced)
    expect(idleBeaten).toBe(n);
  }, 120_000);

  it("a hard CPU calls the bombchus itself: a bomb on the south room's crystal (Tower of Flames), the pot switches (Tower of Winds, Dark World)", () => {
    // Against three easy CPUs (which never use the switches); the calls counted are the hard CPU's: the trigger's switch
    // turned on with it standing on the floor switch, or by the blast of its own bomb on the crystal.
    for (const [room, seed] of [[1, 1], [7, 1]] as const) {
      const { world, props } = arenaOf(room);
      const game = addCpus(createBattle(room, arenaSpawns(stage, room).slice(0, 4), { hearts: 4, timeLimit: 0, wins: 1 }, props, seed), (["hard", "easy", "easy", "easy"] as const).map((level, player) => ({ player, level })));
      const calls = switchTriggers(props).filter((tr) => tr.effects.some((ef) => ef.attack === "bombchus"));
      let called = 0, before = game.battle!.switches;
      play(game, world, 20_000, undefined, (g) => {
        const b = g.battle!, p = g.players[0]!;
        for (const tr of calls) {
          const n = ownSwitch(props.actors[tr.prop]!.params);
          if (!switchOn(b, n) || (before >>> n) & 1) continue;
          const pressed = !tr.crystal && Math.abs(p.x / SUBPX - tr.x) <= 8 && Math.abs(p.y / SUBPX - tr.y) <= 8;
          const blasted = tr.crystal && b.entities.some((e) => e.kind === "explosion" && e.owner === 0 && Math.abs(e.x / SUBPX - tr.x) <= 24 && Math.abs(e.y / SUBPX - tr.y) <= 24);
          if (pressed || blasted) called++;
        }
        before = b.switches;
      });
      console.log(`${arenaName(room)}: the hard CPU called the bombchus ${called} times`);
      expect(called, arenaName(room)).toBeGreaterThan(0);
    }
  }, 60_000);

  it("the Tower of Winds' gallery: a hard CPU with bombs lights its four crystals (two bombs thrown up, 100 ticks apart): the giant-bomb Shadow Link", () => {
    // (The arena's generators hold no bombs: here the CPU is given them.) Its three rivals are on the TV.
    const { world, props } = arenaOf(2);
    for (const level of ["hard", "normal", "easy"] as const) {
      const game = createBattle(2, [{ x: 200, y: 792, facing: "right" as const }, ...arenaSpawns(stage, 2).slice(1, 4)], { hearts: 4, timeLimit: 0, wins: 1 }, props, 9);
      addCpus(game, [{ player: 0, level }]);
      giveItem(game.battle!.fighters[0]!, "bomb");
      let lit = -1;
      play(game, world, COUNTDOWN_TICKS + 1500, () => [0, 0, 0, 0], (g) => {
        if (lit < 0 && switchOn(g.battle!, 21)) lit = g.tick;
      });
      console.log(`${level}: the gallery's crystals all lit at tick ${lit}`);
      if (level === "easy") expect(lit).toBe(-1);
      else expect(lit, level).toBeGreaterThan(0);
    }
  });

  it("the colored panels (Above the Clouds) split the arena for everyone but the Link of their color", () => {
    const { world, props } = arenaOf(4);
    const closed = navGrid(world, props), open = navGrid(world, props, true);
    const inside = nearestWalkable(closed, 248, 200, 3), outside = nearestWalkable(closed, 100, 70, 3);
    expect(region(closed, inside)).not.toBe(region(closed, outside));
    expect(region(open, inside)).toBe(region(open, outside));
  });
});
