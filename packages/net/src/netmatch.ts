// One call from a lobby "start" to a running match: builds the transport (WebRTC / relay, optionally impaired), the
// rollback session for a player or the spectator session for a spectator, and feeds spectators from one player (the
// lowest still in the match; the next one takes over when he goes), including those joining mid-match. The
// integration point for apps (see docs/netcode.md). A room can run match after match over one lobby connection:
// close() the previous match (it stops listening to the lobby), then start the next one; its packets carry the new
// match number (StartInfo.match), so the old match's stragglers are dropped.
//
// Rejoining (docs/netcode.md "Rejoining"): a start with `resume` (we dropped out and came back with our key) asks the
// players still in the match for a snapshot through the lobby (every one of them hears the ask, so the arbiter makes
// the rejoin; the sponsor sends it) and starts the session from it; every player's match takes the newcomer's id for
// the slot when the lobby says who came back.
import { decodeState, encodeState, fromBase64, toBase64 } from "./codec.ts";
import type { LobbyClient, RoomInfo, StartInfo } from "./lobby.ts";
import { LossyTransport, type Impairment } from "./lossy.ts";
import { PeerTransport, type Route, type TransportMode } from "./peer-transport.ts";
import { RollbackSession, type SessionOptions, type SessionSnapshot, type SplitClaim } from "./session.ts";
import { SpectatorSession } from "./spectator.ts";
import type { PeerId, RollbackGame, Transport } from "./types.ts";

export interface NetMatchOptions<S> extends Partial<Omit<SessionOptions<S>, "game" | "state" | "players" | "localPlayer" | "peers" | "transport" | "now" | "resume" | "absent" | "referee">> {
  game: RollbackGame<S>;
  /** State at frame 0, built the same way on every machine (from start.seed / start.config if needed). */
  state: S;
  mode?: TransportMode;
  iceServers?: RTCIceServer[];
  /** "relay" = TURN candidates only (see PeerTransportOptions). */
  iceTransportPolicy?: RTCIceTransportPolicy;
  /** Artificial latency/jitter/loss on outgoing packets (testing). */
  impairment?: Impairment;
  now?: () => number;
  onRoute?: (peer: PeerId, route: Route) => void;
  /** Spectator catch-up speed, frames per tick (default 32). */
  spectatorCatchup?: number;
  onSpectatorLost?: () => void;
  /** The state as bytes for a rejoining player's snapshot, and back (default: the generic codec, codec.ts). */
  encodeState?: (state: S) => Uint8Array;
  decodeState?: (bytes: Uint8Array) => S;
  /** Rejoining: the session started from a snapshot of this frame (`ok`), or no snapshot came (`ok` false, see
   *  `resumeError`). */
  onResume?: (ok: boolean, frame: number) => void;
}

export interface NetMatch<S> {
  /** The match's number in the room (StartInfo.match; 0 from a server that doesn't count). */
  readonly match: number;
  /** Our player index, or -1 when spectating. */
  readonly localPlayer: number;
  readonly players: number;
  /** Null for a spectator, and while rejoining until the snapshot arrives. */
  readonly session: RollbackSession<S> | null;
  readonly spectator: SpectatorSession<S> | null;
  readonly transport: PeerTransport;
  readonly lossy: LossyTransport | null;
  /** Rejoining the running match: waiting for the snapshot (true until the session starts or the rejoin fails). */
  readonly resuming: boolean;
  /** Why the rejoin failed, or "". */
  readonly resumeError: string;
  /** The state to draw. */
  readonly state: S;
  /** The frame `state` is at. */
  readonly frame: number;
  /** One 60 Hz tick with the local buttons (ignored when spectating). */
  tick(input: number): void;
  /** Flushes delayed packets of an impaired transport; call often (every few ms). */
  pump(): void;
  /** Leaves the match: tells the others at once, unless `quiet` (everyone is moving on anyway: a rematch, the end). */
  close(options?: { quiet?: boolean }): void;
}

/** A rejoin's messages through the lobby's `signal` (`ch`: the match). The snapshot travels as JSON text in parts; every
 *  player gets the ask, only the `sponsor` answers it. */
type ResumeSignal = { resume: "ask"; ch: number; sponsor?: boolean } | { resume: "part"; ch: number; frame: number; k: number; n: number; text: string };
/** Characters of snapshot text per lobby message (the server takes WebSocket messages up to 64 KB). */
const PART_CHARS = 16_000;
/** The rejoiner asks its sponsor again this often (the sponsor answers once the cut has settled: ~1 s). */
const ASK_MS = 2000;
/** And gives up after this long without a snapshot. */
const RESUME_TIMEOUT_MS = 20_000;

/** The members who watch a match: everyone in the room but its players (spectators, and a free room's players who
 *  joined after it started). */
const spectatorsOf = (room: RoomInfo | null, players: readonly number[]): number[] =>
  (room?.members ?? []).filter((m) => !players.includes(m.id)).map((m) => m.id);

