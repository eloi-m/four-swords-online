// GGPO-style rollback session for 2–4 players over an unreliable, unordered transport.
//
// Frames: S(f+1) = step(S(f), inputs(f)). The local input sampled while simulating frame f is scheduled for frame
// f + inputDelay. A remote player's missing inputs are predicted (their last confirmed input repeats); when the real
// input arrives and differs, the session restores the snapshot of that frame and resimulates up to the present.
// A frame is *final* once every input before it is known (onFinal), and *settled* once every live player reports
// holding those inputs too; settled frames can no longer change, so their state hashes are compared across peers.
// Disconnects are arbitrated: a peer that stops hearing another only reports it (lost); one arbiter, the lowest player
// of the group that still hears each other, decides who is cut and after which frame, and relays the inputs up to
// there to peers that lack them, so every peer applies the same cut and settled frames never change. Only a majority
// of the players still in may cut the others; a tie (a 2–2 split) goes to a referee both halves reach (the lobby), and
// the half that loses, or is smaller, drops out (to rejoin): a split never leaves two games.
// A player who dropped can come back into his slot (rejoinPeer, rejoinSnapshot, SessionOptions.resume): the arbiter
// un-cuts the slot from a frame everyone adopts, and any peer hands him a snapshot of a settled frame.
// Design and protocol: docs/netcode.md.
import { AdaptiveFrames } from "./adapt.ts";
import { decodePacket, emptyPacket, encodePacket, Flag, type Packet } from "./protocol.ts";
import type { PeerId, RollbackGame, Transport } from "./types.ts";

export const FRAME_MS = 1000 / 60;

export interface SessionPeer {
  id: PeerId;
  player: number;
}

export interface SessionOptions<S> {
  game: RollbackGame<S>;
  /** State at frame 0; must be identical on every peer. The session owns it from now on. */
  state: S;
  /** Number of players (1–4); inputs arrays passed to `step` have this length. */
  players: number;
  localPlayer: number;
  /** The other players' peers (one per remote player). Spectators join later with addSpectator(). */
  peers: readonly SessionPeer[];
  transport: Transport;
  /** Monotonic clock in ms: performance.now() in browsers, simulated time in tests. */
  now: () => number;
  /** Frames between sampling a local input and the frame it applies to (default 2; the starting one if adaptive). */
  inputDelay?: number;
  /**
   * Adapts the input delay to what our inputs need to reach the other players in time (delayTarget: the one-way
   * latency, its jitter and the ticks' phase), within [min, max], one frame at a time at most every `interval` ticks
   * (default 30), with hysteresis going down (adapt.ts). Each peer adapts its own: inputs carry their frames, so peers
   * stay in sync.
   */
  adaptiveDelay?: { min: number; max: number; interval?: number };
  /** Most frames a remote player's input may be predicted before the session stalls (default 8). */
  maxPrediction?: number;
  /** Snapshot ring size; rollbacks can reach this far back (default 64, must exceed maxPrediction + 1). */
  historyFrames?: number;
  /** Cap on inputs resent per packet (default 64). */
  maxInputsPerPacket?: number;
  /** A state hash is exchanged every this many frames (default 30; 0 disables desync detection). */
  hashInterval?: number;
  /** Silence after which a peer is reported as interrupted (ms, default 750). */
  interruptTimeout?: number;
  /** Silence after which a peer is disconnected (ms, default 3000). */
  disconnectTimeout?: number;
  /** Same, for a peer never heard from (ms, default 10000). */
  connectTimeout?: number;
  /** Input fed to `step` for a disconnected player (default 0). */
  disconnectedInput?: number;
  /** Frame advantage (frames, averaged) above which the session skips a tick to let others catch up (default 1). */
  syncThreshold?: number;
  /** Minimum ticks between two such skips (default 10). */
  syncInterval?: number;
  onEvent?: (event: SessionEvent) => void;
  /** Called once a frame's state is final (every input before it known), in frame order. After a disconnect lowers
   * a cut frame, frames after the cut are reported again with their corrected state. */
  onFinal?: (frame: number, state: S) => void;
  /** Starts from a snapshot of a running match (rejoining it, see rejoinSnapshot) instead of frame 0. */
  resume?: SessionSnapshot<S>;
  /**
   * Players cut from frame 0 on (a free play restarted while they were away, keeping their slots): their inputs are
   * disconnectedInput until they rejoin, which they can do at once. Every peer must pass the same ones.
   */
  absent?: readonly number[];
  /**
   * The referee of splits, reached by every peer independently of the others (netmatch.ts: the lobby). The session
   * claims each cut it makes of players still in (`cut`, keeping `keep`, every other player still in): a majority's
   * at once, while it waits for a tie's answer (a 2–2 or 1–1 split). The referee grants a claim unless one of `keep`
   * was cut by a claim it granted before, so of two halves that can't hear each other only the first to claim goes on.
   * Returns true (granted), false (refused: we drop out) or undefined (no answer yet: asked again on later ticks, with
   * the same arrays' contents). Without one, a tie goes to the half holding the lowest player.
   */
  referee?: (claim: SplitClaim) => boolean | undefined;
  /** Frames simulated per tick while a resumed session catches up with the others (default 32). */
  catchupFrames?: number;
}

/**
 * What a player rejoining a running match starts from (rejoinSnapshot on a peer still in it): a settled frame's state,
 * and every player's inputs from that frame on as far as the sender holds them.
 */
export interface SessionSnapshot<S> {
  /** The player coming back. */
  player: number;
  /** `state` is S(frame), settled on the sender: the same on every peer, for good. */
  frame: number;
  state: S;
  /** game.hash(state) on the sender: the receiver checks its decoded state against it. */
  hash: number;
  /** inputs[p]: player p's inputs from `frame` on (a cut player's up to his cut). */
  inputs: number[][];
  /** Each player's cut frame, -1 while playing. */
  cuts: number[];
  /** Each player's rejoin frame (0 = never cut and back): his inputs from it on are real again. */
  rejoins: number[];
  /** The cut each rejoin came back from (-1 = none). */
  rejoinCuts: number[];
}

/** A claim to the referee (SessionOptions.referee): the players kept and those cut, by player index, ascending. */
export interface SplitClaim {
  keep: number[];
  cut: number[];
}

export type DisconnectReason = "timeout" | "closed" | "left" | "reported" | "dropped-us";

export type SessionEvent =
  | { type: "interrupted"; peer: PeerId; player: number }
  | { type: "resumed"; peer: PeerId; player: number }
  /** `frame` is the player's last frame with real inputs; later frames use disconnectedInput. */
  | { type: "disconnected"; peer: PeerId | null; player: number; frame: number; reason: DisconnectReason }
  /** A cut player is back (rejoinSnapshot): his inputs count again from `frame` on. */
  | { type: "rejoined"; peer: PeerId | null; player: number; frame: number }
  | { type: "spectator-left"; peer: PeerId }
  /**
   * We drop out: from now on we play alone and nothing we simulate counts for the others (droppedOut). `cut`: the
   * others' arbiter cut us (or decided our rejoin twice); `split`: our side of a split is smaller than the other, or
   * lost the tie.
   */
  | { type: "dropped"; reason: "cut" | "split" }
  | { type: "desync"; peer: PeerId; frame: number; local: number; remote: number }
  | { type: "error"; message: string };

