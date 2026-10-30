// An adventure record (../replay.ts) replayed: the stage's game from where the Links started, then its logged buttons.
import { replaySteps, type AdventureRecord, type ReplayResult } from "../replay.ts";
import { SUBPX } from "../player.ts";
import { createAdventure, enterArea, stepAdventure, type AdventureGame } from "./adventure.ts";
import { resetTrails } from "./formation.ts";
import { enterShadowAt } from "./shadowlink.ts";
import type { AdventureStage } from "./stage.ts";
import { SWIM_UNIT } from "./swim.ts";

/** The record's game before its first step, as apps/game starts it: the room entered with the carry (and its area,
 *  a GBA screen's), its switches set as the record's, its Shadow Link put in the record's state of his entrance, then
 *  each Link put on his spot (swimming, carried by the current, when the record says so), each follower's trail begun
 *  at the Link ahead of him. */
export function startAdventure(record: AdventureRecord, stage: AdventureStage): AdventureGame {
  const game = createAdventure(stage, { room: record.room, x: record.x, y: record.y, players: record.players, ...(record.carry ? { carry: record.carry } : {}) });
  if (record.area) enterArea(game, stage, game.adventure.room, record.area, 0, 0);
  if (record.switches !== undefined) game.battle.switches = record.switches >>> 0;
  const shadow = record.shadow && game.adventure.enemies.find((e) => e.type === "SLK2");
  if (shadow) enterShadowAt(shadow, record.shadow!.state, record.shadow!.tick);
  if (!record.links) return game;
  record.links.forEach((l, i) => {
    const p = game.players[i];
    if (!p) return;
    [p.x, p.y] = [Math.round(l.x * SUBPX), Math.round(l.y * SUBPX)];
    if (l.facing) p.facing = l.facing;
    if (l.swim) Object.assign(game.adventure.links[i]!, { mode: "swim", tick: 0, speed: 0, dir: -1, vx: 0, cx: Math.round(l.swim.x * SWIM_UNIT), cy: Math.round(l.swim.y * SWIM_UNIT) });
  });
  resetTrails(game);
  return game;
}

/** Replays an adventure record on its stage (built as apps/game builds it: playedAlone, the messages) `ticks` steps. */
export function replayAdventure(record: AdventureRecord, stage: AdventureStage, ticks?: number): ReplayResult<AdventureGame> {
  return replaySteps(startAdventure(record, stage), record, (game, buttons) => void stepAdventure(game, buttons, stage), ticks);
}
