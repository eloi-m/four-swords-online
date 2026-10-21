// The captures folder (gitignored: frames hold the game's graphics): one folder per capture and an index line each.
//   captures/index.jsonl                 {"id","time","app","note","tick","url","frame"} per line, oldest first
//   captures/<id>/frame.png              the game canvas when F8 was pressed
//   captures/<id>/capture.json           app, URL, note, viewport, the app's summary (info)
//   captures/<id>/state.json             the sim state (Maps and typed arrays as arrays)
//   captures/<id>/replay.json            the start and input log that replay it (@fso/sim replay.ts), when there is one
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dirname, "../../..");

/** The captures folder: FSO_CAPTURES, else the repo's captures/. */
export const capturesDir = (): string => resolve(REPO, process.env.FSO_CAPTURES ?? "captures");
export const indexFile = (): string => join(capturesDir(), "index.jsonl");

export interface IndexEntry {
  id: string;
  time: string;
  app: string;
  note: string;
  tick: number | null;
  url: string;
  /** frame.png's path, relative to the repo. */
  frame: string;
  replay: boolean;
}

/** The index, oldest first. */
export function readIndex(): IndexEntry[] {
  if (!existsSync(indexFile())) return [];
  return readFileSync(indexFile(), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as IndexEntry);
}

/** A capture's folder from its id, "latest" (or nothing), or a path to the folder. */
export function captureFolder(id = "latest"): string {
  if (existsSync(join(id, "capture.json"))) return resolve(id);
  if (id === "latest") {
    const last = readIndex().at(-1);
    if (!last) throw new Error(`no captures yet in ${capturesDir()}`);
    id = last.id;
  }
  if (!/^[\w-]+$/.test(id)) throw new Error(`not a capture id: ${id}`);
  const dir = join(capturesDir(), id);
  if (!existsSync(dir)) throw new Error(`no capture ${id} in ${capturesDir()}`);
  return dir;
}

export const repoRelative = (path: string): string => (path.startsWith(`${REPO}/`) ? path.slice(REPO.length + 1) : path);
