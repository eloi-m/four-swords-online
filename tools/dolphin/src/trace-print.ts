// Prints a trace as a table: per frame the pad, one Link's room-local position, deltas, sprite frame, walk tick,
// state and the camera; battle traces (GBA ports) show that player's GBA keys instead of the pad, and his life,
// invincibility and hop height.   node tools/dolphin/src/trace-print.ts out/trace.json [player] [from] [to]
import { readFileSync } from "node:fs";
import type { FrameSnapshot } from "./fsa.ts";

const [file, playerS = "0", fromS = "0", toS] = process.argv.slice(2);
if (!file) {
  console.error("usage: trace-print <trace.json> [player] [from] [to]");
  process.exit(1);
}
const trace = JSON.parse(readFileSync(file, "utf8")) as { frames: (FrameSnapshot & { f: number; input: string })[] };
const player = Number(playerS);
const rows = trace.frames.slice(Number(fromS), toS === undefined ? undefined : Number(toS) + 1);
const battle = rows.some((r) => r.gba);
const fx = (v: number, w = 9, d = 3) => v.toFixed(d).padStart(w);
console.log(
  `   f input          ${battle ? "gba keys" : "pad(x,y)"}  room-x    room-y      dx      dy  frm prv tick st nx pv    cam-x    cam-y` +
    (battle ? " life inv      z" : ""),
);
let prev = trace.frames[Math.max(0, Number(fromS) - 1)]!.links[player]!;
for (const r of rows) {
  const l = r.links[player];
  if (!l) continue;
  const rx = l.x - Math.floor(l.x / 512) * 512, ry = l.y - Math.floor(l.y / 384) * 384;
  const input = battle ? (r.gba?.[player] ?? 0).toString(16).padStart(3, "0") : `${r.pad.x},${r.pad.y}`;
  console.log(
    `${String(r.f).padStart(4)} ${r.input.slice(0, 14).padEnd(14)} ${input.padStart(8)} ${fx(rx)} ${fx(ry)} ` +
      `${fx(l.x - prev.x, 7)} ${fx(l.y - prev.y, 7)} ${String(l.frame).padStart(4)} ${String(l.prevFrame).padStart(3)} ` +
      `${String(l.animTick).padStart(4)} ${String(l.state).padStart(2)} ${String(l.nextState).padStart(2)} ${String(l.prevState).padStart(2)} ` +
      `${fx(r.camera.x, 8, 2)} ${fx(r.camera.y, 8, 2)}` +
      (battle ? ` ${String(l.life).padStart(4)} ${String(l.invincible).padStart(3)} ${fx(l.z, 6, 2)}` : ""),
  );
  prev = l;
}
