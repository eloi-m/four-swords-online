// Named places in Dolphin: savestates kept with their recipe (recipe.ts, `<state>.sav.json`), so a state can be made
// again from its parent and checked to land where it says.
//   node tools/dolphin/src/place.ts save <state.sav> --from <parent.sav|boot> --script "<script>" [--at <frame>]
//        [--tele f:x:y] [--write f:addr:bytes] [--fill …] [--patch …] [--room n] [--area n] [--stage boss010]
//        [--arena field --players 2] [--note "…"]
//     plays the script from the parent (with the pokes), saves the state at --at (default: 10 frames after the
//     script) and writes its recipe with its place (room/area or arena, the Links): room from the leader's cell on
//     the TV; on a GBA screen --room, else the parent's.
//   node tools/dolphin/src/place.ts build <state.sav> [--parents]   makes the state again from its recipe
//     (--parents: missing parents first, from theirs), then checks it
//   node tools/dolphin/src/place.ts check <state.sav>    replays the recipe from its parent without saving, and
//     compares the Links on its frame with the place it says (or, for an older state with no place, with the state
//     itself read offline); exit 1 when they differ
//   node tools/dolphin/src/place.ts show <state.sav> [--all]   the recipe, what keeps it from replaying, and the
//     state read offline (live.ts)
// Options: --user <dolphin user dir> (ref/dolphin-user-compare with GBA ports, else ref/dolphin-user-compare-adventure),
// --port <gdb port> (2490). Runs go to out/dolphin-compare/places/.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { FrameSnapshot } from "./fsa.ts";
import { actorVtables, readLive, readMem1, type LiveLink } from "./live.ts";
import { battleStateName, cellAt, landingErrors, parseRecipe, scriptFrames, traceArgs, type Place, type Recipe } from "./recipe.ts";
import { parsePorts } from "./script.ts";

export const EXTRACTED = "extracted";
export const TRACE = join(import.meta.dirname, "trace.ts");
export const RUNS = "out/dolphin-compare";
/** Frames past the script a state is saved on by default (the movie must be over). */
const SAVE_AFTER = 10;

export const userDirFor = (recipe: Pick<Recipe, "ports">, user?: string): string =>
  user ?? (recipe.ports.includes("gba") ? "ref/dolphin-user-compare" : "ref/dolphin-user-compare-adventure");

export function readRecipe(state: string): { recipe: Recipe; problems: string[] } {
  const file = `${state}.json`;
  if (!existsSync(file)) throw new Error(`${state} has no recipe (${file})`);
  return parseRecipe(JSON.parse(readFileSync(file, "utf8")));
}

type Snapshot = FrameSnapshot & { f: number; input: string };

/** Runs trace.ts (a child process: one Dolphin at a time on a GDB port) and returns its output. */
export function runTrace(args: string[], out: string, opts: { user: string; port: string }): { frames: Snapshot[]; frameDumps: number[] } {
  mkdirSync(join(out, ".."), { recursive: true });
  execFileSync("node", [TRACE, ...args, "--user", opts.user, "--port", opts.port, "--out", out], { stdio: ["ignore", "inherit", "inherit"] });
  return JSON.parse(readFileSync(out, "utf8"));
}

/** A recorded Link with his screen (recorded by `--link 3b4:4`). */
export const withScreen = (l: Snapshot["links"][number]) => ({ x: l.x, y: l.y, screen: l.raw?.["3b4"] ? parseInt(l.raw["3b4"], 16) : 0 });

/** The rooms of an adventure stage by world cell. */
async function roomAtCell(stage: string, cx: number, cy: number): Promise<number | undefined> {
  const { loadStage } = await import("../../playtest/src/stage.ts");
  const s = loadStage(stage).stage;
  return s.rooms.find((r) => {
    const c = s.cellOf(r);
    return c?.cx === cx && c.cy === cy;
  });
}

