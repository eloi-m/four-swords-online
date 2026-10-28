// One input script played in Dolphin and in our sim from the same place (a state with its recipe, place.ts, or a
// battle round-start state), then the Links compared frame by frame: the first divergence (> 1 px on an axis), and a
// table every few frames. Ours is fed what Dolphin's game read each frame (the GBA keys in battle, the pad in the
// adventure), as the sim's regression fixtures are (fixture.ts).
//   node tools/dolphin/src/clip.ts <state.sav> --script "<script>" [--name <name>] [--tol 1] [--every 10]
//        [--user <dolphin user dir>] [--port <gdb port> (2490)]
// Output: out/dolphin-compare/<name>/report.md and clip.json (per frame, per Link: Dolphin's and our x, y, state).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";
import { Button } from "@fso/sim";
import { FORMATION_BUTTONS } from "@fso/sim/adventure";
import { clipDiff, CLIP_TOLERANCE, type ClipLink } from "./diff.ts";
import { gbaButtons } from "./fixture.ts";
import type { FrameSnapshot } from "./fsa.ts";
import { describePlace, EXTRACTED, knownPlace, readRecipe, RUNS, runTrace, userDirFor, withScreen } from "./place.ts";
import { battleStateName } from "./recipe.ts";
import { adventureSim, battleSim, loadAdventureStage, placePx, type Sim } from "./sim.ts";

/** PADStatus bits and the stick threshold (fixture.ts: the game walks from a tilt of about 36). */
const PAD = { A: 0x100, B: 0x200, R: 0x20 } as const;
const STICK = 36;

/** A GameCube pad as the adventure's buttons: B the sword, A the item, R the action, the C stick the formations. */
export function adventureButtons(pad: FrameSnapshot["pad"]): number {
  let b = 0;
  if (pad.x >= STICK) b |= Button.Right;
  if (pad.x <= -STICK) b |= Button.Left;
  if (pad.y >= STICK) b |= Button.Up;
  if (pad.y <= -STICK) b |= Button.Down;
  if (pad.buttons & PAD.B) b |= Button.Sword;
  if (pad.buttons & PAD.A) b |= Button.Item;
  if (pad.buttons & PAD.R) b |= Button.Action;
  const cx = pad.cx ?? 0, cy = pad.cy ?? 0;
  if (cy >= STICK) b |= FORMATION_BUTTONS.box;
  else if (cy <= -STICK) b |= FORMATION_BUTTONS.long;
  else if (cx <= -STICK) b |= FORMATION_BUTTONS.cross;
  else if (cx >= STICK) b |= FORMATION_BUTTONS.wide;
  return b;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      script: { type: "string" },
      name: { type: "string" },
      tol: { type: "string", default: String(CLIP_TOLERANCE) },
      every: { type: "string", default: "10" },
      user: { type: "string" },
      port: { type: "string", default: "2490" },
    },
  });
  const state = positionals[0];
  if (!state || !existsSync(state) || !values.script) {
    console.error('usage: clip <state.sav> --script "<script>" [--name n] [--tol 1] [--every 10]');
    process.exit(1);
  }
  const script = values.script.startsWith("@") ? readFileSync(values.script.slice(1), "utf8").trim() : values.script;
  const name = values.name ?? `${basename(state, ".sav").replace(/^save-/, "")}-clip`;
  const out = join(RUNS, name);
  mkdirSync(out, { recursive: true });
  const place = await knownPlace(state);
  const ports = existsSync(`${state}.json`) ? readRecipe(state).recipe.ports : battleStateName(state) ? ["gba", "gba", "gba", "gba"] : ["gc"];
  console.log(`${state}: ${describePlace(place)}`);

  const trace = runTrace(["--savestate", state, "--ports", ports.join(","), "--script", script, "--link", "3b4:4"], join(out, "dolphin.json"), {
    user: userDirFor({ ports } as never, values.user),
    port: values.port!,
  });
  const frames = trace.frames;
  // Ours from where Dolphin's Links stand on the clip's first frame.
  const first = frames[0]!;
  const start = { ...place, links: first.links.map(withScreen) };
  const sim: Sim = place.arena ? battleSim(EXTRACTED, start, { live: first.links }) : adventureSim(loadAdventureStage(EXTRACTED, place.stage), start);
  const players = sim.game.players.length;
  // Battle: the players in the round are the first ones (absent Links trail).
  const dolphinLinks = (f: (typeof frames)[number]): ClipLink[] =>
    f.links.slice(0, players).map((l) => ({ ...placePx(place, withScreen(l)), state: String(l.state) }));
  const buttons = (f: (typeof frames)[number]): number[] =>
    place.arena ? Array.from({ length: players }, (_, i) => gbaButtons(f.gba?.[i] ?? 0)) : [adventureButtons(f.pad)];
  const d: ClipLink[][] = [dolphinLinks(first)], o: ClipLink[][] = [sim.links()];
  for (let k = 1; k < frames.length; k++) {
    sim.step(buttons(frames[k]!));
    d.push(dolphinLinks(frames[k]!));
    o.push(sim.links());
  }
  const { worst, first: diverged } = clipDiff(d, o, Number(values.tol));
  const fmt = (l: ClipLink) => `(${l.x.toFixed(1)}, ${l.y.toFixed(1)}) ${l.state}`;
  const row = (k: number) => `| ${k} | ${frames[k]!.input} | ${d[k]!.map(fmt).join("<br>")} | ${o[k]!.map(fmt).join("<br>")} | ${worst[k]!.toFixed(2)} |`;
  const every = Number(values.every);
  const shown = new Set(d.map((_, k) => k).filter((k) => k % every === 0));
  if (diverged) for (let k = Math.max(0, diverged.frame - 3); k <= Math.min(d.length - 1, diverged.frame + 3); k++) shown.add(k);
  const verdict = diverged
    ? `First divergence: frame ${diverged.frame}, P${diverged.link + 1}: Dolphin ${fmt(diverged.dolphin)}, ours ${fmt(diverged.ours)} (${diverged.off.toFixed(2)} px).`
    : `No divergence over ${d.length} frames (tolerance ${values.tol} px; worst ${Math.max(...worst).toFixed(2)} px).`;
  const lines = [
    `# ${name}: a clip in Dolphin and in ours`, "", `${state}: ${describePlace(place)}. Script: \`${script}\`.`, "",
    "States: Dolphin's state number; ours action/mode. Positions in room px (a battle's side rooms below the arena).", "",
    verdict, "", "| frame | input | Dolphin | ours | off (px) |", "|---|---|---|---|---|", ...[...shown].sort((a, b) => a - b).map(row), "",
  ];
  writeFileSync(join(out, "report.md"), lines.join("\n"));
  writeFileSync(join(out, "clip.json"), JSON.stringify({ state, script, place, frames: d.map((links, k) => ({ f: k, input: frames[k]!.input, dolphin: links, ours: o[k] })) }));
  console.log(verdict);
  console.log(`-> ${join(out, "report.md")}`);
}
