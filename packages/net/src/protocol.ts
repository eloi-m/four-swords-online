// Binary packets exchanged by sessions (big-endian). One packet per peer per tick carries everything: time sync,
// acks, the sender's unacked inputs (redundantly, run-length encoded), disconnect cuts and rejoins, the links it lost
// and a cut player's inputs relayed to a peer that lacks them, the latest settled state hash, and for spectators the
// confirmed inputs of every player. Layout in docs/netcode.md.

export const MAGIC = 0xf5;

export const Flag = {
  /** Carries the sender's own inputs. */
  Inputs: 1,
  /** Carries the hash of a settled frame. */
  Hash: 2,
  /** The sender is leaving the session. */
  Bye: 4,
  /** Carries the players the sender has disconnected, with their last frame. */
  Cuts: 8,
  /** Carries confirmed inputs of every player (player → spectator). */
  Feed: 16,
  /** The sender is a spectator (its packets only ack the feed). */
  Spectator: 32,
  /** Carries the players who came back after a cut: from which frame their inputs count again. */
  Rejoins: 64,
  /** Carries the players known to have lost another (the arbiter's evidence, see Packet.lost). */
  Lost: 128,
  /** Carries a cut player's inputs up to his cut, for a receiver that holds fewer of them. */
  Relay: 256,
} as const;

export interface InputRange {
  start: number;
  values: number[];
}

export interface Packet {
  flags: number;
  /** Sender's current frame (the next one it will simulate). */
  frame: number;
  /** Last frame for which the sender holds every player's input, -1 for none. */
  confirmed: number;
  /** Sender's frame advantage over the receiver, in frames (1/16 precision). */
  advantage: number;
  /** Last frame of the receiver's inputs (or of the feed, for a spectator) the sender holds, -1 for none. */
  ack: number;
  /** Sender clock in ms (u32), the latest `ts` it got from the receiver, and how long ago it got it (ms). */
  ts: number;
  echo: number;
  echoDelay: number;
  /** The cut players: their last frame of real inputs, and how many of them the sender holds (its last one). */
  cuts: { player: number; frame: number; held: number }[];
  /** A cut player back from `frame` on (inputs after `cut` and before `frame` are the disconnected input). */
  rejoins: { player: number; cut: number; frame: number }[];
  /** `reporter` no longer hears `target` (`gens`: each one's rejoin frame then, so an earlier life's reports expire). */
  lost: { reporter: number; target: number; reporterGen: number; targetGen: number }[];
  /** Cut players' inputs the receiver lacks (from its `held` + 1). */
  relay: (InputRange & { player: number })[];
  inputs: InputRange | null;
  hash: { frame: number; hash: number } | null;
  /** Confirmed inputs per player, all of the same length, starting at `start`. */
  feed: { start: number; players: number[][] } | null;
}

const MAX_RUN = 255;
const MAX_COUNT = 0xffff;

export function emptyPacket(): Packet {
  return { flags: 0, frame: 0, confirmed: -1, advantage: 0, ack: -1, ts: 0, echo: 0, echoDelay: 0, cuts: [], rejoins: [], lost: [], relay: [], inputs: null, hash: null, feed: null };
}

class Writer {
  private buf = new Uint8Array(128);
  private view = new DataView(this.buf.buffer);
  length = 0;

  private ensure(n: number): void {
    if (this.length + n <= this.buf.length) return;
    const next = new Uint8Array(Math.max(this.buf.length * 2, this.length + n));
    next.set(this.buf);
    this.buf = next;
    this.view = new DataView(next.buffer);
  }
  u8(v: number): void {
    this.ensure(1);
    this.view.setUint8(this.length, v);
    this.length += 1;
  }
  u16(v: number): void {
    this.ensure(2);
    this.view.setUint16(this.length, v);
    this.length += 2;
  }
  i16(v: number): void {
    this.ensure(2);
    this.view.setInt16(this.length, v);
    this.length += 2;
  }
  u32(v: number): void {
    this.ensure(4);
    this.view.setUint32(this.length, v >>> 0);
    this.length += 4;
  }
  bytes(): Uint8Array {
    return this.buf.slice(0, this.length);
  }
}

class Reader {
  private readonly view: DataView;
  private pos = 0;
  constructor(data: Uint8Array) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }
  private need(n: number): void {
    if (this.pos + n > this.view.byteLength) throw new Error("truncated packet");
  }
  u8(): number {
    this.need(1);
    return this.view.getUint8(this.pos++);
  }
  u16(): number {
    this.need(2);
    const v = this.view.getUint16(this.pos);
    this.pos += 2;
    return v;
  }
  i16(): number {
    this.need(2);
    const v = this.view.getInt16(this.pos);
    this.pos += 2;
    return v;
  }
  u32(): number {
    this.need(4);
    const v = this.view.getUint32(this.pos);
    this.pos += 4;
    return v;
  }
  get done(): boolean {
    return this.pos === this.view.byteLength;
  }
}

// Run-length encoding of u16 inputs: (u16 value, u8 run) pairs covering `count` values (count written separately).
function writeRuns(w: Writer, values: readonly number[]): void {
  for (let i = 0; i < values.length; ) {
    const v = values[i]!;
    let run = 1;
    while (i + run < values.length && run < MAX_RUN && values[i + run] === v) run++;
    w.u16(v);
    w.u8(run);
    i += run;
  }
}