/** A state's place from the state itself: the Links read offline, the room from the leader's cell or the hints. */
async function placeOf(state: string, hints: { stage?: string; room?: number; area?: number; arena?: string; players?: number }, parent?: Place): Promise<Place> {
  const live = readLive(readMem1(state, EXTRACTED), actorVtables(EXTRACTED));
  const r = (v: number) => Math.round(v * 1000) / 1000;
  const links = live.links.map((l) => ({ x: r(l.x), y: r(l.y), screen: l.screen }));
  const leader = live.links[0];
  if (!leader) throw new Error(`${state}: no Links in RAM (a menu?)`);
  const battle = hints.arena ? { arena: hints.arena, players: hints.players ?? parent?.players ?? 2 } : parent?.arena ? { arena: parent.arena, players: parent.players } : null;
  if (battle) return { stage: "boss500", room: battleStateName(`save-battle-${battle.arena}-${battle.players}p.sav`)?.room ?? 0, area: 0, ...battle, links };
  // The stage the game loaded (live.ts: Tingle's Tower loads through the Cave's slot, so a slot number won't do).
  const stage = hints.stage ?? live.stage ?? parent?.stage;
  if (!stage) throw new Error(`${state}: the stage loaded isn't readable from RAM; say which with --stage`);
  const area = hints.area ?? (leader.screen >= 8 ? leader.screen - 7 : 0);
  let room = hints.room;
  const cell = cellAt(leader.x, leader.y);
  if (room === undefined && area === 0) {
    room = await roomAtCell(stage, cell.cx, cell.cy);
    if (room === undefined) throw new Error(`${state}: ${stage} has no room at the leader's cell (${cell.cx}, ${cell.cy}); say which with --room (or --stage)`);
  }
  room ??= parent?.room;
  if (room === undefined) throw new Error(`${state}: on a GBA screen (area ${area}); say which room with --room`);
  return { stage, room, area, links };
}

/** The place a round-start state (ref/save-battle-<arena>-<n>p.sav) or any recipe'd state says it is. */
export async function knownPlace(state: string): Promise<Place> {
  const recipe = existsSync(`${state}.json`) ? readRecipe(state).recipe : null;
  if (recipe?.place) return recipe.place;
  const round = battleStateName(state);
  return placeOf(state, round ? { arena: round.arena, players: round.players } : {});
}

async function save(state: string, recipe: Recipe, hints: Parameters<typeof placeOf>[1], opts: { user: string; port: string }): Promise<void> {
  const parentRecipe = recipe.from !== "boot" && existsSync(`${recipe.from}.json`) ? readRecipe(recipe.from).recipe : null;
  const parentPlace = parentRecipe?.place ?? (battleStateName(recipe.from) ? await knownPlace(recipe.from) : undefined);
  mkdirSync(join(state, ".."), { recursive: true });
  runTrace(traceArgs(recipe, { save: state }), join(RUNS, "places", `${basename(state, ".sav")}.save.json`), opts);
  // trace.ts wrote the recipe as it played it; the place and the note go with it.
  const written = JSON.parse(readFileSync(`${state}.json`, "utf8")) as Record<string, unknown>;
  const place = await placeOf(state, hints, parentPlace);
  writeFileSync(`${state}.json`, JSON.stringify({ ...written, ...(recipe.note ? { note: recipe.note } : {}), place }, null, 2) + "\n");
  console.log(`${state}: ${describePlace(place)}`);
}

export function describePlace(p: Place): string {
  const where = p.arena ? `${p.arena} ${p.players}p (boss500 room ${p.room})` : `${p.stage} room ${p.room}${p.area ? ` area ${p.area}` : ""}`;
  return `${where}; Links ${p.links.map((l) => `(${l.x.toFixed(1)}, ${l.y.toFixed(1)})${l.screen ? ` s${l.screen}` : ""}`).join(" ")}`;
}

/** Replays a recipe without saving and compares the Links on its frame with its place; the errors (empty: it lands). */
async function check(state: string, opts: { user: string; port: string }): Promise<string[]> {
  const { recipe, problems } = readRecipe(state);
  if (problems.length) return problems.map((p) => `can't replay: ${p}`);
  if (recipe.from !== "boot" && !existsSync(recipe.from)) return [`its parent ${recipe.from} is missing (build --parents)`];
  const want: Pick<Place, "links"> = recipe.place ?? { links: readLive(readMem1(state, EXTRACTED), actorVtables(EXTRACTED)).links };
  const trace = runTrace(traceArgs(recipe, { extra: ["--link", "3b4:4", "--from", String(recipe.frame)] }), join(RUNS, "places", `${basename(state, ".sav")}.check.json`), opts);
  const last = trace.frames.find((f) => f.f === recipe.frame);
  if (!last) return [`the replay never reached frame ${recipe.frame}`];
  return landingErrors(want, last.links.map(withScreen));
}

