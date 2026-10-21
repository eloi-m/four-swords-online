import { connect, type Socket } from "node:net";
import { LobbyClient, RelayTransport, RollbackSession, type RoomInfo, type StartInfo } from "@fso/net";
import { createToy, toyGame, scriptedInput } from "@fso/net/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { startSignalServer, type SignalServer } from "./server.ts";
import { acceptKey } from "./websocket.ts";
import { ROOM_WORDS } from "./words.ts";

let server: SignalServer;
let url: string;
const clients: LobbyClient[] = [];

beforeAll(async () => {
  server = await startSignalServer({ port: 0, host: "127.0.0.1" });
  url = `ws://127.0.0.1:${server.port}`;
});
afterAll(async () => {
  for (const c of clients) c.close();
  await server.close();
});

async function client(): Promise<LobbyClient> {
  const c = await LobbyClient.connect(url);
  clients.push(c);
  return c;
}
const next = <T>(subscribe: (fn: (v: T) => void) => () => void): Promise<T> =>
  new Promise((resolve) => {
    const off = subscribe((v) => {
      off();
      resolve(v);
    });
  });
const nextRoom = (c: LobbyClient, pred: (r: RoomInfo) => boolean = () => true) =>
  new Promise<RoomInfo>((resolve) => {
    const off = c.on("room", (r) => pred(r) && (off(), resolve(r)));
  });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("signaling server", () => {
  it("creates a room, lets players join by code into slots, and starts for everyone", async () => {
    const [a, b, c] = [await client(), await client(), await client()];
    const room = await a.create({ name: "Alice", maxPlayers: 3 });
    expect(ROOM_WORDS).toContain(room.code);
    expect(room.members).toEqual([{ id: 1, name: "Alice", slot: 0 }]);
    expect(a.you).toBe(1);

    const seenByA = nextRoom(a, (r) => r.members.length === 2);
    const joined = await b.join(room.code.toLowerCase(), { name: "Bob" });
    expect(joined.members.map((m) => m.slot)).toEqual([0, 1]);
    expect((await seenByA).members[1]).toEqual({ id: 2, name: "Bob", slot: 1 });

    await c.join(room.code, { spectator: true });
    await expect((await client()).join(room.code)).resolves.toMatchObject({ code: room.code }); // third player slot
    await expect((await client()).join(room.code)).rejects.toThrow(/full/);
    await expect((await client()).join("NOPE0")).rejects.toThrow(/no such room/);

    const starts = [a, b, c].map((x) => next<StartInfo>((fn) => x.on("start", fn)));
    b.start();
    await expect(next<string>((fn) => b.on("error", fn))).resolves.toMatch(/only the host/);
    a.start({ stage: "boss010" });
    const infos = await Promise.all(starts);
    for (const info of infos) {
      expect(info.players).toEqual([1, 2, 4]);
      expect(info.seed).toBe(infos[0]!.seed);
      expect(info.config).toEqual({ stage: "boss010" });
      expect(info.room.started).toBe(true);
    }
    await expect((await client()).join(room.code)).rejects.toThrow(/already started/);
    const late = await client();
    const lateStart = next<StartInfo>((fn) => late.on("start", fn));
    await expect(late.join(room.code, { spectator: true })).resolves.toMatchObject({ started: true });
    expect(await lateStart).toMatchObject({ seed: infos[0]!.seed, players: [1, 2, 4] });
  });

  it("hands the host role over when the host leaves, and closes empty rooms", async () => {
    const [a, b] = [await client(), await client()];
    const room = await a.create();
    await b.join(room.code);
    const left = next<number>((fn) => b.on("left", fn));
    const update = nextRoom(b, (r) => r.members.length === 1);
    a.leave();
    expect(await left).toBe(1);
    expect((await update).host).toBe(2);
    b.leave();
    await sleep(50);
    expect(server.rooms().some((r) => r.code === room.code)).toBe(false);
  });

  it("forwards signaling messages and relays binary datagrams between members", async () => {
    const [a, b] = [await client(), await client()];
    const room = await a.create();
    await b.join(room.code);
    const signal = next<[number, unknown]>((fn) => b.on("signal", (from, data) => fn([from, data])));
    a.signal(b.you, { rtc: "offer", sdp: "x".repeat(3000) }); // a 16-bit length frame
    expect(await signal).toEqual([1, { rtc: "offer", sdp: "x".repeat(3000) }]);

    const relayed = next<[number, Uint8Array]>((fn) => a.on("relay", (from, data) => fn([from, data.slice()])));
    b.relay(a.you, new Uint8Array([9, 8, 7]));
    const [from, data] = await relayed;
    expect(from).toBe(b.you);
    expect([...data]).toEqual([9, 8, 7]);
  });

  it("runs a rollback session over the relay (real timers)", async () => {
    const [a, b] = [await client(), await client()];
    const room = await a.create();
    await b.join(room.code);
    const starts = [a, b].map((x) => next<StartInfo>((fn) => x.on("start", fn)));
    a.start();
    const [sa] = await Promise.all(starts);
    const input = scriptedInput(3);
    const finals: number[][] = [[], []];
    const sessions = [a, b].map((lobby, p) => {
      const other = sa!.players[1 - p]!;
      return new RollbackSession({
        game: toyGame,
        state: createToy(2),
        players: 2,
        localPlayer: p,
        peers: [{ id: String(other), player: 1 - p }],
        transport: new RelayTransport(lobby),
        now: () => performance.now(),
        onFinal: (f, s) => (finals[p]![f] = toyGame.hash(s)),
      });
    });
    await new Promise<void>((resolve) => {
      let ticks = 0;
      const timer = setInterval(() => {
        sessions.forEach((s, p) => s.advance(s.frame + s.inputDelay < 60 ? input(p, s.frame + s.inputDelay) : 0));
        if (++ticks === 90) {
          clearInterval(timer);
          resolve();
        }
      }, 1000 / 60);
    });
    const frames = Math.min(...sessions.map((s) => s.finalizedFrame));
    expect(frames).toBeGreaterThan(60);
    expect(finals[1]!.slice(0, frames + 1)).toEqual(finals[0]!.slice(0, frames + 1));
    for (const s of sessions) {
      expect(s.stats.packetsReceived).toBeGreaterThan(50);
      expect(s.peerInfo()[0]!.status).toBe("connected");
    }
  });

  it("shares the host's settings, restarts matches (rematches) and ends them back to the room", async () => {
    const [a, b, c] = [await client(), await client(), await client()];
    const room = await a.create({ maxPlayers: 2, config: { arena: 3 } });
    expect(room).toMatchObject({ maxPlayers: 2, config: { arena: 3 }, matches: 0, started: false });
    await b.join(room.code);
    await expect(c.join(room.code)).rejects.toThrow(/full/);

    const raised = nextRoom(b, (r) => r.maxPlayers === 3);
    a.configure({ maxPlayers: 3, config: { arena: 5, hearts: 6 } });
    expect(await raised).toMatchObject({ config: { arena: 5, hearts: 6 } });
    b.configure({ config: { arena: 0 } });
    await expect(next<string>((fn) => b.on("error", fn))).resolves.toMatch(/only the host/);
    await c.join(room.code, { spectator: true });

    const first = [a, b, c].map((x) => next<StartInfo>((fn) => x.on("start", fn)));
    a.start({ arena: 5 });
    const one = await Promise.all(first);
    expect(one.map((s) => s.match)).toEqual([1, 1, 1]);
    expect(one[0]!.room).toMatchObject({ started: true, matches: 1 });
    a.configure({ maxPlayers: 4 });
    await expect(next<string>((fn) => a.on("error", fn))).resolves.toMatch(/already started/);

    // A rematch straight from a running match: a new seed, the next match number.
    const second = [a, b, c].map((x) => next<StartInfo>((fn) => x.on("start", fn)));
    a.start({ arena: 5 });
    const two = await Promise.all(second);
    expect(two.map((s) => s.match)).toEqual([2, 2, 2]);
    expect(two[0]!.players).toEqual(one[0]!.players);

    // Back to the room: players can join again, and a spectator can take a slot.
    const ends = [b, c].map((x) => next<RoomInfo>((fn) => x.on("end", fn)));
    a.end();
    for (const r of await Promise.all(ends)) expect(r).toMatchObject({ started: false, matches: 2 });
    expect(b.started).toBeNull();
    const seated = nextRoom(a, (r) => r.members.find((m) => m.id === c.you)?.slot === 2);
    c.setRole(false);
    await seated;
    const third = [a, b, c].map((x) => next<StartInfo>((fn) => x.on("start", fn)));
    a.start();
    const three = await Promise.all(third);
    expect(three[0]!.players).toEqual([a.you, b.you, c.you]);
    expect(three[0]!.match).toBe(3);
  });

  it("lets a player who dropped rejoin the running match in his place with his key, and no one else", async () => {
    const [a, b, c] = [await client(), await client(), await client()];
    const room = await a.create({ name: "A" });
    await b.join(room.code, { name: "B" });
    await c.join(room.code, { name: "C" });
    expect(new Set([a.key, b.key, c.key]).size).toBe(3);
    expect(a.key).toMatch(/^[\w-]{16}$/);
    const started = [a, b, c].map((x) => next<StartInfo>((fn) => x.on("start", fn)));
    a.start();
    const [info] = await Promise.all(started);
    expect(info!.players).toEqual([a.you, b.you, c.you]);
    // B drops (a reload): his key brings him back as player 1, under a new id.
    const key = b.key, oldId = b.you;
    b.close();
    await next<number>((fn) => a.on("left", fn));
    await expect((await client()).join(room.code, { rejoin: "not-a-key" })).rejects.toThrow(/already started/);
    const back = await client();
    const rejoins = [a, c].map((x) => next<[number, number, number]>((fn) => x.on("rejoin", (...args) => fn(args))));
    // (The rejoin comes before the room update that lists him: player 0 mustn't take him for a spectator.)
    const order: string[] = [];
    a.on("rejoin", () => order.push("rejoin"));
    a.on("room", () => order.push("room"));
    const resumed = next<StartInfo>((fn) => back.on("start", fn));
    await back.join(room.code, { name: "B", rejoin: key });
    const start = await resumed;
    expect(start.resume).toBe(true);
    expect(back.key).toBe(key);
    expect(start.players).toEqual([a.you, back.you, c.you]);
    expect(back.you).not.toBe(oldId);
    for (const r of await Promise.all(rejoins)) expect(r).toEqual([1, back.you, start.match]);
    await sleep(50);
    expect(order.slice(0, 2)).toEqual(["rejoin", "room"]);
    expect(a.started!.players).toEqual([a.you, back.you, c.you]);
    // A lost connection the server hasn't noticed yet: the key's holder is let go first.
    const again = await client();
    const gone = next<number>((fn) => a.on("left", fn));
    await again.join(room.code, { rejoin: key });
    expect(await gone).toBe(back.you);
    expect(a.started!.players).toEqual([a.you, again.you, c.you]);
    // Once the match is over, the key is just a join (the room is open again).
    a.end();
    await next<RoomInfo>((fn) => c.on("end", fn));
    const later = await client();
    await expect(later.join(room.code, { rejoin: c.key })).resolves.toMatchObject({ started: false });
  });

  it("referees splits: the first claim wins, the other half's are refused until its players rejoin", async () => {
    const all = [await client(), await client(), await client(), await client()];
    const [a, b, c, d] = all;
    const room = await a!.create();
    for (const x of [b, c, d]) await x!.join(room.code);
    const started = all.map((x) => next<StartInfo>((fn) => x.on("start", fn)));
    a!.start();
    const match = (await Promise.all(started))[0]!.match!;
    const claim = (x: LobbyClient, keep: number[], cut: number[], m = match) => {
      const answer = next<[number, number[], number[], boolean]>((fn) => x.on("claim", (...args) => fn(args)));
      x.claim(m, keep, cut);
      return answer;
    };
    // P3 and P4 claim first: granted (again for P4, on the same side); P1's half is refused, whatever it keeps.
    expect(await claim(c!, [2, 3], [0, 1])).toEqual([match, [2, 3], [0, 1], true]);
    expect((await claim(d!, [2, 3], [0, 1]))[3]).toBe(true);
    expect((await claim(a!, [0, 1], [2, 3]))[3]).toBe(false);
    expect((await claim(b!, [0, 1, 3], [2]))[3]).toBe(false);
    // A claim must keep its claimant, and be about the running match.
    expect((await claim(c!, [3], [0, 1, 2]))[3]).toBe(false);
    expect((await claim(c!, [2, 3], [0, 1], match - 1))[3]).toBe(false);
    // P2 comes back (rejoins with his key): his new life isn't outvoted any more.
    const key = b!.key;
    b!.close();
    await next<number>((fn) => a!.on("left", fn));
    const back = await client();
    await back.join(room.code, { rejoin: key });
    expect((await claim(back, [1, 2, 3], [0]))[3]).toBe(true);
    expect((await claim(a!, [0], [1, 2, 3]))[3]).toBe(false);
    for (const x of [...all, back]) x.close(); // (the per-address cap: these tests share one server)
  });

  it("lets a player rejoin from the connection he's still in the room with (a dropped match, not a dropped lobby)", async () => {
    const [a, b] = [await client(), await client()];
    const room = await a.create();
    await b.join(room.code);
    const started = [a, b].map((x) => next<StartInfo>((fn) => x.on("start", fn)));
    a.start();
    await Promise.all(started);
    const oldId = b.you;
    const rejoin = next<[number, number, number]>((fn) => a.on("rejoin", (...args) => fn(args)));
    const resumed = next<StartInfo>((fn) => b.on("start", fn));
    await b.join(room.code, { rejoin: b.key });
    expect((await resumed).resume).toBe(true);
    expect((await rejoin).slice(0, 2)).toEqual([1, b.you]);
    expect(b.you).not.toBe(oldId);
    // Without the key (or another room's), it's still "already in a room".
    await expect(b.join(room.code)).rejects.toThrow(/already in a room/);
    for (const x of [a, b]) x.close();
  });

  it("keeps player slots contiguous when a player leaves (slot = Link color)", async () => {
    const [a, b, c, d] = [await client(), await client(), await client(), await client()];
    const room = await a.create();
    await b.join(room.code);
    await c.join(room.code);
    await d.join(room.code, { spectator: true });
    const moved = nextRoom(a, (r) => r.members.length === 3);
    b.leave();
    expect((await moved).members.map((m) => [m.id, m.slot])).toEqual([
      [a.you, 0],
      [c.you, 1],
      [d.you, null],
    ]);
    const watching = nextRoom(a, (r) => r.members.find((m) => m.id === c.you)?.slot === null);
    c.setRole(true);
    await watching;
    const seated = nextRoom(a, (r) => r.members.find((m) => m.id === d.you)?.slot === 1);
    d.setRole(false);
    await seated;
  });
});