function readRuns(r: Reader, count: number): number[] {
  const values: number[] = [];
  while (values.length < count) {
    const v = r.u16(), run = r.u8();
    if (run === 0 || values.length + run > count) throw new Error("bad input run");
    for (let k = 0; k < run; k++) values.push(v);
  }
  return values;
}

function checkInputs(values: readonly number[]): void {
  if (values.length > MAX_COUNT) throw new Error("too many inputs in one packet");
  for (const v of values) if (!Number.isInteger(v) || v < 0 || v > 0xffff) throw new Error(`input ${v} is not a u16`);
}

export function encodePacket(p: Packet): Uint8Array {
  let flags = p.flags & (Flag.Bye | Flag.Spectator);
  if (p.inputs && p.inputs.values.length > 0) flags |= Flag.Inputs;
  if (p.hash) flags |= Flag.Hash;
  if (p.cuts.length > 0) flags |= Flag.Cuts;
  if (p.rejoins.length > 0) flags |= Flag.Rejoins;
  if (p.lost.length > 0) flags |= Flag.Lost;
  if (p.relay.length > 0) flags |= Flag.Relay;
  if (p.feed && (p.feed.players[0]?.length ?? 0) > 0) flags |= Flag.Feed;
  const w = new Writer();
  w.u8(MAGIC);
  w.u16(flags);
  w.u32(p.frame);
  w.u32(p.confirmed + 1);
  w.i16(Math.max(-0x8000, Math.min(0x7fff, Math.round(p.advantage * 16))));
  w.u32(p.ack + 1);
  w.u32(p.ts);
  w.u32(p.echo);
  w.u16(Math.max(0, Math.min(0xffff, Math.round(p.echoDelay))));
  if (flags & Flag.Cuts) {
    w.u8(p.cuts.length);
    for (const c of p.cuts) {
      w.u8(c.player);
      w.u32(c.frame + 1);
      w.u32(c.held + 1);
    }
  }
  if (flags & Flag.Rejoins) {
    w.u8(p.rejoins.length);
    for (const j of p.rejoins) {
      w.u8(j.player);
      w.u32(j.cut + 1);
      w.u32(j.frame);
    }
  }
  if (flags & Flag.Lost) {
    w.u8(p.lost.length);
    for (const l of p.lost) {
      w.u8(l.reporter);
      w.u8(l.target);
      w.u32(l.reporterGen);
      w.u32(l.targetGen);
    }
  }
  if (flags & Flag.Relay) {
    w.u8(p.relay.length);
    for (const r of p.relay) {
      checkInputs(r.values);
      w.u8(r.player);
      w.u32(r.start);
      w.u16(r.values.length);
      writeRuns(w, r.values);
    }
  }
  if (flags & Flag.Inputs) {
    const { start, values } = p.inputs!;
    checkInputs(values);
    w.u32(start);
    w.u16(values.length);
    writeRuns(w, values);
  }
  if (flags & Flag.Hash) {
    w.u32(p.hash!.frame);
    w.u32(p.hash!.hash);
  }
  if (flags & Flag.Feed) {
    const { start, players } = p.feed!;
    const count = players[0]!.length;
    w.u32(start);
    w.u16(count);
    w.u8(players.length);
    for (const values of players) {
      if (values.length !== count) throw new Error("feed rows differ in length");
      checkInputs(values);
      writeRuns(w, values);
    }
  }
  return w.bytes();
}

/** Throws on anything malformed; sessions drop such packets. */
export function decodePacket(data: Uint8Array): Packet {
  const r = new Reader(data);
  if (r.u8() !== MAGIC) throw new Error("not a netcode packet");
  const p = emptyPacket();
  p.flags = r.u16();
  p.frame = r.u32();
  p.confirmed = r.u32() - 1;
  p.advantage = r.i16() / 16;
  p.ack = r.u32() - 1;
  p.ts = r.u32();
  p.echo = r.u32();
  p.echoDelay = r.u16();
  if (p.flags & Flag.Cuts) {
    const n = r.u8();
    for (let i = 0; i < n; i++) p.cuts.push({ player: r.u8(), frame: r.u32() - 1, held: r.u32() - 1 });
  }
  if (p.flags & Flag.Rejoins) {
    const n = r.u8();
    for (let i = 0; i < n; i++) p.rejoins.push({ player: r.u8(), cut: r.u32() - 1, frame: r.u32() });
  }
  if (p.flags & Flag.Lost) {
    const n = r.u8();
    for (let i = 0; i < n; i++) p.lost.push({ reporter: r.u8(), target: r.u8(), reporterGen: r.u32(), targetGen: r.u32() });
  }
  if (p.flags & Flag.Relay) {
    const n = r.u8();
    for (let i = 0; i < n; i++) {
      const player = r.u8(), start = r.u32(), count = r.u16();
      p.relay.push({ player, start, values: readRuns(r, count) });
    }
  }
  if (p.flags & Flag.Inputs) {
    const start = r.u32(), count = r.u16();
    p.inputs = { start, values: readRuns(r, count) };
  }
  if (p.flags & Flag.Hash) p.hash = { frame: r.u32(), hash: r.u32() };
  if (p.flags & Flag.Feed) {
    const start = r.u32(), count = r.u16(), n = r.u8();
    const players: number[][] = [];
    for (let i = 0; i < n; i++) players.push(readRuns(r, count));
    p.feed = { start, players };
  }
  if (!r.done) throw new Error("trailing bytes in packet");
  return p;
}