export type PeerStatus = "connecting" | "connected" | "interrupted" | "disconnected";

export interface PeerInfo {
  id: PeerId;
  /** -1 for spectators. */
  player: number;
  status: PeerStatus;
  /** Round-trip time in ms (smoothed), NaN until measured. */
  rtt: number;
  /** How many frames we run ahead of this peer (smoothed; positive = we are ahead). */
  advantage: number;
  /** Their last frame of our inputs they acknowledged (or of the feed, for spectators). */
  acked: number;
}

export interface SessionStats {
  /** advance() calls. */
  ticks: number;
  /** Frames advanced (not counting resimulation). */
  frames: number;
  rollbacks: number;
  /** Frames resimulated by rollbacks. */
  rollbackFrames: number;
  maxRollback: number;
  predictionStalls: number;
  syncStalls: number;
  packetsSent: number;
  bytesSent: number;
  packetsReceived: number;
  bytesReceived: number;
  badPackets: number;
  hashChecks: number;
  desyncs: number;
}

interface Slot {
  /** Known inputs, contiguous from frame 0 (so the last confirmed frame is log.length - 1). */
  log: number[];
  /** Last frame of real inputs once disconnected, Infinity while connected. */
  cut: number;
  /** When the slot was cut (now()), for the rejoin's wait for every peer to agree on the cut. */
  cutAt: number;
  /** The frame the player came back from after a cut (0 = never), and the cut he came back from. */
  rejoin: number;
  rejoinCut: number;
  /** He is back under a new peer (rejoinPeer) and waits for the arbiter to un-cut his slot; he asked for a snapshot. */
  awaiting: boolean;
  asked: boolean;
  /** The current life's peer is known (false between adopting a rejoin from a packet and the lobby's word of it). */
  lifePeer: boolean;
  /** Why we lost his peer (reported to the arbiter; the reason of the cut when we decide it). */
  lostReason: DisconnectReason;
  /** Input used when frame f was last simulated, at f % history. */
  used: Int32Array;
  peer: Peer | null;
}

interface Peer {
  id: PeerId;
  player: number;
  status: PeerStatus;
  heard: boolean;
  lastRecv: number;
  acked: number;
  remoteFrame: number;
  remoteFrameAt: number;
  remoteAdvantage: number;
  remoteConfirmed: number;
  localAdvantage: number;
  skew: number;
  rtt: number;
  /** Mean deviation of the RTT samples (ms, smoothed), NaN until measured: the link's jitter. */
  rttVar: number;
  /** localAdvantage smoothed (frames), NaN until the RTT is known: how far ahead of it our ticks run. */
  lead: number;
  echoTs: number;
  echoAt: number;
  /** Settled hashes it reported, waiting for ours. */
  hashes: Map<number, number>;
  /** Newest frame whose hash was compared (the same report repeats in many packets). */
  checkedHash: number;
  /** Its last frame of each cut player's inputs (its cut reports): we relay it what it lacks. */
  held: Map<number, { cut: number; held: number }>;
  /** Packets still sent to it after we cut it while hearing it, so it learns. */
  notices: number;
}

/** `reporter` no longer hears `target`, as of their lives then (each one's rejoin frame). */
interface Lost {
  reporter: number;
  target: number;
  reporterGen: number;
  targetGen: number;
}

const KEEP_HASHES = 16;
/** Inputs further ahead of our frame than this are ignored (a legit peer is at most ~maxPrediction ahead). */
const MAX_INPUT_LEAD = 1024;

/** How long a cut must stand before its player can rejoin: every peer has adopted the same cut frame by then. */
export const REJOIN_SETTLE_MS = 1000;

/**
 * How long the arbiter waits before cutting one of two players it still hears who lost each other: a player who
 * crashed is soon lost by the arbiter too (and is the one cut), while two who really can't reach each other stay so.
 */
export const ARBITER_GRACE_MS = 1000;

/** How long the arbiter of one half of a tied split waits for the referee's answer before dropping out. */
export const REFEREE_WAIT_MS = 5000;

/** Packets sent to a player after cutting him while we still heard him (his notice). */
const CUT_NOTICES = 30;

const stamp = (now: number): number => (Math.floor(now) + 1) >>> 0 || 1;

/** The adaptive delay's margin over the measured need (frames): ticks and packet handling aren't instant. */
export const DELAY_MARGIN = 0.25;
/**
 * RTT deviations the adaptive delay adds for jitter. One is enough: the RTT's deviation already sums both directions'
 * (and the ticks' quantization), and every packet resends the unacked inputs, so a late one is often overtaken by the
 * next (measured: at one, each jitter profile settles on the smallest delay that doesn't roll back, or one above).
 */
export const DELAY_JITTER = 1;

export class RollbackSession<S> {
  readonly players: number;
  readonly localPlayer: number;
  readonly maxPrediction: number;
  readonly stats: SessionStats = {
    ticks: 0,
    frames: 0,
    rollbacks: 0,
    rollbackFrames: 0,
    maxRollback: 0,
    predictionStalls: 0,
    syncStalls: 0,
    packetsSent: 0,
    bytesSent: 0,
    packetsReceived: 0,
    bytesReceived: 0,
    badPackets: 0,
    hashChecks: 0,
    desyncs: 0,
  };
  /** Why the last advance() did not advance, or null. */
  stalled: null | "prediction" | "sync" = null;

  private readonly game: RollbackGame<S>;
  private readonly transport: Transport;
  private readonly now: () => number;
  private readonly history: number;
  private readonly maxInputs: number;
  private readonly hashInterval: number;
  private readonly interruptTimeout: number;
  private readonly disconnectTimeout: number;
  private readonly connectTimeout: number;
  private readonly disconnectedInput: number;
  private readonly syncThreshold: number;
  private readonly syncInterval: number;
  private readonly onEvent: (event: SessionEvent) => void;
  private readonly onFinal: ((frame: number, state: S) => void) | undefined;

