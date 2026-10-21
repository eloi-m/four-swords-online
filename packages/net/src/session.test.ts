import { describe, expect, it } from "vitest";
import { DELAY_MARGIN, FRAME_MS, RollbackSession, type SessionEvent } from "./session.ts";
import { appliedInputs, createToy, replay, runMatch, scriptedInput, SimNetwork, toyGame, type LinkConditions, type MatchOptions, type MatchResult, type ToyState } from "./testing.ts";
import type { RollbackGame } from "./types.ts";

const input = scriptedInput(7);
const BAD = { latency: 60, jitter: 40, loss: 0.2, duplicate: 0.05 };

function match(players: number, extra: Partial<MatchOptions<ToyState>> = {}): MatchResult<ToyState> {
  return runMatch<ToyState>({
    game: toyGame,
    initial: () => createToy(players),
    players,
    conditions: BAD,
    duration: 12_000,
    input,
    inputUntil: 500,
    ...extra,
  });
}

/**
 * Every listed peer reported the same final states, frame by frame, and they equal a plain replay of the inputs
 * the sessions agreed on. Returns how many frames were compared.
 */
function expectInSync(r: MatchResult<ToyState>, alive: number[], players: number): number {
  const frames = Math.min(...alive.map((p) => r.sessions[p]!.finalizedFrame));
  const ref = replay(toyGame, createToy(players), players, frames, appliedInputs(r.sessions[alive[0]!]!));
  for (const p of alive) {
    const finals = r.finals[p]!.slice(0, frames + 1);
    const firstBad = finals.findIndex((h, f) => h !== ref[f]);
    expect(firstBad, `peer ${p} diverges from the replay at frame ${firstBad}`).toBe(-1);
    expect(finals.length).toBe(frames + 1);
  }
  return frames;
}

const disconnects = (events: SessionEvent[]) => events.filter((e) => e.type === "disconnected");

