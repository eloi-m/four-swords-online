// Signaling server: lobbies by room code (create/join, player slots, host settings, the host starts match after
// match), free rooms (joined without a code, up to 8 players, open to players while a match runs), players rejoining
// the running match in their slot (with the key of their welcome), forwarding of WebRTC signaling messages between
// members, and a binary datagram relay for peers whose WebRTC connection fails.
// Protocol types: packages/net/src/lobby.ts. Notes and hosting: docs/netcode.md.
//
// Hardening that needs no extra infrastructure: an Origin allowlist, an optional shared secret (`token`, checked on
// the handshake as ?token=), connection caps (total and per address), a room cap, token-bucket rate limits on lobby
// messages and on relayed bytes/datagrams, and a cap on failed joins (code guessing). Behind a reverse proxy,
// `trustProxy` takes the client address from X-Forwarded-For.
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { MAX_RELAY_PAYLOAD, type ClientMessage, type RoomInfo, type ServerMessage } from "@fso/net";
import { upgrade, type WsConnection } from "./websocket.ts";
import { ROOM_WORDS } from "./words.ts";

const MAX_PLAYERS = 4;
/** Players in a free room: one shared room anyone joins without a code (`free`), even while a match runs. */
const FREE_PLAYERS = 8;
const MAX_SPECTATORS = 8;
/** Member ids are one byte on the relay. */
const MAX_MEMBER_ID = 255;
const MAX_CONFIG_BYTES = 2048;
const HEARTBEAT_MS = 20_000;
/**
 * A free room keeps the places of its running match's players whose connection dropped (not a `leave`) this long: the
 * host's restarts keep them as players (`start` with `keep`), so a page back from the background rejoins in its slot.
 */
export const FREE_AWAY_MS = 120_000;

export interface SignalLimits {
  /** Open rooms (default 10 000; never more than the room words, ROOM_WORDS). */
  maxRooms: number;
  /** WebSocket connections (default 5 000). */
  maxConnections: number;
  /** Connections from one address (default 32). */
  maxConnectionsPerAddress: number;
  /** Lobby (JSON) messages per second per connection, and the burst allowed (default 20 / 60). */
  messagesPerSecond: number;
  messageBurst: number;
  /** Relayed datagrams per second per connection, and the burst (default 1 200 / 2 400: a host feeding 8 spectators). */
  relayPerSecond: number;
  relayBurst: number;
  /** Relayed bytes per second per connection, and the burst (default 128 KB / 256 KB). */
  relayBytesPerSecond: number;
  relayBytesBurst: number;
  /** Failed joins (unknown code, full room…) before the connection is closed (default 20). */
  maxFailedJoins: number;
}

export const DEFAULT_LIMITS: SignalLimits = {
  maxRooms: 10_000,
  maxConnections: 5_000,
  maxConnectionsPerAddress: 32,
  messagesPerSecond: 20,
  messageBurst: 60,
  relayPerSecond: 1_200,
  relayBurst: 2_400,
  relayBytesPerSecond: 128 * 1024,
  relayBytesBurst: 256 * 1024,
  maxFailedJoins: 20,
};

export interface SignalServerOptions {
  port?: number;
  host?: string;
  log?: (line: string) => void;
  /** Page origins allowed to connect (e.g. "https://fso.example.org"); empty or absent = any origin. */
  allowedOrigins?: readonly string[];
  /** Take the client address from the last X-Forwarded-For entry (set by your reverse proxy). */
  trustProxy?: boolean;
  /** A shared secret the handshake must carry as `?token=` (pages can't set WebSocket headers, and Safari doesn't
   *  send a site's Basic credentials on one). Empty or absent = an open lobby. */
  token?: string;
  limits?: Partial<SignalLimits>;
  /** Clock for the rate limits (ms), for tests. */
  now?: () => number;
  /** How long a free room keeps the place of a player whose connection dropped (default FREE_AWAY_MS), for tests. */
  freeAwayMs?: number;
}

interface Member {
  id: number;
  name: string;
  slot: number | null;
  conn: WsConnection;
  state: ConnState;
  /** Secret (sent in its welcome only): a player who drops out of the running match comes back with it. */
  key: string;
}