  private current: S;
  private currentFrame = 0;
  private readonly ring: (S | undefined)[];
  private readonly ringFrames: Int32Array;
  private readonly slots: Slot[];
  private readonly peers = new Map<PeerId, Peer>();
  private firstIncorrect = Infinity;
  private finalFrame = -1;
  private settled = -1;
  private readonly localHashes = new Map<number, number>();
  private reportHash: { frame: number; hash: number } | null = null;
  private syncCooldown = 0;
  private closed = false;
  private delay: number;
  private readonly adaptive: AdaptiveFrames | null;
  /** The input delay just went down a frame: the next input is for a frame already scheduled, and is dropped. */
  private skipInput = false;
  /** The first frame this session simulated (a resumed one's snapshot frame): nothing before it can be rolled back. */
  private base = 0;
  /** A resumed session that hasn't caught up with the others yet. */
  private catchingUp = false;
  private readonly catchup: number;
  /** The last snapshot handed out (asked again: the same one). */
  private lastSnapshot: SessionSnapshot<S> | null = null;
  /** Who lost whom (ours and every peer's, as reported). */
  private lost: Lost[] = [];
  /** Since when we, the arbiter, have seen two players we hear lose each other, by pair. */
  private readonly conflicts = new Map<number, number>();
  /** Rejoins heard of while we still lack the player's inputs up to his cut (adopted once they're relayed). */
  private readonly pendingRejoins = new Map<number, { cut: number; frame: number }>();
  private dropped = false;
  private readonly referee: ((claim: SplitClaim) => boolean | undefined) | undefined;
  /** Claims of cuts we made as a majority, until the referee answers them. */
  private claims: SplitClaim[] = [];
  /** A tie we wait on the referee for (its claim, as JSON) and since when. */
  private tie: { key: string; since: number } | null = null;

  constructor(options: SessionOptions<S>) {
    this.game = options.game;
    this.players = options.players;
    this.localPlayer = options.localPlayer;
    this.transport = options.transport;
    this.now = options.now;
    this.delay = options.inputDelay ?? 2;
    const a = options.adaptiveDelay;
    this.adaptive = a ? new AdaptiveFrames(this.delay, a.min, a.max, a.interval ?? 30) : null;
    this.maxPrediction = options.maxPrediction ?? 8;
    this.history = options.historyFrames ?? 64;
    this.maxInputs = options.maxInputsPerPacket ?? 64;
    this.hashInterval = options.hashInterval ?? 30;
    this.interruptTimeout = options.interruptTimeout ?? 750;
    this.disconnectTimeout = options.disconnectTimeout ?? 3000;
    this.connectTimeout = options.connectTimeout ?? 10000;
    this.disconnectedInput = options.disconnectedInput ?? 0;
    this.syncThreshold = options.syncThreshold ?? 1;
    this.syncInterval = options.syncInterval ?? 10;
    this.onEvent = options.onEvent ?? (() => {});
    this.onFinal = options.onFinal;
    this.catchup = options.catchupFrames ?? 32;
    this.referee = options.referee;
    if (this.players < 1 || this.players > 255) throw new Error(`bad player count ${this.players}`);
    if (this.localPlayer < 0 || this.localPlayer >= this.players) throw new Error(`bad local player ${this.localPlayer}`);
    if (this.history < this.maxPrediction + 2) throw new Error("historyFrames must exceed maxPrediction + 1");
    if (this.delay < 0 || !Number.isInteger(this.delay)) throw new Error("bad input delay");
    if (a && (a.min < 0 || a.max < a.min || !Number.isInteger(a.min) || !Number.isInteger(a.max))) throw new Error("bad adaptive delay");

    this.current = options.state;
    this.ring = new Array<S | undefined>(this.history);
    this.ringFrames = new Int32Array(this.history).fill(-1);
    this.slots = Array.from({ length: this.players }, () => ({
      log: [],
      cut: Infinity,
      cutAt: 0,
      rejoin: 0,
      rejoinCut: -1,
      awaiting: false,
      asked: false,
      lifePeer: true,
      lostReason: "timeout" as DisconnectReason,
      used: new Int32Array(this.history),
      peer: null,
    }));
    const resume = options.resume;
    if (resume) this.resume(resume);
    else for (let f = 0; f < this.delay; f++) this.slots[this.localPlayer]!.log.push(0);
    if (!resume) {
      for (const p of options.absent ?? []) {
        const slot = this.slots[p];
        if (!slot || p === this.localPlayer) throw new Error(`bad absent player ${p}`);
        // (Cut long enough ago: he can rejoin at once.)
        Object.assign(slot, { cut: -1, cutAt: -Infinity, lostReason: "left" });
      }
    }
    const start = this.now();
    for (const { id, player } of options.peers) {
      if (player === this.localPlayer || player < 0 || player >= this.players || this.slots[player]!.peer) throw new Error(`bad peer player ${player}`);
      const peer = this.newPeer(id, player, start);
      this.slots[player]!.peer = peer;
      if (!resume) {
        if (this.slots[player]!.cut !== Infinity) peer.status = "disconnected";
        continue;
      }
      // Our inputs before the rejoin frame are the padding every peer holds once it adopts the rejoin.
      peer.acked = this.slots[this.localPlayer]!.log.length - 1;
      if (this.slots[player]!.cut !== Infinity) peer.status = "disconnected";
    }
    this.transport.listen({ message: (from, data) => this.receive(from, data), closed: (peer) => this.peerClosed(peer) });
  }

  /** Starts from a snapshot (options.resume): its frame, state and inputs; frames before it never run again. */
  private resume(r: SessionSnapshot<S>): void {
    const n = this.players;
    if (r.player !== this.localPlayer || r.inputs.length !== n || r.cuts.length !== n || r.rejoins.length !== n || r.rejoinCuts.length !== n) throw new Error("snapshot of another match");
    if (r.cuts[this.localPlayer] !== -1 || r.rejoins[this.localPlayer]! < r.frame) throw new Error("the snapshot doesn't bring us back");
    this.current = r.state;
    this.currentFrame = this.base = r.frame;
    this.finalFrame = this.settled = r.frame - 1;
    this.slots.forEach((slot, p) => {
      slot.log = new Array<number>(r.frame).fill(0).concat(r.inputs[p]!);
      slot.cut = r.cuts[p]! < 0 ? Infinity : r.cuts[p]!;
      slot.rejoin = r.rejoins[p]!;
      slot.rejoinCut = r.rejoinCuts[p]!;
    });
    this.catchingUp = true;
  }

  /** Frames between sampling a local input and the frame it applies to: the next advance()'s input is for
   * frame + inputDelay. */
  get inputDelay(): number {
    return this.delay;
  }

  /** The current (possibly predicted) state, S(frame). Read-only for callers. */
  get state(): S {
    return this.current;
  }

  /** The next frame to simulate; `state` is the state at this frame. */
  get frame(): number {
    return this.currentFrame;
  }

  /** Last frame for which every player's input is known. */
  get confirmedFrame(): number {
    return this.minConfirmed(true);
  }

  /** Last frame whose inputs every live player holds; states up to settledFrame + 1 can no longer change. */
  get settledFrame(): number {
    return this.settled;
  }

  /** Last frame reported through onFinal. */
  get finalizedFrame(): number {
    return this.finalFrame;
  }

  /** Known inputs of a player (index = frame). Disconnected players' inputs stop at their cut frame. */
  inputLog(player: number): readonly number[] {
    const slot = this.slots[player]!;
    return slot.cut === Infinity ? slot.log : slot.log.slice(0, slot.cut + 1);
  }

  /** The frame after which a player's inputs are disconnectedInput, or Infinity while connected. */
  cutFrame(player: number): number {
    return this.slots[player]!.cut;
  }

  /** The player who decides cuts and rejoins for our group (see arbitrate), as far as we know. */
  get arbiter(): number {
    return Math.min(...this.group());
  }