describe("rollback session", () => {
  it("on a clean network with latency under the input delay: no rollback, no stall", () => {
    const r = match(2, { conditions: { latency: 20, jitter: 0, loss: 0 } });
    expect(expectInSync(r, [0, 1], 2)).toBeGreaterThan(700);
    for (const s of r.sessions) {
      expect(s.stats.rollbacks).toBe(0);
      expect(s.stats.predictionStalls + s.stats.syncStalls).toBe(0);
      expect(s.stats.hashChecks).toBeGreaterThanOrEqual(23);
      expect(s.peerInfo()[0]!.rtt).toBeCloseTo(40, 0);
    }
  });

  for (const players of [2, 3, 4]) {
    for (const seed of [1, 2, 3]) {
      it(`${players} players, 60±40 ms, 20% loss, 5% duplicates, reordering (seed ${seed}): all peers end bit-identical`, () => {
        const r = match(players, { seed });
        const all = Array.from({ length: players }, (_, p) => p);
        expect(expectInSync(r, all, players)).toBeGreaterThan(690);
        for (const s of r.sessions) {
          expect(s.stats.rollbacks).toBeGreaterThan(20); // latency > input delay: the predictions get corrected
          expect(s.stats.maxRollback).toBeLessThanOrEqual(s.maxPrediction);
          expect(s.stats.desyncs).toBe(0);
          expect(s.stats.hashChecks).toBeGreaterThanOrEqual(20 * (players - 1));
          expect(s.stats.bytesSent / s.stats.packetsSent).toBeLessThan(80);
        }
      });
    }
  }

  it("never predicts more than maxPrediction frames, even at 150±100 ms and 40% loss", () => {
    let worst = 0;
    const r = match(3, {
      conditions: { latency: 150, jitter: 100, loss: 0.4 },
      session: { maxPrediction: 6 },
      onTick: (p, sessions) => {
        const s = sessions[p]!;
        const remote = Math.min(...[0, 1, 2].filter((q) => q !== p).map((q) => s.inputLog(q).length - 1));
        worst = Math.max(worst, s.frame - 1 - remote);
      },
    });
    expectInSync(r, [0, 1, 2], 3);
    expect(worst).toBeLessThanOrEqual(6);
    for (const s of r.sessions) {
      expect(s.stats.maxRollback).toBeLessThanOrEqual(6);
      expect(s.stats.predictionStalls).toBeGreaterThan(0);
    }
  });

  it("time sync: a machine running 1% fast is held back to its opponent's pace", () => {
    const fast = { period: FRAME_MS / 1.01 };
    let lead = 0, leadNoSync = 0;
    const synced = match(2, { conditions: { latency: 40, jitter: 20, loss: 0.1 }, peers: [fast, {}], onTick: (_, s) => (lead = Math.max(lead, s[0]!.frame - s[1]!.frame)) });
    const unsynced = match(2, {
      conditions: { latency: 40, jitter: 20, loss: 0.1 },
      peers: [fast, {}],
      session: { syncThreshold: Infinity },
      onTick: (_, s) => (leadNoSync = Math.max(leadNoSync, s[0]!.frame - s[1]!.frame)),
    });
    expectInSync(synced, [0, 1], 2);
    expect(synced.sessions[0]!.stats.syncStalls).toBeGreaterThan(3);
    expect(synced.sessions[1]!.stats.syncStalls).toBe(0);
    expect(lead).toBeLessThanOrEqual(3);
    expect(leadNoSync).toBeGreaterThan(lead);
    expect(synced.sessions[0]!.stats.rollbackFrames).toBeLessThan(unsynced.sessions[0]!.stats.rollbackFrames);
  });

  it("a late starter: the early peer waits at the prediction limit, then both run in step", () => {
    const r = match(2, { conditions: { latency: 40, jitter: 20, loss: 0.1 }, peers: [{}, { start: 1000 }] });
    expectInSync(r, [0, 1], 2);
    expect(r.sessions[0]!.stats.predictionStalls).toBeGreaterThan(50);
    expect(Math.abs(r.sessions[0]!.frame - r.sessions[1]!.frame)).toBeLessThanOrEqual(2);
  });

  it("a crashed player is cut at the same frame by every survivor, who then play on in sync", () => {
    const r = match(3, { conditions: { latency: 40, jitter: 20, loss: 0.1 }, peers: [{}, {}, { crashAt: 3000 }] });
    expectInSync(r, [0, 1], 3);
    const [a, b] = [disconnects(r.events[0]!), disconnects(r.events[1]!)];
    expect(a.at(-1)).toMatchObject({ player: 2, reason: expect.any(String) });
    expect(r.sessions[0]!.cutFrame(2)).toBe(r.sessions[1]!.cutFrame(2));
    expect(r.sessions[0]!.cutFrame(2)).toBeGreaterThan(170);
    expect(a[0]!.type === "disconnected" && a[0]!.reason).toBe("timeout");
    expect(b.length).toBeGreaterThan(0);
    expect(r.events[0]!.some((e) => e.type === "interrupted")).toBe(true);
    expect(r.sessions[0]!.frame).toBeGreaterThan(500); // ~3 s frozen waiting for the timeout, then on again
  });

  it("a player leaving cleanly (bye) is cut at once, without waiting for the timeout", () => {
    const r = match(3, { conditions: { latency: 40, jitter: 20, loss: 0.1 }, peers: [{}, {}, { leaveAt: 3000 }] });
    expectInSync(r, [0, 1], 3);
    for (const p of [0, 1]) {
      expect(disconnects(r.events[p]!)[0]).toMatchObject({ player: 2, reason: "left" });
      expect(r.sessions[p]!.stats.predictionStalls).toBeLessThan(10);
      expect(r.sessions[p]!.frame).toBeGreaterThan(700);
    }
  });

  it("peers holding fewer of a crashed player's inputs get the rest relayed: every survivor applies the arbiter's cut", () => {
    // p1 stops hearing p3 half a second before p3 crashes, so it holds fewer of p3's inputs, and it has a longer
    // timeout: p0, the arbiter, cuts p3 after the last frame it holds, and relays p1 the inputs it lacks.
    let p1Held = Infinity;
    const r = match(4, {
      conditions: { latency: 40, jitter: 20, loss: 0.1 },
      peers: [{}, { session: { disconnectTimeout: 5000 } }, {}, { crashAt: 3000 }],
      onTick: (p, s, net) => {
        if (net.now > 2500) net.setLink("p3", "p1", { latency: 0, jitter: 0, loss: 1 });
        if (p === 1 && net.now > 3500 && p1Held === Infinity) p1Held = s[1]!.inputLog(3).length - 1;
      },
    });
    const alive = [0, 1, 2];
    expectInSync(r, alive, 4);
    const cut = r.sessions[0]!.cutFrame(3);
    for (const p of alive) {
      expect(r.sessions[p]!.cutFrame(3)).toBe(cut);
      expect(r.sessions[p]!.inputLog(3)).toEqual(r.sessions[0]!.inputLog(3)); // (p1's, relayed up to the cut)
    }
    expect(p1Held).toBeLessThan(160);
    expect(cut).toBeGreaterThan(p1Held + 10);
    // Nobody lowered the cut afterwards: one "disconnected" each, p0's own timeout, p1 and p2 from p0's packets.
    expect(disconnects(r.events[0]!).map((e) => e.type === "disconnected" && e.reason)).toEqual(["timeout"]);
    expect(disconnects(r.events[1]!).map((e) => e.type === "disconnected" && e.reason)).toEqual(["reported"]);
    for (const s of r.sessions.slice(0, 3)) {
      expect(s.stats.desyncs).toBe(0);
      expect(s.arbiter).toBe(0);
    }
  });

  it("detects a desync: hashes of settled frames are compared", () => {
    // Player 1's copy of the game drifts at frame 300 (as a nondeterministic sim would).
    const broken: RollbackGame<ToyState> = {
      ...toyGame,
      step: (s, inputs) => {
        toyGame.step(s, inputs);
        if (s.frame === 300) s.rng ^= 1;
        return s;
      },
    };
    const r = match(2, { gameFor: (p) => (p === 1 ? broken : toyGame) });
    for (const p of [0, 1]) {
      const desyncs = r.events[p]!.filter((e) => e.type === "desync");
      expect(desyncs.length).toBeGreaterThan(0);
      expect(desyncs[0]).toMatchObject({ frame: 300, peer: `p${1 - p}` });
    }
  });

  it("spectators, one from the start and one joining 3 s late, see exactly the players' game", () => {
    const r = match(3, { spectators: [{ host: 0, join: 0 }, { host: 2, join: 3000 }] });
    const frames = expectInSync(r, [0, 1, 2], 3);
    const ref = replay(toyGame, createToy(3), 3, frames, appliedInputs(r.sessions[0]!));
    r.spectators.forEach((spectator, k) => {
      expect(spectator.frame).toBeGreaterThan(690);
      const seen = r.spectatorFinals[k]!;
      const from = k === 0 ? 0 : seen.findIndex((h) => h !== undefined);
      for (let f = from; f <= Math.min(spectator.frame, frames); f++) expect(seen[f], `spectator ${k} frame ${f}`).toBe(ref[f]);
      for (const s of r.sessions) expect(s.stats.desyncs).toBe(0);
    });
    // The spectators never slowed the players down.
    expect(r.sessions[0]!.frame).toBeGreaterThan(710);
  });

  it("a partition that outlasts the timeout splits the game; each side plays on alone", () => {
    const r = match(2, {
      conditions: { latency: 30, jitter: 10, loss: 0 },
      onTick: (_p, _s, net) => {
        if (net.now > 2000 && net.now < 7000) net.partition("p0", "p1");
        else if (net.now >= 7000) net.partition("p0", "p1", false);
      },
    });
    for (const p of [0, 1]) {
      expect(disconnects(r.events[p]!)[0]).toMatchObject({ player: 1 - p, reason: "timeout" });
      expect(r.sessions[p]!.frame).toBeGreaterThan(500);
      expect(r.sessions[p]!.stats.desyncs).toBe(0);
    }
  });

  it("rejects bad configurations and inputs", () => {
    const net = new SimNetwork({ latency: 0, jitter: 0, loss: 0 });
    const base = { game: toyGame, state: createToy(2), players: 2, localPlayer: 0, peers: [{ id: "p1", player: 1 }], transport: net.endpoint("p0"), now: () => 0 };
    expect(() => new RollbackSession({ ...base, localPlayer: 2 })).toThrow();
    expect(() => new RollbackSession({ ...base, peers: [{ id: "x", player: 0 }] })).toThrow();
    expect(() => new RollbackSession({ ...base, historyFrames: 8 })).toThrow();
    const s = new RollbackSession(base);
    expect(() => s.advance(-1)).toThrow();
    expect(() => s.advance(0x10000)).toThrow();
    expect(s.advance(3)).toBe(true);
  });

  it("drops garbage packets", () => {
    const net = new SimNetwork({ latency: 0, jitter: 0, loss: 0 });
    const s = new RollbackSession({ game: toyGame, state: createToy(2), players: 2, localPlayer: 0, peers: [{ id: "p1", player: 1 }], transport: net.endpoint("p0"), now: () => net.now });
    const evil = net.endpoint("p1");
    evil.send("p0", new Uint8Array([1, 2, 3]));
    evil.send("p0", new Uint8Array(0));
    net.deliverUntil(10);
    s.advance(0);
    expect(s.stats.badPackets).toBe(2);
  });
});