async function build(state: string, parents: boolean, opts: { user?: string; port: string }): Promise<void> {
  const { recipe, problems } = readRecipe(state);
  if (problems.length) throw new Error(`${state} can't be rebuilt: ${problems.join("; ")}`);
  if (recipe.from !== "boot" && !existsSync(recipe.from)) {
    if (!parents || !existsSync(`${recipe.from}.json`)) throw new Error(`its parent ${recipe.from} is missing${parents ? " and has no recipe" : " (--parents builds it)"}`);
    await build(recipe.from, parents, opts);
  }
  const hints = recipe.place ? { stage: recipe.place.stage, room: recipe.place.room, area: recipe.place.area, arena: recipe.place.arena, players: recipe.place.players } : {};
  const before = recipe.place;
  await save(state, recipe, hints, { user: userDirFor(recipe, opts.user), port: opts.port });
  const after = readRecipe(state).recipe.place!;
  const errors = before ? landingErrors(before, after.links) : [];
  console.log(errors.length ? `${state}: rebuilt, but not where its recipe said:\n  ${errors.join("\n  ")}` : `${state}: rebuilt where its recipe says`);
  if (errors.length) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      from: { type: "string" },
      script: { type: "string" },
      at: { type: "string" },
      tele: { type: "string", multiple: true, default: [] },
      write: { type: "string", multiple: true, default: [] },
      fill: { type: "string", multiple: true, default: [] },
      patch: { type: "string", multiple: true, default: [] },
      ports: { type: "string" },
      room: { type: "string" },
      area: { type: "string" },
      stage: { type: "string" },
      arena: { type: "string" },
      players: { type: "string" },
      note: { type: "string" },
      user: { type: "string" },
      port: { type: "string", default: "2490" },
      parents: { type: "boolean", default: false },
      all: { type: "boolean", default: false },
    },
  });
  const [command, stateArg] = positionals;
  if (!command || !stateArg || !["save", "build", "check", "show"].includes(command)) {
    console.error("usage: place save|build|check|show <state.sav> [options] (see the header)");
    process.exit(1);
  }
  const state = relative(process.cwd(), resolve(stateArg));
  const num = (v?: string) => (v === undefined ? undefined : Number(v));
  if (command === "save") {
    if (!values.from || !values.script) throw new Error("save needs --from and --script");
    const script = values.script.startsWith("@") ? readFileSync(values.script.slice(1), "utf8").trim() : values.script;
    const parent = values.from === "boot" ? null : existsSync(`${values.from}.json`) ? readRecipe(values.from).recipe : null;
    const ports = values.ports ? parsePorts(values.ports) : (parent?.ports ?? ["gc"]);
    const recipe: Recipe = {
      from: values.from, script, frame: num(values.at) ?? scriptFrames(script) + SAVE_AFTER, ports,
      tele: values.tele!, write: values.write!, fill: values.fill!, patch: values.patch!, ...(values.note ? { note: values.note } : {}),
    };
    const hints = { stage: values.stage, room: num(values.room), area: num(values.area), arena: values.arena, players: num(values.players) };
    await save(state, recipe, hints, { user: userDirFor(recipe, values.user), port: values.port! });
  } else if (command === "build") {
    await build(state, values.parents!, { user: values.user, port: values.port! });
  } else if (command === "check") {
    const { recipe } = readRecipe(state);
    const errors = await check(state, { user: userDirFor(recipe, values.user), port: values.port! });
    console.log(errors.length ? `${state}: does not land where it says:\n  ${errors.join("\n  ")}` : `${state}: lands where it says${recipe.place ? ` (${describePlace(recipe.place)})` : " (the state itself; no place recorded)"}`);
    if (errors.length) process.exitCode = 1;
  } else {
    const { recipe, problems } = readRecipe(state);
    console.log(JSON.stringify(recipe, null, 2));
    if (problems.length) console.log(`can't replay as written:\n  ${problems.join("\n  ")}`);
    const live = readLive(readMem1(state, EXTRACTED), actorVtables(EXTRACTED), values.all);
    const fmt = (l: LiveLink) => `(${l.x.toFixed(1)}, ${l.y.toFixed(1)}) s${l.screen} state ${l.state}`;
    console.log(`Links ${live.links.map(fmt).join(" ")}; camera ${live.camera ? `zoom ${live.camera.zoom.toFixed(4)}` : "-"}`);
    for (const a of live.actors) console.log(`  ${a.id.padEnd(5)} s${a.screen} (${a.x.toFixed(1)}, ${a.y.toFixed(1)})`);
  }
}
