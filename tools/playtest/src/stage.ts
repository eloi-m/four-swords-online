// World 1's stages (Lake Hylia boss010, the Cave of No Return boss011, Tingle's Tower boss012, Hyrule Castle boss013)
// built in node as apps/game builds them (tools/capture/src/replay.ts: played alone, the actors' stats, the English
// messages), on the game files in the main checkout's extracted/, with their scripted routes (packages/sim).
import "@fso/sim"; // (before @fso/sim/adventure: its modules import the battle's in an order that needs this one first)
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { decompressYaz0, Dol, isYaz0, loadActorTypes, parseBmg, parseRarc, readTileTypes, Stage, type RarcArchive } from "@fso/formats";
import {
  actorStats, AdventureStage, CAVE_OF_NO_RETURN_MILESTONES, HYRULE_CASTLE_MILESTONES, LAKE_HYLIA_MILESTONES, messageBook, TINGLE_TOWER_MILESTONES, type Goal,
} from "@fso/sim/adventure";

export const EXTRACTED = resolve(import.meta.dirname, "../../../extracted");

export const archive = (path: string): RarcArchive => {
  const bytes = readFileSync(join(EXTRACTED, "files/GC4Sword_usa", path));
  return parseRarc(isYaz0(bytes) ? decompressYaz0(bytes) : bytes);
};

/** A stage the checks play: its archive's name, its name, its scripted route's milestones. */
export interface PlayStage {
  id: string;
  name: string;
  /** Short names the command lines take for it (besides its id). */
  aliases: readonly string[];
  milestones: readonly { name: string; goals: readonly Goal[] }[];
}

export const STAGES: readonly PlayStage[] = [
  { id: "boss010", name: "Lake Hylia", aliases: ["lake"], milestones: LAKE_HYLIA_MILESTONES },
  { id: "boss011", name: "the Cave of No Return", aliases: ["cave"], milestones: CAVE_OF_NO_RETURN_MILESTONES },
  { id: "boss012", name: "Tingle's Tower", aliases: ["tingle", "tower"], milestones: TINGLE_TOWER_MILESTONES },
  { id: "boss013", name: "Hyrule Castle", aliases: ["castle"], milestones: HYRULE_CASTLE_MILESTONES },
];

/** The stage an argument names (its id or an alias), if any. */
export const stageNamed = (arg: string): PlayStage | undefined => STAGES.find((s) => s.id === arg || s.aliases.includes(arg));

/** The stages a command line names (all when it names none), and its other arguments. */
export function stageArgs(args: readonly string[]): { stages: PlayStage[]; rest: string[] } {
  const named = args.map(stageNamed).filter((s): s is PlayStage => !!s);
  return { stages: named.length ? [...new Set(named)] : STAGES.slice(), rest: args.filter((a) => !stageNamed(a)) };
}

/** The stage file and the sim's stage for `name` (boss010). */
export function loadStage(name = "boss010"): { source: Stage; stage: AdventureStage; tileTypes: Uint16Array } {
  if (!existsSync(EXTRACTED)) throw new Error(`the playtest checks need the game files in ${EXTRACTED}`);
  const tileTypes = readTileTypes(new Dol(readFileSync(join(EXTRACTED, "sys/main.dol"))));
  const source = new Stage(archive(`Boss/${name}.arc`));
  const stage = new AdventureStage(source, tileTypes, actorStats(loadActorTypes(archive("data.arc")) ?? new Map()));
  const bmg = archive("msgus.arc").files.find((f) => f.path.endsWith("_e.bmg"));
  if (bmg) stage.messages = messageBook(parseBmg(isYaz0(bmg.data) ? decompressYaz0(bmg.data) : bmg.data));
  return { source, stage, tileTypes };
}
