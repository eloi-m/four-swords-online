// The online battle over the rollback netcode on simulated bad networks: every peer bit-identical, a departed
// player's Link taken out at the same frame everywhere, CPU players played alike by every peer and spectator, and
// (with extracted/) a real arena fought to the match's end.
import { existsSync, readFileSync } from "node:fs";
import { decompressYaz0, Dol, MAP_GRID, parseRarc, readTileTypes, Stage } from "@fso/formats";
import { decodeState, encodeState, fromBase64, toBase64 } from "@fso/net";
import { appliedInputs, replay, runMatch } from "@fso/net/testing";
import { arenaProps, arenaSpawns, buildArenaWorld, Button, COUNTDOWN_TICKS, createBattle, hashGame, ROUND_OVER_TICKS, SUBPX, type GameState, type World } from "@fso/sim";
import { describe, expect, it } from "vitest";
import {
  battleGame,
  cleanConfig,
  cpuSlots,
  DEFAULT_CONFIG,
  freeSpots,
  initialBattle,
  initialFree,
  ONLINE_VERSION,
  parseConfig,
  PLAYER_LEFT,
  retire,
  AUTO_DELAY,
  delayOptions,
  MAX_DELAY,
  type FreeSpot,
  type MatchConfig,
} from "./online-game.ts";

describe("match config", () => {
  it("accepts the host's settings and refuses bad or foreign ones", () => {
    expect(parseConfig({ ...DEFAULT_CONFIG, arena: 7, hearts: 6, time: 120, wins: 5, delay: 3 })).toEqual({ v: ONLINE_VERSION, arena: 7, hearts: 6, time: 120, wins: 5, delay: 3, cpus: [] });
    expect(parseConfig({ ...DEFAULT_CONFIG, cpus: ["easy", "hard"] }).cpus).toEqual(["easy", "hard"]);
    expect(() => parseConfig({ ...DEFAULT_CONFIG, cpus: ["impossible"] })).toThrow(/CPU/);
    expect(() => parseConfig({ ...DEFAULT_CONFIG, cpus: ["easy", "easy", "easy", "easy"] })).toThrow(/CPU/);
    expect(() => parseConfig({ ...DEFAULT_CONFIG, v: 3 })).toThrow(/another version/); // before CPU players
    expect(() => parseConfig({ ...DEFAULT_CONFIG, v: ONLINE_VERSION + 1 })).toThrow(/another version/);
    expect(() => parseConfig({ ...DEFAULT_CONFIG, v: 1 })).toThrow(/another version/); // before arena props and the seed
    expect(() => parseConfig(null)).toThrow(/another version/);
    expect(() => parseConfig({ ...DEFAULT_CONFIG, arena: 10 })).toThrow(/arena/);
    expect(() => parseConfig({ ...DEFAULT_CONFIG, hearts: 5 })).toThrow(/hearts/);
    expect(() => parseConfig({ ...DEFAULT_CONFIG, time: 1.5 })).toThrow(/time/);
    expect(() => parseConfig({ ...DEFAULT_CONFIG, delay: 20 })).toThrow(/delay/);
    expect(() => parseConfig({ ...DEFAULT_CONFIG, delay: -2 })).toThrow(/delay/);
    // The input delay adapting to each peer's connection by default (the session's adaptiveDelay), or fixed.
    expect([DEFAULT_CONFIG.delay, parseConfig(DEFAULT_CONFIG).delay]).toEqual([AUTO_DELAY, AUTO_DELAY]);
    expect(delayOptions(DEFAULT_CONFIG)).toEqual({ inputDelay: 2, adaptiveDelay: { min: 1, max: MAX_DELAY } });
    expect(delayOptions({ ...DEFAULT_CONFIG, delay: 3 })).toEqual({ inputDelay: 3 });
    expect(cleanConfig({ arena: 42, hearts: 6, time: -1, wins: 2 })).toEqual({ ...DEFAULT_CONFIG, hearts: 6, wins: 2 });
    expect(cleanConfig({ cpus: ["normal", "bad" as "easy"] }).cpus).toEqual([]);
    // CPUs take the slots the room's players leave, up to 4 Links.
    const three = cleanConfig({ cpus: ["easy", "normal", "hard"] });
    expect([1, 2, 3, 4].map((humans) => cpuSlots(three, humans))).toEqual([["easy", "normal", "hard"], ["easy", "normal"], ["easy"], []]);
  });

  it("a free room's configs: free play with the Links' places, a battle for everyone; bad places are refused", () => {
    const at: FreeSpot[] = [[1, 100, 200, "down"], [7, 1023, 767, "left"]];
    expect(parseConfig({ ...DEFAULT_CONFIG, mode: "free", at })).toEqual({ ...DEFAULT_CONFIG, mode: "free", at });
    expect(parseConfig({ ...DEFAULT_CONFIG, mode: "free" })).toEqual({ ...DEFAULT_CONFIG, mode: "free" });
    expect(parseConfig({ ...DEFAULT_CONFIG, mode: "battle" }).mode).toBe("battle");
    expect(parseConfig(DEFAULT_CONFIG)).not.toHaveProperty("mode");
    expect(() => parseConfig({ ...DEFAULT_CONFIG, mode: "chaos" })).toThrow(/mode/);
    const bad: unknown[] = [
      [[1, 100, 200]], // no facing
      [[1, 100, 200, "north"]],
      [[0, 100, 200, "down"]], // member ids are 1-255
      [[256, 100, 200, "down"]],
      [[1, 100, 200, "down"], [1, 300, 200, "up"]], // twice the same member
      [[1, 1024, 200, "down"]], // off the 1024×768 map
      [[1, 100, -1, "down"]],
      [[1, 100.5, 200, "down"]],
      Array.from({ length: 9 }, (_, i) => [i + 1, 100 + 40 * i, 200, "down"]),
      "everyone",
    ];
    for (const b of bad) expect(() => parseConfig({ ...DEFAULT_CONFIG, mode: "free", at: b }), JSON.stringify(b)).toThrow(/places/);
    expect(() => parseConfig({ ...DEFAULT_CONFIG, mode: "battle", at })).toThrow(/places/); // (only free play has them)
    expect(() => parseConfig({ ...DEFAULT_CONFIG, at })).toThrow(/places/);
  });
});

