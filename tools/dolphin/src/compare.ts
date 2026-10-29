// Dolphin against our sim at a place (a state with its recipe, place.ts, or a battle round-start state
// ref/save-battle-<arena>-<n>p.sav): both left idle, and at each moment asked the live actors paired up (diff.ts: same,
// moved, missing from ours, extra in ours; ±4 px), and the two frames side by side at the same size.
//   node tools/dolphin/src/compare.ts <state.sav> [--name <name>] [--at 0,2,5 (s)] [--no-frames] [--seed n]
//        [--user <dolphin user dir>] [--port <gdb port> (2490)] [--web-port <dev server port> (5560)]
// Ours: an adventure room entered at the leader's spot (#room), each Link put where Dolphin's stands; a battle round
// on the state's arena with the Links at Dolphin's starts, control coming on the same frame. Our frames come from the
// app's dev server, which compare.ts starts (replaying out/dolphin-compare/captures). Output in
// out/dolphin-compare/<name>/: report.md, diff.json, dolphin-t<s>.png, ours-t<s>.png, side-t<s>.png.
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";
import { hashState, type BattleRecord, type AdventureRecord } from "@fso/sim";
import { actorTable, countStatus, diffActors, type ActorRow } from "./diff.ts";
import { actorVtables, readLive, readMem1 } from "./live.ts";
import { describePlace, EXTRACTED, knownPlace, readRecipe, RUNS, runTrace, userDirFor } from "./place.ts";
import { battleStateName, type Place } from "./recipe.ts";
import { COMPARE_CAPTURES, shoot, sideBySide, startDevServer, writeRecord } from "./shots.ts";
import { adventureSim, BATTLE_RULES, battleSim, dolphinBodies, loadAdventureStage, type Sim } from "./sim.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    name: { type: "string" },
    at: { type: "string", default: "0,2,5" },
    "no-frames": { type: "boolean", default: false },
    seed: { type: "string", default: "1" },
    user: { type: "string" },
    port: { type: "string", default: "2490" },
    "web-port": { type: "string", default: "5560" },
  },
});
const state = positionals[0];
if (!state || !existsSync(state)) {
  console.error("usage: compare <state.sav> [--name n] [--at 0,2,5] [--no-frames] (see the header)");
  process.exit(1);
}
const name = values.name ?? basename(state, ".sav").replace(/^save-/, "");
const out = join(RUNS, name);
mkdirSync(out, { recursive: true });
const seconds = values.at!.split(",").map(Number);
const ticks = seconds.map((s) => Math.round(s * 60));
const last = Math.max(...ticks);
const place: Place = await knownPlace(state);
const recipe = existsSync(`${state}.json`) ? readRecipe(state).recipe : null;
const ports = recipe?.ports ?? (battleStateName(state) ? ["gba", "gba", "gba", "gba"] : ["gc"]);
const user = userDirFor({ ports } as never, values.user);
console.log(`${state}: ${describePlace(place)}`);

// Dolphin, idle from the state: RAM at each moment, the frames dumped.
const frameDir = join(user, "Dump", "Frames");
if (existsSync(frameDir)) for (const f of readdirSync(frameDir)) rmSync(join(frameDir, f));
const dumps = ticks.flatMap((t) => ["--dump", `${t}:80000000:1800000`]);
const tracePath = join(out, "dolphin.json");
const trace = runTrace(["--savestate", state, "--ports", ports.join(","), "--script", `${last + 1} idle`, "--link", "3b4:4", "--dump-frames", ...dumps], tracePath, { user, port: values.port! });

