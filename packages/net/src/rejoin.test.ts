// Rejoining a running match (docs/netcode.md "Rejoining"): a player crashes, the others cut him, then he comes back
// under a new peer id from a snapshot one of them hands out, through the state codec; every peer must end bit-identical
// with a plain replay of the inputs they agreed on, his real inputs counting again from the rejoin frame.
import { describe, expect, it } from "vitest";
import { decodeState, encodeState, fromBase64, toBase64 } from "./codec.ts";
import { FRAME_MS, REJOIN_SETTLE_MS, RollbackSession, type SessionEvent, type SessionSnapshot } from "./session.ts";
import { appliedInputs, createToy, replay, runSimulation, scriptedInput, SimNetwork, toyGame, type LinkConditions, type Ticker, type ToyState } from "./testing.ts";

const LEFT = 0x8000;
const input = scriptedInput(11);

interface Rejoin {
  sessions: RollbackSession<ToyState>[];
  /** The rejoined player's new session (the latest, after `again`). */
  back: RollbackSession<ToyState> | null;
  /** The snapshot it started from. */
  snapshot: SessionSnapshot<ToyState> | null;
  /** By session: players 0, 1, 2, then each return of player 2. */
  finals: Map<number, number>[];
  events: SessionEvent[][];
  /** When player 0 first cut player 2, and when it handed out the (last) snapshot (virtual ms). */
  cutAt: number;
  snapshotAt: number;
}

/**
 * 3 players; player 2 crashes at `crashAt` (the others time out on him), comes back as "p2b" at `backAt`: the others
 * hear of his new id (the lobby's "rejoin"), he asks player 0, who hands out a snapshot once it can; it travels for
 * `transferMs` (encoded with the state codec, as through the lobby) and the new session starts from it. `again`: that
 * session crashes too, and comes back as "p2c". `absent`: player 2 is absent from frame 0 (SessionOptions.absent: a free
 * play restarted while he was away), and never plays before `backAt`.
 */
function rejoin(
  conditions: LinkConditions,
  options: { crashAt?: number; backAt?: number; again?: { crashAt: number; backAt: number }; transferMs?: number; until?: number; seed?: number; absent?: boolean } = {},
): Rejoin {
  const { crashAt = options.absent ? 0 : 3000, backAt = 7000, transferMs = 80, until = 16_000 } = options;
  const players = 3, inputUntil = Math.floor((until - 3000) / FRAME_MS);
  const net = new SimNetwork(conditions, options.seed ?? 1);
  const finals = [0, 1, 2, 3, 4].map(() => new Map<number, number>());
  const events: SessionEvent[][] = [[], [], [], [], []];
  const ids = ["p0", "p1", "p2"];
  // Player 2's lives: his peer id, when he crashes, when he comes back.
  const again = options.again;
  const lives = [
    { id: "p2", crashAt, backAt },
    ...(again ? [{ id: "p2b", crashAt: again.crashAt, backAt: again.backAt }] : []),
    { id: again ? "p2c" : "p2b", crashAt: Infinity, backAt: Infinity },
  ];
  /** Session `k` (0-2: the players, 3+: player 2's returns) plays `p`. */
  const make = (p: number, k: number, resume?: SessionSnapshot<ToyState>) =>
    new RollbackSession<ToyState>({
      game: toyGame,
      state: resume ? resume.state : createToy(players),
      players,
      localPlayer: p,
      peers: ids.map((peer, q) => ({ id: q === 2 ? lives[Math.max(0, k - 2)]!.id : peer, player: q })).filter((x) => x.player !== p),
      transport: net.endpoint(p === 2 ? lives[Math.max(0, k - 2)]!.id : ids[p]!),
      now: () => net.now,
      disconnectedInput: LEFT,
      resume,
      absent: options.absent && !resume ? [2].filter((q) => q !== p) : undefined,
      onEvent: (e) => {
        events[k]!.push(e);
        if (k === 0 && e.type === "disconnected" && !(result.cutAt < Infinity)) result.cutAt = net.now;
      },
      onFinal: (frame, state) => finals[k]!.set(frame, toyGame.hash(state)),
    });
  const sessions = [0, 1, 2].map((p) => make(p, p));
  const result: Rejoin = { sessions, back: null, snapshot: null, finals, events, cutAt: Infinity, snapshotAt: Infinity };
  const buttons = (p: number, s: RollbackSession<ToyState>) => {
    const frame = s.frame + s.inputDelay;
    return frame > inputUntil ? 0 : input(p, frame);
  };
  // The life of player 2 being played, whether he asked player 0 for a snapshot, and the one on its way.
  let life = 0, asked = false, arrives = Infinity, wire: { meta: string; state: string } | null = null;
  let current: RollbackSession<ToyState> = sessions[2]!;
  const tickers: Ticker[] = sessions.slice(0, 2).map((s, p) => ({
    start: 0,
    period: FRAME_MS,
    tick: () => {
      s.advance(buttons(p, s));
      if (p === 0 && asked && !wire) {
        const snap = s.rejoinSnapshot(2);
        if (snap) {
          result.snapshot = snap;
          result.snapshotAt = net.now;
          const { state, ...meta } = snap;
          wire = { meta: JSON.stringify(meta), state: toBase64(encodeState(state)) };
          arrives = net.now + transferMs;
        }
      }
    },
  }));
  tickers.push({
    start: 0,
    period: FRAME_MS,
    tick: () => {
      const now = net.now, l = lives[life]!;
      if (now < l.crashAt) return void current.advance(buttons(2, current));
      if (now < l.backAt) return; // crashed: silent
      const next = lives[life + 1]!;
      if (!asked) {
        asked = true;
        for (const s of sessions.slice(0, 2)) s.rejoinPeer(2, next.id);
      }
      if (wire && now >= arrives) {
        const snap = { ...(JSON.parse(wire.meta) as Omit<SessionSnapshot<ToyState>, "state">), state: decodeState(fromBase64(wire.state)) as ToyState };
        expect(toyGame.hash(snap.state)).toBe(snap.hash); // the snapshot restores exactly
        life++;
        current = result.back = make(2, 2 + life, snap);
        asked = false;
        wire = null;
        current.advance(buttons(2, current));
      }
    },
  });
  runSimulation(net, tickers, until);
  return result;
}