describe("free rooms", () => {
  const FREE: MatchConfig = { ...DEFAULT_CONFIG, mode: "free" };

  it("free play restarts with the Links in `at` where they stood and the newcomers apart from them", () => {
    const world = openArena();
    const first = initialFree(world, FREE, [3, 5], 11);
    expect(first.battle!.phase).toBe("free");
    // Everyone walks a while; then member 9 joins and member 3 leaves: 5 stays put, 9 lands somewhere free.
    const game = battleGame(world);
    for (let f = 0; f < 90; f++) game.step(first, [Button.Left, Button.Up | Button.Right]);
    const spots = freeSpots(first, [3, 5]);
    expect(spots.map((s) => s[0])).toEqual([3, 5]);
    const config = parseConfig({ ...FREE, at: spots.filter((s) => s[0] !== 3) });
    const next = initialFree(world, config, [5, 9], 12);
    expect(next).toEqual(initialFree(world, config, [5, 9], 12));
    const [p5, p9] = next.players;
    expect([p5!.x / SUBPX, p5!.y / SUBPX, p5!.facing]).toEqual(spots[1]!.slice(1));
    expect(Math.abs(p9!.x - p5!.x) + Math.abs(p9!.y - p5!.y)).toBeGreaterThanOrEqual(32 * SUBPX);
    expect(next.battle!.rng).toBe(12);
  });

  it("a player who leaves free play is out until his inputs come back (a rejoin); the others keep their hearts whatever hits them", () => {
    const world = openArena();
    const state = initialFree(world, FREE, [1, 2, 3], 5);
    const game = battleGame(world);
    for (let f = 0; f < 200; f++) game.step(state, [f % 20 < 2 ? Button.Sword : Button.Right, PLAYER_LEFT, f % 16 < 2 ? Button.Sword : Button.Left]);
    const [a, gone, c] = state.battle!.fighters;
    expect([gone!.mode, gone!.hearts]).toEqual(["dead", 0]);
    expect([a!.hearts, c!.hearts]).toEqual([DEFAULT_CONFIG.hearts * 4, DEFAULT_CONFIG.hearts * 4]);
    expect(state.battle!.phase).toBe("free");
    expect(freeSpots(state, [1, 2, 3]).map((s) => s[0])).toEqual([1, 3]);
    // He rejoins (his inputs come back): his Link is in again where it stood, as new.
    const at = { x: state.players[1]!.x, y: state.players[1]!.y };
    game.step(state, [0, 0, 0]);
    const back = state.battle!.fighters[1]!;
    expect([back.mode, back.hearts]).toEqual(["active", DEFAULT_CONFIG.hearts * 4]);
    expect({ x: state.players[1]!.x, y: state.players[1]!.y }).toEqual(at);
    expect(freeSpots(state, [1, 2, 3]).map((s) => s[0])).toEqual([1, 2, 3]);
  });

  it("a free room's battle takes up to 8 Links, the arena's 4 starts and 4 more beyond them; a room's own stays at 4", () => {
    const spawns = [
      { x: 120, y: 150, facing: "right" as const },
      { x: 390, y: 150, facing: "left" as const },
      { x: 120, y: 260, facing: "right" as const },
      { x: 390, y: 260, facing: "left" as const },
    ];
    const battle = { ...DEFAULT_CONFIG, mode: "battle" as const };
    const eight = initialBattle(spawns, battle, 8, 1);
    expect(eight.players.length).toBe(8);
    expect(eight.battle!.phase).toBe("countdown");
    expect(eight.players.slice(4).map((p) => [p.x / SUBPX, p.y / SUBPX])).toEqual([[52, 122], [457, 122], [52, 287], [457, 287]]);
    expect(initialBattle(spawns, battle, 5, 1).players.length).toBe(5);
    expect(() => initialBattle(spawns, battle, 9, 1)).toThrow(/2-8/);
    expect(() => initialBattle(spawns, DEFAULT_CONFIG, 5, 1)).toThrow(/2-4/);
  });

  it("free play over the netcode, 5 players at 60±30 ms / 10% loss, P4 crashing: bit-identical, his Link out everywhere", () => {
    const world = openArena();
    const game = battleGame(world);
    const initial = () => initialFree(world, FREE, [1, 2, 3, 4, 5], 99);
    const r = runMatch<GameState>({
      game,
      initial,
      players: 5,
      conditions: { latency: 60, jitter: 30, loss: 0.1 },
      seed: 21,
      duration: 12_000,
      input: wander,
      inputUntil: 600,
      session: { disconnectedInput: PLAYER_LEFT },
      peers: [{}, {}, {}, { crashAt: 4_000 }, {}],
    });
    const live = r.sessions.filter((_, p) => p !== 3);
    const frames = Math.min(...live.map((s) => s.finalizedFrame));
    expect(frames).toBeGreaterThan(500);
    const ref = replay(game, initial(), 5, frames, appliedInputs(live[0]!, PLAYER_LEFT));
    for (const p of [0, 1, 2, 4]) expect(r.finals[p]!.slice(0, frames + 1).findIndex((h, f) => h !== ref[f]), `peer ${p}`).toBe(-1);
    for (const s of live) {
      expect(s.state.battle!.fighters[3]!.mode).toBe("dead");
      expect(s.state.battle!.fighters.filter((f) => f.mode !== "dead").every((f) => f.hearts === DEFAULT_CONFIG.hearts * 4)).toBe(true);
    }
  });
});

