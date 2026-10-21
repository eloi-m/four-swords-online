// The netplay stats overlay's text (toggled with `): frames, rollbacks, stalls, and per peer the route, round trip
// and frame advantage; desyncs stay listed at the bottom. Pure formatting over a NetMatch.
import type { NetMatch, Route, SessionEvent } from "@fso/net";

export interface StatsContext<S> {
  net: NetMatch<S>;
  code: string;
  /** Display names by player index. */
  names: readonly string[];
  routes: ReadonlyMap<string, Route>;
  /** Player index of a remote peer id, -1 for none. */
  playerOf: (peer: string) => number;
  /** A spectator's feeding peer (player 0). */
  feed?: string;
  desyncs: readonly Extract<SessionEvent, { type: "desync" }>[];
}

export class NetStats {
  private last = { at: 0, sent: 0, received: 0 };
  private rate = { sent: 0, received: 0 };

  text<S>(ctx: StatsContext<S>, now: number): string {
    const { net } = ctx;
    const lines: string[] = [];
    const me = net.localPlayer >= 0 ? `P${net.localPlayer + 1} ${ctx.names[net.localPlayer] ?? ""}` : "spectating";
    lines.push(`room ${ctx.code} · match ${net.match} · ${me} · \` hides`);
    const s = net.session;
    if (s) {
      const k = s.stats;
      if (now - this.last.at >= 1000) {
        const dt = (now - this.last.at) / 1000;
        if (this.last.at > 0) this.rate = { sent: (k.bytesSent - this.last.sent) / dt, received: (k.bytesReceived - this.last.received) / dt };
        this.last = { at: now, sent: k.bytesSent, received: k.bytesReceived };
      }
      lines.push(`frame ${s.frame} · final ${s.finalizedFrame} · settled ${s.settledFrame} · delay ${s.inputDelay}`);
      lines.push(`rollbacks ${k.rollbacks} (avg ${(k.rollbackFrames / Math.max(1, k.rollbacks)).toFixed(1)}, max ${k.maxRollback}) · stalls ${k.predictionStalls}+${k.syncStalls}${s.stalled ? ` (${s.stalled})` : ""}`);
      lines.push(`hash checks ${k.hashChecks} · desyncs ${k.desyncs} · ${kb(this.rate.sent)} out, ${kb(this.rate.received)} in`);
      for (const p of s.peerInfo()) {
        const who = p.player >= 0 ? `P${p.player + 1} ${ctx.names[p.player] ?? ""}` : `spectator #${p.id}`;
        const rtt = Number.isNaN(p.rtt) ? "–" : `${Math.round(p.rtt)} ms`;
        const ahead = p.player >= 0 ? ` · ${p.advantage >= 0 ? "+" : ""}${p.advantage.toFixed(1)} f` : "";
        lines.push(`${who}: ${ctx.routes.get(p.id) ?? net.transport.route(p.id)} ${rtt}${ahead} · ${p.status}`);
      }
    } else if (net.spectator) {
      const sp = net.spectator;
      lines.push(`frame ${sp.frame} · backlog ${sp.backlog}${sp.disconnected ? " · feed lost" : ""}`);
      if (ctx.feed) lines.push(`fed by P1 ${ctx.names[0] ?? ""}: ${ctx.routes.get(ctx.feed) ?? net.transport.route(ctx.feed)}`);
    }
    if (net.lossy) {
      const i = net.lossy.impairment;
      lines.push(`impaired: +${i.latency}±${i.jitter} ms, ${Math.round(i.loss * 100)}% loss (${net.lossy.dropped} dropped)`);
    }
    // The first mismatch per peer is the one that matters (the states differ from then on).
    const first = new Map<string, (typeof ctx.desyncs)[number]>();
    for (const d of ctx.desyncs) if (!first.has(d.peer)) first.set(d.peer, d);
    for (const d of first.values()) {
      const p = ctx.playerOf(d.peer), later = ctx.desyncs.filter((x) => x.peer === d.peer).length - 1;
      lines.push(`DESYNC with ${p >= 0 ? `P${p + 1}` : d.peer} at frame ${d.frame}: ${hex(d.local)} vs ${hex(d.remote)}${later ? ` (+${later} later checks)` : ""}`);
    }
    return lines.join("\n");
  }
}

const kb = (bytesPerSecond: number) => `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
const hex = (v: number) => (v >>> 0).toString(16).padStart(8, "0");
