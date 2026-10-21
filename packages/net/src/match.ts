// Test harness: runs a whole match of N rollback sessions (plus spectators) over a SimNetwork in virtual time, and
// records every peer's final state hashes so they can be compared with each other and with a plain replay.
import { FRAME_MS, RollbackSession, type SessionEvent, type SessionOptions } from "./session.ts";
import { runSimulation, SimNetwork, type LinkConditions, type Ticker } from "./simnet.ts";
import { SpectatorSession } from "./spectator.ts";
import type { RollbackGame } from "./types.ts";

export interface MatchPeer {
  /** First tick (ms, default 0). */
  start?: number;
  /** Tick period (ms, default 1000/60). */
  period?: number;
  /** The peer crashes (stops ticking and sending) at this time. */
  crashAt?: number;
  /** The peer leaves cleanly (close()) at this time. */
  leaveAt?: number;
  /** Session options for this peer only. */
  session?: MatchOptions<unknown>["session"];
}

export interface MatchOptions<S> {
  game: RollbackGame<S>;
  /** A different game per player (to test desync detection); defaults to `game`. */
  gameFor?: (player: number) => RollbackGame<S>;
  initial: () => S;
  players: number;
  conditions: LinkConditions;
  seed?: number;
  /** Virtual ms to run. */
  duration: number;
  /** Input of `player` for `frame`. */
  input: (player: number, frame: number) => number;
  /** Frames after this get input 0, so the end of the match settles on every peer. */
  inputUntil?: number;
  session?: Partial<Omit<SessionOptions<S>, "game" | "state" | "players" | "localPlayer" | "peers" | "transport" | "now" | "resume">>;
  peers?: MatchPeer[];
  /** Spectators: who feeds them, when they join (ms), and a fixed buffer (frames; adaptive by default). */
  spectators?: { host: number; join: number; buffer?: number }[];
  /** Called once with the network before the run (to set per-link conditions). */
  setup?: (net: SimNetwork) => void;
  /** Called with every final state of every player (after the harness records its hash). */
  onFinal?: (player: number, frame: number, state: S) => void;
  /** Called at every tick of every player, after its advance(). */
  onTick?: (player: number, sessions: readonly RollbackSession<S>[], net: SimNetwork) => void;
  /** Called at every tick of every spectator, after its advance(). */
  onSpectatorTick?: (spectator: number, session: SpectatorSession<S>, net: SimNetwork) => void;
}

export interface MatchResult<S> {
  net: SimNetwork;
  sessions: RollbackSession<S>[];
  spectators: SpectatorSession<S>[];
  /** finals[peer][frame] = hash of that peer's final state at frame (the last report wins). */
  finals: number[][];
  spectatorFinals: number[][];
  events: SessionEvent[][];
  /** Wall-clock ms spent inside advance() per player. */
  advanceMs: number[];
}

export const playerId = (p: number): string => `p${p}`;

export function runMatch<S>(options: MatchOptions<S>): MatchResult<S> {
  const { game, players } = options;
  const net = new SimNetwork(options.conditions, options.seed ?? 1);
  options.setup?.(net);
  const finals: number[][] = Array.from({ length: players }, () => []);
  const events: SessionEvent[][] = Array.from({ length: players }, () => []);
  const advanceMs = new Array<number>(players).fill(0);
  const sessions: RollbackSession<S>[] = [];
  for (let p = 0; p < players; p++) {
    sessions.push(
      new RollbackSession<S>({
        ...options.session,
        ...options.peers?.[p]?.session,
        game: options.gameFor?.(p) ?? game,
        state: options.initial(),
        players,
        localPlayer: p,
        peers: Array.from({ length: players }, (_, q) => ({ id: playerId(q), player: q })).filter((x) => x.player !== p),
        transport: net.endpoint(playerId(p)),
        now: () => net.now,
        onEvent: (e) => events[p]!.push(e),
        onFinal: (frame, state) => {
          finals[p]![frame] = game.hash(state) >>> 0;
          options.onFinal?.(p, frame, state);
        },
      }),
    );
  }
  const spectators: SpectatorSession<S>[] = [];
  const spectatorFinals: number[][] = [];
  const tickers: Ticker[] = sessions.map((session, p) => {
    const cfg = options.peers?.[p] ?? {};
    const stop = Math.min(cfg.crashAt ?? Infinity, cfg.leaveAt ?? Infinity);
    return {
      start: cfg.start ?? 0,
      period: cfg.period ?? FRAME_MS,
      stop,
      tick: () => {
        const frame = session.frame + session.inputDelay;
        const input = frame > (options.inputUntil ?? Infinity) ? 0 : options.input(p, frame);
        const t0 = performance.now();
        session.advance(input);
        advanceMs[p]! += performance.now() - t0;
        options.onTick?.(p, sessions, net);
        if (cfg.leaveAt !== undefined && net.now + (cfg.period ?? FRAME_MS) >= cfg.leaveAt) session.close();
      },
    };
  });
  options.spectators?.forEach(({ host, join, buffer }, k) => {
    const id = `s${k}`;
    const hashes: number[] = [];
    spectatorFinals.push(hashes);
    let spectator: SpectatorSession<S> | null = null;
    tickers.push({
      start: join,
      period: FRAME_MS,
      tick: () => {
        if (!spectator) {
          spectator = new SpectatorSession<S>({
            game,
            state: options.initial(),
            players,
            host: playerId(host),
            buffer,
            transport: net.endpoint(id),
            now: () => net.now,
            onFinal: (frame, state) => (hashes[frame] = game.hash(state) >>> 0),
          });
          spectators.push(spectator);
          sessions[host]!.addSpectator(id);
        }
        spectator.advance();
        options.onSpectatorTick?.(k, spectator, net);
      },
    });
  });
  runSimulation(net, tickers, options.duration);
  return { net, sessions, spectators, finals, spectatorFinals, events, advanceMs };
}

/** Plain replay without netcode: hashes[frame] of S(frame) for frames 0..frames. */
export function replay<S>(game: RollbackGame<S>, state: S, players: number, frames: number, input: (player: number, frame: number) => number): number[] {
  const hashes = [game.hash(state) >>> 0];
  for (let f = 0; f < frames; f++) {
    state = game.step(state, Array.from({ length: players }, (_, p) => input(p, f)));
    hashes.push(game.hash(state) >>> 0);
  }
  return hashes;
}

/** The inputs a session applied: what replay() needs to reproduce its game. */
export function appliedInputs(session: Pick<RollbackSession<unknown>, "inputLog" | "cutFrame">, disconnectedInput = 0): (player: number, frame: number) => number {
  return (player, frame) => {
    if (frame > session.cutFrame(player)) return disconnectedInput;
    return session.inputLog(player)[frame] ?? 0;
  };
}
