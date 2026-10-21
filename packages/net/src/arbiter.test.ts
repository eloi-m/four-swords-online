// Arbitrated disconnects (docs/netcode.md "Disconnects"): a peer that stops hearing another only reports it, and one
// arbiter decides every cut, so partitions inside a 3–4 player match and players leaving together leave the others
// agreeing on who is still in, from which frame, and never rewrite a settled frame. Splits: only a majority of the
// players still in cuts the others; a tie (2–2, 1–1) goes to the referee (the lobby; else the half holding P1), and the
// other side drops out, so a split never leaves two games.
import { describe, expect, it } from "vitest";
import { ARBITER_GRACE_MS, type RollbackSession, type SessionEvent, type SplitClaim } from "./session.ts";
import { appliedInputs, createToy, replay, rng, runMatch, scriptedInput, toyGame, type MatchOptions, type MatchResult, type SimNetwork, type ToyState } from "./testing.ts";

const input = scriptedInput(5);

function match(players: number, extra: Partial<MatchOptions<ToyState>> = {}): MatchResult<ToyState> {
  return runMatch<ToyState>({
    game: toyGame,
    initial: () => createToy(players),
    players,
    conditions: { latency: 40, jitter: 20, loss: 0.1 },
    duration: 12_000,
    input,
    inputUntil: 500,
    ...extra,
  });
}

/** The listed peers reported the same final states as a plain replay of what the first one applied. */
function expectInSync(r: MatchResult<ToyState>, alive: number[], players: number): number {
  const frames = Math.min(...alive.map((p) => r.sessions[p]!.finalizedFrame));
  const ref = replay(toyGame, createToy(players), players, frames, appliedInputs(r.sessions[alive[0]!]!));
  for (const p of alive) {
    const firstBad = r.finals[p]!.slice(0, frames + 1).findIndex((h, f) => h !== ref[f]);
    expect(firstBad, `peer ${p} diverges from the replay at frame ${firstBad}`).toBe(-1);
    expect(r.sessions[p]!.stats.desyncs).toBe(0);
    expect(r.events[p]!.filter((e) => e.type === "error")).toEqual([]);
  }
  return frames;
}

const cuts = (events: SessionEvent[]) => events.filter((e) => e.type === "disconnected") as Extract<SessionEvent, { type: "disconnected" }>[];
const drops = (events: SessionEvent[]) => events.flatMap((e) => (e.type === "dropped" ? [e.reason] : []));

/**
 * The lobby as the referee of splits (the server's rule, tools/signal): a claim is granted unless one of the players it
 * keeps was cut by a claim granted before. Each player reaches it with its own one-way latency (ms), in virtual time.
 */
function lobbyReferee(players: number, latency: (player: number) => number) {
  let net: SimNetwork | null = null;
  const outvoted = new Set<number>();
  const asked = new Map<string, { answerAt: number; ok?: boolean }>();
  const queue: { at: number; player: number; claim: SplitClaim; key: string }[] = [];
  const process = (now: number) => {
    queue.sort((a, b) => a.at - b.at);
    while (queue.length > 0 && queue[0]!.at <= now) {
      const { player, claim, key } = queue.shift()!;
      const ok = claim.keep.includes(player) && claim.keep.every((p) => !outvoted.has(p));
      if (ok) for (const p of claim.cut) outvoted.add(p);
      asked.get(key)!.ok = ok;
    }
  };
  return {
    setup: (n: SimNetwork) => void (net = n),
    /** The players no granted claim cut. */
    granted: () => [...Array(players).keys()].filter((p) => !outvoted.has(p)),
    session: (player: number) => ({
      referee: (claim: SplitClaim) => {
        const now = net!.now, key = `${player}:${JSON.stringify(claim)}`;
        process(now);
        let entry = asked.get(key);
        if (!entry) {
          asked.set(key, (entry = { answerAt: now + 2 * latency(player) }));
          queue.push({ at: now + latency(player), player, claim, key });
        }
        return now >= entry.answerAt ? entry.ok : undefined;
      },
    }),
  };
}

/** Cuts every link between the two halves, both ways. */
const split = (net: SimNetwork, a: number[], b: number[]) => {
  for (const p of a) for (const q of b) net.partition(`p${p}`, `p${q}`);
};
/** The players still playing the match (not dropped out). */
const live = (sessions: readonly RollbackSession<ToyState>[]) => sessions.flatMap((s, p) => (s.droppedOut ? [] : [p]));

