// startNetMatch end to end in node: the real signaling server, lobby clients, the relay transport (WebRTC needs a
// browser: see tools/e2e/src/netplay.ts), an impaired network, and a spectator joining mid-match.
import { LobbyClient, startNetMatch, type NetMatch, type StartInfo } from "@fso/net";
import { createToy, scriptedInput, toyGame, type ToyState } from "@fso/net/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startSignalServer, type SignalServer } from "./server.ts";

let server: SignalServer;
const lobbies: LobbyClient[] = [];
beforeAll(async () => void (server = await startSignalServer({ port: 0, host: "127.0.0.1" })));
afterAll(async () => {
  for (const l of lobbies) l.close();
  await server.close();
});

const connect = async () => {
  const l = await LobbyClient.connect(`ws://127.0.0.1:${server.port}`);
  lobbies.push(l);
  return l;
};
const started = (l: LobbyClient) => new Promise<StartInfo>((resolve) => l.on("start", resolve));

describe("startNetMatch", () => {
  it("runs 3 players over the relay with 40±20 ms and 10% loss, and a spectator joining after 1 s", async () => {
    const lobbies = [await connect(), await connect(), await connect()];
    const room = await lobbies[0]!.create();
    for (const l of lobbies.slice(1)) await l.join(room.code);
    const starts = lobbies.map(started);
    lobbies[0]!.start({ hello: 1 });
    const infos = await Promise.all(starts);
    const input = scriptedInput(11);
    const finals: number[][] = [[], [], [], []];
    const matches: NetMatch<ToyState>[] = infos.map((start, i) =>
      startNetMatch(lobbies[i]!, start, {
        game: toyGame,
        state: createToy(3),
        mode: "relay",
        impairment: { latency: 40, jitter: 20, loss: 0.1 },
        onFinal: (f, s) => (finals[i]![f] = toyGame.hash(s)),
      }),
    );
    expect(matches.map((m) => m.localPlayer)).toEqual([0, 1, 2]);

    const LAST_INPUT = 120, END = 150;
    let spectator: NetMatch<ToyState> | null = null;
    await new Promise<void>((resolve, reject) => {
      const timer = setInterval(() => {
        try {
          for (const m of matches) {
            m.pump();
            const f = m.session!.frame + m.session!.inputDelay;
            m.tick(f <= LAST_INPUT ? input(m.localPlayer, f) : 0);
          }
          if (spectator) {
            spectator.pump();
            spectator.tick(0);
          }
          const done = matches.every((m) => m.session!.finalizedFrame >= END) && (spectator?.frame ?? 0) >= END;
          if (done) {
            clearInterval(timer);
            resolve();
          }
        } catch (e) {
          clearInterval(timer);
          reject(e);
        }
      }, 1000 / 60);
      setTimeout(async () => {
        const l = await connect();
        const start = started(l);
        await l.join(room.code, { spectator: true });
        spectator = startNetMatch(l, await start, {
          game: toyGame,
          state: createToy(3),
          mode: "relay",
          onFinal: (f, s) => (finals[3]![f] = toyGame.hash(s)),
        });
        expect(spectator.localPlayer).toBe(-1);
      }, 1000);
      setTimeout(() => reject(new Error("match did not finish")), 15_000);
    });
    for (let f = 0; f <= END; f++) for (let i = 1; i < 4; i++) expect(finals[i]![f], `peer ${i} frame ${f}`).toBe(finals[0]![f]);
    for (const m of matches) {
      expect(m.session!.stats.desyncs).toBe(0);
      expect(m.session!.stats.rollbacks).toBeGreaterThan(0);
      expect(m.transport.route(String(infos[0]!.players[(m.localPlayer + 1) % 3]))).toBe("relay");
      expect(m.lossy!.dropped).toBeGreaterThan(0);
    }
    for (const m of matches) m.close();
  }, 20_000);

  it("a player who drops out (his lobby connection closes) rejoins in his slot from a snapshot, over the relay", async () => {
    const lobbies = [await connect(), await connect(), await connect()];
    const room = await lobbies[0]!.create();
    for (const l of lobbies.slice(1)) await l.join(room.code);
    const starts = lobbies.map(started);
    lobbies[0]!.start();
    const infos = await Promise.all(starts);
    const input = scriptedInput(17), LEFT = 0x8000;
    const finals: Map<number, number>[] = [new Map(), new Map(), new Map()];
    const events: string[][] = [[], [], []];
    const play = (lobby: LobbyClient, start: StartInfo, i: number, onResume?: (ok: boolean, frame: number) => void) =>
      startNetMatch(lobby, start, {
        game: toyGame,
        state: createToy(3),
        mode: "relay",
        disconnectedInput: LEFT,
        impairment: { latency: 30, jitter: 20, loss: 0.05 },
        onFinal: (f, s) => finals[i]!.set(f, toyGame.hash(s)),
        onEvent: (e) => events[i]!.push(`${e.type}${"player" in e ? ` P${e.player + 1}` : ""}`),
        onResume,
      });
    const matches: (NetMatch<ToyState> | null)[] = infos.map((start, i) => play(lobbies[i]!, start, i));
    const key = lobbies[2]!.key;
    let resumedAt = -1;
    const done = new Promise<void>((resolve, reject) => {
      const timer = setInterval(() => {
        try {
          for (const m of matches) {
            if (!m) continue;
            m.pump();
            const f = (m.session?.frame ?? 0) + (m.session?.inputDelay ?? 0);
            m.tick(f <= 600 ? input(m.localPlayer, f) : 0);
          }
          if (resumedAt >= 0 && matches.every((m) => m?.session && m.session.finalizedFrame >= resumedAt + 240)) {
            clearInterval(timer);
            resolve();
          }
        } catch (e) {
          clearInterval(timer);
          reject(e);
        }
      }, 1000 / 60);
      // P3 drops at 1 s (his lobby connection closes: a reload), and comes back with his key at 2 s.
      setTimeout(() => {
        matches[2]!.close({ quiet: true });
        matches[2] = null;
        lobbies[2]!.close();
      }, 1000);
      setTimeout(async () => {
        const l = await connect();
        const start = started(l);
        await l.join(room.code, { rejoin: key });
        const info = await start;
        expect(info.resume).toBe(true);
        finals[2]!.clear();
        matches[2] = play(l, info, 2, (ok, frame) => {
          expect(ok).toBe(true);
          resumedAt = frame;
        });
        expect([matches[2].localPlayer, matches[2].resuming]).toEqual([2, true]);
      }, 2000);
      setTimeout(() => (clearInterval(timer), reject(new Error(`no rejoin (${JSON.stringify(events)})`))), 15_000);
    });
    await done;
    const last = Math.min(...matches.map((m) => m!.session!.finalizedFrame));
    for (let f = resumedAt; f <= last; f++) for (const i of [1, 2]) expect(finals[i]!.get(f), `peer ${i} frame ${f}`).toBe(finals[0]!.get(f));
    for (let f = 0; f < resumedAt; f++) expect(finals[1]!.get(f), `peer 1 frame ${f}`).toBe(finals[0]!.get(f));
    for (const i of [0, 1]) expect(events[i]).toEqual(expect.arrayContaining(["disconnected P3", "rejoined P3"]));
    const rejoin = matches[0]!.session!.inputLog(2);
    expect(rejoin.slice(-100).every((v) => v !== LEFT)).toBe(true); // his own inputs again
    for (const m of matches) expect(m!.session!.stats.desyncs).toBe(0);
    expect(matches[2]!.session!.stats.hashChecks).toBeGreaterThan(3);
    for (const m of matches) m!.close();
  }, 20_000);

  it("a 2–2 split over the relay: the lobby referees it, one half plays on, the other drops out and rejoins it", async () => {
    const lobbies = [await connect(), await connect(), await connect(), await connect()];
    const room = await lobbies[0]!.create();
    for (const l of lobbies.slice(1)) await l.join(room.code);
    const starts = lobbies.map(started);
    lobbies[0]!.start();
    const infos = await Promise.all(starts);
    const input = scriptedInput(23), LEFT = 0x8000;
    const finals: Map<number, number>[] = [new Map(), new Map(), new Map(), new Map()];
    const events: string[][] = [[], [], [], []];
    const dropped = new Set<number>(), back = new Map<number, number>();
    const matches: NetMatch<ToyState>[] = [];
    const play = (i: number, start: StartInfo) =>
      (matches[i] = startNetMatch(lobbies[i]!, start, {
        game: toyGame,
        state: createToy(4),
        mode: "relay",
        disconnectedInput: LEFT,
        impairment: { latency: 30, jitter: 20, loss: 0.05 },
        onFinal: (f, s) => finals[i]!.set(f, toyGame.hash(s)),
        onEvent: (e) => {
          events[i]!.push(`${e.type}${"player" in e ? ` P${e.player + 1}` : ""}${"reason" in e ? ` ${e.reason}` : ""}`);
          // Dropped out of a split: back into the match with our key, from the same lobby connection (as the battle does).
          if (e.type === "dropped" && !dropped.has(i)) {
            dropped.add(i);
            setTimeout(async () => {
              matches[i]!.close({ quiet: true });
              const resumed = started(lobbies[i]!);
              await lobbies[i]!.join(room.code, { rejoin: lobbies[i]!.key });
              finals[i]!.clear();
              play(i, await resumed);
            }, 0);
          }
        },
        onResume: (ok, frame) => ok && back.set(i, frame),
      }));
    infos.forEach((start, i) => play(i, start));
    const ids = infos[0]!.players.map(String);
    const done = new Promise<void>((resolve, reject) => {
      const timer = setInterval(() => {
        try {
          for (const m of matches) {
            m.pump();
            const f = (m.session?.frame ?? 0) + (m.session?.inputDelay ?? 0);
            m.tick(f <= 900 ? input(m.localPlayer, f) : 0);
          }
          const from = Math.max(...back.values());
          if (back.size === 2 && matches.every((m) => m.session && !m.session.droppedOut && m.session.finalizedFrame >= from + 120)) {
            clearInterval(timer);
            resolve();
          }
        } catch (e) {
          clearInterval(timer);
          reject(e);
        }
      }, 1000 / 60);
      // At 1 s, P1 and P2 stop hearing P3 and P4 (every packet between the halves lost, both ways); the lobby still
      // reaches everyone.
      setTimeout(() => {
        for (const i of [0, 1]) matches[i]!.lossy!.impairment.cut = [ids[2]!, ids[3]!];
        for (const i of [2, 3]) matches[i]!.lossy!.impairment.cut = [ids[0]!, ids[1]!];
      }, 1000);
      setTimeout(() => (clearInterval(timer), reject(new Error(`not one game again (${JSON.stringify(events)})`))), 25_000);
    });
    await done;
    // One half dropped out of the split and came back; the other never did.
    const losers = [...dropped].sort();
    expect([[0, 1], [2, 3]]).toContainEqual(losers);
    for (const i of losers) expect(events[i]).toContain("dropped split");
    for (const i of [0, 1, 2, 3].filter((p) => !losers.includes(p))) {
      expect(events[i]).not.toContain("dropped split");
      for (const p of losers) expect(events[i]).toEqual(expect.arrayContaining([`disconnected P${p + 1} timeout`, `rejoined P${p + 1}`]));
    }
    const from = Math.max(...back.values()), last = Math.min(...matches.map((m) => m.session!.finalizedFrame));
    for (let f = from; f <= last; f++) for (const i of [1, 2, 3]) expect(finals[i]!.get(f), `peer ${i} frame ${f}`).toBe(finals[0]!.get(f));
    for (const m of matches) expect(m.session!.stats.desyncs).toBe(0);
    for (const m of matches) m.close();
  }, 30_000);

  it("P1, who feeds the spectator, leaves: P2 takes over the feed, and keeps it when P1 rejoins", async () => {
    const lobbies = [await connect(), await connect(), await connect(), await connect()];
    const room = await lobbies[0]!.create();
    for (const l of lobbies.slice(1, 3)) await l.join(room.code);
    await lobbies[3]!.join(room.code, { spectator: true });
    const starts = lobbies.map(started);
    lobbies[0]!.start();
    const infos = await Promise.all(starts);
    const input = scriptedInput(23), LEFT = 0x8000;
    const finals: Map<number, number>[] = [new Map(), new Map(), new Map(), new Map()];
    let lost = false;
    const play = (lobby: LobbyClient, start: StartInfo, i: number) =>
      startNetMatch(lobby, start, {
        game: toyGame,
        state: createToy(3),
        mode: "relay",
        disconnectedInput: LEFT,
        impairment: { latency: 20, jitter: 10, loss: 0.02 },
        onFinal: (f, s) => finals[i]!.set(f, toyGame.hash(s)),
        onSpectatorLost: () => (lost = true),
      });
    const matches: (NetMatch<ToyState> | null)[] = infos.map((start, i) => play(lobbies[i]!, start, i));
    const watcher = matches[3]!;
    expect(watcher.localPlayer).toBe(-1);
    const key = lobbies[0]!.key, ids = infos[0]!.players;
    let leftAt = -1, rejoinedAt = -1;
    await new Promise<void>((resolve, reject) => {
      const timer = setInterval(() => {
        try {
          for (const m of matches) {
            if (!m) continue;
            m.pump();
            const f = (m.session?.frame ?? 0) + (m.session?.inputDelay ?? 0);
            m.tick(f <= 500 ? input(m.localPlayer, f) : 0);
          }
          if (rejoinedAt >= 0 && matches[0]?.session && watcher.frame >= rejoinedAt + 200 && matches.every((m) => (m?.session?.finalizedFrame ?? Infinity) >= watcher.frame)) {
            clearInterval(timer);
            resolve();
          }
        } catch (e) {
          clearInterval(timer);
          reject(e);
        }
      }, 1000 / 60);
      // P1 leaves at 1 s (a reload: his lobby connection closes) and comes back with his key at 3 s.
      setTimeout(() => {
        leftAt = matches[1]!.session!.frame;
        matches[0]!.close();
        matches[0] = null;
        lobbies[0]!.close();
      }, 1000);
      setTimeout(async () => {
        const l = await connect();
        const start = started(l);
        await l.join(room.code, { rejoin: key });
        finals[0]!.clear();
        matches[0] = play(l, await start, 0);
        rejoinedAt = matches[1]!.session!.frame;
      }, 3000);
      setTimeout(() => (clearInterval(timer), reject(new Error(`the spectator stopped at frame ${watcher.frame}`))), 15_000);
    });
    // The spectator went on past P1's leaving and his return, fed by P2 (P1, back from a snapshot, can't feed it).
    expect(lost).toBe(false);
    expect(watcher.frame).toBeGreaterThan(leftAt + 300);
    expect(watcher.spectator!.host).toBe(String(ids[1]));
    for (let f = 0; f <= watcher.frame; f++) expect(finals[3]!.get(f), `spectator frame ${f}`).toBe(finals[1]!.get(f));
    for (const m of matches) expect(m!.session?.stats.desyncs ?? 0).toBe(0);
    for (const m of matches) m!.close();
  }, 20_000);

  it("a free room's player who joins mid-match watches it: player 0 feeds him as it feeds spectators", async () => {
    const lobbies = [await connect(), await connect()];
    const room = await lobbies[0]!.free({ name: "A" });
    await lobbies[1]!.free({ name: "B" });
    const starts = lobbies.map(started);
    lobbies[0]!.start();
    const infos = await Promise.all(starts);
    const finals: number[][] = [[], [], []];
    const matches = infos.map((start, i) =>
      startNetMatch(lobbies[i]!, start, { game: toyGame, state: createToy(2), mode: "relay", onFinal: (f, s) => (finals[i]![f] = toyGame.hash(s)) }),
    );
    const input = scriptedInput(3), END = 150;
    let late: NetMatch<ToyState> | null = null;
    await new Promise<void>((resolve, reject) => {
      const timer = setInterval(() => {
        for (const m of matches) {
          const f = m.session!.frame + m.session!.inputDelay;
          m.tick(f <= 120 ? input(m.localPlayer, f) : 0);
        }
        late?.tick(0);
        if (matches.every((m) => m.session!.finalizedFrame >= END) && (late?.frame ?? 0) >= END) {
          clearInterval(timer);
          resolve();
        }
      }, 1000 / 60);
      setTimeout(async () => {
        const l = await connect();
        const start = started(l);
        const joined = await l.free({ name: "C" });
        expect([joined.code, joined.members.find((m) => m.id === l.you)!.slot]).toEqual([room.code, 2]); // a player's slot
        late = startNetMatch(l, await start, { game: toyGame, state: createToy(2), mode: "relay", onFinal: (f, s) => (finals[2]![f] = toyGame.hash(s)) });
        expect(late.localPlayer).toBe(-1);
      }, 500);
      setTimeout(() => (clearInterval(timer), reject(new Error("the late player never caught up"))), 10_000);
    });
    for (let f = 0; f <= END; f++) for (const i of [1, 2]) expect(finals[i]![f], `peer ${i} frame ${f}`).toBe(finals[0]![f]);
    for (const m of [...matches, late!]) m.close();
  }, 15_000);

  it("plays a rematch in the same room: the first match's late packets and byes don't reach the second", async () => {
    const lobbies = [await connect(), await connect()];
    const room = await lobbies[0]!.create();
    await lobbies[1]!.join(room.code);
    const input = scriptedInput(5);
    const finals: number[][][] = [];
    const events: string[][] = [];
    const current: (NetMatch<ToyState> | null)[] = [null, null];
    const play = (i: number, start: StartInfo) => {
      const n = start.match!;
      (finals[n] ??= [[], []])[i] = [];
      (events[n] ??= []);
      // The old match leaves with bye packets (the default close), which the new one must ignore.
      current[i]?.close();
      current[i] = startNetMatch(lobbies[i]!, start, {
        game: toyGame,
        state: createToy(2),
        mode: "relay",
        impairment: { latency: 30, jitter: 20, loss: 0.05 },
        onFinal: (f, st) => (finals[n]![i]![f] = toyGame.hash(st)),
        onEvent: (e) => events[n]!.push(`${i}:${e.type}`),
      });
    };
    lobbies.forEach((l, i) => l.on("start", (start) => play(i, start)));
    const run = (until: (m: NetMatch<ToyState>[]) => boolean) =>
      new Promise<void>((resolve, reject) => {
        const timer = setInterval(() => {
          const ms = current.filter((m): m is NetMatch<ToyState> => m !== null);
          for (const m of ms) {
            m.pump();
            const f = m.session!.frame + m.session!.inputDelay;
            m.tick(f <= 100 ? input(m.localPlayer + m.match, f) : 0);
          }
          if (ms.length === 2 && until(ms)) {
            clearInterval(timer);
            resolve();
          }
        }, 1000 / 60);
        setTimeout(() => (clearInterval(timer), reject(new Error("match did not finish"))), 10_000);
      });
    lobbies[0]!.start();
    await run((ms) => ms.every((m) => m.match === 1 && m.session!.finalizedFrame >= 90));
    lobbies[0]!.start(); // rematch while match 1 still runs
    await run((ms) => ms.every((m) => m.match === 2 && m.session!.finalizedFrame >= 130));
    for (const n of [1, 2]) {
      const frames = n === 1 ? 90 : 130;
      expect(finals[n]![1]!.slice(0, frames + 1), `match ${n}`).toEqual(finals[n]![0]!.slice(0, frames + 1));
    }
    expect(finals[2]![0]!.slice(0, 90)).not.toEqual(finals[1]![0]!.slice(0, 90)); // other inputs: a new game
    expect(events[2]).toEqual([]); // no "disconnected" from match 1's byes, no desync from its hash reports
    for (const m of current) {
      expect(m!.session!.stats.desyncs).toBe(0);
      expect(m!.session!.peerInfo()[0]!.status).toBe("connected");
    }
    for (const m of current) m!.close();
  }, 25_000);
});
