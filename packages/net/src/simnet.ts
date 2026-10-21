// Deterministic simulated network and event loop, for testing sessions under latency, jitter, loss, duplication
// and reordering without real time or sockets. Everything is driven by one virtual clock (ms).
import type { PeerId, Transport, TransportHandlers } from "./types.ts";

/** Seeded PRNG (mulberry32): a float in [0, 1) per call. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface LinkConditions {
  /** One-way base latency, ms. */
  latency: number;
  /** Extra uniform random delay in [0, jitter) ms per packet; packets overtake each other when it exceeds the
   * send interval. */
  jitter: number;
  /** Probability a packet is dropped. */
  loss: number;
  /** Probability a packet is delivered twice. */
  duplicate?: number;
}

interface InFlight {
  at: number;
  seq: number;
  from: PeerId;
  to: PeerId;
  data: Uint8Array;
}

export class SimNetwork {
  now = 0;
  delivered = 0;
  dropped = 0;
  private readonly random: () => number;
  private readonly defaults: LinkConditions;
  private readonly links = new Map<string, LinkConditions>();
  private readonly handlers = new Map<PeerId, TransportHandlers>();
  private queue: InFlight[] = [];
  private seq = 0;

  constructor(conditions: LinkConditions, seed = 1) {
    this.defaults = conditions;
    this.random = rng(seed);
  }

  /** Overrides the conditions from one peer to another (one direction). */
  setLink(from: PeerId, to: PeerId, conditions: LinkConditions): void {
    this.links.set(`${from}>${to}`, conditions);
  }

  /** Cuts both directions between two peers (or restores the defaults with `false`). */
  partition(a: PeerId, b: PeerId, cut = true): void {
    for (const [x, y] of [[a, b], [b, a]] as const) {
      if (cut) this.setLink(x, y, { latency: 0, jitter: 0, loss: 1 });
      else this.links.delete(`${x}>${y}`);
    }
  }

  endpoint(id: PeerId): Transport & { closePeer(peer: PeerId): void } {
    return {
      send: (to, data) => this.send(id, to, data),
      listen: (handlers) => void this.handlers.set(id, handlers),
      closePeer: (peer) => this.handlers.get(id)?.closed?.(peer),
    };
  }

  private send(from: PeerId, to: PeerId, data: Uint8Array): void {
    const c = this.links.get(`${from}>${to}`) ?? this.defaults;
    if (this.random() < c.loss) {
      this.dropped++;
      return;
    }
    const copies = c.duplicate && this.random() < c.duplicate ? 2 : 1;
    for (let k = 0; k < copies; k++) {
      const at = this.now + c.latency + this.random() * c.jitter;
      this.push({ at, seq: this.seq++, from, to, data: data.slice() });
    }
  }

  private push(p: InFlight): void {
    // Sorted insert (queues stay small: a few peers × a few hundred ms of packets).
    let i = this.queue.length;
    while (i > 0 && (this.queue[i - 1]!.at > p.at || (this.queue[i - 1]!.at === p.at && this.queue[i - 1]!.seq > p.seq))) i--;
    this.queue.splice(i, 0, p);
  }

  /** Time of the next delivery, or Infinity. */
  nextDelivery(): number {
    return this.queue[0]?.at ?? Infinity;
  }

  /** Delivers every packet due by `time` (and moves the clock there). */
  deliverUntil(time: number): void {
    while (this.queue.length > 0 && this.queue[0]!.at <= time) {
      const p = this.queue.shift()!;
      this.now = p.at;
      this.delivered++;
      this.handlers.get(p.to)?.message(p.from, p.data);
    }
    this.now = time;
  }
}

export interface Ticker {
  /** First tick time, ms. */
  start: number;
  /** Tick period, ms (1000/60 for a 60 Hz machine; slightly off to model clock drift). */
  period: number;
  /** Last tick time (exclusive), or Infinity. */
  stop?: number;
  tick(): void;
}

/**
 * Runs the virtual world until `until` ms: packet deliveries and every ticker's ticks, in time order (deliveries
 * first on ties, then tickers in array order).
 */
export function runSimulation(net: SimNetwork, tickers: Ticker[], until: number): void {
  const next = tickers.map((t) => t.start);
  for (;;) {
    let best = -1, bestAt = Infinity;
    next.forEach((at, i) => {
      if (at < bestAt && at < (tickers[i]!.stop ?? Infinity)) {
        bestAt = at;
        best = i;
      }
    });
    const deliveryAt = net.nextDelivery();
    if (Math.min(bestAt, deliveryAt) > until) break;
    if (deliveryAt <= bestAt) {
      net.deliverUntil(deliveryAt);
      continue;
    }
    net.deliverUntil(bestAt);
    tickers[best]!.tick();
    next[best] = bestAt + tickers[best]!.period;
  }
  net.deliverUntil(until);
}
