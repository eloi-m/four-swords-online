// Rebuilds the Shadow Battle reference savestates from power-on, by chaining trace.ts runs that each start from the
// previous step's state and save the next one (docs/measurements/battle-arenas.md "Battle mode in Dolphin"). Menu steps land in
// ref/battle/<step>.sav; each round start is ref/save-battle-<arena>-<n>p.sav, saved 10 frames before the players
// get control (found by a first run holding right), with its recipe and place (recipe.ts, place.ts check). All four
// ports are integrated GBAs; P1's GBA drives the menus. The Dark World arenas come from area-dark-<n>p, a player
// count picked with the Quest Log's unlock flag poked in.
//   node tools/dolphin/src/battle-states.ts [--port 55031] [--user ref/dolphin-user-battle] [--only title,modes,…|field-2p,dark-field-2p,…]
//     [--players 2,3,4] [--arenas field,…,dark-clouds]
// A step runs when it's named by --only or its state is missing; the steps made from it then rerun too.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { BATTLE_USER, GBA_BIOS, setupBattleUser } from "./battle-user.ts";
import { knownPlace } from "./place.ts";
import { ARENA_SLUGS } from "./recipe.ts";
import { parseScript } from "./script.ts";

const { values } = parseArgs({
  options: {
    port: { type: "string", default: "55031" },
    user: { type: "string", default: BATTLE_USER },
    only: { type: "string", default: "" },
    players: { type: "string", default: "2,3,4" },
    arenas: { type: "string", default: ARENA_SLUGS.join(",") },
  },
});

/**
 * The Quest Log's word that unlocks the Dark World arenas (the area menu, 0x803B9120: rooms 5-9 are picked when bit
 * 31 of [0x8050EC80 + 200 · file + 0x28] is set, file = [0x8050EC90]; a new file holds 0x24444444 there, file 0).
 * Poked before the area menu is built (its constructor reads it once).
 */
const DARK_UNLOCK = "0:8050eca8:a4";

interface Step {
  name: string;
  from: string | null; // a previous step, null = power-on
  script: string;
  /** Frame to save at (after the script: the movie must be over). */
  save: number;
  /** trace.ts --write pokes. */
  write?: string[];
}

const PICK_COUNT: Record<number, string> = {
  // Up, up, A → Two-Player Game → the area menu (cursor on The Field).
  2: "10 idle; 6 p1:up; 20 idle; 6 p1:up; 20 idle; 6 p1:A; 250 idle",
  3: "10 idle; 6 p1:up; 20 idle; 6 p1:A; 250 idle",
  4: "10 idle; 6 p1:A; 250 idle",
};
const COUNT_SAVE: Record<number, number> = { 2: 330, 3: 305, 4: 280 };

const MENU: Step[] = [
  // Power-on to the title screen ("PRESS START" shows from about frame 810; the GBAs are booted by then).
  { name: "title", from: null, script: "1095 idle", save: 1125 },
  // START (on P1's GBA) → Hyrulean Adventure / Shadow Battle / Options.
  { name: "modes", from: "title", script: "30 idle; 10 p1:START; 260 idle", save: 310 },
  // Down, A → the Shadow Battle screen (its attract demo, START! / Back).
  { name: "shadow", from: "modes", script: "20 idle; 6 p1:down; 30 idle; 6 p1:A; 200 idle", save: 272 },
  // START! → "create a file on the Memory Card?" No → "no saved data" A → "could not be loaded, start game?" left
  // (Yes), A → Quest Log 1 (a new file, never saved), A → START! → the player count (cursor on Four-Player).
  {
    name: "count",
    from: "shadow",
    script: "10 idle; 6 p1:A; 250 idle; 6 p1:A; 150 idle; 6 p1:A; 100 idle; 6 p1:left; 20 idle; 6 p1:A; 250 idle; 6 p1:A; 150 idle; 6 p1:A; 250 idle",
    save: 1240,
  },
  // The player count → the area menu: as the new file leaves it, and with the Dark World row unlocked.
  ...[2, 3, 4].map((n) => ({ name: `area-${n}p`, from: "count", script: PICK_COUNT[n]!, save: COUNT_SAVE[n]! })),
  ...[2, 3, 4].map((n) => ({ name: `area-dark-${n}p`, from: "count", script: PICK_COUNT[n]!, save: COUNT_SAVE[n]!, write: [DARK_UNLOCK] })),
];

