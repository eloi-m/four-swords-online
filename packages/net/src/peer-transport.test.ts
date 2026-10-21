import { describe, expect, it } from "vitest";
import { PeerTransport, type RelayPath, type Route, type RtcPath } from "./peer-transport.ts";
import type { ChannelState } from "./webrtc.ts";
import type { PeerId, TransportHandlers } from "./types.ts";

/** Two members ("1", "2") joined by a fake relay and a fake data channel whose directions can go quiet. */
function pair(options: { channel?: number } = {}) {
  let now = 0;
  const handlers = { relay: new Map<PeerId, TransportHandlers>(), rtc: new Map<PeerId, TransportHandlers>() };
  const counts = { relay: 0, rtc: 0 };
  const rtc = { state: "open" as ChannelState, dead: new Set<PeerId>() }; // dead: senders whose data channel packets vanish
  const relayPath = (me: PeerId): RelayPath => ({
    send: (to, data) => (counts.relay++, handlers.relay.get(to)?.message(me, data)),
    listen: (h) => void handlers.relay.set(me, h),
    close: () => {},
  });
  const rtcPath = (me: PeerId): RtcPath => ({
    state: () => rtc.state,
    addPeer: () => {},
    send: (to, data) => {
      counts.rtc++;
      if (!rtc.dead.has(me)) handlers.rtc.get(to)?.message(me, data);
    },
    listen: (h) => void handlers.rtc.set(me, h),
    close: () => {},
  });
  const routes: Record<PeerId, Route[]> = { "1": [], "2": [] };
  const got: Record<PeerId, number> = { "1": 0, "2": 0 };
  const make = (me: PeerId) => {
    const t = new PeerTransport(null, [], { ...options, now: () => now, paths: { relay: relayPath(me), rtc: rtcPath(me) }, onRoute: (_peer, r) => routes[me]!.push(r) });
    t.listen({ message: () => got[me]!++ });
    return t;
  };
  const a = make("1"), b = make("2");
  /** One 60 Hz tick: each side sends one packet to the other. */
  const tick = () => {
    now += 1000 / 60;
    a.send("2", new Uint8Array([1, 2, 3]));
    b.send("1", new Uint8Array([4, 5, 6]));
  };
  const run = (ms: number) => {
    const until = now + ms;
    while (now < until) tick();
  };
  return { a, b, rtc, counts, routes, got, run, reset: () => ((counts.relay = counts.rtc = 0), (got["1"] = got["2"] = 0)) };
}

describe("PeerTransport (auto)", () => {
  it("uses the relay until the data channel opens, then only the data channel", () => {
    const p = pair();
    p.rtc.state = "connecting";
    p.run(500);
    expect(p.counts.rtc).toBe(0);
    expect(p.a.route("2")).toBe("relay");
    p.rtc.state = "open";
    p.run(600); // the first data channel packets arrive; the relay stops once the last "don't hear you" flags expire
    p.reset();
    p.run(1000);
    expect(p.counts.relay).toBe(0);
    expect(p.got["1"]).toBe(60);
    expect(p.got["2"]).toBe(60);
    expect(p.a.route("2")).toBe("webrtc");
    expect(p.routes["1"]).toEqual(["relay", "webrtc"]);
  });

  it("goes back through the relay when an open data channel goes quiet in both directions", () => {
    const p = pair();
    p.run(200);
    p.rtc.dead.add("1").add("2");
    p.reset();
    p.run(1000);
    // Within staleMs (250 ms) + a tick, both sides send through the relay again: at most ~16 packets lost each way.
    expect(p.got["1"]).toBeGreaterThanOrEqual(60 - 17);
    expect(p.got["2"]).toBeGreaterThanOrEqual(60 - 17);
    expect(p.a.route("2")).toBe("relay");
    expect(p.a.rescued).toBeGreaterThan(40);
    // The channel recovers: back to WebRTC only.
    p.rtc.dead.clear();
    p.run(1000);
    p.reset();
    p.run(500);
    expect(p.counts.relay).toBe(0);
    expect(p.a.route("2")).toBe("webrtc");
  });

  it("covers a data channel dead in one direction: the side that stops hearing tells the other", () => {
    const p = pair();
    p.run(200);
    p.rtc.dead.add("1"); // 1 → 2 vanishes, 2 → 1 still works
    p.reset();
    p.run(2000);
    // 2 stops hearing 1 over WebRTC, flags its relay packets, and 1 sends through the relay too.
    expect(p.got["2"]).toBeGreaterThanOrEqual(120 - 17);
    expect(p.a.route("2")).toBe("relay");
    p.rtc.dead.clear();
    p.run(1000);
    p.reset();
    p.run(500);
    expect(p.counts.relay).toBe(0);
  });

  it("drops datagrams of another channel, and wraps channels at 128", () => {
    const p = pair({ channel: 130 });
    expect(p.a.channel).toBe(2);
    p.run(100);
    expect(p.a.foreign).toBe(0);
    const other = new PeerTransport(null, [], { channel: 3, paths: { relay: null, rtc: null } });
    expect(other.channel).toBe(3);
  });
});