describe("arbitrated disconnects", () => {
  it("4 players, the link between P2 and P3 cut: the arbiter (P1) cuts P3 alone, the other three play on in sync", () => {
    const r = match(4, { onTick: (_p, _s, net) => net.now > 2000 && net.partition("p1", "p2") });
    const alive = [0, 1, 3];
    expect(expectInSync(r, alive, 4)).toBeGreaterThan(450);
    const cut = r.sessions[0]!.cutFrame(2);
    for (const p of alive) {
      expect(r.sessions[p]!.cutFrame(2)).toBe(cut);
      for (const q of alive) expect(r.sessions[p]!.cutFrame(q)).toBe(Infinity);
      expect(cuts(r.events[p]!).map((e) => e.player)).toEqual([2]);
      expect(r.sessions[p]!.arbiter).toBe(0);
      expect(r.sessions[p]!.frame).toBeGreaterThan(450); // (~4 s waiting: the timeout, then the grace)
    }
    // P1 still heard both and waited ARBITER_GRACE_MS before choosing; P2 had lost P3 itself (its own reason).
    expect(cuts(r.events[0]!)[0]!.reason).toBe("reported");
    expect(r.sessions[0]!.stats.predictionStalls).toBeGreaterThan((3000 + ARBITER_GRACE_MS) / 17 - 20);
    expect(cuts(r.events[1]!)[0]!.reason).toBe("timeout");
    expect(cut).toBeGreaterThan(110);
    // P3 learned it was cut and plays on alone.
    expect(r.sessions[2]!.droppedOut).toBe(true);
    expect(cuts(r.events[2]!).map((e) => [e.player, e.reason])).toEqual([[0, "dropped-us"], [1, "timeout"], [3, "dropped-us"]]);
  });

  it("3 players, the arbiter's own link to P3 cut (both still hear P2): P3 is cut, P2 stays", () => {
    const r = match(3, { onTick: (_p, _s, net) => net.now > 2000 && net.partition("p0", "p2") });
    expectInSync(r, [0, 1], 3);
    for (const p of [0, 1]) {
      expect(r.sessions[p]!.cutFrame(2)).toBe(r.sessions[0]!.cutFrame(2));
      expect(r.sessions[p]!.cutFrame(1 - p)).toBe(Infinity);
      expect(cuts(r.events[p]!).map((e) => e.player)).toEqual([2]);
    }
    expect(r.sessions[2]!.droppedOut).toBe(true);
  });

  it("the arbiter crashes: the next player takes over and cuts it, the others in sync", () => {
    const r = match(4, { peers: [{ crashAt: 3000 }, {}, {}, {}] });
    const alive = [1, 2, 3];
    expectInSync(r, alive, 4);
    for (const p of alive) {
      expect(r.sessions[p]!.arbiter).toBe(1);
      expect(r.sessions[p]!.cutFrame(0)).toBe(r.sessions[1]!.cutFrame(0));
      expect(cuts(r.events[p]!).map((e) => [e.player, e.reason])).toEqual([[0, "timeout"]]);
      expect(r.sessions[p]!.frame).toBeGreaterThan(500);
    }
  });

  it("two players crash at once, the arbiter one of them (the lobby says they left): the other two take it from there", () => {
    const r = match(4, {
      peers: [{ crashAt: 3000 }, {}, { crashAt: 3010 }, {}],
      // (A crashed tab's lobby connection closes: the lobby tells everyone it left, so it no longer counts.)
      onTick: (q, _s, net) => {
        if (net.now >= 3100 && q % 2 === 1) for (const gone of ["p0", "p2"]) net.endpoint(`p${q}`).closePeer(gone);
      },
    });
    expectInSync(r, [1, 3], 4);
    for (const p of [1, 3]) {
      expect(r.sessions[p]!.arbiter).toBe(1);
      for (const q of [0, 2]) expect(r.sessions[p]!.cutFrame(q)).toBe(r.sessions[1]!.cutFrame(q));
      expect(r.sessions[p]!.frame).toBeGreaterThan(500);
      expect(r.sessions[p]!.droppedOut).toBe(false);
    }
  });

  it("two players vanish at once without a word: the other two can't tell it from a split, so the referee decides", () => {
    const silent = [{ crashAt: 3000 }, {}, { crashAt: 3010 }, {}];
    // Without a referee, the half holding P1 goes on: here it's gone, so the two left drop out.
    const alone = match(4, { peers: silent });
    for (const p of [1, 3]) expect(drops(alone.events[p]!)).toEqual(["split"]);
    // The lobby grants them the tie (nobody else claims): they go on, in sync.
    const lobby = lobbyReferee(4, () => 40);
    const r = match(4, { setup: lobby.setup, peers: silent.map((peer, p) => ({ ...peer, session: lobby.session(p) })) });
    expectInSync(r, [1, 3], 4);
    for (const p of [1, 3]) {
      expect(r.sessions[p]!.droppedOut).toBe(false);
      for (const q of [0, 2]) expect(r.sessions[p]!.cutFrame(q)).toBe(r.sessions[1]!.cutFrame(q));
      expect(r.sessions[p]!.frame).toBeGreaterThan(500);
    }
  });

  it("a 2-player partition: P1, the half holding the lowest player, plays on; P2 drops out", () => {
    const r = match(2, { conditions: { latency: 30, jitter: 10, loss: 0 }, onTick: (_p, _s, net) => net.now > 2000 && net.partition("p0", "p1") });
    expect(cuts(r.events[0]!)).toMatchObject([{ player: 1, reason: "timeout" }]);
    expect(r.sessions[0]!.frame).toBeGreaterThan(500);
    expect(drops(r.events[0]!)).toEqual([]);
    expect(drops(r.events[1]!)).toEqual(["split"]);
    expect(live(r.sessions)).toEqual([0]);
  });

  it("a 2–2 split: the half holding P1 plays on in sync and cuts the other, which drops out (no referee)", () => {
    const r = match(4, { onTick: (_p, _s, net) => net.now > 2000 && split(net, [0, 1], [2, 3]) });
    expectInSync(r, [0, 1], 4);
    for (const p of [0, 1]) {
      for (const q of [2, 3]) expect(r.sessions[p]!.cutFrame(q)).toBe(r.sessions[0]!.cutFrame(q));
      expect(r.sessions[p]!.frame).toBeGreaterThan(500);
    }
    for (const p of [2, 3]) expect(drops(r.events[p]!)).toEqual(["split"]);
    expect(live(r.sessions)).toEqual([0, 1]);
  });

  it("a 2–2 split with the lobby as referee: whichever half claims first plays on, the other drops out, on every seed", () => {
    const winners = new Set<string>();
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const random = rng(seed * 13 + 5);
      // (Each player's latency to the lobby; on even seeds the half holding P1 reaches it much later.)
      const slow = seed % 2 === 0 ? [0, 1] : [];
      const lat = [0, 1, 2, 3].map((p) => (slow.includes(p) ? 400 : 10) + random() * 80);
      const lobby = lobbyReferee(4, (p) => lat[p]!);
      const at = 2000 + random() * 500;
      const r = match(4, {
        seed,
        conditions: { latency: 20 + random() * 60, jitter: random() * 40, loss: random() * 0.1 },
        setup: lobby.setup,
        peers: [0, 1, 2, 3].map((p) => ({ session: lobby.session(p) })),
        onTick: (_p, _s, net) => net.now > at && split(net, [0, 1], [2, 3]),
      });
      const won = live(r.sessions), lost = [0, 1, 2, 3].filter((p) => !won.includes(p));
      expect([[0, 1], [2, 3]], `seed ${seed}: ${won.join()} still play`).toContainEqual(won);
      winners.add(won.join());
      expectInSync(r, won, 4);
      for (const p of won) {
        for (const q of lost) expect(r.sessions[p]!.cutFrame(q), `seed ${seed}`).toBe(r.sessions[won[0]!]!.cutFrame(q));
        expect(r.sessions[p]!.frame).toBeGreaterThan(450);
      }
      for (const p of lost) expect(drops(r.events[p]!), `seed ${seed}`).toEqual(["split"]);
      expect(lobby.granted(), `seed ${seed}`).toEqual(won);
    }
    expect([...winners].sort()).toEqual(["0,1", "2,3"]);
  });

  it("a 3–1 split: the three play on, the one alone drops out without asking", () => {
    const lobby = lobbyReferee(4, () => 30);
    const r = match(4, { setup: lobby.setup, peers: [0, 1, 2, 3].map((p) => ({ session: lobby.session(p) })), onTick: (_p, _s, net) => net.now > 2000 && split(net, [0, 1, 2], [3]) });
    expectInSync(r, [0, 1, 2], 4);
    expect(live(r.sessions)).toEqual([0, 1, 2]);
    expect(drops(r.events[3]!)).toEqual(["split"]);
    expect(lobby.granted()).toEqual([0, 1, 2]);
  });

  // Before arbitration (the lowest cut reported won), these seeds gave a settled frame rewritten, and two of them a
  // false desync warning: P4 cut P3 lower than the others did, then left; the lobby's word that P4 left reached P1
  // before P4's report, which still came to P1 through P2, after P1 had settled frames past it.
  it("two players leaving at once, with the lobby's word of it: no settled frame rewritten, no false desync", () => {
    for (const seed of [5, 19, 22, 27, 51, 140, 186, 304, 1, 2, 3, 4]) {
      const random = rng(seed * 7 + 1), at = 3000 + (seed % 7) * 3;
      const leaves = [at, at + Math.floor(random() * 60)];
      const lobbyMs = Array.from({ length: 16 }, () => 5 + random() * 120);
      const told = new Set<number>();
      const r = match(4, {
        seed,
        duration: 9000,
        inputUntil: 450,
        conditions: { latency: 50, jitter: 40, loss: 0.15 },
        peers: [{}, {}, { leaveAt: leaves[0] }, { leaveAt: leaves[1] }],
        onTick: (q, _s, net) => {
          // Every page hears from the lobby that a player left, each at its own time (a `closed` on its transport).
          leaves.forEach((t, k) => {
            const p = 2 + k, key = q * 4 + p;
            if (p !== q && !told.has(key) && net.now >= t + lobbyMs[key]!) {
              told.add(key);
              net.endpoint(`p${q}`).closePeer(`p${p}`);
            }
          });
        },
        setup: (net) => {
          for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) if (a !== b) net.setLink(`p${a}`, `p${b}`, { latency: 10 + random() * 150, jitter: random() * 100, loss: random() * 0.3 });
        },
      });
      expectInSync(r, [0, 1], 4);
      for (const p of [2, 3]) expect(r.sessions[1]!.cutFrame(p), `seed ${seed}`).toBe(r.sessions[0]!.cutFrame(p));
      expect(r.sessions[0]!.stats.hashChecks).toBeGreaterThan(20);
    }
  });
});