const refState = (name: string) => (name.startsWith("save-") ? `ref/${name}.sav` : `ref/battle/${name}.sav`);
const frames = (script: string) => parseScript(script).reduce((n, s) => n + s.frames, 0);

function trace(args: string[]): void {
  execFileSync(process.execPath, [join(dirname(new URL(import.meta.url).pathname), "trace.ts"), "--port", values.port!, "--user", values.user!, ...args], { stdio: "inherit" });
}

function runStep(step: Step): void {
  const out = refState(step.name);
  mkdirSync(dirname(out), { recursive: true });
  const tail = step.save - frames(step.script) + 1;
  if (tail < 2) throw new Error(`${step.name}: save frame ${step.save} is inside the script`);
  const start = step.from === null ? ["--boot", "--ports", "gba,gba,gba,gba"] : ["--savestate", refState(step.from)];
  const pokes = (step.write ?? []).flatMap((w) => ["--write", w]);
  trace([...start, ...pokes, "--script", step.script, "--tail", String(tail), "--save", `${step.save}:${out}`, "--from", "1000000", "--out", "out/battle-states/step.json"]);
}

/** The area menu's step for an arena: the Dark World ones (rooms 5-9) need the unlocked menu. */
const areaStep = (players: number, room: number) => (room >= 5 ? `area-dark-${players}p` : `area-${players}p`);

/** The area menu → arena `room` (a row of five, the Dark World row below) → the round: holds P1's right from well
 *  before the round starts to find the first frame he moves, then saves 10 frames earlier from an idle run. */
async function runArena(players: number, room: number): Promise<void> {
  const name = `save-battle-${ARENA_SLUGS[room]}-${players}p`;
  const area = areaStep(players, room);
  const pick = [...(room >= 5 ? ["6 p1:down; 15 idle"] : []), ...Array<string>(room % 5).fill("6 p1:right; 15 idle"), "6 p1:A"].join("; ");
  const picked = frames(`10 idle; ${pick}`);
  const probe = "out/battle-states/probe.json";
  trace(["--savestate", refState(area), "--script", `10 idle; ${pick}; 900 p1:right`, "--from", String(picked + 100), "--out", probe]);
  // The Links appear while the arena loads, standing (P1 facing down); the first frame he turns or walks is the start.
  const recs = (JSON.parse(readFileSync(probe, "utf8")) as { frames: { f: number; links: { frame: number; state: number }[] }[] }).frames;
  const standing = recs.find((r) => r.links[0])?.links[0];
  const first = standing && recs.find((r) => r.links[0] && (r.links[0].state !== 0 || r.links[0].frame !== standing.frame));
  if (!first) throw new Error(`${name}: P1 never moved`);
  const save = first.f - 10;
  runStep({ name, from: area, script: `10 idle; ${pick}; ${save - 20 - picked} idle`, save });
  // The place it lands on (the Links read from the state), for place.ts check.
  const state = refState(name);
  const recipe = JSON.parse(readFileSync(`${state}.json`, "utf8")) as Record<string, unknown>;
  writeFileSync(`${state}.json`, JSON.stringify({ ...recipe, place: await knownPlace(state) }, null, 2) + "\n");
  console.log(`${name}: control from frame ${first.f} of the arena pick, saved at ${save}`);
}

setupBattleUser(values.user!, GBA_BIOS);
mkdirSync("out/battle-states", { recursive: true });
const only = values.only ? values.only.split(",") : [];
const playerCounts = values.players!.split(",").map(Number);
const arenas = values.arenas!.split(",").map((slug) => {
  const room = (ARENA_SLUGS as readonly string[]).indexOf(slug);
  if (room < 0) throw new Error(`no arena ${slug} (${ARENA_SLUGS.join(", ")})`);
  return room;
});
const needed = new Set(playerCounts.flatMap((n) => arenas.map((room) => areaStep(n, room))));
const rerun = new Set<string>();
for (const step of MENU) {
  if (step.name.startsWith("area-") && !needed.has(step.name)) continue;
  if (only.includes(step.name) || !existsSync(refState(step.name)) || (step.from !== null && rerun.has(step.from))) {
    runStep(step);
    rerun.add(step.name);
  }
}
for (const players of playerCounts) {
  for (const room of arenas) {
    const name = `${ARENA_SLUGS[room]}-${players}p`;
    if (rerun.has(areaStep(players, room)) || only.includes(name) || !existsSync(refState(`save-battle-${name}`))) await runArena(players, room);
  }
}