// Ours, idle as long.
let sim: Sim, record: AdventureRecord | BattleRecord;
const vtables = actorVtables(EXTRACTED);
const startLive = readLive(readMem1(`${tracePath}.f${ticks[0]}.80000000.bin`, EXTRACTED), vtables);
let roomCell: { cx: number; cy: number } | undefined;
if (place.arena) {
  const b = battleSim(EXTRACTED, place, { seed: Number(values.seed), live: startLive.links });
  sim = b;
  record = { kind: "battle", room: place.room, players: b.start.spawns.length, rules: BATTLE_RULES, seed: Number(values.seed), cpus: [], start: b.start, inputs: [], checkpoints: [], tick: 0, hash: 0 };
} else {
  const stage = loadAdventureStage(EXTRACTED, place.stage);
  const a = adventureSim(stage, place, startLive.actors);
  sim = a;
  roomCell = a.cell;
  const leader = a.game.players[0]!;
  record = { kind: "adventure", stage: place.stage, room: place.room, x: Math.round(leader.x / 256), y: Math.round(leader.y / 256), players: place.links.length, inputs: [], checkpoints: [], tick: 0, hash: 0 };
}
const idle = sim.game.players.map(() => 0);
const moments: { s: number; tick: number; rows: ActorRow[]; zoom: number | null; dolphinFrame: string | null }[] = [];
for (let t = 0, k = 0; t <= last; t++) {
  if (t > 0) sim.step(idle);
  if (ticks[k] !== t) continue;
  const live = readLive(readMem1(`${tracePath}.f${t}.80000000.bin`, EXTRACTED), vtables);
  const rows = diffActors(dolphinBodies(place, live.actors, roomCell), sim.bodies());
  // frameDumps[f]: the images Dolphin had dumped by frame f, framedump_1.png the first (the game skips presenting
  // some frames while it loads).
  const n = trace.frameDumps[t];
  const dumped = n !== undefined ? join(frameDir, `framedump_${Math.max(1, n)}.png`) : null;
  let dolphinFrame: string | null = null;
  if (dumped && existsSync(dumped)) copyFileSync(dumped, (dolphinFrame = join(out, `dolphin-t${seconds[k]}.png`)));
  moments.push({ s: seconds[k]!, tick: t, rows, zoom: live.camera?.zoom ?? null, dolphinFrame });
  k++;
}

// Our frames: the same start replayed by the app's dev server, idle to each moment.
let framesNote = "";
if (!values["no-frames"]) {
  const id = `compare-${name}`;
  writeRecord(id, { ...record, inputs: [[idle, last + 1]], tick: last + 1, hash: hashState(sim.game) } as typeof record);
  const server = await startDevServer(place.arena ? "battle" : "game", Number(values["web-port"]));
  try {
    const files = moments.map((m) => join(out, `ours-t${m.s}.png`));
    await shoot(server.url, id, moments.map((m) => m.tick), files);
    for (const [i, m] of moments.entries()) if (m.dolphinFrame) sideBySide(m.dolphinFrame, files[i]!, join(out, `side-t${m.s}.png`));
  } catch (e) {
    framesNote = `our frames failed: ${(e as Error).message}`;
    console.warn(framesNote);
  } finally {
    server.stop();
  }
  framesNote ||= `side-t<s>.png: Dolphin left (its camera), ours right (our camera), both at 640 x 480; our capture ${COMPARE_CAPTURES}/${id}.`;
}

const lines = [`# ${name}: Dolphin against ours`, "", `${state}: ${describePlace(place)}.`, ""];
if (!place.arena) lines.push("Ours: the room entered at the leader's spot, the Links put on Dolphin's; actors the sim keeps no object for are shown where they are placed (`placed`).", "");
for (const m of moments) {
  const n = countStatus(m.rows);
  lines.push(`## t = ${m.s} s (frame ${m.tick})`, "", `same ${n.same}, moved ${n.moved}, missing from ours ${n.missing}, extra in ours ${n.extra}; Dolphin's camera zoom ${m.zoom?.toFixed(4) ?? "-"}`, "", actorTable(m.rows), "");
}
if (framesNote) lines.push(framesNote, "");
writeFileSync(join(out, "report.md"), lines.join("\n"));
writeFileSync(join(out, "diff.json"), JSON.stringify({ state, place, moments }, null, 1));
for (const m of moments) {
  const n = countStatus(m.rows);
  console.log(`t ${m.s} s: same ${n.same}, moved ${n.moved}, missing ${n.missing}, extra ${n.extra}`);
  for (const r of m.rows.filter((r) => r.status === "moved")) console.log(`  moved ${r.kind} Dolphin (${r.dolphin!.x.toFixed(1)}, ${r.dolphin!.y.toFixed(1)}) ours (${r.ours!.x.toFixed(1)}, ${r.ours!.y.toFixed(1)})`);
}
// The MEM1 dumps are 24 MiB each: the diff keeps what they told.
for (const t of ticks) rmSync(`${tracePath}.f${t}.80000000.bin`, { force: true });
console.log(`-> ${join(out, "report.md")}`);