describe("adaptive input delay", () => {
  const ADAPT = { adaptiveDelay: { min: 1, max: 6 } };
  const F = FRAME_MS;

  it("settles where the inputs arrive in time: 4.2 frames' latency takes 5 frames, and nothing rolls back", () => {
    const LINK = { latency: 4.2 * F, jitter: 0, loss: 0 };
    const r = match(2, { conditions: LINK, session: { inputDelay: 1, ...ADAPT } });
    expect(expectInSync(r, [0, 1], 2)).toBeGreaterThan(650);
    const fixed = match(2, { conditions: LINK, session: { inputDelay: 1 } });
    r.sessions.forEach((s, p) => {
      expect(s.inputDelay).toBe(5);
      // Its own inputs are contiguous, one per frame, whatever the delay did (a frame repeated as it grew).
      expect(s.inputLog(s.localPlayer).length).toBeGreaterThan(650);
      expect(s.stats.rollbackFrames).toBeLessThan(fixed.sessions[p]!.stats.rollbackFrames / 4);
    });
    const settled = match(2, { conditions: LINK, session: { inputDelay: 5, ...ADAPT } });
    for (const s of settled.sessions) expect([s.inputDelay, s.stats.rollbacks]).toEqual([5, 0]);
  });

  it("gives the peer whose ticks fall later in the frame the extra delay its inputs need", () => {
    // P1 ticks 12 ms (0.72 frame) after P0: P0 needs its inputs 0.72 frame sooner, P1 that much later.
    const r = match(2, { conditions: { latency: 3.3 * F, jitter: 0, loss: 0 }, peers: [{}, { start: 12 }], session: { inputDelay: 2, ...ADAPT } });
    expectInSync(r, [0, 1], 2);
    expect(r.sessions.map((s) => s.inputDelay)).toEqual([3, 5]);
    // Their targets: 3.3 ∓ 0.72 + DELAY_MARGIN.
    r.sessions.forEach((s, p) => expect(Math.abs(s.delayTarget - (3.3 + (p ? 0.72 : -0.72) + DELAY_MARGIN))).toBeLessThan(0.1));
  });

  it("shrinks back on a fast link, but not under its minimum; a fixed delay doesn't move", () => {
    const r = match(3, { conditions: { latency: 0, jitter: 2, loss: 0.05 }, session: { inputDelay: 5, ...ADAPT } });
    expect(expectInSync(r, [0, 1, 2], 3)).toBeGreaterThan(650);
    for (const s of r.sessions) expect(s.inputDelay).toBe(1);
    const fixed = match(2, { conditions: { latency: 70, jitter: 0, loss: 0 }, session: { inputDelay: 1 } });
    for (const s of fixed.sessions) expect(s.inputDelay).toBe(1);
  });

  it("follows a link that gets slower mid-match, one frame at a time, the peers bit-identical throughout", () => {
    const r = match(2, {
      conditions: { latency: 10, jitter: 0, loss: 0 },
      session: { inputDelay: 1, adaptiveDelay: { min: 0, max: 6, interval: 20 } },
      onTick: (_p, _s, net) => {
        if (net.now > 4000 && net.now < 4020) for (const [a, b] of [["p0", "p1"], ["p1", "p0"]] as const) net.setLink(a, b, { latency: 50, jitter: 10, loss: 0.1 });
      },
    });
    expect(expectInSync(r, [0, 1], 2)).toBeGreaterThan(600);
    for (const s of r.sessions) expect(s.inputDelay).toBeGreaterThanOrEqual(4);
  });
});

