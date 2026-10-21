// A finding written as a capture (tools/capture/src/captures.ts' layout, as F8 writes them): the stage's start and
// every button since in replay.json, capture.json with the note, state.json, a line in captures/index.jsonl. So
// `pnpm -s capture:replay <id>` and apps/game's `#replay=<id>` (a dev server running) replay it. The captures go to
// FSO_CAPTURES (another captures folder), else the repo's captures/.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { capturesDir, indexFile, repoRelative, type IndexEntry } from "@fso/capture";
import { hashState, InputLog, SUBPX, type AdventureRecord } from "@fso/sim";
import { createAdventure, stepAdventure, type AdventureStage } from "@fso/sim/adventure";
import type { PlayStage } from "./stage.ts";

/** A capture id from a finding's name: `playtest-<slug>` (the same finding overwrites its capture). */
export const findingId = (name: string): string => `playtest-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80)}`;

/**
 * Replays `buttons` (the leader's, one per tick from the stage's start, four Links) on `play` and writes the capture
 * `id` (default: findingId(note)); returns its id.
 */
export function writeCapture(play: PlayStage, stage: AdventureStage, buttons: readonly number[], note: string, id = findingId(note.split(":").slice(0, 2).join(" "))): string {
  const game = createAdventure(stage, { players: 4 }), log = new InputLog();
  for (const b of buttons) {
    stepAdventure(game, [b], stage);
    log.push([b], game);
  }
  const record: AdventureRecord = { kind: "adventure", stage: play.id, players: 4, inputs: log.runs, checkpoints: log.checkpoints, tick: game.tick, hash: hashState(game) };
  const dir = join(capturesDir(), id), time = new Date().toISOString();
  mkdirSync(dir, { recursive: true });
  const a = game.adventure, p = game.players[0]!;
  const url = "http://localhost:5191/adventure/";
  const info = {
    stage: play.id,
    name: play.name,
    tick: game.tick,
    room: a.room,
    area: a.area,
    leader: { x: p.x / SUBPX, y: p.y / SUBPX, room: a.room, area: a.area },
    route: null,
    hud: "",
    banner: "",
  };
  writeFileSync(join(dir, "replay.json"), JSON.stringify(record));
  writeFileSync(join(dir, "capture.json"), `${JSON.stringify({ id, app: "game", url, time, info, note, source: "tools/playtest" }, null, 2)}\n`);
  writeFileSync(join(dir, "state.json"), JSON.stringify(game, (_, v: unknown) => (v instanceof Map ? [...v] : ArrayBuffer.isView(v) ? Array.from(v as unknown as ArrayLike<number>) : v)));
  const known = existsSync(indexFile()) && readFileSync(indexFile(), "utf8").includes(`"id":"${id}"`);
  if (!known) {
    const entry: IndexEntry = { id, time, app: "game", note, tick: game.tick, url, frame: repoRelative(join(dir, "frame.png")), replay: true };
    appendFileSync(indexFile(), `${JSON.stringify(entry)}\n`);
  }
  return id;
}