  /** The others cut us: we play on alone, and nothing we simulate counts for them any more. */
  get droppedOut(): boolean {
    return this.dropped;
  }

  peerInfo(): PeerInfo[] {
    return [...this.peers.values()].map((p) => ({ id: p.id, player: p.player, status: p.status, rtt: p.rtt, advantage: p.skew, acked: p.acked }));
  }

  /**
   * A player who dropped is back under another peer id (a new lobby member). His slot stays cut until the arbiter
   * un-cuts it (once he asks: rejoinSnapshot) and we adopt that; his old peer is forgotten.
   */
  rejoinPeer(player: number, id: PeerId): void {
    if (player === this.localPlayer || player < 0 || player >= this.players) throw new Error(`bad rejoining player ${player}`);
    const slot = this.slots[player]!, old = slot.peer;
    if (old?.id === id) return;
    // (A rejoin adopted from a packet before the lobby told us who came back: this is that life's peer.)
    if (slot.cut !== Infinity || slot.lifePeer) {
      if (old && old.status !== "disconnected") this.disconnectPeer(old, "left");
      slot.awaiting = true;
      slot.asked = false;
    }
    if (old) this.peers.delete(old.id);
    this.peers.delete(id); // (a member taken for a spectator a moment ago)
    slot.peer = this.newPeer(id, player, this.now());
    slot.lifePeer = true;
  }

  /**
   * The snapshot a rejoining player starts from (SessionOptions.resume), or null while it can't be made yet: call again
   * on a later tick. He asks (this call) after rejoinPeer; the arbiter then un-cuts his slot from the frame of its next
   * input (see arbitrate), and every peer that adopted that rejoin can hand out S(settled + 1) with every input from
   * there: whoever he asks, the rejoin frame is the same. Asked again, it returns the same snapshot.
   */
  rejoinSnapshot(player: number): SessionSnapshot<S> | null {
    const slot = this.slots[player];
    if (!slot || player === this.localPlayer || this.closed) return null;
    const last = this.lastSnapshot;
    if (last?.player === player && slot.cut === Infinity && last.rejoins[player] === slot.rejoin) return last;
    slot.asked = true;
    if (slot.awaiting) this.arbitrate();
    if (slot.cut !== Infinity || slot.awaiting || slot.rejoin === 0 || this.slots.some((s) => s.cut !== Infinity && s.log.length <= s.cut)) return null;
    const frame = Math.max(this.base, Math.min(this.settled + 1, this.finalFrame));
    const state = frame === this.currentFrame ? this.current : this.snapshot(frame);
    if (!state) return null;
    const copy = this.game.clone(state);
    this.lastSnapshot = {
      player,
      frame,
      state: copy,
      hash: this.game.hash(copy) >>> 0,
      inputs: this.slots.map((s) => s.log.slice(frame, s.cut === Infinity ? undefined : Math.max(frame, s.cut + 1))),
      cuts: this.slots.map((s) => (s.cut === Infinity ? -1 : s.cut)),
      rejoins: this.slots.map((s) => s.rejoin),
      rejoinCuts: this.slots.map((s) => s.rejoinCut),
    };
    return this.lastSnapshot;
  }

  /**
   * A cut player is back from `frame` on (we made the rejoin, or a peer's packet carries it): his inputs after `cut`
   * and before `frame` are disconnectedInput, explicitly, and his slot waits for his real ones again. The frames from
   * `frame` on were predicted with disconnectedInput, which is what the slot holds until then: nothing to resimulate.
   */
  private adoptRejoin(player: number, cut: number, frame: number): void {
    const slot = this.slots[player]!;
    if (frame <= slot.rejoin || cut + 1 >= frame) return;
    if (player === this.localPlayer || (slot.cut === Infinity && slot.rejoinCut === cut)) {
      // Another frame for a rejoin from the same cut (a second arbiter decided it before hearing of the first one's):
      // the peers can't agree any more. (Rare: the arbiter left within a round trip of deciding.)
      if (cut !== slot.rejoinCut) return;
      this.onEvent({ type: "error", message: `player ${player} rejoins from frame ${frame}, not ${slot.rejoin}` });
      if (player === this.localPlayer) this.dropOut("cut");
      return;
    }
    this.cut(player, cut, "reported"); // (the cut it comes back from, if we hadn't heard of it)
    if (slot.cut !== cut) this.onEvent({ type: "error", message: `player ${player} rejoins from his cut at frame ${cut}, ours is at ${slot.cut}` });
    if (slot.log.length <= slot.cut) {
      this.pendingRejoins.set(player, { cut, frame }); // (his inputs up to the cut are on their way: relayed)
      return;
    }
    this.pendingRejoins.delete(player);
    slot.log.length = slot.cut + 1;
    while (slot.log.length < frame) slot.log.push(this.disconnectedInput);
    slot.cut = Infinity;
    slot.rejoin = frame;
    slot.rejoinCut = cut;
    slot.lifePeer = slot.awaiting;
    slot.awaiting = slot.asked = false;
    // (His new peer may have timed out while he waited: it starts afresh, as for a player joining.)
    if (slot.lifePeer && slot.peer) Object.assign(slot.peer, { status: "connecting", heard: false, lastRecv: this.now(), notices: 0 });
    this.onEvent({ type: "rejoined", peer: slot.lifePeer ? (slot.peer?.id ?? null) : null, player, frame });
  }

  /** A spectator: it gets every player's settled inputs from this session (see SpectatorSession). */
  addSpectator(id: PeerId): void {
    if (this.peers.has(id)) throw new Error(`peer ${id} already in the session`);
    this.newPeer(id, -1, this.now());
  }

  /** Stops feeding a spectator (another player feeds it now). */
  removeSpectator(id: PeerId): void {
    if (this.peers.get(id)?.player === -1) this.peers.delete(id);
  }

  /**
   * Runs one local 60 Hz tick: applies received inputs (rolling back if a prediction was wrong), then simulates the
   * next frame with `input` scheduled inputDelay frames ahead, unless too far ahead of the others. Sends a packet to
   * every peer. Returns whether a frame was simulated (see `stalled` otherwise).
   */
  advance(input: number): boolean {
    if (this.closed) return false;
    if (!Number.isInteger(input) || input < 0 || input > 0xffff) throw new Error(`input ${input} is not a u16`);
    const now = this.now();
    this.stats.ticks++;
    this.checkPeers(now);
    this.arbitrate();
    this.rollback();
    if (this.catchingUp) this.catchUp(input);
    this.updateSync(now);
    let advanced = false;
    if (this.currentFrame - this.minRemoteConfirmed() > this.maxPrediction) {
      this.stalled = "prediction";
      this.stats.predictionStalls++;
    } else if (this.syncStall()) {
      this.stalled = "sync";
      this.stats.syncStalls++;
    } else {
      this.stalled = null;
      const local = this.slots[this.localPlayer]!.log;
      if (this.skipInput) this.skipInput = false;
      else if (local.length <= this.currentFrame + this.delay) local.push(input); // (a resumed session's may run ahead)
      this.simulate(true);
      this.stats.frames++;
      advanced = true;
      this.adaptDelay(input);
    }
    this.finalize();
    this.updateSettled();
    this.sendAll(now);
    return advanced;
  }

