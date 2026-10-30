// An adventure record (../replay.ts) replayed: the stage's game from where the Links started, then its logged buttons.
import { replaySteps, type AdventureRecord, type ReplayResult } from "../replay.ts";
import { SUBPX } from "../player.ts";
import { createAdventure, stepAdventure, type AdventureGame } from "./adventure.ts";
import { resetTrails } from "./formation.ts";
import type { AdventureStage } from "./stage.ts";

/** The record's game before its first step, as apps/game starts it: the room entered with the carry, its switches
 *  set as the record's, then each Link put on his spot, each follower's trail begun at the Link ahead of him. */
export function startAdventure(record: AdventureRecord, stage: AdventureStage): AdventureGame {
  const game = createAdventure(stage, { room: record.room, x: record.x, y: record.y, players: record.players, ...(record.carry ? { carry: record.carry } : {}) });
  if (record.switches !== undefined) game.battle.switches = record.switches >>> 0;
  if (!record.links) return game;
  record.links.forEach((l, i) => {
    const p = game.players[i];
    if (!p) return;
    [p.x, p.y] = [Math.round(l.x * SUBPX), Math.round(l.y * SUBPX)];
    if (l.facing) p.facing = l.facing;
  });
  resetTrails(game);
  return game;
}

/** Replays an adventure record on its stage (built as apps/game builds it: playedAlone, the messages) `ticks` steps. */
export function replayAdventure(record: AdventureRecord, stage: AdventureStage, ticks?: number): ReplayResult<AdventureGame> {
  return replaySteps(startAdventure(record, stage), record, (game, buttons) => void stepAdventure(game, buttons, stage), ticks);
}
