// Recipes: how a savestate was made, so it can be rebuilt and checked. A recipe sits next to its state as
// `<state>.sav.json` (trace.ts --save writes it): the parent state (or power-on), the input script, the RAM pokes
// (--tele, --write, --fill, --patch) and the frame it was saved on, plus where it says it lands (`place`, place.ts):
// the stage and room/area or the battle arena, and the Links' positions.
// States made before recipes kept their pokes as free text (or not at all): parseRecipe says what it can't replay.
import type { PortDevice } from "./dtm.ts";
import { parseScript } from "./script.ts";

/** Where a state stands: an adventure stage's room (area 0 = the TV, else a GBA area) or a battle arena. */
export interface Place {
  /** Adventure: the stage archive (boss010); battle: "boss500". */
  stage: string;
  room: number;
  area: number;
  /** Battle: the arena's name in the round-start states (field … clouds, dark-field … dark-clouds) and the players. */
  arena?: string;
  players?: number;
  /** The Links in port order, world px (as RAM holds them; an area's own px on a GBA screen), with their screen. */
  links: { x: number; y: number; screen: number }[];
}

export interface Recipe {
  /** The parent savestate (a path from the repo root), or "boot" for power-on. */
  from: string;
  script: string;
  /** The frame the state was saved on (frame 0 = the parent state). */
  frame: number;
  ports: PortDevice[];
  tele: string[];
  write: string[];
  fill: string[];
  patch: string[];
  place?: Place;
  note?: string;
}

const POKES = ["tele", "write", "fill", "patch"] as const;
/** Each poke's shape, as trace.ts takes it. */
const POKE_SHAPE: Readonly<Record<(typeof POKES)[number], RegExp>> = {
  tele: /^\d+:-?[\d.]+:-?[\d.]+$/,
  write: /^\d+:[0-9a-f]+:([0-9a-f]{2})+$/i,
  fill: /^\d+:[0-9a-f]+:[0-9a-f]+:[0-9a-f]{1,2}$/i,
  patch: /^[0-9a-f]+:r\d+:([0-9a-f]{2})+$/i,
};

/**
 * A recipe from a state's JSON. `problems` lists what keeps it from replaying as written: pokes noted as free text (a
 * trailing "(…)" comment is dropped and fine), a missing script or frame. A recipe with problems still parses, so a
 * state can be shown; place.ts refuses to rebuild or check it.
 */
export function parseRecipe(json: unknown): { recipe: Recipe; problems: string[] } {
  const o = (json ?? {}) as Record<string, unknown>;
  const problems: string[] = [];
  const from = typeof o.from === "string" ? o.from : "";
  if (!from) problems.push("no parent state (from)");
  const script = typeof o.script === "string" ? o.script.trim() : "";
  if (!script) problems.push("no script");
  else {
    try {
      parseScript(script);
    } catch (e) {
      problems.push(`script: ${(e as Error).message}`);
    }
  }
  const frame = typeof o.frame === "number" ? o.frame : NaN;
  if (!Number.isInteger(frame) || frame < 0) problems.push("no frame");
  const ports = Array.isArray(o.ports) ? (o.ports as PortDevice[]) : ["gc" as const];
  const pokes = Object.fromEntries(POKES.map((k) => [k, [] as string[]])) as Record<(typeof POKES)[number], string[]>;
  for (const k of POKES) {
    const v = o[k];
    if (v === undefined) continue;
    if (!Array.isArray(v)) {
      problems.push(`${k} noted as text: "${String(v)}"`);
      continue;
    }
    for (const entry of v as unknown[]) {
      const s = String(entry).replace(/\s*\(.*\)\s*$/s, "").trim();
      if (POKE_SHAPE[k].test(s)) pokes[k].push(s);
      else problems.push(`${k} "${String(entry)}" is not --${k}'s form`);
    }
  }
  if (typeof o.pokes === "string") problems.push(`pokes noted as text: "${o.pokes}"`);
  const recipe: Recipe = { from, script, frame, ports, ...pokes };
  if (o.place) recipe.place = o.place as Place;
  if (typeof o.note === "string") recipe.note = o.note;
  return { recipe, problems };
}