  /**
   * A resumed session starts behind the others: like a spectator joining late, it simulates the frames whose inputs
   * every live player has sent, up to catchupFrames per tick, until it's level with them.
   */
  private catchUp(input: number): void {
    const target = this.minRemoteConfirmed(), local = this.slots[this.localPlayer]!.log;
    for (let n = 0; n < this.catchup && this.currentFrame + this.delay < target; n++) {
      if (local.length <= this.currentFrame + this.delay) local.push(input);
      this.simulate(true);
      this.stats.frames++;
    }
    if (this.currentFrame + this.delay >= target || target === Infinity) this.catchingUp = false;
  }

  /**
   * The input delay our inputs need to reach every live player before it simulates their frame (frames, fractional;
   * NaN until an RTT is measured), smoothed over about half a second: the largest, over them, of
   *   (RTT / 2 + DELAY_JITTER × RTT deviation) / 16.7 ms − (lead + 1) + DELAY_MARGIN,
   * `lead` being how far our ticks run ahead of theirs (the time sync keeps it within about a frame, but not at 0: the
   * peer whose ticks fall later in the frame needs that much more delay; + 1 as their packets carry the frame after
   * the one they just simulated, ours the one we are about to). The adaptive delay keeps to its ceiling.
   */
  get delayTarget(): number {
    return this.adaptive?.target ?? NaN;
  }

  private need(): number {
    let need = NaN;
    for (const peer of this.peers.values()) {
      if (peer.player < 0 || peer.status !== "connected" || Number.isNaN(peer.lead)) continue;
      const n = (peer.rtt / 2 + DELAY_JITTER * peer.rttVar) / FRAME_MS - (peer.lead + 1) + DELAY_MARGIN;
      if (!(n <= need)) need = n;
    }
    return need;
  }

  /**
   * The adaptive input delay (options.adaptiveDelay), after a tick that advanced: follows delayTarget (adapt.ts), up a
   * frame (this tick's input repeated for the extra frame) or down a frame (the next input dropped: its frame is
   * already scheduled).
   */
  private adaptDelay(input: number): void {
    const move = this.adaptive?.update(this.need(), !this.skipInput) ?? 0;
    if (move > 0) this.slots[this.localPlayer]!.log.push(input);
    else if (move < 0) this.skipInput = true;
    this.delay += move;
  }

  /** Leaves the session: tells every peer (twice, in case of loss), then stops. */
  close(): void {
    if (this.closed) return;
    const now = this.now();
    this.sendAll(now, true);
    this.sendAll(now, true);
    this.closed = true;
  }

  // --- simulation ---

  private effectiveInput(player: number, frame: number): number {
    const slot = this.slots[player]!;
    if (frame > slot.cut) return this.disconnectedInput;
    if (frame < slot.log.length) return slot.log[frame]!;
    return slot.log.length > 0 ? slot.log[slot.log.length - 1]! : 0;
  }

  private simulate(save: boolean): void {
    const f = this.currentFrame, i = f % this.history;
    if (save) {
      this.ring[i] = this.game.clone(this.current);
      this.ringFrames[i] = f;
    }
    const inputs = new Array<number>(this.players);
    for (let p = 0; p < this.players; p++) {
      const v = this.effectiveInput(p, f);
      inputs[p] = v;
      this.slots[p]!.used[i] = v;
    }
    this.current = this.game.step(this.current, inputs);
    this.currentFrame = f + 1;
  }

  private snapshot(frame: number): S | undefined {
    const i = frame % this.history;
    return this.ringFrames[i] === frame ? this.ring[i] : undefined;
  }

  /** Marks frames from `frame` on as simulated with wrong inputs. */
  private invalidate(frame: number): void {
    if (frame < this.currentFrame) this.firstIncorrect = Math.min(this.firstIncorrect, frame);
  }

  private rollback(): void {
    const target = this.firstIncorrect;
    this.firstIncorrect = Infinity;
    if (target >= this.currentFrame) return;
    const snap = this.snapshot(target);
    if (!snap) {
      this.onEvent({ type: "error", message: `cannot roll back to frame ${target} (history ${this.history} frames, at ${this.currentFrame})` });
      return;
    }
    const end = this.currentFrame, frames = end - target;
    this.current = this.game.clone(snap);
    this.currentFrame = target;
    this.simulate(false); // the snapshot of `target` is still valid
    while (this.currentFrame < end) this.simulate(true);
    this.stats.rollbacks++;
    this.stats.rollbackFrames += frames;
    this.stats.maxRollback = Math.max(this.stats.maxRollback, frames);
  }

  /** min over players of the last confirmed frame; cut players count as fully known once we hold their inputs up to
   * the cut (some may still be on their way, relayed). */
  private minConfirmed(includeLocal: boolean): number {
    let min = Infinity;
    for (let p = 0; p < this.players; p++) {
      const slot = this.slots[p]!;
      if ((p === this.localPlayer && !includeLocal) || slot.log.length > slot.cut) continue;
      min = Math.min(min, slot.log.length - 1);
    }
    return min;
  }

  private minRemoteConfirmed(): number {
    return this.minConfirmed(false);
  }

  private finalize(): void {
    const target = Math.min(this.minConfirmed(true) + 1, this.currentFrame);
    for (let f = this.finalFrame + 1; f <= target; f++) {
      const state = f === this.currentFrame ? this.current : this.snapshot(f);
      if (!state) {
        this.onEvent({ type: "error", message: `frame ${f} fell out of the history before it was final` });
        this.finalFrame = f;
        continue;
      }
      this.onFinal?.(f, state);
      if (this.hashInterval > 0 && f % this.hashInterval === 0) {
        this.localHashes.set(f, this.game.hash(state) >>> 0);
        for (const k of this.localHashes.keys()) if (k < f - KEEP_HASHES * this.hashInterval) this.localHashes.delete(k);
      }
      this.finalFrame = f;
    }
  }

  // --- settled frames and desync detection ---

  private updateSettled(): void {
    let settled = this.minConfirmed(true);
    for (const peer of this.peers.values()) {
      const slot = peer.player >= 0 ? this.slots[peer.player]! : null;
      // (A player coming back counts once his slot is live again.)
      if (slot && peer.status !== "disconnected" && slot.cut === Infinity && slot.peer === peer) settled = Math.min(settled, peer.remoteConfirmed);
    }
    if (settled > this.settled) this.settled = settled;
    if (this.hashInterval === 0) return;
    for (const [frame, hash] of this.localHashes) {
      if (frame - 1 <= this.settled && frame <= this.finalFrame && (!this.reportHash || frame > this.reportHash.frame)) {
        this.reportHash = { frame, hash };
      }
    }
    const oldest = this.finalFrame - KEEP_HASHES * this.hashInterval;
    for (const peer of this.peers.values()) {
      for (const [frame, remote] of peer.hashes) {
        const local = this.localHashes.get(frame);
        if (local !== undefined && frame - 1 <= this.settled && frame <= this.finalFrame) {
          peer.hashes.delete(frame);
          peer.checkedHash = Math.max(peer.checkedHash, frame);
          this.stats.hashChecks++;
          if (local !== remote) {
            this.stats.desyncs++;
            this.onEvent({ type: "desync", peer: peer.id, frame, local, remote });
          }
        } else if (frame < oldest) peer.hashes.delete(frame);
      }
    }
  }

