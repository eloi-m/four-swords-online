// Datagrams through the signaling server's WebSocket: the fallback when WebRTC can't connect. It's TCP underneath
// (reliable and ordered, so a lost segment delays the ones behind it), but the session doesn't mind.
import type { LobbyClient } from "./lobby.ts";
import type { PeerId, Transport, TransportHandlers } from "./types.ts";

export class RelayTransport implements Transport {
  private readonly lobby: LobbyClient;
  private handlers: TransportHandlers | null = null;
  private readonly off: (() => void)[];

  constructor(lobby: LobbyClient) {
    this.lobby = lobby;
    this.off = [
      lobby.on("relay", (from, data) => this.handlers?.message(String(from), data.slice())),
      lobby.on("left", (id) => this.handlers?.closed?.(String(id))),
    ];
  }

  send(peer: PeerId, data: Uint8Array): void {
    this.lobby.relay(Number(peer), data);
  }

  listen(handlers: TransportHandlers): void {
    this.handlers = handlers;
  }

  /** Stops listening to the lobby; the lobby connection itself stays open (for the next match in the room). */
  close(): void {
    for (const off of this.off.splice(0)) off();
    this.handlers = null;
  }
}