interface Profile {
  conditions: LinkConditions;
  /** The one-way latency (frames) by time (ms), both ways. */
  latencyAt?: (ms: number) => number;
  session?: MatchOptions<ToyState>["session"];
  /** The spectator's fixed buffer (adaptive by default). */
  buffer?: number;
  /** Rollbacks and the spectator's stalls are counted from then on (ms, default 3000). */
  from?: number;
}

/**
 * Two players 15 s on a link profile (P1 ticking 8 ms after P0), and a spectator fed by P0 from the start, every one
 * of them checked bit-identical to a replay. Returns each player's delays in order (one entry per change), its
 * rollbacks from `from` on, and the spectator's ticks that simulated nothing (the backlog ran dry) from then on.
 */
function profile({ conditions, latencyAt, session = { inputDelay: 2, adaptiveDelay: { min: 1, max: 6 } }, buffer, from = 3000 }: Profile) {
  const delays: number[][] = [[], []];
  let before: number[] | null = null, stallsBefore = 0;
  const r = runMatch<ToyState>({
    game: toyGame,
    initial: () => createToy(2),
    players: 2,
    conditions,
    duration: 15_000,
    input,
    inputUntil: 880,
    session,
    peers: [{}, { start: 8 }],
    spectators: [{ host: 0, join: 0, buffer }],
    onTick: (p, sessions, net) => {
      const d = sessions[p]!.inputDelay, row = delays[p]!;
      if (row[row.length - 1] !== d) row.push(d);
      if (latencyAt && p === 0) for (const [a, b] of [["p0", "p1"], ["p1", "p0"]] as const) net.setLink(a, b, { ...conditions, latency: latencyAt(net.now) * FRAME_MS });
      if (p === 1 && net.now >= from && !before) before = sessions.map((s) => s.stats.rollbacks);
    },
    onSpectatorTick: (_k, spectator, net) => {
      if (net.now < from) stallsBefore = spectator.stats.stalls;
    },
  });
  expectInSync(r, [0, 1], 2);
  const seen = r.spectatorFinals[0]!;
  expect(seen.length).toBeGreaterThan(850);
  expect(seen.findIndex((h, f) => h !== r.finals[0]![f])).toBe(-1);
  return { r, delays, rollbacks: r.sessions.map((s, p) => s.stats.rollbacks - before![p]!), stalls: r.spectators[0]!.stats.stalls - stallsBefore };
}

