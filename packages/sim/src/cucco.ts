// An item orb's cucco (NIWA kind 2: traced in battle, docs/measurements/battle-combat.md "Items, levels and the Four Sword"): let out
// where the orb broke, it flies on the way the orb flew; its heading (+0x29C) turns toward its target by at most 22.5°
// (0x1000) every 2-9 ticks (+0x238, random), and its velocity eases 0.3 of the way to 3 px/tick along that heading each
// tick (main.dol 0x80330868, 0x8032FA8C; traced: with its rival 40 px off its way it circled him about 40 px out for 95
// ticks); on him it takes 4 life (the most he has; a type-1 hit: the sword's knockback), slows ×0.7 a tick and stays 50
// ticks, then flies back to its thrower the same way and gives him what it took, past his starting life up to 16 (Link
// +0xBF8); it waits over him 28 ticks and is gone. With several rivals it goes for the first in player order (traced).
import type { BattleState } from "./battle.ts";
import { AWAY, HEART, hurtbox, hurtFighter, vulnerable } from "./combat.ts";
import { cos4096, pointInBox, removeEntity, setPhase, sin4096, spawnEntity, TRIG_ONE, velocityAlong, type Entity } from "./entities.ts";
import { angleTo } from "./hazards.ts";
import type { GameState } from "./game.ts";
import { SUBPX } from "./player.ts";
import { sameScreen } from "./siderooms.ts";

export const CUCCO_STEAL = 4; // a heart (a literal: this module loads before combat.ts's HEART is set)
export const CUCCO_SPEED = 768;
export const CUCCO_START_SPEED = 301; // so 1.72 px/tick on its first eased step (traced: 1.72, 2.10, 2.36, 2.55…)
export const CUCCO_TURN = 0x1000; // 22.5°: its heading's step toward its goal
export const CUCCO_TURN_TICKS = 2; // …every 2 + rand(8) ticks
export const CUCCO_TURN_SPREAD = 8;
export const CUCCO_HOLD_TICKS = 50;
export const CUCCO_DONE_TICKS = 28;
export const CUCCO_TICKS = 600; // gives up after this long
/** Where it waits over its owner, px up (traced: 24). */
const CUCCO_OVER = 24 * 256; // (1/256 px)
/** The life a Link can reach: 16 (Link +0xBF8 in battle, his start 12), or more with more hearts in the rules. */
export const maxLife = (b: BattleState) => Math.max(b.rules.hearts * HEART, 4 * HEART);

/**
 * The game draws the ticks to its next turn from its random generator; the sim mixes the cucco's id and tick instead, so
 * a cucco doesn't shift the battle's random draws (what the CPUs and orbs get).
 */
function turnSpread(e: Entity): number {
  const h = Math.imul(e.id * 0x9e37 + e.tick, 0x85ebca6b) >>> 0;
  return (h >>> 13) % CUCCO_TURN_SPREAD;
}

/** A cucco out of an orb that broke at (x, y) flying at (vx, vy), for `owner` (its thrower; -1: nobody's). */
export function spawnCucco(b: BattleState, x: number, y: number, owner: number, vx: number, vy: number): Entity {
  const [sx, sy] = vx || vy ? velocityAlong(vx, vy, CUCCO_START_SPEED) : [0, 0];
  return spawnEntity(b, "cucco", x, y, { owner, target: -1, phase: "chase", vx: sx, vy: sy, homeX: angleTo(0, 0, vx, vy), homeY: 0, timer: CUCCO_TICKS });
}

/**
 * The rival it goes for: the first standing one in player order on that screen, or -1 (traced with 3 players: P1's
 * cucco went for P2 whether he was the nearer or the farther; a later thrower's choice isn't traced).
 */
function cuccoTarget(state: GameState, i: number, y: number): number {
  const b = state.battle!;
  return b.fighters.findIndex((g, j) => j !== i && g.hearts > 0 && g.mode !== "dying" && g.mode !== "dead" && !AWAY.has(g.move) && sameScreen(state.players[j]!, { y }));
}

/**
 * The cucco's flight: its heading (0-65535 = a turn) in `homeX`, the ticks to its next turn in `homeY`; its velocity
 * (vx, vy) eased 0.3 of the way (at most 1 px/tick a tick on each axis) to CUCCO_SPEED along the heading; what it took
 * in `angle`. Phases: "chase" its target, "rest" on him, "return" to its owner, "active" waiting over him.
 */
export function stepCucco(state: GameState, e: Entity): void {
  const b = state.battle!;
  e.tick++;
  if (e.target < 0 && e.phase === "chase") e.target = cuccoTarget(state, e.owner, e.y);
  const owner = state.players[e.owner], fo = b.fighters[e.owner];
  if (e.phase === "active") {
    if (owner) [e.x, e.y] = [owner.x, owner.y - CUCCO_OVER];
    if (--e.timer <= 0) removeEntity(e);
    return;
  }
  if (e.phase === "rest") {
    e.vx = Math.trunc((e.vx * 7) / 10);
    e.vy = Math.trunc((e.vy * 7) / 10);
    e.x += e.vx;
    e.y += e.vy;
    if (--e.timer <= 0) {
      setPhase(e, "return");
      e.timer = CUCCO_TICKS;
    }
    return;
  }
  const chasing = e.phase === "chase";
  const goal = chasing ? state.players[e.target] : owner, fg = chasing ? b.fighters[e.target] : fo;
  if (--e.timer <= 0 || !goal || !fg || fg.hearts <= 0 || !sameScreen(goal, e)) {
    // Its target out or away: back empty-handed; its owner out or away: gone.
    if (!chasing || !owner || !fo || fo.hearts <= 0 || !sameScreen(owner, e)) return removeEntity(e);
    setPhase(e, "return");
    e.timer = CUCCO_TICKS;
    return;
  }
  if (e.homeY <= 0) {
    const turn = (((angleTo(e.x, e.y, goal.x, goal.y) - e.homeX) & 0xffff) << 16) >> 16; // (signed)
    e.homeX = (e.homeX + Math.max(-CUCCO_TURN, Math.min(CUCCO_TURN, turn))) & 0xffff;
    e.homeY = CUCCO_TURN_TICKS + turnSpread(e);
  }
  e.homeY--;
  const ease = (v: number, to: number) => v + Math.max(-SUBPX, Math.min(SUBPX, Math.trunc(((to - v) * 3) / 10)));
  e.vx = ease(e.vx, Math.trunc((CUCCO_SPEED * cos4096(e.homeX)) / TRIG_ONE));
  e.vy = ease(e.vy, Math.trunc((CUCCO_SPEED * sin4096(e.homeX)) / TRIG_ONE));
  e.x += e.vx;
  e.y += e.vy;
  if (e.vx) e.facing = e.vx > 0 ? "right" : "left";
  if (!pointInBox(Math.floor(e.x / SUBPX), Math.floor(e.y / SUBPX), hurtbox(goal))) return;
  if (chasing) {
    if (!vulnerable(fg)) return; // (round him till he can be hit)
    const stolen = Math.min(CUCCO_STEAL, fg.hearts);
    const hit = hurtFighter(goal, fg, e.target, stolen, e.x, e.y, { attacker: e.owner, cause: "cucco" });
    if (!hit) return;
    b.hits.push(hit);
    e.angle = stolen;
    setPhase(e, "rest");
    e.timer = CUCCO_HOLD_TICKS;
  } else {
    if (fo!.hearts > 0) fo!.hearts = Math.min(maxLife(b), fo!.hearts + e.angle);
    setPhase(e, "active");
    e.timer = CUCCO_DONE_TICKS;
  }
}
