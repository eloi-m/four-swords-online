// The transport a match uses: WebRTC where it connects, the lobby relay otherwise. In "auto" mode packets go
// through the relay from the first frame and switch to the data channel per peer as soon as it opens, so a match
// never waits on ICE and still works where WebRTC is blocked.
//
// A data channel can also go quiet while it still reads "open" (a phone moving from Wi-Fi to cellular, a NAT
// rebinding: often in one direction only), and the channel only notices after tens of seconds, long after the
// session's 3 s disconnect. Every peer sends a packet per tick, so in "auto" mode a channel that hasn't delivered
// anything for `staleMs` counts as down: packets to that peer go through the relay too, flagged "I don't hear you
// over WebRTC", and a peer that receives the flag also sends through the relay (for a channel dead in the other
// direction only) until the flags stop. Both paths deliver; the session doesn't mind duplicates.
//
// Every datagram starts with a byte: the channel in its low 7 bits (the match's number in the room, see
// StartInfo.match; datagrams of another channel are dropped: the late packets of a match that just ended, a bye, a
// hash report, stale inputs, can't reach the rematch that follows it over the same lobby connection), and the
// "don't hear you" flag in bit 7.
import type { LobbyClient } from "./lobby.ts";
import { RelayTransport } from "./relay.ts";
import type { PeerId, Transport, TransportHandlers } from "./types.ts";
import { WebRtcTransport, type ChannelState } from "./webrtc.ts";

export type TransportMode = "auto" | "webrtc" | "relay";

export interface PeerTransportOptions {
  mode?: TransportMode;
  iceServers?: RTCIceServer[];
  /** "relay" = TURN candidates only; with no TURN server, ICE never connects (testing the relay fallback). */
  iceTransportPolicy?: RTCIceTransportPolicy;
  onRoute?: (peer: PeerId, route: Route) => void;
  /** Channel number prefixed to every datagram (0–127, default 0; higher values wrap). */
  channel?: number;
  /** A data channel silent for this long counts as down (default 250 ms, "auto" mode only). */
  staleMs?: number;
  now?: () => number;
  /** Tests: the two paths instead of a relay and WebRTC over the lobby. */
  paths?: { relay: RelayPath | null; rtc: RtcPath | null };
}

/** The relay side as PeerTransport uses it (RelayTransport, or a fake in tests). */
export interface RelayPath extends Transport {
  close(): void;
}

/** The WebRTC side as PeerTransport uses it (WebRtcTransport, or a fake in tests). */
export interface RtcPath extends Transport {
  state(peer: PeerId): ChannelState;
  addPeer(peer: number): void;
  close(): void;
}

export type Route = "webrtc" | "relay" | "none";

const CHANNEL_MASK = 0x7f;
/** Bit 7 of the first byte: the sender doesn't hear us over WebRTC. */
const DEAF = 0x80;
/** How long a peer's "don't hear you" keeps us sending through the relay. */
const COMPLAINT_MS = 500;

interface PeerPaths {
  /** When a datagram last arrived over WebRTC (-Infinity: never). */
  rtcAt: number;
  /** When the peer last said it doesn't hear us over WebRTC. */
  deafAt: number;
  route: Route | null;
}

export class PeerTransport implements Transport {
  readonly mode: TransportMode;
  readonly channel: number;
  /** Datagrams dropped for carrying another channel's byte. */
  foreign = 0;
  /** Datagrams sent through the relay while the data channel was open (it had gone quiet). */
  rescued = 0;
  private readonly relay: RelayPath | null;
  private readonly rtc: RtcPath | null;
  private readonly staleMs: number;
  private readonly now: () => number;
  private readonly onRoute: ((peer: PeerId, route: Route) => void) | undefined;
  private readonly peers = new Map<PeerId, PeerPaths>();

  constructor(lobby: LobbyClient | null, peers: readonly number[], options: PeerTransportOptions = {}) {
    this.mode = options.mode ?? "auto";
    this.channel = (options.channel ?? 0) & CHANNEL_MASK;
    this.staleMs = options.staleMs ?? 250;
    this.now = options.now ?? (() => performance.now());
    this.onRoute = options.onRoute;
    if (options.paths) {
      this.relay = this.mode === "webrtc" ? null : options.paths.relay;
      this.rtc = this.mode === "relay" ? null : options.paths.rtc;
      return;
    }
    this.relay = this.mode === "webrtc" ? null : new RelayTransport(lobby!);
    this.rtc =
      this.mode === "relay"
        ? null
        : new WebRtcTransport(lobby!, peers, {
            iceServers: options.iceServers,
            iceTransportPolicy: options.iceTransportPolicy,
            channel: this.channel,
            onState: (peer) => this.report(peer),
          });
  }

  /** Connects to a member joining mid-match (the relay needs nothing). */
  addPeer(peer: number): void {
    this.rtc?.addPeer(peer);
  }

  /** How packets to this peer travel right now ("relay" also while a quiet data channel is tried alongside it). */
  route(peer: PeerId): Route {
    if (this.rtc?.state(peer) === "open" && !this.needsRelay(peer)) return "webrtc";
    return this.relay ? "relay" : this.rtc?.state(peer) === "open" ? "webrtc" : "none";
  }

  send(peer: PeerId, data: Uint8Array): void {
    const open = this.rtc?.state(peer) === "open";
    const deaf = !open || this.deaf(peer);
    const tagged = new Uint8Array(data.byteLength + 1);
    tagged[0] = this.channel | (deaf && this.relay && this.rtc ? DEAF : 0);
    tagged.set(data, 1);
    if (open) this.rtc!.send(peer, tagged);
    if (!open || this.needsRelay(peer)) {
      if (open && this.relay) this.rescued++;
      this.relay?.send(peer, tagged);
    }
    this.report(peer);
  }

  listen(handlers: TransportHandlers): void {
    const on = (rtc: boolean) => (from: PeerId, data: Uint8Array) => {
      if (data.byteLength < 1 || (data[0]! & CHANNEL_MASK) !== this.channel) {
        this.foreign++;
        return;
      }
      const p = this.paths(from);
      if (rtc) p.rtcAt = this.now();
      if (data[0]! & DEAF) p.deafAt = this.now();
      handlers.message(from, data.subarray(1));
    };
    // Both paths deliver (duplicates while switching are harmless to the session).
    this.relay?.listen({ message: on(false), closed: handlers.closed });
    this.rtc?.listen({ message: on(true), closed: handlers.closed });
  }

  /** Closes the data channels and stops listening to the lobby (the lobby connection stays open). */
  close(): void {
    this.rtc?.close();
    this.relay?.close();
  }

  private paths(peer: PeerId): PeerPaths {
    let p = this.peers.get(peer);
    if (!p) this.peers.set(peer, (p = { rtcAt: -Infinity, deafAt: -Infinity, route: null }));
    return p;
  }

  /** Nothing has arrived from this peer over its open data channel lately. */
  private deaf(peer: PeerId): boolean {
    return this.mode === "auto" && this.now() - this.paths(peer).rtcAt > this.staleMs;
  }

  /** Packets to this peer go through the relay too: we don't hear it over WebRTC, or it doesn't hear us. */
  private needsRelay(peer: PeerId): boolean {
    return this.mode === "auto" && (this.deaf(peer) || this.now() - this.paths(peer).deafAt < COMPLAINT_MS);
  }

  private report(peer: PeerId): void {
    if (!this.onRoute) return;
    const p = this.paths(peer), route = this.route(peer);
    if (route === p.route) return;
    p.route = route;
    this.onRoute(peer, route);
  }
}