  // --- time sync ---

  private updateSync(now: number): void {
    for (const peer of this.peers.values()) {
      if (peer.player < 0 || peer.status !== "connected") continue;
      const elapsed = now - peer.remoteFrameAt + (Number.isNaN(peer.rtt) ? 0 : peer.rtt / 2);
      peer.localAdvantage = this.currentFrame - (peer.remoteFrame + elapsed / FRAME_MS);
      // Averaging our view with theirs cancels most of the one-way latency error (asymmetric routes).
      const sample = (peer.localAdvantage - peer.remoteAdvantage) / 2;
      peer.skew += (sample - peer.skew) * 0.1;
      if (peer.heard && !Number.isNaN(peer.rtt)) peer.lead = Number.isNaN(peer.lead) ? peer.localAdvantage : peer.lead + (peer.localAdvantage - peer.lead) / 64;
    }
  }

  private syncStall(): boolean {
    if (this.syncCooldown > 0) {
      this.syncCooldown--;
      return false;
    }
    let ahead = -Infinity;
    for (const peer of this.peers.values()) if (peer.player >= 0 && peer.status === "connected") ahead = Math.max(ahead, peer.skew);
    if (ahead < this.syncThreshold) return false;
    this.syncCooldown = this.syncInterval;
    return true;
  }

  // --- peers ---

  private newPeer(id: PeerId, player: number, now: number): Peer {
    const peer: Peer = {
      id,
      player,
      status: "connecting",
      heard: false,
      lastRecv: now,
      acked: -1,
      remoteFrame: 0,
      remoteFrameAt: now,
      remoteAdvantage: 0,
      remoteConfirmed: -1,
      localAdvantage: 0,
      skew: 0,
      rtt: NaN,
      rttVar: NaN,
      lead: NaN,
      echoTs: 0,
      echoAt: now,
      hashes: new Map(),
      checkedHash: -1,
      held: new Map(),
      notices: 0,
    };
    this.peers.set(id, peer);
    return peer;
  }

  private checkPeers(now: number): void {
    for (const peer of this.peers.values()) {
      if (peer.status === "disconnected") continue;
      const silent = now - peer.lastRecv;
      if (silent > (peer.heard ? this.disconnectTimeout : this.connectTimeout)) this.disconnectPeer(peer, "timeout");
      else if (peer.status === "connected" && silent > this.interruptTimeout && peer.player >= 0) {
        peer.status = "interrupted";
        this.onEvent({ type: "interrupted", peer: peer.id, player: peer.player });
      }
    }
  }

  private peerClosed(id: PeerId): void {
    const peer = this.peers.get(id);
    if (peer && peer.status !== "disconnected") this.disconnectPeer(peer, "closed");
  }

  private disconnectPeer(peer: Peer, reason: DisconnectReason): void {
    peer.status = "disconnected";
    if (peer.player < 0) {
      this.peers.delete(peer.id);
      this.onEvent({ type: "spectator-left", peer: peer.id });
      return;
    }
    const slot = this.slots[peer.player]!;
    if (slot.peer !== peer || slot.cut !== Infinity) return;
    // We only report it (see arbitrate); a goodbye or the lobby's word means he's gone for everyone.
    slot.lostReason = reason;
    this.addLost(this.localPlayer, peer.player);
    if (reason === "left" || reason === "closed") for (let p = 0; p < this.players; p++) this.addLost(peer.player, p);
  }

  /**
   * The others cut us, or we are the smaller side of a split (or lost its tie): we can't stay in sync with any of them,
   * so we lose them all and play on alone.
   */
  private dropOut(reason: "cut" | "split"): void {
    if (this.dropped) return;
    this.dropped = true;
    this.onEvent({ type: "dropped", reason });
    for (const peer of [...this.peers.values()]) if (peer.player >= 0 && peer.status !== "disconnected") this.disconnectPeer(peer, "dropped-us");
    for (let p = 0; p < this.players; p++) this.addLost(this.localPlayer, p);
    this.arbitrate();
  }

  // --- arbitration ---

  private isLost(reporter: number, target: number): boolean {
    const r = this.slots[reporter]!.rejoin, t = this.slots[target]!.rejoin;
    return this.lost.some((l) => l.reporter === reporter && l.target === target && l.reporterGen === r && l.targetGen === t);
  }

  /** Two players who don't hear each other (either one reported losing the other). */
  private apart(a: number, b: number): boolean {
    return this.isLost(a, b) || this.isLost(b, a);
  }

  private addLost(reporter: number, target: number, reporterGen = this.slots[reporter]?.rejoin ?? 0, targetGen = this.slots[target]?.rejoin ?? 0): void {
    const n = this.players;
    if (reporter === target || reporter >= n || target >= n) return;
    const stale = (l: Lost) => l.reporterGen < this.slots[l.reporter]!.rejoin || l.targetGen < this.slots[l.target]!.rejoin;
    const report = { reporter, target, reporterGen, targetGen };
    if (stale(report) || this.lost.some((l) => l.reporter === reporter && l.target === target && l.reporterGen === reporterGen && l.targetGen === targetGen)) return;
    this.lost = this.lost.filter((l) => !stale(l));
    this.lost.push(report);
  }

  /** The live players we reach from us through pairs that still hear each other (us included). */
  private group(): Set<number> {
    const group = new Set([this.localPlayer]);
    for (let grew = true; grew; ) {
      grew = false;
      for (let p = 0; p < this.players; p++) {
        if (group.has(p) || this.slots[p]!.cut !== Infinity) continue;
        if (![...group].every((q) => this.apart(p, q))) {
          group.add(p);
          grew = true;
        }
      }
    }
    return group;
  }

  /** He left for good (a bye, the lobby's word): every loss he reported, so no split counts him. */
  private gone(p: number): boolean {
    if (p === this.localPlayer) return false;
    for (let q = 0; q < this.players; q++) if (q !== p && !this.isLost(p, q)) return false;
    return true;
  }