/** Peers 0, 1 and the rejoined one agree with a replay of what peer 0 applied, from the snapshot's frame on. */
function expectInSync(r: Rejoin): { from: number; to: number } {
  const back = r.back!, from = r.snapshot!.frame;
  const to = Math.min(r.sessions[0]!.finalizedFrame, r.sessions[1]!.finalizedFrame, back.finalizedFrame);
  const ref = replay(toyGame, createToy(3), 3, to, appliedInputs(r.sessions[0]!, LEFT));
  const last = r.finals.findLastIndex((m) => m.size > 0);
  for (const [k, finals] of [[0, r.finals[0]!], [1, r.finals[1]!], [last, r.finals[last]!]] as const) {
    const start = k === last ? from : 0;
    for (let f = start; f <= to; f++) if (finals.get(f) !== ref[f]) expect.fail(`peer ${k} diverges from the replay at frame ${f} (from ${start} to ${to})`);
  }
  expect(appliedInputs(r.sessions[1]!, LEFT)(2, to - 1)).toBe(appliedInputs(r.sessions[0]!, LEFT)(2, to - 1));
  for (const s of [...r.sessions.slice(0, 2), back]) expect(s.stats.desyncs).toBe(0);
  return { from, to };
}

describe("rejoining a running match", () => {
  for (const [label, conditions] of [
    ["a clean network", { latency: 20, jitter: 0, loss: 0 }],
    ["40±20 ms, 10% loss", { latency: 40, jitter: 20, loss: 0.1 }],
    ["60±40 ms, 20% loss, duplicates", { latency: 60, jitter: 40, loss: 0.2, duplicate: 0.05 }],
  ] as const) {
    it(`a crashed player comes back into his slot (${label}): every peer bit-identical, his inputs real again`, () => {
      const r = rejoin(conditions);
      expect(r.back, "the snapshot never arrived").not.toBeNull();
      const snap = r.snapshot!;
      const rejoinFrame = snap.rejoins[2]!, cut = snap.rejoinCuts[2]!;
      expect(cut).toBeGreaterThan(100);
      expect(rejoinFrame).toBeGreaterThan(cut + 1);
      expect(snap.frame).toBeLessThanOrEqual(rejoinFrame);
      const { to } = expectInSync(r);
      expect(to).toBeGreaterThan(rejoinFrame + 300);
      // The slot: real inputs to the cut, then the departed input, then the new session's real inputs.
      const applied = appliedInputs(r.sessions[0]!, LEFT);
      expect(r.sessions[0]!.cutFrame(2)).toBe(Infinity);
      expect(applied(2, cut + 1)).toBe(LEFT);
      expect(applied(2, rejoinFrame - 1)).toBe(LEFT);
      const after = Array.from({ length: 200 }, (_, k) => applied(2, rejoinFrame + k));
      expect(after.every((v) => v !== LEFT)).toBe(true);
      expect(after.some((v, k) => v === input(2, rejoinFrame + k) && v !== 0)).toBe(true);
      for (const k of [0, 1]) {
        expect(r.events[k]!.filter((e) => e.type === "disconnected" && e.player === 2).length).toBeGreaterThan(0); // (a peer's lower cut: twice)
        expect(r.events[k]!.filter((e) => e.type === "rejoined")).toEqual([{ type: "rejoined", peer: "p2b", player: 2, frame: rejoinFrame }]);
      }
      // The others waited for him at most maxPrediction frames past the rejoin frame, and he caught up.
      expect(r.back!.frame).toBeGreaterThan(r.sessions[0]!.frame - 12);
      expect(r.back!.stats.hashChecks).toBeGreaterThan(5);
    });
  }

  it("waits for the cut to settle, and hands out the same snapshot when asked again", () => {
    const r = rejoin({ latency: 30, jitter: 10, loss: 0.05 }, { crashAt: 3000, backAt: 6050 });
    // The cut came 3 s after the crash (the timeout), the ask right after it: the snapshot only REJOIN_SETTLE_MS later.
    expect(r.cutAt).toBeGreaterThan(6000);
    expect(r.cutAt).toBeLessThan(6100);
    expect(r.snapshotAt - r.cutAt).toBeGreaterThanOrEqual(REJOIN_SETTLE_MS);
    expect(r.snapshotAt - r.cutAt).toBeLessThan(REJOIN_SETTLE_MS + 50);
    expect(r.sessions[0]!.rejoinSnapshot(2)).toBe(r.snapshot);
    expectInSync(r);
  });

  it("comes back twice (the second rejoin un-cuts the slot again, from a new snapshot)", () => {
    const r = rejoin({ latency: 40, jitter: 20, loss: 0.1 }, { crashAt: 2000, backAt: 5500, again: { crashAt: 9000, backAt: 12_500 }, until: 22_000 });
    const snap = r.snapshot!;
    expect(r.finals[4]!.size).toBeGreaterThan(0);
    const rejoins = r.events[0]!.filter((e) => e.type === "rejoined").map((e) => (e as { frame: number }).frame);
    expect(rejoins).toHaveLength(2);
    expect(rejoins[1]).toBe(snap.rejoins[2]);
    expect(snap.rejoinCuts[2]).toBeGreaterThan(rejoins[0]! + 100);
    const { to } = expectInSync(r);
    expect(to).toBeGreaterThan(snap.rejoins[2]! + 200);
    const applied = appliedInputs(r.sessions[0]!, LEFT);
    expect(applied(2, rejoins[0]! + 30)).not.toBe(LEFT);
    expect(applied(2, snap.rejoinCuts[2]! + 1)).toBe(LEFT);
    expect(applied(2, rejoins[1]! + 30)).not.toBe(LEFT);
  });

  it("a player absent from frame 0 (a free play restarted while he was away) comes into his slot at once, nobody waiting for him", () => {
    const r = rejoin({ latency: 40, jitter: 20, loss: 0.1 }, { absent: true, backAt: 2000 });
    expect(r.back, "the snapshot never arrived").not.toBeNull();
    const snap = r.snapshot!;
    // Cut from frame 0 on (after frame -1) and long enough ago: the arbiter un-cut him as soon as he asked.
    expect(snap.rejoinCuts[2]).toBe(-1);
    expect(r.snapshotAt - 2000).toBeLessThan(200);
    expect(r.cutAt).toBe(Infinity); // (no "disconnected": he was never in)
    const { to } = expectInSync(r);
    expect(to).toBeGreaterThan(snap.rejoins[2]! + 300);
    const applied = appliedInputs(r.sessions[0]!, LEFT);
    expect(applied(2, 0)).toBe(LEFT);
    expect(applied(2, snap.rejoins[2]! - 1)).toBe(LEFT);
    expect(applied(2, snap.rejoins[2]! + 30)).not.toBe(LEFT);
    // The two others played from the start without waiting for him.
    for (const k of [0, 1]) expect(r.sessions[k]!.stats.predictionStalls).toBeLessThan(30);
  });

  it("the codec restores plain data exactly (typed arrays, Maps, -0, NaN, fractions, undefined)", () => {
    const value = {
      a: [1, -1, 0, -0, 2 ** 40, -(2 ** 52), 0.5, NaN, Infinity, -Infinity, undefined, null, true, false, "é ✓"],
      t: [new Int8Array([-3, 4]), new Uint16Array([65535, 2]), new Int32Array([-(2 ** 31), 7]), new Float64Array([0.1, -0])],
      m: new Map<unknown, unknown>([[1, { x: 2 }], ["k", [3]]]),
      big: 12345678901234567890n,
      nested: { deep: { deeper: [{ z: 1 }] } },
      skipped: undefined,
    };
    const back = decodeState(fromBase64(toBase64(encodeState(value)))) as typeof value;
    expect(back).toEqual(value);
    expect(Object.is(back.a[3], -0)).toBe(true);
    expect(Object.is(back.t[3]![1], -0)).toBe(true);
    expect(back.t[2]).toBeInstanceOf(Int32Array);
    expect(Object.keys(back)).toEqual(Object.keys(value));
    expect(() => encodeState({ f: () => 1 })).toThrow(/function/);
    expect(() => encodeState({ d: new Date() })).toThrow(/Date/);
    expect(() => decodeState(encodeState(value).slice(0, 20))).toThrow();
  });
});