export function startNetMatch<S>(lobby: LobbyClient, start: StartInfo, options: NetMatchOptions<S>): NetMatch<S> {
  const { game, state, mode, iceServers, iceTransportPolicy, impairment, onRoute, spectatorCatchup, onSpectatorLost, onResume, ...rest } = options;
  const { encodeState: encode = encodeState as (s: S) => Uint8Array, decodeState: decode = decodeState as (b: Uint8Array) => S, ...sessionOptions } = rest;
  const now = options.now ?? (() => performance.now());
  // (The lobby updates start.players when a player rejoins under a new id: "rejoin".)
  const ids = start.players;
  const players = ids.length;
  const localPlayer = ids.indexOf(lobby.you);
  const host = ids[0]!;
  const resumed = localPlayer >= 0 && start.resume === true;
  const peers = localPlayer >= 0 ? [...ids.filter((id) => id !== lobby.you), ...(localPlayer === 0 && !resumed ? spectatorsOf(start.room, ids) : [])] : [host];
  /** Players who came back into the match (rejoin): their sessions lack the frames before their snapshot, so they
   *  can't feed spectators. */
  const rejoined = new Set<number>(resumed ? [localPlayer] : []);
  const match = start.match ?? 0;
  const transport = new PeerTransport(lobby, peers, { mode, iceServers, iceTransportPolicy, onRoute, channel: match, now });
  const lossy = impairment ? new LossyTransport(transport, impairment, now) : null;
  const wire: Transport = lossy ?? transport;

  let session: RollbackSession<S> | null = null;
  let spectator: SpectatorSession<S> | null = null;
  const offs: (() => void)[] = [];

  // --- splits: the lobby, which both halves of a split reach, referees them (SessionOptions.referee: first claim wins) ---
  /** Our claims by `keep|cut`: the lobby's answer, undefined until it comes. Forgotten when a player rejoins (the
   *  lobby forgets the cuts of his earlier life too). */
  const claims = new Map<string, boolean | undefined>();
  const claimKey = (keep: readonly number[], cut: readonly number[]) => `${keep.join()}|${cut.join()}`;
  const referee = (claim: SplitClaim): boolean | undefined => {
    const key = claimKey(claim.keep, claim.cut);
    if (!claims.has(key) && lobby.open) {
      claims.set(key, undefined);
      lobby.claim(match, claim.keep, claim.cut);
    }
    return claims.get(key);
  };
  /** Players not in the room when the match started (a free play restarted while they were away): absent until they
   *  rejoin. Every peer reads the same start. */
  const inRoom = new Set(start.room.members.map((m) => m.id));
  const absent = ids.flatMap((id, p) => (inRoom.has(id) ? [] : [p]));
  const newSession = (resume?: SessionSnapshot<S>) =>
    new RollbackSession<S>({
      ...sessionOptions,
      game,
      state: resume?.state ?? state,
      players,
      localPlayer,
      peers: ids.map((id, player) => ({ id: String(id), player })).filter((p) => p.player !== localPlayer),
      transport: wire,
      now,
      resume,
      absent,
      referee,
      onEvent: (e) => {
        if (e.type === "rejoined") claims.clear();
        sessionOptions.onEvent?.(e);
      },
    });

  // --- rejoining: as the one coming back ---
  let resuming = resumed, resumeError = "";
  const parts = new Map<number, string[]>();
  let askedAt = -Infinity, sponsor = -1;
  const resumeStarted = now();
  /** The first other player still in the room (any of them hands out the same rejoin frame: the arbiter's). */
  const pickSponsor = (): number => {
    const present = new Set((lobby.room?.members ?? []).map((m) => m.id));
    return ids.find((id, p) => p !== localPlayer && present.has(id)) ?? -1;
  };
  const fail = (message: string) => {
    resuming = false;
    resumeError = message;
    sessionOptions.onEvent?.({ type: "error", message: `rejoin: ${message}` });
    onResume?.(false, 0);
  };
  const ask = () => {
    if (sponsor < 0 || !lobby.room?.members.some((m) => m.id === sponsor)) sponsor = pickSponsor();
    if (sponsor < 0) return fail("nobody left in the match to rejoin");
    if (now() - resumeStarted > RESUME_TIMEOUT_MS) return fail("no snapshot came");
    if (now() - askedAt < ASK_MS) return;
    askedAt = now();
    const present = new Set((lobby.room?.members ?? []).map((m) => m.id));
    for (const [p, id] of ids.entries()) {
      if (p !== localPlayer && present.has(id)) lobby.signal(id, { resume: "ask", ch: match, sponsor: id === sponsor } satisfies ResumeSignal);
    }
  };
  const receivePart = (data: Extract<ResumeSignal, { resume: "part" }>) => {
    if (!resuming || !(data.n >= 1 && data.n <= 256 && data.k >= 0 && data.k < data.n) || typeof data.text !== "string") return;
    let got = parts.get(data.frame);
    if (!got || got.length !== data.n) parts.set(data.frame, (got = Array.from({ length: data.n }, () => "")));
    got[data.k] = data.text;
    askedAt = now(); // (it's coming: don't ask again meanwhile)
    if (got.some((t) => t === "")) return;
    try {
      const { state: text, ...meta } = JSON.parse(got.join("")) as Omit<SessionSnapshot<S>, "state"> & { state: string };
      const snapshot: SessionSnapshot<S> = { ...meta, state: decode(fromBase64(text)) };
      const hash = game.hash(snapshot.state) >>> 0;
      if (hash !== snapshot.hash) throw new Error(`the snapshot's state doesn't restore (hash ${hash.toString(16)}, sent ${snapshot.hash.toString(16)})`);
      session = newSession(snapshot);
      resuming = false;
      onResume?.(true, snapshot.frame);
    } catch (error) {
      fail((error as Error).message);
    }
  };

  // --- rejoining: as a player still in the match ---
  /** Players who asked for a snapshot: whether we are their sponsor (else the ask only lets the arbiter decide). */
  const asks = new Map<number, boolean>();
  const sent = new WeakMap<SessionSnapshot<S>, string[]>();
  /** Hands the snapshot to every player who asked us, once the session can make it (see rejoinSnapshot). */
  const answer = () => {
    for (const [player, sponsored] of asks) {
      const snapshot = session!.rejoinSnapshot(player);
      if (!snapshot) continue;
      asks.delete(player);
      if (!sponsored) continue;
      let texts = sent.get(snapshot);
      if (!texts) {
        const { state: s, ...meta } = snapshot;
        const text = JSON.stringify({ ...meta, state: toBase64(encode(s)) });
        texts = [];
        for (let i = 0; i < text.length; i += PART_CHARS) texts.push(text.slice(i, i + PART_CHARS));
        sent.set(snapshot, texts);
      }
      texts.forEach((text, k) => lobby.signal(ids[player]!, { resume: "part", ch: match, frame: snapshot.frame, k, n: texts.length, text } satisfies ResumeSignal));
    }
  };

  if (localPlayer >= 0) {
    if (!resumed) session = newSession();
    offs.push(
      lobby.on("claim", (m, keep, cut, ok) => {
        const key = claimKey(keep, cut);
        if (m === match && claims.has(key)) claims.set(key, ok);
      }),
      lobby.on("signal", (from, raw) => {
        const data = raw as Partial<ResumeSignal> | null;
        if (!data || typeof data !== "object" || data.ch !== match) return;
        if (data.resume === "ask") {
          const player = ids.indexOf(from);
          if (player >= 0 && player !== localPlayer) asks.set(player, data.sponsor !== false);
        } else if (data.resume === "part" && from === sponsor) receivePart(data as Extract<ResumeSignal, { resume: "part" }>);
      }),
      lobby.on("rejoin", (player, id, m) => {
        if (m !== match || player === localPlayer || player < 0 || player >= players) return;
        ids[player] = id; // (the lobby did it too, on the same StartInfo)
        rejoined.add(player);
        transport.addPeer(id);
        session?.rejoinPeer(player, String(id));
      }),
    );
  } else {
    spectator = new SpectatorSession<S>({
      game,
      state,
      players,
      host: String(host),
      transport: wire,
      now,
      catchupFrames: spectatorCatchup ?? 32,
      onFinal: sessionOptions.onFinal,
      onEvent: () => onSpectatorLost?.(),
    });
  }

  // --- feeding spectators: the lowest player still in the match, every player agreeing on who (the lobby's room, the
  // arbitrated cuts); the next one takes over when he leaves, is cut, or comes back from a drop. ---
  const fed = new Set<number>();
  const feeder = (): number => {
    if (!session || session.droppedOut) return -1;
    const present = new Set((lobby.room ?? start.room).members.map((m) => m.id));
    for (let p = 0; p < players; p++) if (present.has(ids[p]!) && !rejoined.has(p) && session.cutFrame(p) === Infinity) return p;
    return -1;
  };
  const feed = () => {
    const watchers = feeder() === localPlayer ? spectatorsOf(lobby.room ?? start.room, ids) : [];
    for (const id of watchers) {
      if (fed.has(id)) continue;
      fed.add(id);
      transport.addPeer(id);
      session!.addSpectator(String(id));
    }
    for (const id of fed) {
      if (watchers.includes(id)) continue;
      fed.delete(id);
      session!.removeSpectator(String(id));
    }
  };

  let closed = false;
  return {
    match,
    localPlayer,
    players,
    get session() {
      return session;
    },
    spectator,
    transport,
    lossy,
    get resuming() {
      return resuming;
    },
    get resumeError() {
      return resumeError;
    },
    get state() {
      return (session ?? spectator)?.state ?? state;
    },
    get frame() {
      return (session ?? spectator)?.frame ?? 0;
    },
    tick(input) {
      if (closed) return;
      if (resuming) ask();
      if (session) {
        feed();
        session.advance(input);
        if (asks.size > 0) answer();
      } else spectator?.advance();
    },
    pump() {
      if (!closed) lossy?.pump();
    },
    close(options = {}) {
      if (closed) return;
      closed = true;
      for (const off of offs.splice(0)) off();
      if (!options.quiet) {
        session?.close();
        lossy?.flush();
      }
      transport.close();
    },
  };
}