// An open 512×384 arena with a wall border (8×8 cells).
function openArena(): World {
  const widthCells = 64, heightCells = 48;
  const solid = new Uint8Array(widthCells * heightCells);
  for (let x = 0; x < widthCells; x++) solid[x] = solid[(heightCells - 1) * widthCells + x] = 1;
  for (let y = 0; y < heightCells; y++) solid[y * widthCells] = solid[y * widthCells + widthCells - 1] = 1;
  const rooms = new Int16Array(MAP_GRID * MAP_GRID).fill(-1);
  rooms[0] = 0;
  return { widthCells, heightCells, solid, surface: new Uint8Array(solid.length), rooms };
}

/** Walks and swings at random, changing every 6-20 frames. */
const wander = (player: number, frame: number): number => {
  const seg = Math.floor(frame / (6 + player * 5));
  let v = Math.imul(seg + 1, 0x9e3779b1) ^ Math.imul(player + 3, 0x85ebca6b);
  v = Math.imul(v ^ (v >>> 16), 0x7feb352d);
  v ^= v >>> 15;
  const dirs = [Button.Up, Button.Down, Button.Left, Button.Right, Button.Up | Button.Left, Button.Down | Button.Right, 0];
  return dirs[(v >>> 0) % dirs.length]! | ((v >>> 8) % 3 === 0 ? Button.Sword : 0);
};