/**
 * 4 players; player 3 crashes at 2 s and comes back as "p3b" at 5.5 s, asking every other player (rejoinSnapshot) and
 * taking the snapshot of his sponsor, the first of them still there. Player 0, the arbiter and first sponsor, makes the
 * rejoin, then is gone before his snapshot arrives: `leaves` (a goodbye right after handing it out) or `crashes` (silent
 * from the very tick it decided, so no packet ever says which frame it picked).
 */
function sponsorGone(how: "leaves" | "crashes") {
  const players = 4, until = 16_000, inputUntil = Math.floor((until - 3000) / FRAME_MS);
  const net = new SimNetwork({ latency: 40, jitter: 20, loss: 0.1 }, 3);
  const finals = [0, 1, 2, 3, 4].map(() => new Map<number, number>());
  const events: SessionEvent[][] = [[], [], [], [], []];
  const ids = ["p0", "p1", "p2", "p3"];
  let gone = false;
  const make = (p: number, k: number, resume?: SessionSnapshot<ToyState>) =>
    new RollbackSession<ToyState>({
      game: toyGame,
      state: resume ? resume.state : createToy(players),
      players,
      localPlayer: p,
      peers: ids.map((id, q) => ({ id, player: q })).filter((x) => x.player !== p),
      transport: net.endpoint(k === 4 ? "p3b" : ids[p]!),
      now: () => net.now,
      disconnectedInput: LEFT,
      resume,
      onEvent: (e) => {
        events[k]!.push(e);
        // The arbiter decided the rejoin: when it `crashes`, that tick's packets are lost too.
        if (k === 0 && e.type === "rejoined" && how === "crashes") {
          gone = true;
          for (const q of ["p1", "p2", "p3b"]) net.setLink("p0", q, { latency: 0, jitter: 0, loss: 1 });
        }
      },
      onFinal: (frame, state) => finals[k]!.set(frame, toyGame.hash(state)),
    });
  const sessions = [0, 1, 2, 3].map((p) => make(p, p));
  let returned = false, back: RollbackSession<ToyState> | null = null, sponsor = 0, firstPick = -1;
  let snapshot: SessionSnapshot<ToyState> | null = null, wire: { meta: string; state: string; at: number } | null = null;
  const buttons = (p: number, s: RollbackSession<ToyState>) => (s.frame + s.inputDelay > inputUntil ? 0 : input(p, s.frame + s.inputDelay));
  const tickers: Ticker[] = [0, 1, 2].map((p) => ({
    start: 0,
    period: FRAME_MS,
    tick: () => {
      if (p === 0 && gone && sponsor !== 0) return;
      const s = sessions[p]!;
      s.advance(buttons(p, s));
      if (!returned || back) return;
      const snap = s.rejoinSnapshot(3); // (every player is asked; only the sponsor's answer is sent)
      if (!snap || p !== sponsor || wire) return;
      if (p === 0) {
        firstPick = snap.rejoins[3]!;
        if (how === "leaves") s.close();
        gone = true;
        sponsor = 1; // (the lobby says he left: the rejoiner asks the next one)
        return;
      }
      snapshot = snap;
      const { state, ...meta } = snap;
      wire = { meta: JSON.stringify(meta), state: toBase64(encodeState(state)), at: net.now + 80 };
    },
  }));
  tickers.push({
    start: 0,
    period: FRAME_MS,
    tick: () => {
      if (net.now < 2000) return void sessions[3]!.advance(buttons(3, sessions[3]!));
      if (net.now < 5500) return;
      if (!returned) {
        returned = true;
        for (const s of sessions.slice(0, 3)) s.rejoinPeer(3, "p3b");
      }
      if (!back && wire && net.now >= wire.at) {
        const snap = { ...(JSON.parse(wire.meta) as Omit<SessionSnapshot<ToyState>, "state">), state: decodeState(fromBase64(wire.state)) as ToyState };
        back = make(3, 4, snap);
      }
      if (back) back.advance(buttons(3, back));
    },
  });
  runSimulation(net, tickers, until);
  return { sessions, back: back as RollbackSession<ToyState> | null, snapshot: snapshot as SessionSnapshot<ToyState> | null, finals, events, firstPick };
}