describe("free rooms", () => {
  let free: SignalServer;
  let own: LobbyClient[] = [];
  const freeClient = async (port = free.port) => {
    const c = await LobbyClient.connect(`ws://127.0.0.1:${port}`);
    own.push(c);
    return c;
  };
  beforeAll(async () => {
    free = await startSignalServer({ port: 0, host: "127.0.0.1" });
  });
  afterEach(async () => {
    for (const c of own) c.close();
    own = [];
    await sleep(50);
  });
  afterAll(() => free.close());

  it("joins the first free room with a slot left, or opens one hosted by its first member", async () => {
    const [a, b] = [await freeClient(), await freeClient()];
    const room = await a.free({ name: "Alice" });
    expect(room).toMatchObject({ free: true, maxPlayers: 8, host: a.you, members: [{ id: a.you, name: "Alice", slot: 0 }] });
    const seenByA = nextRoom(a, (r) => r.members.length === 2);
    expect((await b.free()).code).toBe(room.code);
    expect((await seenByA).members[1]).toEqual({ id: b.you, name: "Player 2", slot: 1 });
    await expect(a.free()).rejects.toThrow(/already in a room/);

    for (let i = 2; i < 8; i++) expect((await (await freeClient()).free()).code).toBe(room.code);
    const ninth = await freeClient();
    const second = await ninth.free();
    expect(second.code).not.toBe(room.code);
    expect(second).toMatchObject({ free: true, host: ninth.you, members: [{ id: ninth.you, slot: 0 }] });
    expect(free.rooms().find((r) => r.code === room.code)!.members).toHaveLength(8);

    // A code-made room is never picked, and says nothing of being free.
    const regular = await (await freeClient()).create();
    expect(regular.free).toBeUndefined();
  });

  it("takes players while a match runs: they get the running start and play from the next one", async () => {
    const [a, b, c, d] = [await freeClient(), await freeClient(), await freeClient(), await freeClient()];
    const room = await a.free();
    await b.free();
    const first = [a, b].map((x) => next<StartInfo>((fn) => x.on("start", fn)));
    a.start({ arena: 1 });
    const one = await Promise.all(first);
    expect(one[0]!.players).toEqual([a.you, b.you]);

    const running = next<StartInfo>((fn) => c.on("start", fn));
    await expect(c.free()).resolves.toMatchObject({ code: room.code, started: true });
    expect(await running).toMatchObject({ match: 1, players: [a.you, b.you] });
    const replayed = next<StartInfo>((fn) => d.on("start", fn));
    await expect(d.join(room.code)).resolves.toMatchObject({ code: room.code });
    await replayed;
    expect(d.room!.members.find((m) => m.id === d.you)!.slot).toBe(3);

    const second = [a, b, c, d].map((x) => next<StartInfo>((fn) => x.on("start", fn)));
    a.start();
    const two = await Promise.all(second);
    expect(two.map((s) => s.match)).toEqual([2, 2, 2, 2]);
    expect(two[0]!.players).toEqual([a.you, b.you, c.you, d.you]);
  });

  it("keeps the places of players away (a dropped connection, not a leave) through the host's restarts, a while", async () => {
    const short = await startSignalServer({ port: 0, host: "127.0.0.1", freeAwayMs: 600 });
    try {
      const [a, b, c, d] = [await freeClient(short.port), await freeClient(short.port), await freeClient(short.port), await freeClient(short.port)];
      const room = await a.free();
      await b.free();
      await c.free();
      const first = [a, b, c].map((x) => next<StartInfo>((fn) => x.on("start", fn)));
      a.start({ mode: "free" });
      await Promise.all(first);
      // B's connection drops: his place is kept (RoomInfo.away); C leaves: his isn't.
      const bId = b.you, key = b.key;
      const away = nextRoom(a, (r) => r.away?.includes(bId) === true);
      b.close();
      expect((await away).away).toEqual([bId]);
      const left = nextRoom(a, (r) => !r.members.some((m) => m.id === c.you));
      c.leave();
      expect((await left).away).toEqual([bId]);
      // D joins; the host restarts keeping B: B stays P2 (absent), D comes after him.
      await d.free();
      const restart = [a, d].map((x) => next<StartInfo>((fn) => x.on("start", fn)));
      a.start({ mode: "free" }, [bId]);
      const two = (await Promise.all(restart))[0]!;
      expect(two.players).toEqual([a.you, bId, d.you]);
      expect(two.room.away).toEqual([bId]);
      // B comes back with his key: he's P2 of the restarted match, under a new id.
      const back = await freeClient(short.port);
      const resumed = next<StartInfo>((fn) => back.on("start", fn));
      await back.join(room.code, { rejoin: key });
      expect(await resumed).toMatchObject({ resume: true, match: two.match, players: [a.you, back.you, d.you] });
      expect(back.room!.away).toBeUndefined();
      // Away for good: after FREE_AWAY_MS the place goes, and a restart doesn't keep him even if asked.
      const backId = back.you;
      back.close();
      await nextRoom(a, (r) => r.away?.includes(backId) === true);
      await nextRoom(a, (r) => r.away === undefined);
      const third = next<StartInfo>((fn) => a.on("start", fn));
      a.start({ mode: "free" }, [backId]);
      expect((await third).players).toEqual([a.you, d.you]);
    } finally {
      await short.close();
    }
  });

  it("keeps the place of a player away from a battle started from free play through the free play after it", async () => {
    const [a, b, c] = [await freeClient(), await freeClient(), await freeClient()];
    const room = await a.free({ name: "A" });
    await b.free({ name: "B" });
    await c.free({ name: "C" });
    const starts = (xs: LobbyClient[]) => Promise.all(xs.map((x) => next<StartInfo>((fn) => x.on("start", fn))));
    let all = starts([a, b, c]);
    a.start({ mode: "free" });
    await all;
    all = starts([a, b, c]);
    a.start({ mode: "battle" });
    const battle = (await all)[0]!;
    expect(battle.players).toEqual([a.you, b.you, c.you]);
    // B's connection drops mid-battle: his place is kept.
    const bId = b.you, key = b.key;
    const away = nextRoom(a, (r) => r.away?.includes(bId) === true);
    b.close();
    expect((await away).away).toEqual([bId]);
    // The battle over, the host restarts free play keeping him: still P2 (absent), still his key.
    const restart = starts([a, c]);
    a.start({ mode: "free" }, [bId]);
    const free = (await restart)[0]!;
    expect(free.players).toEqual([a.you, bId, c.you]);
    expect(free.room.away).toEqual([bId]);
    const back = await freeClient();
    const resumed = next<StartInfo>((fn) => back.on("start", fn));
    await back.join(room.code, { rejoin: key, name: "B" });
    expect(await resumed).toMatchObject({ resume: true, match: free.match, players: [a.you, back.you, c.you] });
    expect(back.room!.members.find((m) => m.id === back.you)!.name).toBe("B");
    expect(back.room!.away).toBeUndefined();
  });

  it("hands the host role to the next member when the host leaves", async () => {
    const [a, b, c] = [await freeClient(), await freeClient(), await freeClient()];
    await a.free();
    await b.free();
    await c.free();
    const update = nextRoom(c, (r) => r.members.length === 2);
    a.leave();
    expect(await update).toMatchObject({ host: b.you, members: [{ id: b.you, slot: 0 }, { id: c.you, slot: 1 }] });
  });

  it("leaves code-made rooms at 4 players, closed to players while a match runs", async () => {
    const [a, b] = [await freeClient(), await freeClient()];
    const room = await a.create({ maxPlayers: 8 });
    expect(room.maxPlayers).toBe(4);
    a.configure({ maxPlayers: 8 });
    expect((await nextRoom(a)).maxPlayers).toBe(4);
    a.start();
    await next<StartInfo>((fn) => a.on("start", fn));
    await expect(b.join(room.code)).rejects.toThrow(/already started/);
  });

  it("reuses member ids past 255, never those of the running match's players", async () => {
    const s = await startSignalServer({ port: 0, host: "127.0.0.1", limits: { messagesPerSecond: 1e6, messageBurst: 1e6 } });
    try {
      const [a, b, c] = [await freeClient(s.port), await freeClient(s.port), await freeClient(s.port)];
      const room = await a.create();
      for (let id = 2; id <= 254; id++) {
        await b.join(room.code, { spectator: true });
        expect(b.you).toBe(id);
        b.leave();
      }
      await c.join(room.code);
      expect(c.you).toBe(255);
      await b.join(room.code);
      expect(b.you).toBe(2);

      // During a match, the id of a player who left stays out of reach; after it, it's reused.
      const starts = [a, b, c].map((x) => next<StartInfo>((fn) => x.on("start", fn)));
      a.start();
      expect((await Promise.all(starts))[0]!.players).toEqual([1, 255, 2]);
      b.leave();
      await b.join(room.code, { spectator: true });
      expect(b.you).toBe(3);
      b.leave();
      const ended = next<RoomInfo>((fn) => c.on("end", fn));
      a.end();
      await ended;
      await b.join(room.code, { spectator: true });
      expect(b.you).toBe(2);
    } finally {
      await s.close();
    }
  });
});

