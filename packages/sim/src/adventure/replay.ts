// An adventure record (../replay.ts) replayed: the stage's game from where the Links started, then its logged buttons.
import { replaySteps, type AdventureRecord, type ReplayResult } from "../replay.ts";
import { createAdventure, stepAdventure, type AdventureGame } from "./adventure.ts";
import type { AdventureStage } from "./stage.ts";

/** The record's game before its first step, as apps/game starts it. */
export const startAdventure = (record: AdventureRecord, stage: AdventureStage): AdventureGame =>
  createAdventure(stage, { room: record.room, x: record.x, y: record.y, players: record.players });

/** Replays an adventure record on its stage (built as apps/game builds it: playedAlone, the messages) `ticks` steps. */
export function replayAdventure(record: AdventureRecord, stage: AdventureStage, ticks?: number): ReplayResult<AdventureGame> {
  return replaySteps(startAdventure(record, stage), record, (game, buttons) => void stepAdventure(game, buttons, stage), ticks);
}
