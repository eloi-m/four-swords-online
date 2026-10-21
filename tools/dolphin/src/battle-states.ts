// Rebuilds the Shadow Battle reference savestates from power-on, by chaining trace.ts runs that each start from the
// previous step's state and save the next one (docs/measurements/battle-arenas.md "Battle mode in Dolphin"). Menu steps land in
// ref/battle/<step>.sav; each round start is ref/save-battle-<arena>-<n>p.sav, saved 10 frames before the players
// get control (found by a first run holding right). All four ports are integrated GBAs; P1's GBA drives the menus.
//   node tools/dolphin/src/battle-states.ts [--port 55031] [--only title,modes,…|field-2p,…] [--players 2,3,4]
// A step runs when it's named by --only or its state is missing; the ones after it then rerun too.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { BATTLE_USER, GBA_BIOS, setupBattleUser } from "./battle-user.ts";
import { parseScript } from "./script.ts";

const { values } = parseArgs({
  options: {
    port: { type: "string", default: "55031" },
    only: { type: "string", default: "" },
    players: { type: "string", default: "2,3,4" },
  },
});

/** The arenas in the area menu's order (= boss500 rooms 0-4; the Dark World ones stay locked on a new file). */
export const ARENA_SLUGS = ["field", "flames", "winds", "castle", "clouds"] as const;

interface Step {
  name: string;
  from: string | null; // a previous step, null = power-on
  script: string;
  /** Frame to save at (after the script: the movie must be over). */
  save: number;
}

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
  // Up, up, A → Two-Player Game → the area menu (cursor on The Field).
  { name: "area-2p", from: "count", script: "10 idle; 6 p1:up; 20 idle; 6 p1:up; 20 idle; 6 p1:A; 250 idle", save: 330 },
  { name: "area-3p", from: "count", script: "10 idle; 6 p1:up; 20 idle; 6 p1:A; 250 idle", save: 305 },
  { name: "area-4p", from: "count", script: "10 idle; 6 p1:A; 250 idle", save: 280 },
];

const refState = (name: string) => (name.startsWith("save-") ? `ref/${name}.sav` : `ref/battle/${name}.sav`);
const frames = (script: string) => parseScript(script).reduce((n, s) => n + s.frames, 0);

function trace(args: string[]): void {
  execFileSync(process.execPath, [join(dirname(new URL(import.meta.url).pathname), "trace.ts"), "--port", values.port!, ...args], { stdio: "inherit" });
}

function runStep(step: Step): void {
  const out = refState(step.name);
  mkdirSync(dirname(out), { recursive: true });
  const tail = step.save - frames(step.script) + 1;
  if (tail < 2) throw new Error(`${step.name}: save frame ${step.save} is inside the script`);
  const start = step.from === null ? ["--boot", "--ports", "gba,gba,gba,gba"] : ["--savestate", refState(step.from)];
  trace([...start, "--script", step.script, "--tail", String(tail), "--save", `${step.save}:${out}`, "--from", "1000000", "--out", "out/battle-states/step.json"]);
}

/** The area menu → arena `i` → the round: holds P1's right from well before the round starts to find the first
 *  frame he moves, then saves 10 frames earlier from an idle run. */
function runArena(players: number, i: number): void {
  const name = `save-battle-${ARENA_SLUGS[i]}-${players}p`;
  const pick = [...Array<string>(i).fill("6 p1:right; 15 idle"), "6 p1:A"].join("; ");
  const picked = frames(`10 idle; ${pick}`);
  const probe = "out/battle-states/probe.json";
  trace(["--savestate", refState(`area-${players}p`), "--script", `10 idle; ${pick}; 900 p1:right`, "--from", String(picked + 100), "--out", probe]);
  // The Links appear while the arena loads, standing (P1 facing down); the first frame he turns or walks is the start.
  const recs = (JSON.parse(readFileSync(probe, "utf8")) as { frames: { f: number; links: { frame: number; state: number }[] }[] }).frames;
  const standing = recs.find((r) => r.links[0])?.links[0];
  const first = standing && recs.find((r) => r.links[0] && (r.links[0].state !== 0 || r.links[0].frame !== standing.frame));
  if (!first) throw new Error(`${name}: P1 never moved`);
  const save = first.f - 10;
  runStep({ name, from: `area-${players}p`, script: `10 idle; ${pick}; ${save - 20 - picked} idle`, save });
  console.log(`${name}: control from frame ${first.f} of the arena pick, saved at ${save}`);
}

setupBattleUser(BATTLE_USER, GBA_BIOS);
mkdirSync("out/battle-states", { recursive: true });
const only = values.only ? values.only.split(",") : [];
const playerCounts = values.players!.split(",").map(Number);
let rerun = false;
for (const step of MENU) {
  if (step.name.startsWith("area-") && !playerCounts.includes(Number(step.name[5]))) continue;
  rerun ||= only.includes(step.name) || !existsSync(refState(step.name));
  if (rerun) runStep(step);
}
for (const players of playerCounts) {
  ARENA_SLUGS.forEach((slug, i) => {
    const name = `${slug}-${players}p`;
    if (rerun || only.includes(name) || !existsSync(refState(`save-battle-${name}`))) runArena(players, i);
  });
}
