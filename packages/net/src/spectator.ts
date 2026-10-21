// A spectator follows a match from one player's session (its host), which sends it every player's *settled*
// inputs. It never predicts, so it never rolls back: it simulates settled frames only, a little behind the players,
// and runs several frames per tick to catch up after joining late. When its host leaves, another player feeds it
// (settled inputs are the same on every player): it follows whoever sends it the feed.
//
// The feed arrives unevenly (the network's jitter, and the settled frame moving in steps as the players' packets come
// in), so the spectator keeps a few frames of backlog as a buffer: it plays one frame per tick while the backlog is
// within the buffer, stalls a tick when it runs dry, and plays faster when it is past it. The buffer adapts to the
// feed's jitter the way the players' input delay adapts to theirs (session.ts adaptDelay).
import { decodePacket, emptyPacket, encodePacket, Flag } from "./protocol.ts";
import { AdaptiveFrames } from "./adapt.ts";
import { FRAME_MS } from "./session.ts";
import type { RollbackGame, PeerId, Transport } from "./types.ts";

export interface SpectatorOptions<S> {
  game: RollbackGame<S>;
  /** State at frame 0, as for the players. */
  state: S;
  players: number;
  /** The player peer feeding us at first (it must call addSpectator with our id); another one may take over. */
  host: PeerId;
  transport: Transport;
  now: () => number;
  /** Frames of backlog played at normal speed before catching up faster: fixed, or by default adapting to the feed's
   *  jitter within SPECTATOR_BUFFER (bufferTarget). */
  buffer?: number;
  /** Frames simulated per tick at most, while catching up (default 8). */
  catchupFrames?: number;
  /** Silence after which the feed counts as gone (ms, default 6000: the players' 3 s disconnect, then another player
   *  taking over). */
  disconnectTimeout?: number;
  onFinal?: (frame: number, state: S) => void;
  onEvent?: (event: { type: "disconnected" }) => void;
}

/** Bounds of the adaptive buffer (frames). */
export const SPECTATOR_BUFFER = { min: 1, max: 30 };
/** Mean deviations of the feed's arrival the adaptive buffer covers. A uniform jitter spans four of them, and the
 *  backlog swings by that much around its mean; eight keeps it off both ends (measured: on 2 ± 1.5 frames of jitter,
 *  ~30 stalls in 12 s at four, ~1 at eight, for about a frame more lag). */
export const BUFFER_JITTER = 8;
/** Ticks between two moves of the adaptive buffer. */
const BUFFER_INTERVAL = 30;
/** Feed packets this full may be cut short by the sender (its catch-up window): they don't show the live edge. */
const FULL_FEED = 64;

export interface SpectatorStats {
  ticks: number;
  frames: number;
  /** Ticks that simulated nothing although the feed had started (the backlog ran dry). */
  stalls: number;
  /** Ticks that simulated more than one frame (catching up). */
  fastTicks: number;
}

export class SpectatorSession<S> {
  readonly stats: SpectatorStats = { ticks: 0, frames: 0, stalls: 0, fastTicks: 0 };
  readonly players: number;
  private readonly game: RollbackGame<S>;
  private readonly transport: Transport;
  private readonly now: () => number;
  private feeder: PeerId;
  private bufferFrames: number;
  private readonly adaptive: AdaptiveFrames | null;
  private readonly catchup: number;
  /** Arrival of the feed's live edge, now / 16.7 ms − its end frame: its mean and mean deviation (frames, smoothed). */
  private transit = NaN;
  private jitter = 0;
  private readonly timeout: number;
  private readonly onFinal: ((frame: number, state: S) => void) | undefined;
  private readonly onEvent: (event: { type: "disconnected" }) => void;
  private current: S;
  private currentFrame = 0;
  /** inputs[player][frame], contiguous from frame 0. */
  private readonly inputs: number[][];
  private lastRecv: number;
  private echoTs = 0;
  private echoAt = 0;
  private gone = false;

  constructor(options: SpectatorOptions<S>) {
    this.game = options.game;
    this.players = options.players;
    this.transport = options.transport;
    this.now = options.now;
    this.feeder = options.host;
    this.bufferFrames = options.buffer ?? SPECTATOR_BUFFER.min;
    this.adaptive = options.buffer === undefined ? new AdaptiveFrames(this.bufferFrames, SPECTATOR_BUFFER.min, SPECTATOR_BUFFER.max, BUFFER_INTERVAL) : null;
    this.catchup = options.catchupFrames ?? 8;
    this.timeout = options.disconnectTimeout ?? 6000;
    this.onFinal = options.onFinal;
    this.onEvent = options.onEvent ?? (() => {});
    this.current = options.state;
    this.inputs = Array.from({ length: this.players }, () => []);
    this.lastRecv = this.now();
    this.transport.listen({ message: (from, data) => this.receive(from, data) });
    this.onFinal?.(0, this.current);
  }

