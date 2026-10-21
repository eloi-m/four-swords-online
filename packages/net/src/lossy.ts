// Artificial latency, jitter and loss on top of a real transport (outgoing packets), to try the netcode on a bad
// network from one machine. Delayed packets wait in a queue drained by pump(), which the app calls often (a few ms);
// timers would be throttled in background tabs.
import { rng } from "./simnet.ts";
import type { PeerId, Transport, TransportHandlers } from "./types.ts";

export interface Impairment {
  latency: number;
  jitter: number;
  loss: number;
  /** Peers whose packets are all dropped (a link cut one way: cut it on both pages for a partition). */
  cut?: PeerId[];
}

export class LossyTransport implements Transport {
  readonly impairment: Impairment;
  dropped = 0;
  private readonly inner: Transport;
  private readonly now: () => number;
  private readonly random: () => number;
  private queue: { at: number; peer: PeerId; data: Uint8Array }[] = [];

  constructor(inner: Transport, impairment: Impairment, now: () => number, seed = Date.now()) {
    this.inner = inner;
    this.impairment = impairment;
    this.now = now;
    this.random = rng(seed);
  }

  send(peer: PeerId, data: Uint8Array): void {
    if (this.random() < this.impairment.loss || this.impairment.cut?.includes(peer)) {
      this.dropped++;
      return;
    }
    const at = this.now() + this.impairment.latency + this.random() * this.impairment.jitter;
    this.queue.push({ at, peer, data: data.slice() });
    this.pump();
  }

  /** Sends the packets whose delay has elapsed (in delivery-time order, so jitter reorders them). */
  pump(): void {
    const now = this.now();
    if (!this.queue.some((p) => p.at <= now)) return;
    this.queue.sort((a, b) => a.at - b.at);
    while (this.queue.length > 0 && this.queue[0]!.at <= now) {
      const p = this.queue.shift()!;
      this.inner.send(p.peer, p.data);
    }
  }

  /** Sends everything still queued now (when leaving: the goodbye shouldn't wait for artificial lag). */
  flush(): void {
    this.queue.sort((a, b) => a.at - b.at);
    for (const p of this.queue.splice(0)) this.inner.send(p.peer, p.data);
  }

  listen(handlers: TransportHandlers): void {
    this.inner.listen(handlers);
  }
}
