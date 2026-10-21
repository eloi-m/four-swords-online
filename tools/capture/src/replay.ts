// Replays a capture in node (no browser): the match or stage from its start with its logged inputs (@fso/sim
// replay.ts), on the game files in extracted/. Checks the state hash against the capture's (and the log's checkpoints
// on the way), prints where the Links are, and writes the replayed state to captures/<id>/replayed-state.json (or
// --state <file>). --at <tick> stops earlier (to look at the steps before a bug). Exit code 1 when the hash differs.
//   node tools/capture/src/replay.ts [id|latest|folder] [--at <tick>] [--state <file>]     (pnpm capture:replay)
// The same calls make a test of a capture: replayBattle(record, stage, tileTypes) / replayAdventure(record, stage).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { decompressYaz0, Dol, isYaz0, loadActorTypes, parseBmg, parseRarc, readTileTypes, Stage, type RarcArchive } from "@fso/formats";
import { replayBattle, runTicks, SUBPX, type ReplayRecord } from "@fso/sim";
import { actorStats, AdventureStage, messageBook, playedAlone, replayAdventure } from "@fso/sim/adventure";
import { captureFolder, repoRelative } from "./captures.ts";

const EXTRACTED = resolve(import.meta.dirname, "../../../extracted");
const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const at = option("--at"), stateOut = option("--state");
const dir = captureFolder(args[0]);
const file = join(dir, "replay.json");
if (!existsSync(file)) {
  console.error(`${repoRelative(dir)} has no replay.json (captured online, in a menu, or before a match started)`);
  process.exit(2);
}
const record = JSON.parse(readFileSync(file, "utf8")) as ReplayRecord;
if (!existsSync(EXTRACTED)) throw new Error(`replays need the game files in ${EXTRACTED}`);
const archive = (path: string): RarcArchive => {
  const bytes = readFileSync(join(EXTRACTED, "files/GC4Sword_usa", path));
  return parseRarc(isYaz0(bytes) ? decompressYaz0(bytes) : bytes);
};
const tileTypes = readTileTypes(new Dol(readFileSync(join(EXTRACTED, "sys/main.dol"))));
const total = runTicks(record.inputs), ticks = at === undefined ? total : Math.min(total, Number(at));

const started = performance.now();
let result, summary: unknown;
if (record.kind === "battle") {
  const r = (result = replayBattle(record, new Stage(archive("Boss/boss500.arc")), tileTypes, ticks));
  const b = r.state.battle;
  summary = { phase: b?.phase, round: b?.round, players: r.state.players.map((p, i) => ({ x: p.x / SUBPX, y: p.y / SUBPX, action: p.action, facing: p.facing, hearts: b?.fighters[i]?.hearts })) };
} else {
  // The stage as apps/game builds it: played alone, the actors' stats, the English messages.
  const data = archive("data.arc");
  const stage = new AdventureStage(playedAlone(new Stage(archive(`Boss/${record.stage}.arc`))), tileTypes, actorStats(loadActorTypes(data) ?? new Map()));
  const bmg = archive("msgus.arc").files.find((f) => f.path.endsWith("_e.bmg"));
  if (bmg) stage.messages = messageBook(parseBmg(isYaz0(bmg.data) ? decompressYaz0(bmg.data) : bmg.data));
  const r = (result = replayAdventure(record, stage, ticks));
  const a = r.state.adventure;
  summary = { room: a.room, area: a.area, cleared: a.cleared, players: r.state.players.map((p) => ({ x: p.x / SUBPX, y: p.y / SUBPX, action: p.action, facing: p.facing })) };
}
const out = stateOut ? resolve(stateOut) : join(dir, "replayed-state.json");
writeFileSync(out, JSON.stringify(result.state, (_, v: unknown) => (v instanceof Map ? [...v] : ArrayBuffer.isView(v) ? Array.from(v as unknown as ArrayLike<number>) : v)));
const whole = ticks === total;
const match = whole ? result.hash === record.hash : null;
console.log(`${record.kind} replay of ${repoRelative(dir)}: ${result.steps}/${total} steps in ${((performance.now() - started) / 1000).toFixed(2)} s, tick ${(result.state as { tick: number }).tick}`);
console.log(`hash ${result.hash.toString(16)}${whole ? (match ? " = the capture's" : ` != the capture's ${record.hash.toString(16)}`) : " (stopped early: no capture hash to compare)"}`);
if (result.diverged !== null) console.log(`first checkpoint that differs: after step ${result.diverged} (checkpoints every few hundred steps: the replay parts from the recording before it)`);
console.log(JSON.stringify(summary));
console.log(`state: ${repoRelative(out)}`);
if (match === false || result.diverged !== null) process.exit(1);