/** Frames the script plays. */
export const scriptFrames = (script: string): number => parseScript(script).reduce((n, s) => n + s.frames, 0);

/**
 * trace.ts's arguments replaying a recipe up to its frame (recorded, frame `frame` the last), with `extra` appended;
 * `save` saves the state there too.
 */
export function traceArgs(recipe: Recipe, opts: { save?: string; extra?: string[] } = {}): string[] {
  const played = scriptFrames(recipe.script);
  if (recipe.frame < played) throw new Error(`frame ${recipe.frame} is inside the script (${played} frames): a state is saved after it`);
  const args = recipe.from === "boot" ? ["--boot"] : ["--savestate", recipe.from];
  args.push("--script", recipe.script, "--ports", recipe.ports.join(","), "--tail", String(recipe.frame - played + 1));
  for (const k of POKES) for (const p of recipe[k]) args.push(`--${k}`, p);
  if (opts.save) args.push("--save", `${recipe.frame}:${opts.save}`);
  return [...args, ...(opts.extra ?? [])];
}

/** How far (px, either axis) a replayed Link may stand from the recipe's place. */
export const LANDING_TOLERANCE = 0.5;

/** Where a replay's Links differ from the place a recipe says (empty: it lands there). */
export function landingErrors(place: Pick<Place, "links">, links: readonly { x: number; y: number; screen: number }[], tolerance = LANDING_TOLERANCE): string[] {
  const errors: string[] = [];
  if (links.length !== place.links.length) errors.push(`${links.length} Links, the recipe says ${place.links.length}`);
  place.links.forEach((want, i) => {
    const got = links[i];
    if (!got) return;
    if (got.screen !== want.screen) errors.push(`Link ${i + 1} on screen ${got.screen}, not ${want.screen}`);
    const d = Math.max(Math.abs(got.x - want.x), Math.abs(got.y - want.y));
    if (d > tolerance) errors.push(`Link ${i + 1} at (${got.x.toFixed(1)}, ${got.y.toFixed(1)}), not (${want.x.toFixed(1)}, ${want.y.toFixed(1)}): ${d.toFixed(1)} px off`);
  });
  return errors;
}

/** Room cells are 512 x 384 world px; battle arenas sit at cell (1, 1). */
export const CELL_W = 512;
export const CELL_H = 384;

/** The world cell a world position is in. */
export const cellAt = (x: number, y: number): { cx: number; cy: number } => ({ cx: Math.floor(x / CELL_W), cy: Math.floor(y / CELL_H) });

/** A Link's position in the sim's terms: room px on the TV (its cell's origin off), an area's own px on a GBA screen. */
export function localPx(link: { x: number; y: number; screen: number }, cell: { cx: number; cy: number }): { x: number; y: number } {
  return link.screen === 0 ? { x: link.x - cell.cx * CELL_W, y: link.y - cell.cy * CELL_H } : { x: link.x, y: link.y };
}

/** The arenas by boss500 room, in the area menu's order: the five, then their Dark World variants (rooms 5-9). */
export const ARENA_SLUGS = ["field", "flames", "winds", "castle", "clouds", "dark-field", "dark-flames", "dark-winds", "dark-castle", "dark-clouds"] as const;
/** The battle round states' names: ref/save-battle-<arena>-<n>p.sav. */
export const ARENA_ROOMS: Readonly<Record<string, number>> = Object.fromEntries(ARENA_SLUGS.map((slug, room) => [slug, room]));
export function battleStateName(path: string): { arena: string; room: number; players: number } | null {
  const m = /save-battle-([a-z-]+)-(\d)p\.sav$/.exec(path);
  return m && m[1]! in ARENA_ROOMS ? { arena: m[1]!, room: ARENA_ROOMS[m[1]!]!, players: Number(m[2]) } : null;
}
