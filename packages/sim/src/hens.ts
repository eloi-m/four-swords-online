// The Field's cave cucco and its angry cuccos (NIWA kind 6, update 0x8032FF..; traced in Dolphin: docs/measurements/battle-open-items.md
// "Angry cuccos"). The cucco in The Field's cave (its side room 5) can't be killed: it counts the hits it takes (+0x268,
// from 10), and on the tenth "Angry Cuccos! Run away!" (BMG 0x1B7, asked once a round: +0x2A0) and for 170 ticks a
// cucco flies in from a random edge of the TV every 2-14 ticks (even numbers): straight at a Link there, easing up to
// 3 px a tick, 16 px up; one that meets a Link takes 1 life with a bomb's knockback (1 px a tick, a 4.0 hop) and flies
// on. They only come onto the TV (the Link in the cave was left alone). 230 ticks after the tenth hit the cave cucco
// counts again from 10.
import type { BattleState } from "./battle.ts";
import { hurtbox, hurtFighter, KNOCK_BOMB, onGround, vulnerable } from "./combat.ts";
import { boxAround, boxesOverlap, isRemoved, randomInt, removeEntity, spawnEntity, velocityAlong, type Entity } from "./entities.ts";
import type { GameState } from "./game.ts";
import { askMessage, MESSAGE } from "./messages.ts";
import { SUBPX } from "./player.ts";
import { screenAt } from "./siderooms.ts";

export const HEN_KIND = 6; // NIWA params & 15 of the cave's cucco
export const HEN_HITS = 10;
/** A swing or stab counts once: the hits it takes are this many ticks apart at least (a stab is live 8). */
export const HEN_HIT_GAP = 10;
export const ANGRY_TICKS = 230;
export const ANGRY_SPAWN_TICKS = 170;
export const ANGRY_FIRST = 4; // the first one comes 4 ticks after the tenth hit
export const ANGRY_SPEED = 3 * SUBPX;
export const ANGRY_START_SPEED = 346; // 1.35 px a tick on its first step (traced: 1.35, 1.75, 2.02, 2.21 …)
export const ANGRY_DAMAGE = 1;
export const ANGRY_HEIGHT = 16 * SUBPX;
export const ANGRY_MESSAGE = MESSAGE.angryCuccos;
const ROOM_W = 512, ROOM_H = 384, EDGE = 15; // they appear 15 px out of the TV's room (traced: −15, 527, 399)

/**
 * The cave cucco ("hen"): `param` the hits left before it's angry, `timer` the ticks of its anger (cuccos coming while
 * over ANGRY_TICKS − ANGRY_SPAWN_TICKS), `target` the tick a cucco comes next, `hitMask` whether it asked for its
 * message this round, `angle` the ticks since its last hit.
 */
export function spawnHen(b: BattleState, x: number, y: number, home: number): Entity {
  return spawnEntity(b, "hen", x, y, { home, param: HEN_HITS, angle: HEN_HIT_GAP });
}

const ASKED = 1, ASK = 2; // hitMask bits: the message asked this round, to be asked on its next tick

/** A sword (or anything that strikes) hits the cave cucco (strike.ts): one hit counted; the tenth angers it. */
export function strikeHen(e: Entity): boolean {
  if (e.timer > 0 || e.angle < HEN_HIT_GAP) return true;
  e.angle = 0;
  if (--e.param > 0) return true;
  e.timer = ANGRY_TICKS;
  e.target = ANGRY_TICKS - ANGRY_FIRST;
  if (!(e.hitMask & ASKED)) e.hitMask |= ASKED | ASK;
  return true;
}

/** One tick of the cave cucco: its anger runs down, sending cuccos onto the TV meanwhile. */
export function stepHen(state: GameState, e: Entity): void {
  const b = state.battle!;
  if (e.angle < HEN_HIT_GAP) e.angle++;
  // (Asked a tick after the hit here: the strikes come after the arena's step.)
  if (e.hitMask & ASK) askMessage(state, ANGRY_MESSAGE), (e.hitMask &= ~ASK);
  if (e.timer <= 0) return;
  if (--e.timer === 0) {
    e.param = HEN_HITS;
    return;
  }
  if (e.timer > ANGRY_TICKS - ANGRY_SPAWN_TICKS && e.timer <= e.target) {
    spawnAngryCucco(state);
    e.target = e.timer - 2 * (1 + randomInt(b, 7));
  }
}

/** A cucco flying in from a random edge of the TV at the nearest Link there (straight on if there's none). */
function spawnAngryCucco(state: GameState): void {
  const b = state.battle!;
  const side = randomInt(b, 4), along = randomInt(b, side < 2 ? ROOM_H : ROOM_W);
  const [x, y] = side === 0 ? [-EDGE, along] : side === 1 ? [ROOM_W + EDGE, along] : side === 2 ? [along, -EDGE] : [along, ROOM_H + EDGE];
  let best = -1, bestD = Infinity;
  state.players.forEach((p, i) => {
    const f = b.fighters[i]!;
    if (f.hearts <= 0 || screenAt(p.y) !== 0) return;
    const d = (p.x / SUBPX - x) ** 2 + (p.y / SUBPX - y) ** 2;
    if (d < bestD) [best, bestD] = [i, d];
  });
  const goal = best >= 0 ? state.players[best]! : { x: (ROOM_W / 2) * SUBPX, y: (ROOM_H / 2) * SUBPX };
  const [vx, vy] = velocityAlong(goal.x - x * SUBPX, goal.y - y * SUBPX, SUBPX);
  spawnEntity(b, "angryCucco", x * SUBPX, y * SUBPX, { phase: "flying", z: ANGRY_HEIGHT, vx, vy, param: ANGRY_START_SPEED, target: best });
}

/** One tick of an angry cucco: on along its line, easing up to 3 px a tick; gone once well off the TV. */
export function stepAngryCucco(state: GameState, e: Entity): void {
  const b = state.battle!;
  e.tick++;
  if (e.tick > 1) e.param += Math.round((ANGRY_SPEED - e.param) / 4);
  e.x += Math.trunc((e.vx * e.param) / SUBPX);
  e.y += Math.trunc((e.vy * e.param) / SUBPX);
  if (e.vx) e.facing = e.vx > 0 ? "right" : "left";
  const px = e.x / SUBPX, py = e.y / SUBPX;
  if (px < -2 * EDGE || py < -2 * EDGE || px > ROOM_W + 2 * EDGE || py > ROOM_H + 2 * EDGE) return removeEntity(e);
  const box = boxAround(e.x, e.y, 4);
  b.fighters.forEach((f, i) => {
    if (isRemoved(e) || !vulnerable(f) || !onGround(f) || !boxesOverlap(box, hurtbox(state.players[i]!))) return;
    const hit = hurtFighter(state.players[i]!, f, i, ANGRY_DAMAGE, e.x, e.y, { cause: "cucco", knock: KNOCK_BOMB });
    if (hit) b.hits.push(hit);
  });
}
