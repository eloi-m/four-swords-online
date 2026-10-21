// Lobby client for the signaling server (tools/signal): rooms by code, player slots, start, WebRTC signaling
// messages and the binary relay. Uses the standard WebSocket (browsers, Node 22).
//
// Text frames are JSON (ClientMessage / ServerMessage). Binary frames are relay packets: [u8 member id][payload];
// the id is the destination going up and the source coming down.

export interface MemberInfo {
  /** Member id within the room (1–255). */
  id: number;
  name: string;
  /** Player slot, or null for a spectator. */
  slot: number | null;
}

export interface RoomInfo {
  code: string;
  host: number;
  maxPlayers: number;
  /** A free room (joined with `free`, no code needed): up to 8 players, who can join and change role while a match
   *  runs; they play from the next start. Absent for a room made with `create`. */
  free?: true;
  /** A match is running (new players can't join a room that isn't free; spectators can). */
  started: boolean;
  /** Matches started in this room so far: the running one's number while started. */
  matches?: number;
  /** The host's match settings, shared before the start (create / configure); null until set. */
  config?: unknown;
  members: MemberInfo[];
  /**
   * A free room's players of the running match whose lobby connection dropped (a page in the background, a lost
   * network; not a `leave`), by member id: for FREE_AWAY_MS (2 min) the host's restarts keep their places (`start` with
   * `keep`), so they come back into their slots with their keys. Absent when none.
   */
  away?: number[];
}

export interface StartInfo {
  /** Random seed chosen by the server, the same for everyone. */
  seed: number;
  /** Member ids by player index (slots compacted in slot order). */
  players: number[];
  /** Whatever the host passed to start(). */
  config: unknown;
  /** The match's number in the room (1, then 2, 3… for rematches): packets of an earlier match are told apart by it. */
  match?: number;
  room: RoomInfo;
  /** Sent to a player rejoining the running match (join with `rejoin`): he is in `players` again, under his new id,
   *  and starts from a snapshot a peer sends him (netmatch.ts) rather than from frame 0. */
  resume?: true;
}

export type ClientMessage =
  | { t: "create"; name?: string; maxPlayers?: number; config?: unknown }
  /** `rejoin`: the key of our `welcome` in that room, to come back into the running match in our slot (after a reload,
   *  or a lost lobby connection: a member still holding that key is removed first). */
  | { t: "join"; code: string; name?: string; spectator?: boolean; rejoin?: string }
  /** Join the first free room with a player slot left, or open one (and host it). */
  | { t: "free"; name?: string }
  /** Host, between matches: player limit and shared settings. */
  | { t: "configure"; maxPlayers?: number; config?: unknown }
  /** Between matches: become a spectator, or take a free player slot. */
  | { t: "role"; spectator: boolean }
  /**
   * Host: starts a match, or restarts one (a rematch) while one is running. In a free room, the running match's
   * players stay in their order (newcomers after them), and `keep` lists those away (RoomInfo.away) who stay players
   * of the new match too, absent until they rejoin with their keys.
   */
  | { t: "start"; config?: unknown; keep?: number[] }
  /**
   * A player of match `match` claims a cut during a split (SessionOptions.referee): it keeps the players `keep` (itself
   * among them) and cuts `cut`, by player index. Granted unless one of `keep` was cut by a claim granted before (in this
   * match, since his last rejoin): of two halves that can't hear each other, the first to claim goes on.
   */
  | { t: "claim"; match: number; keep: number[]; cut: number[] }
  /** Host: ends the running match, back to the room (players can join again). */
  | { t: "end" }
  | { t: "signal"; to: number; data: unknown }
  | { t: "leave" };

export type ServerMessage =
  /** `key`: ours to rejoin the room's running match if we drop out of it (a reload, a lost connection). */
  | { t: "welcome"; you: number; room: RoomInfo; key?: string }
  | { t: "room"; room: RoomInfo }
  | ({ t: "start" } & StartInfo)
  | { t: "end"; room: RoomInfo }
  | { t: "signal"; from: number; data: unknown }
  | { t: "left"; id: number }
  /** A player of the running match is back under a new member id (sent before the room update that lists him). */
  | { t: "rejoin"; player: number; id: number; match: number }
  /** The answer to a claim (echoing it). */
  | { t: "claim"; match: number; keep: number[]; cut: number[]; ok: boolean }
  | { t: "error"; message: string };

