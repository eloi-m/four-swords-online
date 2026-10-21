// Prints an actor trace (actor-trace.ts): each actor's life (first and last frame seen), then a row for every frame on
// which its position or one of its recorded fields changed (positions room-local: the arena sits at world (512, 384)).
//   node tools/dolphin/src/actor-print.ts <trace.json> [--id CRTL] [--from 0] [--to 999] [--moves] [--quiet +230,+24c:f]
// A field counting steadily (the same step as the frame before) doesn't make a row, only a change of step does; --all
// prints every change. --moves also prints frames where only the position changed; --quiet leaves fields out of the
// change test.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import type { ActorFrame, ActorRecord } from "./actor-trace.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    id: { type: "string" },
    from: { type: "string", default: "0" },
    to: { type: "string" },
    moves: { type: "boolean", default: false },
    quiet: { type: "string", default: "" },
    all: { type: "boolean", default: false },
  },
});
if (!positionals[0]) {
  console.error("usage: actor-print <trace.json> [--id ID] [--from f] [--to f] [--moves] [--quiet off,…]");
  process.exit(1);
}
const trace = JSON.parse(readFileSync(positionals[0], "utf8")) as { frames: ActorFrame[] };
const from = Number(values.from), to = values.to === undefined ? Infinity : Number(values.to);
const quiet = new Set(values.quiet!.split(",").filter(Boolean).map((k) => (k.startsWith("+") ? k : `+${k}`)));
const ids = values.id ? new Set(values.id.split(",")) : null;

const lives = new Map<string, { id: string; a: number; rows: { f: number; r: ActorRecord }[] }>();
for (const fr of trace.frames) {
  if (fr.f < from || fr.f > to || !fr.actors) continue;
  for (const r of fr.actors) {
    if (ids && !ids.has(r.id)) continue;
    const key = `${r.a.toString(16)} ${r.id}`;
    const life = lives.get(key) ?? lives.set(key, { id: r.id, a: r.a, rows: [] }).get(key)!;
    // A slot reused by a new actor of the same type shows as a gap in the frames: a new life.
    const last = life.rows[life.rows.length - 1];
    if (last && fr.f - last.f > 8) {
      lives.set(`${key} @${fr.f}`, life);
      lives.set(key, { id: r.id, a: r.a, rows: [] });
    }
    lives.get(key)!.rows.push({ f: fr.f, r });
  }
}
const fmt = (v: number) => (Number.isInteger(v) ? (Math.abs(v) >= 0x10000 ? `0x${(v >>> 0).toString(16)}` : String(v)) : v.toFixed(3));
const room = (r: ActorRecord) => `(${(r.x - 512).toFixed(2)}, ${(r.y - 384).toFixed(2)}, ${r.z.toFixed(2)})`;
for (const life of [...lives.values()].sort((p, q) => p.rows[0]!.f - q.rows[0]!.f || p.a - q.a)) {
  const first = life.rows[0]!, last = life.rows[life.rows.length - 1]!;
  console.log(`${life.id} @0x${life.a.toString(16)} frames ${first.f}–${last.f} (${last.f - first.f + 1}) at ${room(first.r)}`);
  let prev: ActorRecord | null = null, prevF = -1;
  const steps: Record<string, number> = {};
  for (const { f, r } of life.rows) {
    let changed = !prev;
    for (const k of prev ? Object.keys(r.v) : []) {
      const step = r.v[k]! - prev!.v[k]!, steady = steps[k] === step;
      steps[k] = step;
      if (step !== 0 && !quiet.has(k) && (values.all || !steady)) changed = true;
    }
    const moved = !!prev && (r.x !== prev.x || r.y !== prev.y || r.z !== prev.z);
    if (changed || (values.moves && moved)) {
      const vals = Object.entries(r.v).map(([k, v]) => `${k.slice(1)}=${fmt(v)}`).join(" ");
      const gap = prevF >= 0 ? ` (+${f - prevF})` : "";
      console.log(`  ${String(f).padStart(5)}${gap.padEnd(8)} ${room(r).padEnd(28)} ${vals}`);
      prevF = f;
    }
    prev = r;
  }
}