describe("online battle over the netcode", () => {
  it("3 players, 60±30 ms, 10% loss; P3 crashes mid-round: his Link is out at the same frame everywhere, for good", () => {
    const world = openArena();
    const spawns = [
      { x: 120, y: 150, facing: "right" as const },
      { x: 390, y: 150, facing: "left" as const },
      { x: 120, y: 260, facing: "right" as const },
    ];
    const rules = { hearts: 6, timeLimit: 5 * 60, wins: 3, vaatiBomb: false }; // rounds end at the time-out
    const game = battleGame(world);
    const r = runMatch<GameState>({
      game,
      initial: () => createBattle(0, spawns, rules),
      players: 3,
      conditions: { latency: 60, jitter: 30, loss: 0.1 },
      seed: 7,
      duration: 30_000,
      input: wander,
      inputUntil: 1000,
      session: { disconnectedInput: PLAYER_LEFT },
      peers: [{}, {}, { crashAt: 9_000 }],
    });
    const [a, b] = r.sessions;
    const cut = a!.cutFrame(2);
    expect(cut).toBeGreaterThan(COUNTDOWN_TICKS);
    expect(b!.cutFrame(2)).toBe(cut);
    const frames = Math.min(a!.finalizedFrame, b!.finalizedFrame);
    expect(frames).toBeGreaterThan(COUNTDOWN_TICKS + rules.timeLimit + ROUND_OVER_TICKS + 100); // into round 2
    const ref = replay(game, createBattle(0, spawns, rules), 3, frames, appliedInputs(a!, PLAYER_LEFT));
    for (const p of [0, 1]) {
      const bad = r.finals[p]!.slice(0, frames + 1).findIndex((h, f) => h !== ref[f]);
      expect(bad, `peer ${p} diverges at frame ${bad}`).toBe(-1);
      expect(r.sessions[p]!.stats.desyncs).toBe(0);
    }
    // Replay by hand: P3 is in until his cut, out from the next frame, and stays out in round 2.
    let state = createBattle(0, spawns, rules);
    const inputs = appliedInputs(a!, PLAYER_LEFT);
    for (let f = 0; f < frames; f++) {
      state = game.step(state, [0, 1, 2].map((p) => inputs(p, f)));
      const f3 = state.battle!.fighters[2]!;
      if (f <= cut) expect(f3.hearts, `frame ${f + 1}`).toBeGreaterThan(0);
      else expect([f3.hearts, f3.mode], `frame ${f + 1}`).toEqual([0, "dead"]);
    }
    expect(state.battle!.round).toBe(2);
    expect(state.battle!.fighters.slice(0, 2).every((f) => f.hearts > 0)).toBe(true);
  });

  it("3 players among hazards, orbs and items, 60±30 ms, 15% loss: every peer bit-identical through the rollbacks", () => {
    const world = openArena();
    const props = {
      actors: [
        { id: "HBMB", x: 200, y: 200, params: 0x101 },
        { id: "HBMB", x: 216, y: 200, params: 0x101 },
        { id: "BLZ2", x: 300, y: 100, params: 0x70000013 },
        { id: "FBMR", x: 256, y: 300, params: 0x42220008 },
        { id: "FBMR", x: 256, y: 300, params: 0x42220108 },
        { id: "SLR1", x: 420, y: 300, params: 0x1002 },
        { id: "CRGN", x: 256, y: 150, params: 1 },
        { id: "CRGN", x: 150, y: 300, params: 1 },
      ],
      bushes: [],
    };
    const spawns = [
      { x: 120, y: 150, facing: "right" as const },
      { x: 390, y: 150, facing: "left" as const },
      { x: 120, y: 260, facing: "right" as const },
    ];
    const config = cleanConfig({ hearts: 6, wins: 3 });
    const initial = () => {
      const state = initialBattle(spawns, config, 3, 99, props);
      // Everyone starts with an item, so bombs, arrows and the boomerang fly while the peers roll back.
      (["bomb", "bow", "boomerang"] as const).forEach((item, i) => (state.battle!.fighters[i]!.item = item));
      return state;
    };
    // wander() plus Action and Item presses.
    const input = (p: number, f: number) => wander(p, f) | ((f + p * 7) % 23 === 0 ? Button.Action : 0) | ((f + p * 5) % 31 === 0 ? Button.Item : 0);
    const game = battleGame(world);
    const r = runMatch<GameState>({
      game,
      initial,
      players: 3,
      conditions: { latency: 60, jitter: 30, loss: 0.15 },
      seed: 11,
      duration: 16_000,
      input,
      inputUntil: 900,
      session: { disconnectedInput: PLAYER_LEFT },
    });
    const frames = Math.min(...r.sessions.map((s) => s.finalizedFrame));
    expect(frames).toBeGreaterThan(800);
    const ref = replay(game, initial(), 3, frames, appliedInputs(r.sessions[0]!, PLAYER_LEFT));
    for (let p = 0; p < 3; p++) {
      const bad = r.finals[p]!.slice(0, frames + 1).findIndex((h, f) => h !== ref[f]);
      expect(bad, `peer ${p} diverges at frame ${bad}`).toBe(-1);
      expect(r.sessions[p]!.stats.desyncs).toBe(0);
      expect(r.sessions[p]!.stats.rollbacks).toBeGreaterThan(10);
    }
    // The match used the new things.
    const kinds = new Set<string>();
    let state = initial();
    const inputs = appliedInputs(r.sessions[0]!, PLAYER_LEFT);
    for (let f = 0; f < frames; f++) {
      state = game.step(state, [0, 1, 2].map((p) => inputs(p, f)));
      for (const e of state.battle!.entities) kinds.add(e.kind);
      for (const fi of state.battle!.fighters) kinds.add(`move:${fi.move}`);
    }
    for (const k of ["bomb", "arrow", "boomerang", "firebar", "flame", "soldier", "orb", "move:ready", "move:use"]) expect(kinds, k).toContain(k);
  });

  it("2 players and 2 CPUs, 60±30 ms, 10% loss, a spectator joining mid-match: everyone agrees on every frame", () => {
    const world = openArena();
    const spawns = [
      { x: 120, y: 150, facing: "right" as const },
      { x: 390, y: 150, facing: "left" as const },
      { x: 120, y: 260, facing: "right" as const },
      { x: 390, y: 260, facing: "left" as const },
    ];
    const config = cleanConfig({ hearts: 4, wins: 3, cpus: ["normal", "hard"] });
    const initial = () => initialBattle(spawns, config, 2, 31);
    expect(initial().battle!.cpus!.map((c) => [c.player, c.level])).toEqual([[2, "normal"], [3, "hard"]]);
    const game = battleGame(world);
    const r = runMatch<GameState>({
      game,
      initial,
      players: 2,
      conditions: { latency: 60, jitter: 30, loss: 0.1 },
      seed: 5,
      duration: 26_000,
      input: wander,
      inputUntil: 1300,
      session: { disconnectedInput: PLAYER_LEFT },
      spectators: [{ host: 0, join: 4_000 }],
    });
    const frames = Math.min(...r.sessions.map((s) => s.finalizedFrame));
    expect(frames).toBeGreaterThan(1300);
    const ref = replay(game, initial(), 2, frames, appliedInputs(r.sessions[0]!, PLAYER_LEFT));
    for (let p = 0; p < 2; p++) {
      const bad = r.finals[p]!.slice(0, frames + 1).findIndex((h, f) => h !== ref[f]);
      expect(bad, `peer ${p} diverges at frame ${bad}`).toBe(-1);
      expect(r.sessions[p]!.stats.desyncs).toBe(0);
      expect(r.sessions[p]!.stats.rollbacks).toBeGreaterThan(10);
    }
    const seen = r.spectatorFinals[0]!.slice(0, frames + 1);
    expect(seen.filter((h) => h !== undefined).length).toBeGreaterThan(1000);
    expect(seen.findIndex((h, f) => h !== undefined && h !== ref[f])).toBe(-1);
    // The CPUs played: they walked, swung and landed hits.
    let state = initial();
    const inputs = appliedInputs(r.sessions[0]!, PLAYER_LEFT);
    const cpuHits = [0, 0];
    for (let f = 0; f < frames; f++) {
      state = game.step(state, [0, 1].map((p) => inputs(p, f)));
      for (const h of state.battle!.hits) if (h.attacker >= 2 && !h.blocked) cpuHits[h.attacker - 2]!++;
    }
    expect(cpuHits.every((n) => n > 0), `CPU hits ${cpuHits}`).toBe(true);
  });

  it("1 player and 3 CPUs (a lone phone): the CPUs play on after the player's cut, and a spectator follows", () => {
    const world = openArena();
    const spawns = [
      { x: 120, y: 150, facing: "right" as const },
      { x: 390, y: 150, facing: "left" as const },
      { x: 120, y: 260, facing: "right" as const },
      { x: 390, y: 260, facing: "left" as const },
    ];
    const config = cleanConfig({ hearts: 2, wins: 1, cpus: ["easy", "normal", "hard"] });
    const initial = () => initialBattle(spawns, config, 1, 77);
    const game = battleGame(world);
    const r = runMatch<GameState>({
      game,
      initial,
      players: 1,
      conditions: { latency: 40, jitter: 10, loss: 0.05 },
      seed: 9,
      duration: 90_000,
      input: (_, f) => (f < 200 ? wander(0, f) : 0),
      session: { disconnectedInput: PLAYER_LEFT },
      spectators: [{ host: 0, join: 1_000 }],
    });
    const s = r.sessions[0]!;
    expect(s.state.battle!.phase).toBe("matchOver"); // decided among the CPUs (or P1, if they left him standing)
    expect(s.state.battle!.fighters.slice(1).some((f) => f.stars > 0) || s.state.battle!.fighters[0]!.stars > 0).toBe(true);
    const seen = r.spectatorFinals[0]!;
    const ref = replay(game, initial(), 1, s.finalizedFrame, appliedInputs(s, PLAYER_LEFT));
    expect(seen.findIndex((h, f) => h !== undefined && h !== ref[f])).toBe(-1);
    expect(seen.filter((h) => h !== undefined).length).toBeGreaterThan(s.finalizedFrame - 200);
  });

  it("a 2-player round resolves when the other player leaves", () => {
    const world = openArena();
    const state = createBattle(0, [{ x: 120, y: 150, facing: "right" }, { x: 390, y: 150, facing: "left" }], { hearts: 4, timeLimit: 0, wins: 2 });
    const game = battleGame(world);
    for (let f = 0; f < COUNTDOWN_TICKS + 10; f++) game.step(state, [0, 0]);
    game.step(state, [Button.Right, PLAYER_LEFT]);
    expect(state.battle).toMatchObject({ phase: "roundOver", roundWinner: 0 });
    expect(state.battle!.fighters[0]!.stars).toBe(1);
  });

  it("a player who leaves while holding a Link, or being held, frees the other at the same frame", () => {
    const world = openArena();
    const spawns = [
      { x: 120, y: 150, facing: "right" as const },
      { x: 136, y: 150, facing: "up" as const },
      { x: 390, y: 260, facing: "left" as const },
    ];
    for (const leaver of [0, 1]) {
      const state = createBattle(0, spawns, { hearts: 4, timeLimit: 0, wins: 2 });
      const game = battleGame(world);
      for (let f = 0; f < COUNTDOWN_TICKS; f++) game.step(state, [0, 0, 0]);
      game.step(state, [Button.Action, 0, 0]); // P1 lifts P2
      for (let f = 0; f < 30; f++) game.step(state, [0, 0, 0]);
      const [f1, f2] = state.battle!.fighters;
      expect([f1!.move, f1!.carryLink, f2!.move]).toEqual(["carry", 1, "held"]);
      const inputs = [0, 0, 0];
      inputs[leaver] = PLAYER_LEFT;
      for (let f = 0; f < 40; f++) game.step(state, inputs);
      const stay = state.battle!.fighters[1 - leaver]!, gone = state.battle!.fighters[leaver]!;
      expect([gone.hearts, gone.mode, gone.move, gone.carryLink, gone.heldBy]).toEqual([0, "dead", "none", -1, -1]);
      expect([stay.mode, stay.move, stay.carryLink, stay.heldBy, stay.z]).toEqual(["active", "none", -1, -1, 0]);
      expect(state.battle!.phase).toBe("play"); // two Links left
      const replayed = JSON.parse(JSON.stringify(state)) as GameState;
      expect(replayed).toEqual(state);
    }
  });

  it("the arena props and the lobby's seed are part of the initial state", () => {
    const props = { actors: [{ id: "CRGN", x: 256, y: 200, params: 1 }], bushes: [] };
    const spawns = [{ x: 120, y: 150, facing: "right" as const }, { x: 390, y: 150, facing: "left" as const }];
    const a = initialBattle(spawns, DEFAULT_CONFIG, 2, 42, props), b = initialBattle(spawns, DEFAULT_CONFIG, 2, 42, props);
    expect(a).toEqual(b);
    expect([a.battle!.props, a.battle!.rng]).toEqual([props, 42]);
    expect(initialBattle(spawns, DEFAULT_CONFIG, 2, 43, props).battle!.rng).toBe(43);
  });

  it("retire() leaves a Link already out alone", () => {
    const state = createBattle(0, [{ x: 50, y: 50, facing: "down" }, { x: 90, y: 50, facing: "down" }]);
    retire(state, 0b10);
    const snapshot = JSON.stringify(state);
    retire(state, 0b10);
    expect(JSON.stringify(state)).toBe(snapshot);
  });
});

