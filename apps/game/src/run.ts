// World 1 as one run: Lake Hylia -> the Cave of No Return -> Tingle's Tower -> Hyrule Castle, then an end screen. A
// stage cleared waits CLEAR_SHOW_TICKS, then the page loads the next one (#stage=, the other deep links kept, so
// `#route` plays the whole world); the Force Gems per stage ride in sessionStorage across those loads, and so does
// what the cleared stage hands on (the Links' hearts and the leader's item: carryOf). A stage reached any other way
// (the stage list, a deep link, #run=off) starts fresh.
import type { AdventureCarry } from "@fso/sim/adventure";

/** World 1's stages in play order. */
export const WORLD_1: readonly string[] = ["boss010", "boss011", "boss012", "boss013"];
/** A cleared stage's banner is shown this long (60 Hz ticks) before the next stage loads. */
export const CLEAR_SHOW_TICKS = 300;
const KEY = "fso-run";
const CARRY_KEY = "fso-run-carry";

/** The stage after `id` in World 1, "end" after the last one, or null when `id` isn't part of the run. */
export function nextStage(id: string): string | null {
  const i = WORLD_1.indexOf(id);
  return i < 0 ? null : (WORLD_1[i + 1] ?? "end");
}

/** `hash` (without the #) moved to stage `id`: the room/spawn of the old stage dropped, the other parameters kept. */
export function hashFor(hash: string, id: string): string {
  const p = new URLSearchParams(hash);
  for (const k of ["room", "x", "y"]) p.delete(k);
  p.set("stage", id);
  return p.toString().replace(/=(?=&|$)/g, "");
}

/** The Force Gems collected per cleared stage id. */
export type RunGems = Record<string, number>;

export function loadRun(storage: Pick<Storage, "getItem"> | undefined): RunGems {
  try {
    const v = JSON.parse(storage?.getItem(KEY) ?? "{}") as unknown;
    return v && typeof v === "object" ? (v as RunGems) : {};
  } catch {
    return {};
  }
}

export function saveRun(storage: Pick<Storage, "setItem"> | undefined, run: RunGems): void {
  try {
    storage?.setItem(KEY, JSON.stringify(run));
  } catch {
    // no storage (private window): the end screen just lacks the totals
  }
}

/** The end screen's rows: each World 1 stage's name and gems ("-" when it wasn't played in this run), and the total. */
export function summary(run: RunGems, names: (id: string) => string): { rows: { id: string; name: string; gems: string }[]; total: number } {
  const rows = WORLD_1.map((id) => ({ id, name: names(id), gems: run[id] === undefined ? "-" : String(run[id]) }));
  return { rows, total: WORLD_1.reduce((n, id) => n + (run[id] ?? 0), 0) };
}

/** What a cleared stage hands on: the stage it went to, and the state it ends with (carryOf). */
export interface RunCarry {
  stage: string;
  carry: AdventureCarry;
}

function loadCarry(storage: Pick<Storage, "getItem"> | undefined): RunCarry | null {
  try {
    const v = JSON.parse(storage?.getItem(CARRY_KEY) ?? "null") as RunCarry | null;
    const c = v?.carry;
    return v && typeof v.stage === "string" && c && Array.isArray(c.hearts) && c.hearts.every((h) => Number.isFinite(h)) && Number.isFinite(c.maxHearts) && typeof c.gear === "string" ? v : null;
  } catch {
    return null;
  }
}

/** Keeps the carry for the next stage, or drops it (null: the end of the run). */
export function saveCarry(storage: Pick<Storage, "setItem" | "removeItem"> | undefined, value: RunCarry | null): void {
  try {
    if (value) storage?.setItem(CARRY_KEY, JSON.stringify(value));
    else storage?.removeItem(CARRY_KEY);
  } catch {
    // no storage (private window): the next stage starts fresh
  }
}

/**
 * The carry `stage` starts with: what the last clear handed on, when `stage` is the stage it went to (a reload of it
 * keeps it). Any other stage, or a load outside the run (`chained` false: #run=off, a capture's replay), starts fresh
 * and drops the carry.
 */
export function carryFor(storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined, stage: string, chained: boolean): AdventureCarry | null {
  const record = loadCarry(storage);
  if (!record) return null;
  if (chained && record.stage === stage) return record.carry;
  saveCarry(storage, null);
  return null;
}
