import { describe, expect, it } from "vitest";
import { LossyTransport } from "./lossy.ts";
import type { PeerId, Transport } from "./types.ts";

describe("LossyTransport", () => {
  it("delays packets by latency + jitter, drops a share, and releases them in delivery order on pump()", () => {
    const sent: { at: number; id: number }[] = [];
    let now = 0;
    const inner: Transport = { send: (_peer: PeerId, data) => sent.push({ at: now, id: data[0]! }), listen: () => {} };
    const lossy = new LossyTransport(inner, { latency: 50, jitter: 30, loss: 0.25 }, () => now, 42);
    for (now = 0; now < 200; now++) {
      lossy.send("x", new Uint8Array([now])); // packet `id` is sent at time `id`
      lossy.pump();
    }
    for (; now < 300; now++) lossy.pump();
    expect(sent.length + lossy.dropped).toBe(200);
    expect(lossy.dropped).toBeGreaterThan(30);
    expect(lossy.dropped).toBeLessThan(70);
    for (const { at, id } of sent) {
      expect(at - id).toBeGreaterThanOrEqual(50);
      expect(at - id).toBeLessThanOrEqual(81); // + 1 ms of pump granularity
    }
    // Jitter larger than the send interval reorders.
    expect(sent.some((s, i) => i > 0 && s.id < sent[i - 1]!.id)).toBe(true);
  });
});
