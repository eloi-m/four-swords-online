// WebRTC data channels, one RTCPeerConnection per remote member, signaled through the lobby. Channels are
// unordered with maxRetransmits 0 (UDP-like: a late packet is useless to rollback netcode, a resend has newer data).
// The member with the lower id makes the offer. Browser only (RTCPeerConnection).
import type { LobbyClient } from "./lobby.ts";
import type { PeerId, Transport, TransportHandlers } from "./types.ts";

export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

export type ChannelState = "connecting" | "open" | "closed";

/** `ch` is the transport's channel: signals of an earlier match's connections (a rematch in the same room) are ignored. */
type Signal = ({ rtc: "offer" | "answer"; sdp: string } | { rtc: "candidate"; candidate: RTCIceCandidateInit | null }) & { ch?: number };

interface Link {
  pc: RTCPeerConnection;
  channel: RTCDataChannel;
  /** Candidates that arrived before the remote description. */
  early: (RTCIceCandidateInit | null)[];
  haveRemote: boolean;
}

export interface WebRtcOptions {
  iceServers?: RTCIceServer[];
  /** "relay" = TURN candidates only (with no TURN server, ICE never connects: tests of the relay fallback). */
  iceTransportPolicy?: RTCIceTransportPolicy;
  /** Called when a channel opens or closes. */
  onState?: (peer: PeerId, state: ChannelState) => void;
  /** Tags our signals; signals with another tag are ignored (default 0). */
  channel?: number;
}

export class WebRtcTransport implements Transport {
  private readonly lobby: LobbyClient;
  private readonly links = new Map<number, Link>();
  private readonly options: WebRtcOptions;
  private readonly channel: number;
  private handlers: TransportHandlers | null = null;
  private readonly off: (() => void)[];
  private closed = false;

  constructor(lobby: LobbyClient, peers: readonly number[], options: WebRtcOptions = {}) {
    this.lobby = lobby;
    this.options = options;
    this.channel = options.channel ?? 0;
    for (const peer of peers) this.connect(peer);
    // Subscribing replays signals that arrived before us (an offer can beat our own start handling).
    this.off = [
      lobby.on("signal", (from, data) => void this.signal(from, data as Signal)),
      lobby.on("left", (id) => {
        this.drop(id);
        this.handlers?.closed?.(String(id));
      }),
    ];
  }

  /** Connects to a member that wasn't in the initial list (a spectator joining mid-match). */
  addPeer(peer: number): void {
    if (!this.closed && !this.links.has(peer)) this.connect(peer);
  }

  state(peer: PeerId): ChannelState {
    const link = this.links.get(Number(peer));
    if (!link) return "closed";
    return link.channel.readyState === "open" ? "open" : link.channel.readyState === "connecting" ? "connecting" : "closed";
  }

  send(peer: PeerId, data: Uint8Array): void {
    const link = this.links.get(Number(peer));
    if (!link || link.channel.readyState !== "open") return;
    try {
      link.channel.send(data as Uint8Array<ArrayBuffer>);
    } catch {
      // Buffer full or closing: a datagram lost like any other.
    }
  }

  listen(handlers: TransportHandlers): void {
    this.handlers = handlers;
  }

  /** Closes every connection and stops listening to the lobby (whose connection stays open for the next match). */
  close(): void {
    this.closed = true;
    for (const off of this.off.splice(0)) off();
    this.handlers = null;
    for (const id of [...this.links.keys()]) this.drop(id);
  }

  private sendSignal(peer: number, signal: Signal): void {
    if (!this.closed) this.lobby.signal(peer, { ...signal, ch: this.channel } satisfies Signal);
  }

  private connect(peer: number): Link {
    const pc = new RTCPeerConnection({
      iceServers: this.options.iceServers ?? DEFAULT_ICE_SERVERS,
      iceTransportPolicy: this.options.iceTransportPolicy ?? "all",
    });
    const channel = pc.createDataChannel("game", { negotiated: true, id: 0, ordered: false, maxRetransmits: 0 });
    channel.binaryType = "arraybuffer";
    const link: Link = { pc, channel, early: [], haveRemote: false };
    this.links.set(peer, link);
    channel.onmessage = (e) => this.handlers?.message(String(peer), new Uint8Array(e.data as ArrayBuffer));
    channel.onopen = () => this.options.onState?.(String(peer), "open");
    channel.onclose = () => this.options.onState?.(String(peer), "closed");
    pc.onicecandidate = (e) => this.sendSignal(peer, { rtc: "candidate", candidate: e.candidate?.toJSON() ?? null });
    if (this.lobby.you < peer) {
      void (async () => {
        await pc.setLocalDescription(await pc.createOffer());
        this.sendSignal(peer, { rtc: "offer", sdp: pc.localDescription!.sdp });
      })().catch((e) => console.warn("webrtc offer failed", e));
    }
    return link;
  }

  private async signal(from: number, data: Signal): Promise<void> {
    if (this.closed || !data || typeof data !== "object" || !("rtc" in data) || (data.ch ?? 0) !== this.channel) return;
    const link = this.links.get(from) ?? this.connect(from);
    const { pc } = link;
    try {
      if (data.rtc === "offer" || data.rtc === "answer") {
        await pc.setRemoteDescription({ type: data.rtc, sdp: data.sdp });
        link.haveRemote = true;
        for (const c of link.early.splice(0)) await pc.addIceCandidate(c ?? undefined);
        if (data.rtc === "offer") {
          await pc.setLocalDescription(await pc.createAnswer());
          this.sendSignal(from, { rtc: "answer", sdp: pc.localDescription!.sdp });
        }
      } else if (data.rtc === "candidate") {
        if (link.haveRemote) await pc.addIceCandidate(data.candidate ?? undefined);
        else link.early.push(data.candidate);
      }
    } catch (e) {
      console.warn("webrtc signaling failed", e);
    }
  }

  private drop(peer: number): void {
    const link = this.links.get(peer);
    if (!link) return;
    this.links.delete(peer);
    link.channel.close();
    link.pc.close();
  }
}