interface Room {
  code: string;
  free: boolean;
  host: number;
  maxPlayers: number;
  started: boolean;
  matches: number;
  config: unknown;
  /** The start message of the running match, replayed to spectators joining mid-match. */
  start: { seed: number; players: number[]; config: unknown; match: number } | null;
  /** The running match's players' keys, by player index (never sent). */
  keys: string[];
  /** The running match's players a granted claim cut (a split's losing half), until each one rejoins. */
  outvoted: Set<number>;
  /** A free room's players of the running match whose connection dropped: member id → when (see FREE_AWAY_MS). */
  away: Map<number, number>;
  nextId: number;
  members: Map<number, Member>;
}

interface ConnState {
  room: Room | null;
  id: number;
  address: string;
  messages: Bucket;
  relayCount: Bucket;
  relayBytes: Bucket;
  failedJoins: number;
  /** Rate-limited messages so far (the connection is closed when this keeps growing). */
  strikes: number;
}

export interface SignalServer {
  readonly port: number;
  readonly http: Server;
  /** Open rooms (for tests and the status page). */
  rooms(): RoomInfo[];
  /** Counters of refused or dropped traffic. */
  readonly stats: { refusedOrigin: number; refusedToken: number; refusedFull: number; rateLimited: number; relayDropped: number };
  close(): Promise<void>;
}

/** Token bucket: `rate` tokens per second up to `burst`. */
class Bucket {
  private tokens: number;
  private last: number;
  private readonly rate: number;
  private readonly burst: number;
  constructor(rate: number, burst: number, now: number) {
    this.rate = rate;
    this.burst = burst;
    this.tokens = burst;
    this.last = now;
  }
  take(n: number, now: number): boolean {
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) * this.rate) / 1000);
    this.last = now;
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
}