describe("rejoining while the sponsor goes", () => {
  for (const how of ["leaves", "crashes"] as const) {
    it(`the arbiter ${how} right after making the rejoin: the next sponsor's snapshot has the rejoin frame everyone uses`, () => {
      const r = sponsorGone(how);
      expect(r.firstPick).toBeGreaterThan(0);
      expect(r.back, "the snapshot never arrived").not.toBeNull();
      const snap = r.snapshot!, rejoinFrame = snap.rejoins[3]!;
      // `leaves`: its goodbye carried the rejoin, so P2 hands out the very frame P1 picked. `crashes`: nobody heard it,
      // so P2, the arbiter after P1, picked its own, and P1's never counted anywhere.
      if (how === "leaves") expect(rejoinFrame).toBe(r.firstPick);
      for (const k of [1, 2]) {
        expect(r.events[k]!.filter((e) => e.type === "rejoined").map((e) => (e as { frame: number }).frame)).toEqual([rejoinFrame]);
        expect(r.sessions[k]!.arbiter).toBe(1);
        expect(r.sessions[k]!.cutFrame(0)).toBe(r.sessions[1]!.cutFrame(0));
      }
      expect(r.back!.cutFrame(0)).toBe(r.sessions[1]!.cutFrame(0));
      // P2, P3 and the rejoined P4 agree with a replay of what P2 applied, from the snapshot on.
      const live = [r.sessions[1]!, r.sessions[2]!, r.back!];
      const to = Math.min(...live.map((s) => s.finalizedFrame));
      expect(to).toBeGreaterThan(rejoinFrame + 200);
      const ref = replay(toyGame, createToy(4), 4, to, appliedInputs(r.sessions[1]!, LEFT));
      for (const [k, finals] of [[1, r.finals[1]!], [2, r.finals[2]!], [4, r.finals[4]!]] as const) {
        for (let f = k === 4 ? snap.frame : 0; f <= to; f++) if (finals.get(f) !== ref[f]) expect.fail(`peer ${k} diverges from the replay at frame ${f}`);
      }
      for (const s of live) expect(s.stats.desyncs).toBe(0);
      for (const k of [1, 2, 4]) expect(r.events[k]!.filter((e) => e.type === "error")).toEqual([]);
      expect(appliedInputs(r.sessions[1]!, LEFT)(3, rejoinFrame + 30)).not.toBe(LEFT);
    });
  }
});