export const MAX_RELAY_PAYLOAD = 2048;

/** Room codes are words of 4 or 5 letters (the server's list: tools/signal/src/words.ts). */
export const ROOM_CODE = /^[A-Z]{4,5}$/;

/** The room code in what a player typed or pasted: the word in any case, stray spaces and all, or an invite link
 *  (…#join=WORD&…). */
export function roomCode(text: string): string {
  const invite = /[#&?]join=([^&#]*)/.exec(text);
  return (invite ? invite[1]! : text).toUpperCase().replace(/[^A-Z]/g, "");
}

type LobbyEvents = {
  room: [RoomInfo];
  start: [StartInfo];
  /** The host ended the match: back to the room. */
  end: [RoomInfo];
  signal: [from: number, data: unknown];
  left: [id: number];
  /** A player of match `match` rejoined under member id `id` (StartInfo.players updated). */
  rejoin: [player: number, id: number, match: number];
  /** The lobby's answer to our claim (claim()). */
  claim: [match: number, keep: number[], cut: number[], ok: boolean];
  relay: [from: number, data: Uint8Array];
  close: [];
  error: [message: string];
};

type Listener<K extends keyof LobbyEvents> = (...args: LobbyEvents[K]) => void;

/** Events that arrive before anyone listens are queued (signals and relay packets can beat the app's setup). */
const QUEUED: readonly (keyof LobbyEvents)[] = ["signal", "relay", "left"];
const MAX_QUEUED = 256;

export class LobbyClient {
  /** Our member id once in a room. */
  you = 0;
  /** Our key in the room (welcome): join with `rejoin: key` to come back into its running match. */
  key = "";
  room: RoomInfo | null = null;
  started: StartInfo | null = null;
  private readonly ws: WebSocket;
  private readonly listeners = new Map<keyof LobbyEvents, Set<(...args: never[]) => void>>();
  private readonly queued = new Map<keyof LobbyEvents, unknown[][]>();
  private pending: { resolve: (room: RoomInfo) => void; reject: (error: Error) => void } | null = null;

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.binaryType = "arraybuffer";
    ws.addEventListener("message", (e) => this.handle(e.data as string | ArrayBuffer));
    ws.addEventListener("close", () => {
      this.pending?.reject(new Error("connection to the lobby closed"));
      this.pending = null;
      this.emit("close");
    });
  }

  static connect(url: string, timeoutMs = 5000): Promise<LobbyClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error(`could not reach the lobby at ${url}`));
      }, timeoutMs);
      ws.addEventListener("open", () => {
        clearTimeout(timer);
        resolve(new LobbyClient(ws));
      });
      ws.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error(`could not reach the lobby at ${url}`));
      });
    });
  }

  on<K extends keyof LobbyEvents>(type: K, fn: Listener<K>): () => void {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(fn as (...args: never[]) => void);
    const queued = this.queued.get(type);
    if (queued) {
      this.queued.delete(type);
      for (const args of queued) (fn as (...a: unknown[]) => void)(...args);
    }
    return () => void set.delete(fn as (...args: never[]) => void);
  }

  private emit<K extends keyof LobbyEvents>(type: K, ...args: LobbyEvents[K]): void {
    const set = this.listeners.get(type);
    if (!set || set.size === 0) {
      if (QUEUED.includes(type)) {
        const q = this.queued.get(type) ?? [];
        if (q.length < MAX_QUEUED) q.push(args);
        this.queued.set(type, q);
      }
      return;
    }
    for (const fn of set) (fn as (...a: unknown[]) => void)(...args);
  }

  create(options: { name?: string; maxPlayers?: number; config?: unknown } = {}): Promise<RoomInfo> {
    return this.request({ t: "create", ...options });
  }

  join(code: string, options: { name?: string; spectator?: boolean; rejoin?: string } = {}): Promise<RoomInfo> {
    return this.request({ t: "join", code, ...options });
  }

  /** Joins a free room as a player (its first member hosts it). While its match runs, the running match's "start"
   *  follows the welcome, as for a late spectator, but this player isn't in its `players`: it plays from the next one. */
  free(options: { name?: string } = {}): Promise<RoomInfo> {
    return this.request({ t: "free", ...options });
  }

  /** Host only: starts the match for everyone in the room (again while one runs: a rematch). `keep`: a free room's
   *  players away (RoomInfo.away) who keep their places in it. */
  start(config?: unknown, keep?: number[]): void {
    this.send({ t: "start", config, ...(keep?.length ? { keep } : {}) });
  }

  /** Claims a cut of a split in match `match` (see ClientMessage "claim"); the answer comes as the "claim" event. */
  claim(match: number, keep: number[], cut: number[]): void {
    this.send({ t: "claim", match, keep, cut });
  }

  /** Whether the lobby connection is open (a claim sent now can be answered). */
  get open(): boolean {
    return this.ws.readyState === WebSocket.OPEN;
  }

  /** Host only: ends the running match; everyone gets "end" and is back in the room. */
  end(): void {
    this.send({ t: "end" });
  }

  /** Host only, between matches: the player limit and the settings everyone sees in `room.config`. */
  configure(options: { maxPlayers?: number; config?: unknown }): void {
    this.send({ t: "configure", ...options });
  }

  /** Between matches: watch instead of playing, or take a free player slot. */
  setRole(spectator: boolean): void {
    this.send({ t: "role", spectator });
  }

  signal(to: number, data: unknown): void {
    this.send({ t: "signal", to, data });
  }

  /** Sends a datagram through the server to a member of the room. */
  relay(to: number, data: Uint8Array): void {
    if (this.ws.readyState !== WebSocket.OPEN || data.byteLength > MAX_RELAY_PAYLOAD) return;
    const frame = new Uint8Array(data.byteLength + 1);
    frame[0] = to;
    frame.set(data, 1);
    this.ws.send(frame);
  }

  leave(): void {
    this.send({ t: "leave" });
  }

  close(): void {
    this.ws.close();
  }

  /** Bytes queued in the WebSocket (the relay is TCP: a growing buffer means the link can't keep up). */
  get bufferedAmount(): number {
    return this.ws.bufferedAmount;
  }

  private send(message: ClientMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }

  private request(message: ClientMessage): Promise<RoomInfo> {
    if (this.pending) return Promise.reject(new Error("a lobby request is already pending"));
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject };
      this.send(message);
    });
  }

  private handle(data: string | ArrayBuffer): void {
    if (typeof data !== "string") {
      const bytes = new Uint8Array(data);
      if (bytes.length >= 1) this.emit("relay", bytes[0]!, bytes.subarray(1));
      return;
    }
    let message: ServerMessage;
    try {
      message = JSON.parse(data) as ServerMessage;
    } catch {
      return;
    }
    switch (message.t) {
      case "welcome":
        this.you = message.you;
        this.key = message.key ?? "";
        this.room = message.room;
        this.pending?.resolve(message.room);
        this.pending = null;
        this.emit("room", message.room);
        break;
      case "room":
        this.room = message.room;
        this.emit("room", message.room);
        break;
      case "start": {
        const { t: _, ...info } = message;
        this.room = info.room;
        this.started = info;
        this.emit("start", info);
        break;
      }
      case "end":
        this.room = message.room;
        this.started = null;
        this.emit("end", message.room);
        this.emit("room", message.room);
        break;
      case "signal":
        this.emit("signal", message.from, message.data);
        break;
      case "left":
        this.emit("left", message.id);
        break;
      case "rejoin":
        if (this.started && (this.started.match ?? 0) === message.match) this.started.players[message.player] = message.id;
        this.emit("rejoin", message.player, message.id, message.match);
        break;
      case "claim":
        this.emit("claim", message.match, message.keep, message.cut, message.ok === true);
        break;
      case "error":
        if (this.pending) {
          this.pending.reject(new Error(message.message));
          this.pending = null;
        }
        this.emit("error", message.message);
        break;
    }
  }
}