export async function startSignalServer(options: SignalServerOptions = {}): Promise<SignalServer> {
  const log = options.log ?? (() => {});
  const limits: SignalLimits = { ...DEFAULT_LIMITS, ...options.limits };
  const allowed = new Set(options.allowedOrigins ?? []);
  const now = options.now ?? (() => performance.now());
  const freeAwayMs = options.freeAwayMs ?? FREE_AWAY_MS;
  const rooms = new Map<string, Room>();
  const conns = new Set<WsConnection>();
  const perAddress = new Map<string, number>();
  const stats = { refusedOrigin: 0, refusedToken: 0, refusedFull: 0, rateLimited: 0, relayDropped: 0 };
  // Compared as digests: equal lengths for timingSafeEqual, and the secret's length doesn't leak either.
  const digest = (s: string) => createHash("sha256").update(s).digest();
  const token = options.token ? digest(options.token) : null;

  const info = (room: Room): RoomInfo => ({
    code: room.code,
    ...(room.free ? { free: true as const } : {}),
    host: room.host,
    maxPlayers: room.maxPlayers,
    started: room.started,
    matches: room.matches,
    config: room.config,
    members: [...room.members.values()].map(({ id, name, slot }) => ({ id, name, slot })),
    ...(room.away.size > 0 ? { away: [...room.away.keys()] } : {}),
  });
  const send = (conn: WsConnection, message: ServerMessage) => conn.send(JSON.stringify(message));
  const broadcast = (room: Room, message: ServerMessage, except?: number) => {
    for (const m of room.members.values()) if (m.id !== except) send(m.conn, message);
  };
  /** No room can open: the cap, or every room word in use (where `newCode` would never return). */
  const full = () => rooms.size >= Math.min(limits.maxRooms, ROOM_WORDS.length);
  const newCode = (): string => {
    for (;;) {
      const code = ROOM_WORDS[randomInt(ROOM_WORDS.length)]!;
      if (!rooms.has(code)) return code;
    }
  };
  const cleanName = (name: unknown, fallback: string): string =>
    typeof name === "string" && name.trim() ? name.trim().replace(/[\u0000-\u001f]/g, "").slice(0, 24) : fallback;
  const clampPlayers = (value: unknown, fallback: number, max = MAX_PLAYERS) =>
    Math.min(max, Math.max(1, Math.floor(Number(value ?? fallback)) || fallback));
  /** A JSON value of at most MAX_CONFIG_BYTES, or undefined if it's too big. */
  const cleanConfig = (config: unknown): unknown => {
    if (config === undefined) return null;
    const json = JSON.stringify(config);
    return json === undefined ? null : json.length > MAX_CONFIG_BYTES ? undefined : (JSON.parse(json) as unknown);
  };
  const players = (room: Room) => [...room.members.values()].filter((m) => m.slot !== null);
  const freeSlot = (room: Room): number | null => {
    const taken = new Set(players(room).map((m) => m.slot));
    return Array.from({ length: room.maxPlayers }, (_, i) => i).find((i) => !taken.has(i)) ?? null;
  };
  /** The id the next member gets; past 255, the lowest one free again, or null when every id is taken. */
  const freeMemberId = (room: Room): number | null => {
    if (room.nextId <= MAX_MEMBER_ID) return room.nextId;
    // The running match's departed players keep their ids: its peers may still address them, and a newcomer must not
    // get those datagrams. Later matches tag every datagram with their number (peer-transport.ts), so an id reused
    // after the match ends can't receive the older match's late packets.
    const taken = new Set([...room.members.keys(), ...(room.start?.players ?? [])]);
    for (let id = 1; id <= MAX_MEMBER_ID; id++) if (!taken.has(id)) return id;
    return null;
  };
  const openRoom = (free: boolean, maxPlayers: number, config: unknown): Room => {
    const room: Room = { code: newCode(), free, host: 1, maxPlayers, started: false, matches: 0, config, start: null, keys: [], outvoted: new Set(), away: new Map(), nextId: 1, members: new Map() };
    rooms.set(room.code, room);
    return room;
  };

  /** Out of its room: `away` when its connection dropped (or it's rejoining from elsewhere), not a `leave`. */
  function leave(state: ConnState, away = false): void {
    const room = state.room;
    if (!room) return;
    const member = room.members.get(state.id);
    room.members.delete(state.id);
    state.room = null;
    if (room.members.size === 0) {
      rooms.delete(room.code);
      log(`room ${room.code} closed`);
      return;
    }
    if (away && room.free && room.started && member?.slot != null && room.start?.players.includes(state.id)) {
      // A free room's player gone without a word (a page in the background): his place is kept a while (FREE_AWAY_MS).
      const id = state.id, since = now();
      room.away.set(id, since);
      setTimeout(() => {
        if (room.away.get(id) !== since || rooms.get(room.code) !== room) return;
        room.away.delete(id);
        broadcast(room, { t: "room", room: info(room) });
      }, freeAwayMs).unref();
    }
    // Slots stay contiguous (slot = Link color): the players after the one who left move up. A running match isn't
    // affected: it identifies players by member id (StartInfo.players).
    const slot = member?.slot ?? null;
    if (slot !== null) for (const m of room.members.values()) if (m.slot !== null && m.slot > slot) m.slot--;
    if (room.host === state.id) {
      const members = [...room.members.values()];
      room.host = (members.find((m) => m.slot !== null) ?? members[0]!).id;
    }
    broadcast(room, { t: "left", id: state.id });
    broadcast(room, { t: "room", room: info(room) });
  }

  function handle(conn: WsConnection, state: ConnState, message: ClientMessage): void {
    const error = (text: string) => send(conn, { t: "error", message: text });
    const failJoin = (text: string) => {
      error(text);
      if (++state.failedJoins >= limits.maxFailedJoins) conn.close(1008, "too many failed joins");
    };
    const hostRoom = (): Room | null => {
      const room = state.room;
      if (room && room.host === state.id) return room;
      error(room ? "only the host can do that" : "not in a room");
      return null;
    };
    /**
     * Adds this connection to the room (slot null = a spectator); false when no member id is left. `back`: the player
     * index of the running match it rejoins (its key), whose place it takes under its new id.
     */
    const admit = (room: Room, slot: number | null, name: unknown, back?: { player: number; key: string }): boolean => {
      const id = freeMemberId(room);
      if (id === null) return false;
      if (id === room.nextId) room.nextId++;
      const key = back?.key ?? randomBytes(12).toString("base64url");
      room.members.set(id, { id, name: cleanName(name, slot === null ? `Spectator ${id}` : `Player ${slot + 1}`), slot, conn, state, key });
      state.room = room;
      state.id = id;
      send(conn, { t: "welcome", you: id, room: info(room), key });
      if (back && room.start) {
        // Before the room update: the match's player 0 must not take him for a newcomer to feed as a spectator.
        room.away.delete(room.start.players[back.player]!);
        room.outvoted.delete(back.player); // (a new life: the cuts of his earlier one don't count)
        room.start.players[back.player] = id;
        broadcast(room, { t: "rejoin", player: back.player, id, match: room.start.match }, id);
        log(`room ${room.code}: player ${back.player + 1} of match ${room.start.match} rejoined as ${id}`);
      }
      broadcast(room, { t: "room", room: info(room) }, id);
      if (room.start) send(conn, { t: "start", ...room.start, room: info(room), ...(back ? { resume: true as const } : {}) });
      return true;
    };
    /** The running match's player index whose key this is, or -1. */
    const keyed = (room: Room, key: unknown): number => (room.started && room.start && typeof key === "string" && key ? room.keys.indexOf(key) : -1);
    switch (message.t) {
      case "create": {
        if (state.room) return error("already in a room");
        if (full()) return error("server full");
        const config = cleanConfig(message.config);
        if (config === undefined) return error("settings too big");
        const room = openRoom(false, clampPlayers(message.maxPlayers, MAX_PLAYERS), config);
        log(`room ${room.code} created by ${state.address}`);
        admit(room, 0, message.name);
        return;
      }
      case "free": {
        if (state.room) return error("already in a room");
        let room = [...rooms.values()].find((r) => r.free && freeSlot(r) !== null && freeMemberId(r) !== null);
        if (!room) {
          if (full()) return error("server full");
          room = openRoom(true, FREE_PLAYERS, null);
          log(`free room ${room.code} created by ${state.address}`);
        }
        admit(room, freeSlot(room), message.name);
        return;
      }
      case "join": {
        const code = String(message.code ?? "").trim().toUpperCase();
        if (state.room) {
          // Back into the running match from the connection it dropped out of (the lobby's still fine: a split, a frozen
          // page whose socket survived): as from another connection, without a `leave` that would give up its place.
          const own = state.room.members.get(state.id);
          if (!(typeof message.rejoin === "string" && own?.key === message.rejoin && state.room.code === code && keyed(state.room, message.rejoin) >= 0)) return error("already in a room");
          leave(state, true);
        }
        const room = rooms.get(code);
        if (!room) return failJoin("no such room");
        const back = keyed(room, message.rejoin);
        if (back >= 0) {
          // Back into the running match: whoever still holds the key (a connection the server hasn't seen die) goes.
          const stale = room.members.get(room.start!.players[back]!);
          if (stale && stale.key === message.rejoin) {
            leave(stale.state, true);
            stale.conn.close(1000, "rejoined elsewhere");
          }
          if (!rooms.has(room.code)) return failJoin("no such room"); // (it was the last one in)
          const slot = freeSlot(room);
          if (slot !== null && admit(room, slot, message.name, { player: back, key: message.rejoin! })) return;
        }
        const spectator = message.spectator === true;
        if (room.started && !spectator && !room.free) return failJoin("the match has already started");
        let slot: number | null = null;
        if (spectator) {
          if (room.members.size - players(room).length >= MAX_SPECTATORS) return failJoin("too many spectators");
        } else {
          slot = freeSlot(room);
          if (slot === null) return failJoin("the room is full");
        }
        if (!admit(room, slot, message.name)) return failJoin("the room has seen too many members");
        return;
      }
      case "configure": {
        const room = hostRoom();
        if (!room) return;
        if (room.started) return error("the match has already started");
        const cap = room.free ? FREE_PLAYERS : MAX_PLAYERS;
        if (message.maxPlayers !== undefined) room.maxPlayers = Math.max(players(room).length, clampPlayers(message.maxPlayers, room.maxPlayers, cap));
        if (message.config !== undefined) {
          const config = cleanConfig(message.config);
          if (config === undefined) return error("settings too big");
          room.config = config;
        }
        broadcast(room, { t: "room", room: info(room) });
        return;
      }
      case "role": {
        const room = state.room, member = room?.members.get(state.id);
        if (!room || !member) return error("not in a room");
        if (room.started && !room.free) return error("the match has already started");
        if (message.spectator === true && member.slot !== null) {
          if (room.members.size - players(room).length >= MAX_SPECTATORS) return error("too many spectators");
          const old = member.slot;
          member.slot = null;
          for (const m of room.members.values()) if (m.slot !== null && m.slot > old) m.slot--;
        } else if (message.spectator === false && member.slot === null) {
          const slot = freeSlot(room);
          if (slot === null) return error("the room is full");
          member.slot = slot;
        } else return;
        broadcast(room, { t: "room", room: info(room) });
        return;
      }
      case "start": {
        // Also while a match runs: a rematch, with the players in the room now.
        const room = hostRoom();
        if (!room) return;
        const config = cleanConfig(message.config);
        if (config === undefined) return error("settings too big");
        let ids = players(room).sort((a, b) => a.slot! - b.slot!).map((m) => m.id);
        if (ids.length === 0) return error("no players");
        const before = room.started ? room.start : null, keys = room.keys;
        if (room.free && before) {
          // A free room's restart: its players keep their places (and Link colors), with those away the host keeps,
          // then the newcomers.
          const keep = new Set(Array.isArray(message.keep) ? message.keep : []), slotted = new Set(ids);
          const stay = before.players.filter((id) => slotted.has(id) || (keep.has(id) && room.away.has(id)));
          ids = [...stay, ...ids.filter((id) => !stay.includes(id))];
          for (let k = ids.length - 1; ids.length > FREE_PLAYERS && k >= 0; k--) if (!room.members.has(ids[k]!)) ids.splice(k, 1);
        }
        for (const id of room.away.keys()) if (!ids.includes(id)) room.away.delete(id); // (their keys are gone)
        room.started = true;
        room.matches++;
        room.keys = ids.map((id) => room.members.get(id)?.key ?? keys[before!.players.indexOf(id)]!);
        room.outvoted = new Set();
        room.start = { seed: randomInt(0x7fffffff), players: ids, config, match: room.matches };
        log(`room ${room.code} started match ${room.matches} with ${ids.length} players`);
        broadcast(room, { t: "start", ...room.start, room: info(room) });
        return;
      }
      case "end": {
        const room = hostRoom();
        if (!room) return;
        if (!room.started) return;
        room.started = false;
        room.start = null;
        room.keys = [];
        room.away.clear();
        broadcast(room, { t: "end", room: info(room) });
        return;
      }
      case "claim": {
        // A split's referee: of two halves that can't hear each other, the first to claim goes on (docs/netcode.md).
        const room = state.room, start = room?.start, n = start?.players.length ?? 0;
        const player = start ? start.players.indexOf(state.id) : -1;
        const list = (v: unknown) => (Array.isArray(v) && v.length <= n && v.every((p) => Number.isInteger(p) && p >= 0 && p < n) ? (v as number[]) : null);
        const keep = list(message.keep), cut = list(message.cut);
        if (!room || !start || !keep || !cut) return;
        const ok = message.match === start.match && keep.includes(player) && !cut.includes(player) && keep.every((p) => !room.outvoted.has(p));
        if (ok) for (const p of cut) room.outvoted.add(p);
        log(`room ${room.code}: player ${player + 1} of match ${start.match} claims to cut ${cut.map((p) => p + 1).join(",")}: ${ok ? "granted" : "refused"}`);
        send(conn, { t: "claim", match: Number(message.match), keep, cut, ok });
        return;
      }
      case "signal": {
        const target = state.room?.members.get(Number(message.to));
        if (!target) return;
        send(target.conn, { t: "signal", from: state.id, data: message.data });
        return;
      }
      case "leave":
        leave(state);
        return;
      default:
        return error("unknown message");
    }
  }

  const http = createServer((req, res) => {
    if (req.method === "GET" && (req.url === "/" || req.url === "/status")) {
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify({ service: "four-swords-online signaling", rooms: rooms.size, connections: conns.size }));
      return;
    }
    res.writeHead(404).end();
  });

  const refuse = (socket: Duplex, status: string) => {
    socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  };
  const addressOf = (req: IncomingMessage): string => {
    const forwarded = options.trustProxy ? req.headers["x-forwarded-for"] : undefined;
    const last = typeof forwarded === "string" ? forwarded.split(",").at(-1)?.trim() : undefined;
    return last || req.socket.remoteAddress || "?";
  };

  http.on("upgrade", (req, socket, head) => {
    const origin = req.headers.origin;
    if (allowed.size > 0 && !allowed.has("*") && !(typeof origin === "string" && allowed.has(origin))) {
      stats.refusedOrigin++;
      log(`refused origin ${origin ?? "(none)"}`);
      return refuse(socket, "403 Forbidden");
    }
    if (token) {
      const given = new URL(req.url ?? "/", "http://lobby").searchParams.get("token") ?? "";
      if (!timingSafeEqual(digest(given), token)) {
        stats.refusedToken++;
        log(`refused ${given ? "a wrong" : "a missing"} token (origin ${origin ?? "(none)"})`);
        return refuse(socket, "403 Forbidden");
      }
    }
    const address = addressOf(req);
    const fromAddress = perAddress.get(address) ?? 0;
    if (conns.size >= limits.maxConnections || fromAddress >= limits.maxConnectionsPerAddress) {
      stats.refusedFull++;
      return refuse(socket, "503 Service Unavailable");
    }
    const conn = upgrade(req, socket, head, address);
    if (!conn) return;
    conns.add(conn);
    perAddress.set(address, fromAddress + 1);
    const t = now();
    const state: ConnState = {
      room: null,
      id: 0,
      address,
      messages: new Bucket(limits.messagesPerSecond, limits.messageBurst, t),
      relayCount: new Bucket(limits.relayPerSecond, limits.relayBurst, t),
      relayBytes: new Bucket(limits.relayBytesPerSecond, limits.relayBytesBurst, t),
      failedJoins: 0,
      strikes: 0,
    };
    conn.onmessage = (data) => {
      if (typeof data !== "string") {
        // Relay: [u8 to][payload] → [u8 from][payload]. Over the rate, datagrams are dropped (as a network would).
        const room = state.room;
        if (!room || data.length < 2 || data.length - 1 > MAX_RELAY_PAYLOAD) return;
        const at = now();
        if (!state.relayCount.take(1, at) || !state.relayBytes.take(data.length, at)) {
          stats.relayDropped++;
          return;
        }
        const target = room.members.get(data[0]!);
        if (!target || target.id === state.id) return;
        const out = new Uint8Array(data.length);
        out.set(data);
        out[0] = state.id;
        target.conn.send(out);
        return;
      }
      if (!state.messages.take(1, now())) {
        stats.rateLimited++;
        if (++state.strikes === 1 || state.strikes % 20 === 0) send(conn, { t: "error", message: "too many messages" });
        if (state.strikes >= 100) conn.close(1008, "rate limit");
        return;
      }
      let message: ClientMessage;
      try {
        message = JSON.parse(data) as ClientMessage;
      } catch {
        return send(conn, { t: "error", message: "bad message" });
      }
      if (typeof message !== "object" || message === null) return;
      handle(conn, state, message);
    };
    conn.onclose = () => {
      conns.delete(conn);
      const n = (perAddress.get(address) ?? 1) - 1;
      if (n > 0) perAddress.set(address, n);
      else perAddress.delete(address);
      leave(state, true);
    };
  });

  const heartbeat = setInterval(() => {
    for (const conn of conns) {
      if (!conn.alive) {
        conn.terminate();
        continue;
      }
      conn.alive = false;
      conn.ping();
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(options.port ?? 0, options.host, () => resolve());
  });
  const port = (http.address() as AddressInfo).port;
  log(`signaling server on port ${port}${allowed.size ? ` (origins: ${[...allowed].join(", ")})` : ""}${token ? " (token required)" : ""}`);

  return {
    port,
    http,
    stats,
    rooms: () => [...rooms.values()].map(info),
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(heartbeat);
        for (const conn of conns) conn.terminate();
        http.close(() => resolve());
        http.closeAllConnections();
      }),
  };
}