  get state(): S {
    return this.current;
  }

  get frame(): number {
    return this.currentFrame;
  }

  /** Frames received but not yet simulated. */
  get backlog(): number {
    return this.inputs[0]!.length - this.currentFrame;
  }

  /** Frames of backlog played at normal speed (adapting unless options.buffer fixed it). */
  get buffer(): number {
    return this.bufferFrames;
  }

  /** The buffer the feed's jitter calls for (frames, smoothed; NaN until the feed is live):
   *  BUFFER_JITTER × the mean deviation of its arrival. */
  get bufferTarget(): number {
    return this.adaptive?.target ?? NaN;
  }

  /** The player peer feeding us now. */
  get host(): PeerId {
    return this.feeder;
  }

  get disconnected(): boolean {
    return this.gone;
  }

  /** One local tick: simulates what arrived (faster when behind) and acks the host. Returns frames simulated. */
  advance(): number {
    const now = this.now();
    if (!this.gone && now - this.lastRecv > this.timeout) this.lose();
    this.stats.ticks++;
    this.adaptBuffer();
    const backlog = this.backlog;
    // Past the buffer, drain the excess over several ticks (at least two frames a tick), up to catchupFrames.
    const steps = backlog > this.bufferFrames ? Math.min(this.catchup, 1 + Math.ceil((backlog - this.bufferFrames) / 8)) : Math.min(backlog, 1);
    if (steps === 0 && this.inputs[0]!.length > 0) this.stats.stalls++;
    if (steps > 1) this.stats.fastTicks++;
    this.stats.frames += steps;
    for (let k = 0; k < steps; k++) {
      const f = this.currentFrame;
      this.current = this.game.step(this.current, this.inputs.map((row) => row[f]!));
      this.currentFrame = f + 1;
      this.onFinal?.(this.currentFrame, this.current);
    }
    if (!this.gone) {
      const packet = emptyPacket();
      packet.flags = Flag.Spectator;
      packet.frame = this.currentFrame;
      packet.ack = this.inputs[0]!.length - 1;
      packet.ts = (Math.floor(now) + 1) >>> 0 || 1;
      packet.echo = this.echoTs;
      packet.echoDelay = this.echoTs === 0 ? 0 : now - this.echoAt;
      this.transport.send(this.feeder, encodePacket(packet));
    }
    return steps;
  }

  /** The adaptive buffer, every tick: follows bufferTarget by the players' adaptive delay's rule (adapt.ts). */
  private adaptBuffer(): void {
    if (!this.adaptive) return;
    this.adaptive.update(Number.isNaN(this.transit) ? NaN : BUFFER_JITTER * this.jitter);
    this.bufferFrames = this.adaptive.value;
  }

  private lose(): void {
    if (this.gone) return;
    this.gone = true;
    this.onEvent({ type: "disconnected" });
  }

  private receive(from: PeerId, data: Uint8Array): void {
    if (this.gone) return;
    let packet;
    try {
      packet = decodePacket(data);
    } catch {
      return;
    }
    if (from !== this.feeder) {
      if (!packet.feed) return;
      this.feeder = from; // (another player feeds us now: ack to him, he resends from there)
    }
    this.lastRecv = this.now();
    this.echoTs = packet.ts;
    this.echoAt = this.lastRecv;
    const feed = packet.feed;
    if (!feed || feed.players.length !== this.players) return;
    const have = this.inputs[0]!.length;
    if (feed.start > have) return; // a gap: the host resends from our ack
    const count = feed.players[0]!.length, end = feed.start + count;
    if (end > have && count < FULL_FEED) {
      // The live edge: how late it arrives against our clock. (Not while catching up: the sender caps those packets.)
      const transit = this.lastRecv / FRAME_MS - end;
      if (Number.isNaN(this.transit)) this.transit = transit;
      else {
        this.jitter += (Math.abs(transit - this.transit) - this.jitter) / 16;
        this.transit += (transit - this.transit) / 16;
      }
    }
    for (let k = have - feed.start; k < feed.players[0]!.length; k++) {
      for (let p = 0; p < this.players; p++) this.inputs[p]!.push(feed.players[p]![k]!);
    }
  }
}