describe("hardening", () => {
  const status = (port: number, headers: Record<string, string> = {}, path = "/") =>
    new Promise<string>((resolve) => {
      const socket = connect(port, "127.0.0.1", () => {
        const key = Buffer.from("0123456789abcdef").toString("base64");
        const extra = Object.entries(headers).map(([k, v]) => `${k}: ${v}\r\n`).join("");
        socket.write(`GET ${path} HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n${extra}\r\n`);
      });
      socket.once("data", (d: Buffer) => {
        resolve(d.toString().split("\r\n")[0]!);
        socket.destroy();
      });
    });

  it("only lets allowed page origins connect", async () => {
    const s = await startSignalServer({ port: 0, host: "127.0.0.1", allowedOrigins: ["https://fso.example.org"] });
    try {
      expect(await status(s.port, { Origin: "https://fso.example.org" })).toMatch(/^HTTP\/1.1 101/);
      expect(await status(s.port, { Origin: "https://evil.example.com" })).toMatch(/^HTTP\/1.1 403/);
      expect(await status(s.port)).toMatch(/^HTTP\/1.1 403/);
      expect(s.stats.refusedOrigin).toBe(2);
    } finally {
      await s.close();
    }
  });

  it("requires the shared token when one is set, on top of the origin allowlist", async () => {
    const secret = "k3y-0123456789abcdef";
    const s = await startSignalServer({ port: 0, host: "127.0.0.1", allowedOrigins: ["https://fso.example.org"], token: secret });
    try {
      const ok = { Origin: "https://fso.example.org" };
      expect(await status(s.port, ok, `/?token=${secret}`)).toMatch(/^HTTP\/1.1 101/);
      expect(await status(s.port, ok)).toMatch(/^HTTP\/1.1 403/);
      expect(await status(s.port, ok, "/?token=wrong")).toMatch(/^HTTP\/1.1 403/);
      expect(await status(s.port, ok, `/?token=${secret}x`)).toMatch(/^HTTP\/1.1 403/);
      // The right token from another page's origin is still refused.
      expect(await status(s.port, { Origin: "https://evil.example.com" }, `/?token=${secret}`)).toMatch(/^HTTP\/1.1 403/);
      expect(s.stats).toMatchObject({ refusedToken: 3, refusedOrigin: 1 });
    } finally {
      await s.close();
    }
    // The lobby client carries it in the URL, as the pages do (apps/battle/src/online.ts withLobbyToken).
    const open = await startSignalServer({ port: 0, host: "127.0.0.1", token: secret });
    try {
      const c = await LobbyClient.connect(`ws://127.0.0.1:${open.port}/?token=${secret}`);
      expect(ROOM_WORDS).toContain((await c.create({ maxPlayers: 2 })).code);
      c.close();
      await expect(LobbyClient.connect(`ws://127.0.0.1:${open.port}`, 1000)).rejects.toThrow();
    } finally {
      await open.close();
    }
  });

  it("names each open room by a word of its own, and is full while every word is taken", async () => {
    const s = await startSignalServer({ port: 0, host: "127.0.0.1", limits: { maxConnectionsPerAddress: ROOM_WORDS.length + 2 } });
    const own: LobbyClient[] = [];
    try {
      const url = `ws://127.0.0.1:${s.port}`;
      for (let i = 0; i < ROOM_WORDS.length + 2; i++) own.push(await LobbyClient.connect(url));
      const [hosts, late] = [own.slice(0, ROOM_WORDS.length), own.slice(ROOM_WORDS.length)];
      const codes = await Promise.all(hosts.map(async (c) => (await c.create()).code));
      expect([...codes].sort()).toEqual([...ROOM_WORDS].sort());
      await expect(late[0]!.create()).rejects.toThrow(/server full/);
      await expect(late[1]!.free()).rejects.toThrow(/server full/);
      const closed = hosts[0]!.room!.code;
      hosts[0]!.leave();
      await sleep(50);
      expect((await late[0]!.create()).code).toBe(closed);
    } finally {
      for (const c of own) c.close();
      await s.close();
    }
  });

  it("caps connections per address (the proxy's X-Forwarded-For when trusted)", async () => {
    const s = await startSignalServer({ port: 0, host: "127.0.0.1", trustProxy: true, limits: { maxConnectionsPerAddress: 2 } });
    try {
      const xff = { "X-Forwarded-For": "6.6.6.6, 10.0.0.1" }; // the proxy appends the address it saw
      const held = [await rawClientOn(s.port, xff), await rawClientOn(s.port, xff)];
      expect(await status(s.port, xff)).toMatch(/^HTTP\/1.1 503/);
      expect(await status(s.port, { "X-Forwarded-For": "10.0.0.2" })).toMatch(/101/);
      for (const socket of held) socket.destroy();
    } finally {
      await s.close();
    }
  });

  it("rate-limits lobby messages and relayed datagrams, and closes connections that guess codes", async () => {
    let t = 0;
    const s = await startSignalServer({
      port: 0,
      host: "127.0.0.1",
      now: () => t,
      limits: { messagesPerSecond: 1, messageBurst: 3, relayPerSecond: 10, relayBurst: 5, maxFailedJoins: 3 },
    });
    const own: LobbyClient[] = [];
    try {
      const url = `ws://127.0.0.1:${s.port}`;
      const [a, b] = [await LobbyClient.connect(url), await LobbyClient.connect(url)];
      own.push(a, b);
      const room = await a.create(); // 1 of a's 3 messages
      await b.join(room.code);
      const errors: string[] = [];
      a.on("error", (e) => errors.push(e));
      for (let i = 0; i < 4; i++) a.signal(b.you, { n: i }); // 2 pass, 2 dropped
      const got: unknown[] = [];
      b.on("signal", (_, data) => got.push(data));
      let relayed = 0;
      b.on("relay", () => relayed++);
      for (let i = 0; i < 8; i++) a.relay(b.you, new Uint8Array([i]));
      await sleep(100);
      expect(got).toEqual([{ n: 0 }, { n: 1 }]);
      expect(errors).toEqual(["too many messages"]);
      expect(relayed).toBe(5);
      expect(s.stats.relayDropped).toBe(3);
      t += 1000; // one more message, 10 more datagrams
      a.signal(b.you, { n: 9 });
      for (let i = 0; i < 12; i++) a.relay(b.you, new Uint8Array([i]));
      await sleep(100);
      expect(got.at(-1)).toEqual({ n: 9 });
      expect(relayed).toBe(10);

      const guesser = await LobbyClient.connect(url);
      own.push(guesser);
      const closed = next<void>((fn) => guesser.on("close", fn));
      for (const code of ["AAAAA", "BBBBB", "CCCCC"]) {
        t += 1000;
        await expect(guesser.join(code)).rejects.toThrow(/no such room|closed/);
      }
      await closed;
    } finally {
      for (const c of own) c.close();
      await s.close();
    }
  });
});