  /**
   * Whether our side may cut `cutting` (whatever we can't stay with): "go" when the players we keep are a majority of
   * those still in (not cut, not gone for good), "drop" when they are fewer; on a tie, the referee's answer ("wait"
   * until it comes, "drop" without one within REFEREE_WAIT_MS), or without a referee, whether we keep the lowest
   * player. `claim`: what we claim with the referee (null when only players gone for good are cut).
   */
  private verdict(cutting: readonly number[], now: number, tie: { key: string; since: number } | null): { go: "go" | "wait" | "drop"; claim: SplitClaim | null } {
    const counted: number[] = [];
    for (let p = 0; p < this.players; p++) if (this.slots[p]!.cut === Infinity && !this.gone(p)) counted.push(p);
    const cut = counted.filter((p) => cutting.includes(p));
    if (cut.length === 0) return { go: "go", claim: null };
    const keep = counted.filter((p) => !cut.includes(p)), claim = { keep, cut };
    if (2 * keep.length > counted.length) return { go: "go", claim };
    if (2 * keep.length < counted.length) return { go: "drop", claim };
    if (!this.referee) return { go: keep.includes(counted[0]!) ? "go" : "drop", claim };
    const answer = this.referee(claim);
    if (answer !== undefined) return { go: answer ? "go" : "drop", claim };
    const key = JSON.stringify(claim);
    this.tie = tie?.key === key ? tie : { key, since: now };
    return { go: now - this.tie.since >= REFEREE_WAIT_MS ? "drop" : "wait", claim };
  }

  /**
   * When we are the arbiter (the lowest player of our group), decides the cuts and rejoins every peer then adopts from
   * our packets. Players out of our group are cut; within it, players are kept in order while they hear every player
   * kept before them, and cut otherwise (after ARBITER_GRACE_MS when we still hear both). The cut is after the last of
   * his inputs we hold; peers holding fewer get the rest from us (Relay), so nobody lowers it later and settled frames
   * stay as they are. A player back under a new peer who asked for a snapshot is un-cut from the frame of our next input
   * (once the cut is REJOIN_SETTLE_MS old and we hold his inputs up to it).
   * Only a majority of the players still in cuts the others (and claims it with the referee all the same, which refuses
   * it if the other side won a tie there first); a tie waits for the referee; the smaller side drops out (verdict).
   * Every peer, not only the arbiter, drops out once its side of a split is the smaller one or lost the tie.
   */
  private arbitrate(): void {
    if (this.closed) return;
    const group = this.group(), local = this.localPlayer, now = this.now();
    const tie = this.tie;
    this.tie = null;
    if (!this.dropped && this.claims.length > 0) {
      // (Answers to the cuts we made as a majority: a refusal means the other side won a tie first.)
      const answers = this.claims.map((c) => this.referee?.(c));
      this.claims = this.claims.filter((_, k) => answers[k] === undefined);
      if (answers.includes(false)) return this.dropOut("split");
    }
    if (Math.min(...group) !== local) {
      // Not the arbiter: we still drop out as soon as our side of a split is the smaller one, or lost its tie.
      const outside: number[] = [];
      for (let p = 0; p < this.players; p++) if (this.slots[p]!.cut === Infinity && !group.has(p)) outside.push(p);
      if (!this.dropped && outside.length > 0 && this.verdict(outside, now, tie).go === "drop") this.dropOut("split");
      return;
    }
    for (const key of this.conflicts.keys()) if (!this.apart(key >> 8, key & 255)) this.conflicts.delete(key);
    const kept = [local], cutting: number[] = [];
    for (let p = 0; p < this.players; p++) {
      const slot = this.slots[p]!;
      if (p === local || slot.cut !== Infinity) continue;
      const against = group.has(p) ? kept.filter((q) => this.apart(p, q)) : [local];
      if (against.length === 0) {
        kept.push(p);
        continue;
      }
      // Two players we hear who lost each other: wait a little, in case one of them crashed (we'd lose him too). (One
      // we lost ourselves goes at once, whoever else lost him: once due, a cut stays due, so no claim of ours to the
      // referee ever keeps a player an earlier one cut.)
      const due = against.includes(local) || against.every((q) => {
        const key = (p << 8) | q, since = this.conflicts.get(key) ?? now;
        this.conflicts.set(key, since);
        return now - since >= ARBITER_GRACE_MS;
      });
      if (due) cutting.push(p);
    }
    if (cutting.length > 0) {
      const { go, claim } = this.dropped ? { go: "go", claim: null } : this.verdict(cutting, now, tie);
      if (go === "drop") return this.dropOut("split");
      if (go === "wait") return;
      if (claim && this.referee && 2 * claim.keep.length > claim.keep.length + claim.cut.length) {
        // A majority's cut, claimed all the same: the other side may have won a tie at the referee already.
        const answer = this.referee(claim);
        if (answer === false) return this.dropOut("split");
        if (answer === undefined) this.claims.push(claim);
      }
      for (const p of cutting) {
        const slot = this.slots[p]!;
        this.cut(p, slot.log.length - 1, slot.peer?.status === "disconnected" ? slot.lostReason : "reported");
      }
    }
    for (let p = 0; p < this.players; p++) {
      const slot = this.slots[p]!;
      if (slot.awaiting && slot.asked && slot.cut !== Infinity && slot.log.length > slot.cut && now - slot.cutAt >= REJOIN_SETTLE_MS) {
        this.adoptRejoin(p, slot.cut, Math.max(this.slots[local]!.log.length, slot.cut + 2));
      }
    }
  }

  /**
   * Cuts a player after `frame` (the arbiter's decision, ours or adopted from a packet): his inputs after it become
   * disconnectedInput, and those up to it that we lack come relayed. Frames simulated with other inputs since are
   * resimulated (none of them settled: the arbiter's own reports kept every settled frame at or below what it held).
   */
  private cut(player: number, frame: number, reason: DisconnectReason): void {
    const slot = this.slots[player]!;
    if (frame >= slot.cut || frame < -1) return;
    const first = slot.cut === Infinity;
    if (!first) this.onEvent({ type: "error", message: `player ${player} cut after frame ${frame}, and after ${slot.cut} by another arbiter` });
    if (frame < this.settled) this.onEvent({ type: "error", message: `player ${player} cut after frame ${frame}, before the settled frame ${this.settled}` });
    slot.cut = frame;
    if (slot.log.length > frame + 1) slot.log.length = frame + 1;
    if (first) slot.cutAt = this.now();
    if (slot.peer && slot.peer.status !== "disconnected") {
      slot.peer.status = "disconnected";
      slot.peer.notices = CUT_NOTICES; // (it learns it was cut from our next packets)
    }
    if (frame + 1 < this.currentFrame - this.history) {
      this.onEvent({ type: "error", message: `player ${player} cut at frame ${frame}, beyond the ${this.history}-frame history` });
    }
    const from = Math.max(frame + 1, this.currentFrame - this.history, this.base);
    for (let f = from; f < this.currentFrame; f++) {
      if (slot.used[f % this.history] !== this.disconnectedInput) {
        this.invalidate(f);
        // States after f were final with the old inputs: report them again once corrected.
        if (this.finalFrame > f) {
          this.finalFrame = f;
          for (const k of this.localHashes.keys()) if (k > f) this.localHashes.delete(k);
        }
        break;
      }
    }
    // (The arbiter's cut of a player we had lost too: our own reason.)
    const why = !first ? "reported" : reason === "reported" && this.isLost(this.localPlayer, player) ? slot.lostReason : reason;
    this.onEvent({ type: "disconnected", peer: slot.peer?.id ?? null, player, frame, reason: why });
  }

