// Dolphin against our sim, as numbers: the actors at one moment (paired by kind, nearest first) and the Links over a
// clip (frame by frame, the first divergence). Pure; compare.ts and clip.ts feed it.

/** An actor on one side: its kind (a type ID such as HNRY; Dolphin's may be `/`-joined, the IDs that share a vtable),
 *  its position (the same px on both sides) and what it is doing, when known. */
export interface Body {
  kind: string;
  x: number;
  y: number;
  state?: string;
}

export type ActorStatus = "same" | "moved" | "missing" | "extra";

export interface ActorRow {
  kind: string;
  status: ActorStatus;
  dolphin?: Body;
  ours?: Body;
  /** ours - Dolphin, px. */
  dx?: number;
  dy?: number;
}

/** How far (px, either axis) a paired actor may stand and still count as the same. */
export const ACTOR_TOLERANCE = 4;

const kindsOf = (b: Body) => b.kind.split("/");
const sameKind = (a: Body, b: Body) => kindsOf(a).some((k) => kindsOf(b).includes(k));

/**
 * Pairs Dolphin's actors with ours of the same kind, nearest pairs first (so two of a kind pair up by position): a pair
 * within `tolerance` px on both axes is "same", further "moved"; Dolphin's left over are "missing" from ours, ours left
 * over "extra". Rows in Dolphin's order, then the extras.
 */
export function diffActors(dolphin: readonly Body[], ours: readonly Body[], tolerance = ACTOR_TOLERANCE): ActorRow[] {
  const pairs: { d: number; o: number; dist: number }[] = [];
  dolphin.forEach((a, d) => ours.forEach((b, o) => sameKind(a, b) && pairs.push({ d, o, dist: Math.hypot(b.x - a.x, b.y - a.y) })));
  pairs.sort((p, q) => p.dist - q.dist || p.d - q.d || p.o - q.o);
  const ofDolphin = new Map<number, number>(), taken = new Set<number>();
  for (const p of pairs) {
    if (ofDolphin.has(p.d) || taken.has(p.o)) continue;
    ofDolphin.set(p.d, p.o);
    taken.add(p.o);
  }
  const rows: ActorRow[] = dolphin.map((a, d) => {
    const o = ofDolphin.get(d);
    if (o === undefined) return { kind: a.kind, status: "missing", dolphin: a };
    const b = ours[o]!, dx = b.x - a.x, dy = b.y - a.y;
    const status = Math.abs(dx) <= tolerance && Math.abs(dy) <= tolerance ? "same" : "moved";
    return { kind: a.kind, status, dolphin: a, ours: b, dx, dy };
  });
  ours.forEach((b, o) => taken.has(o) || rows.push({ kind: b.kind, status: "extra", ours: b }));
  return rows;
}

const px = (v: number) => v.toFixed(1);
const at = (b?: Body) => (b ? `(${px(b.x)}, ${px(b.y)})${b.state ? ` ${b.state}` : ""}` : "-");

/** The rows as a markdown table, the differences first. */
export function actorTable(rows: readonly ActorRow[]): string {
  const order: Record<ActorStatus, number> = { moved: 0, missing: 1, extra: 2, same: 3 };
  const sorted = [...rows].sort((a, b) => order[a.status] - order[b.status]);
  const lines = ["| kind | status | Dolphin | ours | dx, dy |", "|---|---|---|---|---|"];
  for (const r of sorted) lines.push(`| ${r.kind} | ${r.status} | ${at(r.dolphin)} | ${at(r.ours)} | ${r.dx === undefined ? "" : `${px(r.dx)}, ${px(r.dy!)}`} |`);
  return lines.join("\n");
}

export const countStatus = (rows: readonly ActorRow[]): Record<ActorStatus, number> => {
  const n: Record<ActorStatus, number> = { same: 0, moved: 0, missing: 0, extra: 0 };
  for (const r of rows) n[r.status]++;
  return n;
};

/** A Link on one frame of a clip: position (px) and state (Dolphin's state number, our action/mode). */
export interface ClipLink {
  x: number;
  y: number;
  state: string;
}

export interface ClipDivergence {
  frame: number;
  link: number;
  dolphin: ClipLink;
  ours: ClipLink;
  /** The larger axis difference, px. */
  off: number;
}

/** How far (px, either axis) the Links of a clip may drift apart before it counts as diverged. */
export const CLIP_TOLERANCE = 1;

/** Per frame, the largest gap between a Link's two positions; and the first frame where one exceeds `tolerance`. */
export function clipDiff(dolphin: readonly (readonly ClipLink[])[], ours: readonly (readonly ClipLink[])[], tolerance = CLIP_TOLERANCE): { worst: number[]; first: ClipDivergence | null } {
  const frames = Math.min(dolphin.length, ours.length);
  const worst: number[] = [];
  let first: ClipDivergence | null = null;
  for (let f = 0; f < frames; f++) {
    let w = 0;
    dolphin[f]!.forEach((d, i) => {
      const o = ours[f]![i];
      if (!o) return;
      const off = Math.max(Math.abs(o.x - d.x), Math.abs(o.y - d.y));
      w = Math.max(w, off);
      if (!first && off > tolerance) first = { frame: f, link: i, dolphin: d, ours: o, off };
    });
    worst.push(w);
  }
  return { worst, first };
}