const root = new URL("../../../extracted/", import.meta.url);
const boss500 = new URL("files/GC4Sword_usa/Boss/boss500.arc", root);
const dol = new URL("sys/main.dol", root);

describe.skipIf(!existsSync(boss500) || !existsSync(dol))("online battle on a real arena (extracted/)", () => {
  // The switch network (logic actors, random pickers, spawners, circles, colored panels) through rollbacks: Hyrule
  // Castle's soldier and circle chains, and Above the Clouds' panels, orb pickers and fire bars, with the arenas' props.
  it("the arenas' switch logic, 3 peers at 60±30 ms / 15% loss: bit-identical through the rollbacks", () => {
    const stage = new Stage(parseRarc(decompressYaz0(readFileSync(boss500))));
    const tileTypes = readTileTypes(new Dol(readFileSync(dol)));
    for (const room of [3, 9]) {
      const world = buildArenaWorld(stage, tileTypes, room);
      const props = arenaProps(stage, tileTypes, room);
      const config = cleanConfig({ arena: room, hearts: 6, wins: 3 });
      const initial = () => initialBattle(arenaSpawns(stage, room).slice(0, 3), config, 3, 777 + room, props);
      const game = battleGame(world);
      const r = runMatch<GameState>({
        game,
        initial,
        players: 3,
        conditions: { latency: 60, jitter: 30, loss: 0.15 },
        seed: room,
        duration: 22_000,
        input: wander,
        inputUntil: 1200,
        session: { disconnectedInput: PLAYER_LEFT },
      });
      const frames = Math.min(...r.sessions.map((s) => s.finalizedFrame));
      expect(frames).toBeGreaterThan(1100);
      const ref = replay(game, initial(), 3, frames, appliedInputs(r.sessions[0]!, PLAYER_LEFT));
      for (let p = 0; p < 3; p++) {
        const bad = r.finals[p]!.slice(0, frames + 1).findIndex((h, f) => h !== ref[f]);
        expect(bad, `room ${room}: peer ${p} diverges at frame ${bad}`).toBe(-1);
        expect(r.sessions[p]!.stats.desyncs).toBe(0);
      }
      // The logic ran: switches turned on, and (the castle) more soldiers came, (the clouds) the panels changed.
      const end = r.sessions[0]!.state.battle!;
      expect(end.switches, `room ${room}`).not.toBe(0);
      if (room === 3) expect(end.entities.some((e) => e.kind === "soldier" && e.home < 0)).toBe(true); // (a GEN3's)
      if (room === 9) expect(new Set(end.panels.map((v) => v >>> 16)).size + end.round).toBeGreaterThan(1);
    }
  }, 60_000);

  it("2 peers and 2 CPUs on the Tower of Flames and Above the Clouds, 60±30 ms / 15% loss: bit-identical through the rollbacks", () => {
    const stage = new Stage(parseRarc(decompressYaz0(readFileSync(boss500))));
    const tileTypes = readTileTypes(new Dol(readFileSync(dol)));
    for (const room of [1, 9]) {
      const world = buildArenaWorld(stage, tileTypes, room);
      const props = arenaProps(stage, tileTypes, room);
      const config = cleanConfig({ arena: room, hearts: 4, wins: 3, cpus: ["hard", "normal"] });
      const initial = () => initialBattle(arenaSpawns(stage, room), config, 2, 4242 + room, props);
      const game = battleGame(world);
      const r = runMatch<GameState>({
        game,
        initial,
        players: 2,
        conditions: { latency: 60, jitter: 30, loss: 0.15 },
        seed: 100 + room,
        duration: 24_000,
        input: wander,
        inputUntil: 1300,
        session: { disconnectedInput: PLAYER_LEFT },
        spectators: [{ host: 0, join: 2_000 }],
      });
      const frames = Math.min(...r.sessions.map((s) => s.finalizedFrame));
      expect(frames).toBeGreaterThan(1200);
      const ref = replay(game, initial(), 2, frames, appliedInputs(r.sessions[0]!, PLAYER_LEFT));
      for (let p = 0; p < 2; p++) {
        const bad = r.finals[p]!.slice(0, frames + 1).findIndex((h, f) => h !== ref[f]);
        expect(bad, `room ${room}: peer ${p} diverges at frame ${bad}`).toBe(-1);
        expect(r.sessions[p]!.stats.desyncs).toBe(0);
      }
      expect(r.spectatorFinals[0]!.findIndex((h, f) => h !== undefined && f <= frames && h !== ref[f])).toBe(-1);
      // The CPUs moved from their starts.
      const end = r.sessions[0]!.state;
      expect(end.players.slice(2).some((q, k) => q.x !== initial().players[2 + k]!.x || q.y !== initial().players[2 + k]!.y), `room ${room}`).toBe(true);
    }
  }, 60_000);

  // A rejoining player's snapshot (docs/netcode.md "Rejoining"): the state through the net codec, mid-fight on the
  // busiest arenas (props, switches, CPUs, entities), restores to the same hash and steps on identically.
  it("a battle state sent to a rejoining player restores exactly and plays on the same", () => {
    const stage = new Stage(parseRarc(decompressYaz0(readFileSync(boss500))));
    const tileTypes = readTileTypes(new Dol(readFileSync(dol)));
    for (const room of [0, 3, 9]) {
      const world = buildArenaWorld(stage, tileTypes, room);
      const config = cleanConfig({ arena: room, hearts: 4, cpus: ["hard"] });
      const game = battleGame(world);
      let state = initialBattle(arenaSpawns(stage, room).slice(0, 3), config, 2, 99 + room, arenaProps(stage, tileTypes, room));
      for (let f = 0; f < 1500; f++) state = game.step(state, [wander(0, f), f > 900 ? PLAYER_LEFT : wander(1, f)]);
      const bytes = encodeState(state);
      let copy = decodeState(fromBase64(toBase64(bytes))) as GameState;
      expect(hashGame(copy), `room ${room}`).toBe(hashGame(state));
      expect(bytes.length, `room ${room}`).toBeLessThan(48_000);
      for (let f = 1500; f < 1800; f++) {
        const inputs = [wander(0, f), PLAYER_LEFT];
        state = game.step(state, inputs);
        copy = game.step(copy, inputs);
        if (f % 30 === 0) expect(hashGame(copy), `room ${room} frame ${f}`).toBe(hashGame(state));
      }
      expect(hashGame(copy)).toBe(hashGame(state));
    }
  });

  it("Hyrule Castle, 2 hearts, 1 win, 60±30 ms / 10% loss: P1 knocks P2 out, both peers end on the same results", () => {
    const stage = new Stage(parseRarc(decompressYaz0(readFileSync(boss500))));
    const world = buildArenaWorld(stage, readTileTypes(new Dol(readFileSync(dol))), 3);
    const config = cleanConfig({ arena: 3, hearts: 2, wins: 1 });
    const initial = () => initialBattle(arenaSpawns(stage, 3), config, 2, 12345);
    const game = battleGame(world);
    // P1's inputs: a bot chasing P2 (who turns away, then stands still) played once without netcode.
    const script: number[][] = [];
    const bot = initial();
    for (let f = 0; f < 3000 && bot.battle!.phase !== "matchOver"; f++) {
      const [p1, p2] = bot.players, dx = (p2!.x - p1!.x) / 256, dy = (p2!.y - p1!.y) / 256;
      let b1 = 0;
      if (bot.battle!.phase === "play") {
        if (Math.abs(dy) > 3) b1 = dy > 0 ? Button.Down : Button.Up;
        else if (dx > 22) b1 = Button.Right;
        else if (dx < 10) b1 = Button.Left;
        else if (p1!.facing !== "right") b1 = Button.Right;
        else if (p1!.action === "none" && bot.battle!.fighters[1]!.invincible === 0 && !(p1!.held & Button.Sword)) b1 = Button.Sword;
      }
      const b2 = bot.battle!.phase === "play" && bot.battle!.phaseTick < 2 ? Button.Up : 0;
      script.push([b1, b2]);
      game.step(bot, [b1, b2]);
    }
    expect(bot.battle).toMatchObject({ phase: "matchOver", matchWinner: 0 });
    const r = runMatch<GameState>({
      game,
      initial,
      players: 2,
      conditions: { latency: 60, jitter: 30, loss: 0.1 },
      seed: 3,
      duration: (script.length + 200) * (1000 / 60),
      input: (p, f) => script[f]?.[p] ?? 0,
      session: { disconnectedInput: PLAYER_LEFT },
    });
    const frames = Math.min(...r.sessions.map((s) => s.finalizedFrame));
    expect(frames).toBeGreaterThanOrEqual(script.length);
    expect(r.finals[1]!.slice(0, frames + 1)).toEqual(r.finals[0]!.slice(0, frames + 1));
    for (const s of r.sessions) {
      expect(s.state.battle).toMatchObject({ phase: "matchOver", matchWinner: 0 });
      expect(s.state.battle!.fighters.map((f) => f.stars)).toEqual([1, 0]);
      expect(s.stats.desyncs).toBe(0);
      expect(s.stats.rollbacks).toBeGreaterThan(0);
    }
  });
});