function rawClientOn(port: number, headers: Record<string, string>): Promise<Socket> {
  return new Promise((resolve) => {
    const socket = connect(port, "127.0.0.1", () => {
      const key = Buffer.from("0123456789abcdef").toString("base64");
      const extra = Object.entries(headers).map(([k, v]) => `${k}: ${v}\r\n`).join("");
      socket.write(`GET / HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n${extra}\r\n`);
    });
    socket.once("data", () => resolve(socket));
  });
}

// Raw sockets, to check the framing a browser would never send.
function rawClient(): Promise<{ socket: Socket; read: () => Promise<Buffer> }> {
  return new Promise((resolve) => {
    const socket = connect(server.port, "127.0.0.1", () => {
      const key = Buffer.from("0123456789abcdef").toString("base64");
      socket.write(`GET / HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
      let buf = Buffer.alloc(0);
      const waiters: ((b: Buffer) => void)[] = [];
      socket.on("data", (d: Buffer) => {
        buf = Buffer.concat([buf, d]);
        const w = waiters.shift();
        if (w) {
          const out = buf;
          buf = Buffer.alloc(0);
          w(out);
        }
      });
      const read = () =>
        new Promise<Buffer>((res) => {
          if (buf.length) {
            const out = buf;
            buf = Buffer.alloc(0);
            res(out);
          } else waiters.push(res);
        });
      resolve({ socket, read });
    });
  });
}

function frame(op: number, payload: Buffer, { mask = true, fin = true } = {}): Buffer {
  const key = Buffer.from([1, 2, 3, 4]);
  const n = payload.length;
  const len = n < 126 ? Buffer.from([n]) : n < 65536 ? Buffer.from([126, n >> 8, n & 255]) : Buffer.concat([Buffer.from([127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; })()]);
  len[0] = len[0]! | (mask ? 0x80 : 0);
  const body = mask ? Buffer.from(payload.map((v, i) => v ^ key[i & 3]!)) : payload;
  return Buffer.concat([Buffer.from([(fin ? 0x80 : 0) | op]), len, mask ? key : Buffer.alloc(0), body]);
}

describe("websocket framing", () => {
  it("answers the handshake with the RFC 6455 accept key", async () => {
    expect(acceptKey("dGhlIHNhbXBsZSBub25jZQ==")).toBe("s3pPLMBiTxaQ9kYGzzhZRbK+xOo="); // the RFC's example
    const { socket, read } = await rawClient();
    const reply = (await read()).toString();
    expect(reply).toMatch(/^HTTP\/1.1 101/);
    expect(reply).toContain(`Sec-WebSocket-Accept: ${acceptKey(Buffer.from("0123456789abcdef").toString("base64"))}`);
    socket.destroy();
  });

  it("pongs pings, reassembles fragments, and closes on unmasked or oversized frames", async () => {
    const { socket, read } = await rawClient();
    await read(); // handshake
    socket.write(frame(9, Buffer.from("hi")));
    expect([...(await read())]).toEqual([0x8a, 2, ...Buffer.from("hi")]);

    const msg = JSON.stringify({ t: "create", name: "Frag" });
    socket.write(frame(1, Buffer.from(msg.slice(0, 5)), { fin: false }));
    socket.write(frame(0, Buffer.from(msg.slice(5))));
    const welcome = await read();
    expect(welcome[0]).toBe(0x81);
    expect(JSON.parse(welcome.subarray(welcome[1]! === 126 ? 4 : 2).toString())).toMatchObject({ t: "welcome", room: { members: [{ name: "Frag" }] } });

    socket.write(frame(1, Buffer.from("{}"), { mask: false }));
    const close = await read();
    expect(close[0]).toBe(0x88);
    expect(close.readUInt16BE(2)).toBe(1002);
    socket.destroy();

    const big = await rawClient();
    await big.read();
    big.socket.write(frame(2, Buffer.alloc(70 * 1024)));
    const tooBig = await big.read();
    expect(tooBig[0]).toBe(0x88);
    expect(tooBig.readUInt16BE(2)).toBe(1009);
    big.socket.destroy();
  });

  it("refuses non-WebSocket upgrades and serves a status page", async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/`);
    expect(await res.json()).toMatchObject({ service: "four-swords-online signaling" });
    expect((await fetch(`http://127.0.0.1:${server.port}/nope`)).status).toBe(404);
  });
});