  // --- packets ---

  private receive(from: PeerId, data: Uint8Array): void {
    if (this.closed) return;
    const peer = this.peers.get(from);
    if (!peer || peer.status === "disconnected") return;
    let packet: Packet;
    try {
      packet = decodePacket(data);
    } catch {
      this.stats.badPackets++;
      return;
    }
    const now = this.now();
    this.stats.packetsReceived++;
    this.stats.bytesReceived += data.byteLength;
    peer.heard = true;
    peer.lastRecv = now;
    if (peer.status !== "connected") {
      if (peer.status === "interrupted") this.onEvent({ type: "resumed", peer: peer.id, player: peer.player });
      peer.status = "connected";
    }
    peer.echoTs = packet.ts;
    peer.echoAt = now;
    if (packet.echo !== 0) {
      const sample = ((stamp(now) - packet.echo) >>> 0) - packet.echoDelay;
      if (sample >= 0 && sample < 60_000) {
        if (Number.isNaN(peer.rtt)) [peer.rtt, peer.rttVar] = [sample, 0];
        else {
          peer.rttVar += (Math.abs(sample - peer.rtt) - peer.rttVar) / 16; // (RFC 6298's RTTVAR, smoothed as RFC 3550's jitter)
          peer.rtt += (sample - peer.rtt) * 0.1;
        }
      }
    }
    peer.acked = Math.max(peer.acked, packet.ack);
    if (peer.player < 0) return; // spectators only ack the feed

    if (packet.frame >= peer.remoteFrame) {
      peer.remoteFrame = packet.frame;
      peer.remoteFrameAt = now;
      peer.remoteAdvantage = packet.advantage;
    }
    peer.remoteConfirmed = Math.max(peer.remoteConfirmed, packet.confirmed);
    for (const j of packet.rejoins) if (j.player < this.players) this.adoptRejoin(j.player, j.cut, j.frame);
    for (const c of packet.cuts) {
      if (c.player >= this.players || c.frame < this.slots[c.player]!.rejoin - 1) continue; // (a cut from before he came back)
      if (c.player === this.localPlayer) {
        // The arbiter cut us: we can't stay in sync with any of them.
        this.dropOut("cut");
        return;
      }
      if (c.player === peer.player) continue;
      this.cut(c.player, c.frame, "reported");
      const known = peer.held.get(c.player);
      if (this.slots[c.player]!.cut === c.frame) peer.held.set(c.player, { cut: c.frame, held: known?.cut === c.frame ? Math.max(known.held, c.held) : c.held });
    }
    for (const l of packet.lost) this.addLost(l.reporter, l.target, l.reporterGen, l.targetGen);
    if (packet.inputs) this.addRemoteInputs(peer.player, packet.inputs.start, packet.inputs.values);
    for (const r of packet.relay) this.addRelayedInputs(r.player, r.start, r.values);
    for (const [p, j] of this.pendingRejoins) if (this.slots[p]!.log.length > j.cut) this.adoptRejoin(p, j.cut, j.frame);
    if (packet.hash && packet.hash.frame > peer.checkedHash) peer.hashes.set(packet.hash.frame, packet.hash.hash);
    if (packet.flags & Flag.Bye) this.disconnectPeer(peer, "left");
  }

  private addRemoteInputs(player: number, start: number, values: readonly number[]): void {
    const slot = this.slots[player]!;
    if (slot.cut !== Infinity) return;
    for (let k = 0; k < values.length; k++) {
      const f = start + k;
      if (f < slot.log.length) continue;
      if (f > slot.log.length || f > this.currentFrame + MAX_INPUT_LEAD) break; // a gap: wait for the resend
      const v = values[k]!;
      slot.log.push(v);
      if (f < this.currentFrame && slot.used[f % this.history] !== v) this.invalidate(f);
    }
  }

  /** A cut player's inputs up to his cut, from a peer that holds more of them than we do. */
  private addRelayedInputs(player: number, start: number, values: readonly number[]): void {
    const slot = this.slots[player];
    if (!slot || player === this.localPlayer || slot.cut === Infinity) return;
    for (let k = 0; k < values.length; k++) {
      const f = start + k;
      if (f < slot.log.length) continue;
      if (f > slot.log.length || f > slot.cut) break;
      const v = values[k]!;
      slot.log.push(v);
      if (f < this.currentFrame && slot.used[f % this.history] !== v) this.invalidate(f);
    }
  }

  private sendAll(now: number, bye = false): void {
    const local = this.slots[this.localPlayer]!;
    const cuts: Packet["cuts"] = [], rejoins: Packet["rejoins"] = [];
    this.slots.forEach((s, player) => {
      if (s.cut !== Infinity) cuts.push({ player, frame: s.cut, held: Math.min(s.log.length - 1, s.cut) });
      if (s.rejoin > 0) rejoins.push({ player, cut: s.rejoinCut, frame: s.rejoin });
    });
    const lost = this.lost.filter((l) => l.reporterGen >= this.slots[l.reporter]!.rejoin && l.targetGen >= this.slots[l.target]!.rejoin);
    for (const peer of this.peers.values()) {
      if (peer.status === "disconnected" && !(peer.notices > 0 && peer.notices--)) continue;
      const packet = emptyPacket();
      packet.flags = bye ? Flag.Bye : 0;
      packet.frame = this.currentFrame;
      packet.confirmed = this.minConfirmed(true);
      packet.ts = stamp(now);
      packet.echo = peer.echoTs;
      packet.echoDelay = peer.echoTs === 0 ? 0 : now - peer.echoAt;
      packet.cuts = cuts;
      packet.rejoins = rejoins;
      packet.lost = lost;
      packet.hash = this.reportHash;
      if (peer.player >= 0) {
        packet.advantage = peer.heard ? peer.localAdvantage : 0;
        packet.ack = this.slots[peer.player]!.log.length - 1;
        const start = peer.acked + 1, end = Math.min(local.log.length, start + this.maxInputs);
        if (start < end) packet.inputs = { start, values: local.log.slice(start, end) };
        for (const [player, { cut, held }] of peer.held) {
          const slot = this.slots[player]!;
          if (slot.cut !== cut || held >= cut || slot.log.length - 1 <= held) continue;
          packet.relay.push({ player, start: held + 1, values: slot.log.slice(held + 1, Math.min(slot.log.length, cut + 1, held + 1 + this.maxInputs)) });
        }
      } else {
        const start = peer.acked + 1, end = Math.min(this.settled + 1, start + this.maxInputs);
        if (start < end) {
          const players: number[][] = [];
          for (let p = 0; p < this.players; p++) {
            const row: number[] = [];
            for (let f = start; f < end; f++) row.push(this.effectiveInput(p, f));
            players.push(row);
          }
          packet.feed = { start, players };
        }
      }
      const data = encodePacket(packet);
      this.stats.packetsSent++;
      this.stats.bytesSent += data.byteLength;
      this.transport.send(peer.id, data);
    }
  }
}