/** How often a sequence turns back (up then down, or down then up). */
const reversals = (row: number[]) => row.slice(2).filter((d, k) => Math.sign(d - row[k + 1]!) !== Math.sign(row[k + 1]! - row[k]!)).length;

// Before this rule (the delay moving to the one-way latency ± 0.75, the spectator's buffer fixed at 4 frames and
// drained at once past it), with this harness: steady 4.2 frames rolled back 142 times after the warm-up at a delay of
// 4, 2 ± 1.5 frames ~90 times at 2, with the spectator stalled ~200 ticks of 690 (docs/netcode.md, the table).
describe("adaptive delay and spectator buffer under link profiles", () => {
  const F = FRAME_MS;

  it("steady 4.2 frames: no rollback once settled (at the old rule's 4 frames, one every other input change)", () => {
    const adaptive = profile({ conditions: { latency: 4.2 * F, jitter: 0, loss: 0 } });
    const old = profile({ conditions: { latency: 4.2 * F, jitter: 0, loss: 0 }, session: { inputDelay: 4 } });
    expect(adaptive.rollbacks).toEqual([0, 0]);
    expect(old.rollbacks[0]).toBeGreaterThan(100);
    // Straight up from 2, never back: P1, ticking later, needs a frame more.
    expect(adaptive.delays).toEqual([[2, 3, 4], [2, 3, 4, 5]]);
    expect(adaptive.stalls).toBe(0);
  });

  it("2 ± 1.5 frames of jitter: settles above the jitter's reach without flapping; the spectator rarely runs dry", () => {
    const jittery = { latency: 0.5 * F, jitter: 3 * F, loss: 0 };
    const adaptive = profile({ conditions: jittery });
    expect(adaptive.rollbacks.every((n) => n <= 3)).toBe(true);
    for (const row of adaptive.delays) {
      expect(row.length).toBeLessThanOrEqual(5);
      expect(reversals(row)).toBeLessThanOrEqual(1);
      expect(row[row.length - 1]).toBeGreaterThanOrEqual(4);
    }
    expect(adaptive.r.spectators[0]!.buffer).toBeGreaterThan(4);
    // The old spectator buffer (4 frames, fixed) runs dry several times a second.
    const fixed = profile({ conditions: jittery, buffer: 4 });
    expect(adaptive.stalls).toBeLessThanOrEqual(5);
    expect(fixed.stalls).toBeGreaterThan(10 * Math.max(1, adaptive.stalls));
  });

  it("a latency step 2 → 6 → 2 frames: up to 6 and back down, one way each, no rollback once settled", () => {
    const step = profile({ conditions: { latency: 2 * F, jitter: 0, loss: 0 }, latencyAt: (ms) => (ms < 4000 ? 2 : ms < 9000 ? 6 : 2), from: 12_000 });
    step.delays.forEach((row, p) => {
      expect(Math.max(...row)).toBe(6);
      expect(reversals(row)).toBe(1);
      // Back within a frame of the target's ceiling (the hysteresis), whichever peer the time sync left behind.
      const target = step.r.sessions[p]!.delayTarget;
      expect(row[row.length - 1]! - Math.ceil(target)).toBeGreaterThanOrEqual(0);
      expect(row[row.length - 1]! - Math.ceil(target)).toBeLessThanOrEqual(1);
    });
    expect(step.rollbacks).toEqual([0, 0]);
    expect(step.stalls).toBe(0);
  });
});
