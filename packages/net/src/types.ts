// The two seams of the netcode: the game it runs and the network it talks over.

/**
 * A deterministic game the rollback session can drive. `step` advances one 60 Hz frame from one input per player
 * (button masks, 0..0xffff) and may mutate its argument; `clone` makes the snapshots rollbacks restore; `hash` must
 * be equal on every machine for equal states (it is exchanged to detect desyncs).
 */
export interface RollbackGame<S> {
  clone(state: S): S;
  step(state: S, inputs: readonly number[]): S;
  hash(state: S): number;
}

/** Transport-level address of a remote peer (the lobby's member id, as a string). */
export type PeerId = string;

export interface TransportHandlers {
  message(from: PeerId, data: Uint8Array): void;
  /** The transport knows the peer is gone for good (it left the lobby, its connection closed). */
  closed?(peer: PeerId): void;
}

/**
 * Datagram transport: `send` may drop, duplicate or reorder packets (WebRTC data channels with maxRetransmits 0,
 * a relay, a simulated network). Packets are small (well under 1200 bytes).
 */
export interface Transport {
  send(peer: PeerId, data: Uint8Array): void;
  /** Installs the receive handlers (one set per transport; a later call replaces them). */
  listen(handlers: TransportHandlers): void;
}
