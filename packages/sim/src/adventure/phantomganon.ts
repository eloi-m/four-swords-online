// Phantom Ganon (FGAN, Hyrule Castle's room 11, params 0x2000: kind 0, the boss), read from main.dol (ctor 0x80202444,
// init 0x8017E770, update 0x8017C40C with its 29-state table at 0x804A136C, state at +0x230) and traced in Dolphin
// (docs/measurements/adventure-world1.md "Phantom Ganon"). docs/formats/adventure.md "Phantom Ganon" has the decode; here:
// - he starts where he's placed, his home 16 px below it (traced: (256, 192), home (256, 208));
// - he hovers round his home, bobbing (40 + 4 cos, phase +768 a tick), wandering at 2 px/tick for
//   50 + rand(50) ticks at a time, back toward home once 64 px off it; his velocity eases 0.3 of the way to its target
//   (by up to 1 px/tick), his height likewise (by up to his max z speed);
// - playing alone, 50 + rand(50) ticks after his last dash he charges (30 ticks), then dashes at the nearest Link at
//   13 px/tick, slowing by 1 px/tick (~90 px), his sword out (2 damage, hit type 6), stopped by a wall within 48 px;
// - every 200 + rand(100) ticks he rises 60 px up the screen (4 px/tick, ±22.5°), raises an energy ball (kind 10) at
//   (x − 20, y − 110), and 40 ticks later bats it at the Link at 3 px/tick; a Link's sword sends it back at him at the
//   speed it came (the Link can't be hurt by it for 100 ticks, nor send it again for 30), his next bat 0.26 px/tick ×
//   the returns so far faster (traced: 3, 3.26, 3.78; then 4.56, 5 by the code: at 5 a sword no longer returns it); he
//   catches it coming up to 8 px under his place on the ground, ~16 px aside (traced) and bats it back (±2048 off the
//   Link, alternating) until the rally reaches 4: then it strikes him and he falls (the Links held 30 ticks, he's down
//   for up to 400): open to the sword on the ground, his body (x ± 16, y − 8…y + 40) (traced), each blow (4 a swing,
//   traced) closing it till his hurt frames played again (~20 ticks); 75 damage gets him up again, 210 beats him: he
//   rises to z 40 and dies there for 300 ticks (the Links free), then goes. More than 50 ticks after his bat the ball
//   bursts once 16 px off the screen (traced: the room's edge) into seven shards fanned at the nearest Link (5 px/tick,
//   2 damage, ±2 px, through walls, for 78 ticks); it hurts a Link it meets (2, hit type 1).
// - his first two falls fling Force Gems worth 99 each out of him (a GOLD, pickups.ts burstGems), his end 80 (traced).
// - his appearance: when the Links come near (the game: when the camera sees him) the Links are held (a demo lock)
//   for 100 + 300 ticks, he appears (a vertical line widening, faded in), waits 100, swings, the screen's tint, then
//   the fight; struck down they're held too (traced), dying not (traced).
// Not modelled: the JPA effects, his tint, the 2-4 player rules (no dashes, the ball passed from Link to Link).
import { attackMeets, type SubBox } from "../attacks.ts";
import { linkAttack } from "./whirl.ts";
import { hurtFighter, KNOCK_HARD, onGround, vulnerable } from "../combat.ts";
import { cos4096, sin4096 } from "../entities.ts";
import { angleTo } from "../hazards.ts";
import { SUBPX } from "../player.ts";
import { isSolidAt, type World } from "../world.ts";
import { currentArea, nextRandom, type AdventureGame } from "./adventure.ts";
import { burstGems } from "./pickups.ts";
import type { AdventureStage } from "./stage.ts";

/** Frame ticks: the wait loop, the sword swing, getting up (dawn), struck (yarare). */
export const GANON_FRAMES = { wait: [4, 4, 4, 4, 4, 4, 4, 4], swing: [2, 2, 2, 2, 5], dawn: [4, 4, 4, 4, 2, 4], hurt: [4, 4, 4, 8, 4] } as const;
/** His animation groups (the BTI families under boss013.arc's fganon/): dawn, kenhuri (the swing), wait, yarare. */
export type GanonGroup = 0 | 1 | 2 | 3;

export const GANON = {
  hp: 210,
  stunLimit: 75,
  downTicks: 400,
  hover: 40,
  wanderSpeed: 2 * SUBPX,
  homeRange: 64,
  dashSpeed: 13 * SUBPX,
  riseSpeed: 4 * SUBPX,
  rise: 60,
  ballSpeed: 3 * SUBPX,
  ballMax: 5 * SUBPX,
  ballStep: 67, // 0.26 px/tick per hit
  shardSpeed: 5 * SUBPX,
  /** Ticks a shard flies (traced: 78). */
  shardTicks: 78,
  /** The ball bursts once this far off the screen, past this many ticks since his bat (traced). */
  burstMargin: 16,
  burstAfter: 50,
  /** He catches the ball whose middle is in this box round his place on the ground (traced: caught 14.5 px aside,
   *  and from below up to 8 px under him; its top edge is assumed, the ball always comes from below). */
  catchBox: [-16, -40, 16, 8],
  /** Ticks a Link's return keeps the ball from the swords. */
  returnFly: 30,
  damage: 2,
  rally: 4,
  /** The Force Gems his first two falls and his end fling out (GOLD worths, traced). */
  fallGems: 99,
  falls: 2,
  endGems: 80,
  /** Ticks he dies for at z 40 before he goes (the bosses' death, traced: 300). */
  dying: 300,
} as const;

/** The energy ball (kind 10). */
export interface GanonBall {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Its speed (1/256 px per tick): his bat's, kept by a Link's return. */
  speed: number;
  /** Returns by the Links (+0x250); sent back by a Link since he last batted it (only then it counts on him). */
  hits: number;
  back: boolean;
  /** Ticks it can't be sent back (+0x238), ticks it can't hurt a Link (+0x23C), ticks flown since batted (+0x254). */
  fly: number;
  safe: number;
  flown: number;
}

/** A shard of a burst ball (kind 11). */
export interface GanonShard {
  x: number;
  y: number;
  vx: number;
  vy: number;
  tick: number;
}

export interface Ganon {
  state: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  tvx: number;
  tvy: number;
  zTarget: number;
  zMax: number;
  homeX: number;
  homeY: number;
  group: GanonGroup;
  frame: number;
  frameTicks: number;
  /** Timers +0x238 (throw, waits), +0x23C (wander), +0x248 (dash cooldown). */
  t238: number;
  t23c: number;
  t248: number;
  /** Counters +0x250, +0x254 (per state). */
  c250: number;
  c254: number;
  far: boolean;
  phase: number;
  hp: number;
  stun: number;
  rally: number;
  speed: number;
  /** The bat's angle offset and its sign. */
  offset: number;
  sign: number;
  alpha: number;
  /** Width and height scale (1/256). */
  scaleX: number;
  scaleY: number;
  /** The Links' swings that struck him already (bit per Link). */
  struck: number;
  /** The Links are held (the game's demo lock). */
  lock: boolean;
  ball: GanonBall | null;
  shards: GanonShard[];
  /** Falls that flung Force Gems (+0x260). */
  falls: number;
  /** Gone (beaten): the room's ZNSW counts him no more. */
  gone: boolean;
}

const MAXZ = 2 * SUBPX;
/** FSA angles (0 = down the screen... 32768 = up): a velocity is speed × (sin a, cos a). */
const vec = (a: number, speed: number): [number, number] => [Math.trunc((sin4096(a) * speed) / 4096), Math.trunc((cos4096(a) * speed) / 4096)];
/** The FSA angle from (x, y) toward (tx, ty). */
const toward = (x: number, y: number, tx: number, ty: number): number => (0x4000 - angleTo(x, y, tx, ty)) & 0xffff;
const approach = (v: number, t: number, num: number, den: number, max: number) => v + Math.max(-max, Math.min(max, Math.trunc(((t - v) * num) / den)));
const rand = (game: AdventureGame, n: number) => nextRandom(game.adventure) % n;

/** The boss of the current area, made when the Links come into a room with an FGAN of kind 0. */
export function spawnGanon(game: AdventureGame, stage: AdventureStage): void {
  const a = game.adventure;
  a.ganon = null;
  const actor = currentArea(game, stage).actors.find((x) => x.id === "FGAN" && (x.params & 15) === 0);
  if (!actor || a.beatenBosses.includes(a.room)) return;
  const x = actor.x * SUBPX, y = actor.y * SUBPX;
  a.ganon = {
    state: 0, x, y, z: 0, vx: 0, vy: 0, tvx: 0, tvy: 0, zTarget: 0, zMax: MAXZ, homeX: x, homeY: y + 16 * SUBPX, group: 2, frame: 0, frameTicks: 4,
    t238: 0, t23c: 0, t248: 0, c250: 0, c254: 0, far: false, phase: 0, hp: GANON.hp, stun: 0, rally: 0, speed: GANON.ballSpeed,
    offset: 0, sign: 1, alpha: 0, scaleX: 0, scaleY: 5 * 256, struck: 0, lock: false, ball: null, shards: [], falls: 0, gone: false,
  };
}

/** His body (1/256 px): his first init box (−16, −8, 16, 40) round his place on the ground, whatever his height
 *  (traced: struck down, swords met it from 64 px below the Link to 8 px above, 20 px aside but not 28). */
export function ganonBox(g: Ganon): SubBox {
  return { left: g.x - 16 * SUBPX, top: g.y - 8 * SUBPX, right: g.x + 16 * SUBPX, bottom: g.y + 40 * SUBPX };
}
const ballBox = (b: { x: number; y: number }, h: number): SubBox => ({ left: b.x - h * SUBPX, top: b.y - h * SUBPX, right: b.x + h * SUBPX, bottom: b.y + h * SUBPX });
const meet = (p: SubBox, q: SubBox) => p.left <= q.right && q.left <= p.right && p.top <= q.bottom && q.top <= p.bottom;
const linkBox = (p: { x: number; y: number }): SubBox => ballBox(p, 7);

/** The nearest Link still standing, or -1. */
function nearest(game: AdventureGame, x: number, y: number): number {
  let best = -1, bd = Infinity;
  game.players.forEach((p, i) => {
    if (game.battle.fighters[i]!.hearts <= 0) return;
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bd) (best = i), (bd = d);
  });
  return best;
}

/** Steps an animation: true when it ran past its last frame (the frame then stays). */
function play(g: Ganon, ticks: readonly number[], loop = false): boolean {
  if (--g.frameTicks > 0) return false;
  if (g.frame + 1 >= ticks.length) {
    if (!loop) return true;
    g.frame = 0;
  } else g.frame++;
  g.frameTicks = ticks[g.frame]!;
  return false;
}
/** Steps an animation backward: true once it went below frame 0. */
function rewind(g: Ganon, ticks: readonly number[]): boolean {
  if (--g.frameTicks > 0) return false;
  if (--g.frame < 0) return true;
  g.frameTicks = ticks[g.frame]!;
  return false;
}
function setFrames(g: Ganon, group: GanonGroup, ticks: readonly number[], frame = 0): void {
  g.group = group;
  g.frame = frame;
  g.frameTicks = ticks[frame]!;
}

/** One tick of Phantom Ganon, his ball and its shards (after the Links moved). */
export function stepGanon(game: AdventureGame, world: World): void {
  const g = game.adventure.ganon;
  if (!g || g.gone) return;
  if (g.state === 24) {
    // Dying: 300 ticks still where he rose to (the Links free; traced), then gone, Force Gems worth 80 flung out.
    if (--g.c250 <= 0) {
      g.gone = true;
      game.adventure.beatenBosses.push(game.adventure.room);
      burstGems(game, g.x, g.y, g.z, GANON.endGems);
    }
    return;
  }
  for (const k of ["t238", "t23c", "t248"] as const) if (g[k] > 0) g[k]--;
  g.vx = approach(g.vx, g.tvx, 3, 10, SUBPX);
  g.vy = approach(g.vy, g.tvy, 3, 10, SUBPX);
  g.x += g.vx;
  g.y += g.vy;
  if ([7, 8, 9, 10, 17, 21].includes(g.state)) {
    g.zTarget = (GANON.hover * SUBPX) + Math.trunc((4 * SUBPX * cos4096(g.phase)) / 4096);
    g.phase = (g.phase + 768) & 0xffff;
  }
  g.z = approach(g.z, g.zTarget, 3, 10, g.zMax);
  const l = game.players[0]!;
  switch (g.state) {
    case 0: // waiting to be seen (here: a Link within 160 px)
      if (game.players.some((p) => Math.hypot(p.x - g.x, p.y - g.y) < 160 * SUBPX)) Object.assign(g, { lock: true, c250: 0, c254: 0, state: 1 });
      break;
    case 1:
      if (g.c254 < 100) g.c254++;
      else if (++g.c250 >= 300) Object.assign(g, { scaleX: 0, scaleY: 5 * 256, state: 2 }), setFrames(g, 2, GANON_FRAMES.wait);
      break;
    case 2:
      play(g, GANON_FRAMES.wait, true);
      g.alpha = approach(g.alpha, 255, 1, 2, 5);
      g.scaleY = approach(g.scaleY, 256, 3, 10, 3 * 256);
      g.scaleX = approach(g.scaleX, 256, 3, 10, 26);
      if (g.scaleX >= 253 && g.alpha >= 254) Object.assign(g, { t238: 100, state: 3, scaleX: 256 });
      break;
    case 3:
      play(g, GANON_FRAMES.wait, true);
      if (g.t238 === 0) setFrames(g, 1, GANON_FRAMES.swing), (g.state = 4);
      break;
    case 4:
      if (play(g, GANON_FRAMES.swing)) Object.assign(g, { frameTicks: 50, c250: 255, c254: 255, state: 5 });
      break;
    case 5:
      g.c250 = Math.max(159, g.c250 - 2);
      g.c254 = Math.max(127, g.c254 - 3);
      if (rewind(g, GANON_FRAMES.swing)) Object.assign(g, { lock: false, state: 6 });
      break;
    case 6:
      Object.assign(g, { t238: 200 + rand(game, 100), t248: 50 + rand(game, 50), zMax: MAXZ, speed: GANON.ballSpeed, rally: 0, state: 7 });
      setFrames(g, 2, GANON_FRAMES.wait);
      break;
    case 7: {
      g.alpha = approach(g.alpha, 255, 1, 1, 10);
      play(g, GANON_FRAMES.wait, true);
      if (g.z >= GANON.hover * SUBPX && g.t23c === 0) {
        let a = 8192 - rand(game, 16384);
        if (g.far) a += toward(g.x, g.y, g.homeX, g.homeY);
        [g.tvx, g.tvy] = vec(a & 0xffff, GANON.wanderSpeed);
        g.t23c = 50 + rand(game, 50);
      }
      const away = Math.hypot(g.x - g.homeX, g.y - g.homeY) > GANON.homeRange * SUBPX;
      if (away) {
        if (!g.far) Object.assign(g, { tvx: 0, tvy: 0, far: true });
      } else {
        g.far = false;
        if (g.t248 === 0 && nearest(game, g.x, g.y) >= 0) {
          g.state = 8;
          break;
        }
      }
      if (g.t238 === 0) g.state = 11;
      break;
    }
    case 8:
      Object.assign(g, { vx: 0, vy: 0, tvx: 0, tvy: 0, state: 9 });
      g.frame = 0;
      g.frameTicks += 30;
      break;
    case 9:
      if (g.group !== 1) {
        if (--g.frameTicks > 0) break;
        const i = nearest(game, g.x, g.y);
        if (i < 0) {
          g.state = 6;
          break;
        }
        const p = game.players[i]!;
        setFrames(g, 1, GANON_FRAMES.swing);
        [g.vx, g.vy] = vec(toward(g.x, g.y - g.z, p.x, p.y), GANON.dashSpeed);
        break;
      }
      if (play(g, GANON_FRAMES.swing)) Object.assign(g, { frameTicks: 50, state: 10 });
      break;
    case 10:
      if (g.frameTicks > 0) {
        g.frameTicks--;
        const sx = Math.sign(g.vx), sy = Math.sign(g.vy);
        if ((sx || sy) && isSolidAt(world, Math.floor(g.x / SUBPX) + sx * 48, Math.floor(g.y / SUBPX) + sy * 48)) Object.assign(g, { vx: 0, vy: 0, tvx: 0, tvy: 0 });
      } else if (Math.abs(g.vx - g.tvx) <= 26 && Math.abs(g.vy - g.tvy) <= 26) {
        if (g.frameTicks <= 0) g.frameTicks = 1;
        if (rewind(g, GANON_FRAMES.swing)) {
          Object.assign(g, { t248: 50 + rand(game, 50), far: false, t23c: 0, speed: GANON.ballSpeed, state: 7 });
          setFrames(g, 2, GANON_FRAMES.wait);
        }
      }
      break;
    case 11: {
      const a = (32768 + 4096 - rand(game, 8192)) & 0xffff;
      [g.tvx, g.tvy] = vec(a, GANON.riseSpeed);
      g.state = 12;
      break;
    }
    case 12:
      if (g.y <= g.homeY - GANON.rise * SUBPX) Object.assign(g, { tvx: 0, tvy: 0, vx: 0, vy: 0, frame: 0, offset: 0, state: 13 });
      break;
    case 13:
      g.ball = { x: g.x - 20 * SUBPX, y: g.y - 110 * SUBPX, vx: 0, vy: 0, speed: 0, hits: 0, back: false, fly: 0, safe: 0, flown: 0 };
      setFrames(g, 2, GANON_FRAMES.wait);
      Object.assign(g, { t238: 40, state: 14 });
      break;
    case 14: {
      if (g.t238 > 0) break;
      const ball = g.ball;
      if (!ball) {
        g.state = 6;
        break;
      }
      setFrames(g, 1, GANON_FRAMES.swing);
      g.c250 = 0;
      let a = toward(ball.x, ball.y, l.x, l.y);
      a += g.sign * g.offset;
      g.sign = -g.sign;
      g.offset = 2048;
      [ball.vx, ball.vy] = vec(a & 0xffff, g.speed);
      // (A sword may send it back at once: only a Link's return keeps it from the swords a while; traced.)
      Object.assign(ball, { speed: g.speed, fly: 0, flown: 0, back: false });
      g.state = 15;
      break;
    }
    case 15:
      if (play(g, GANON_FRAMES.swing)) Object.assign(g, { frameTicks: 20, state: 16 });
      break;
    case 16:
      if (--g.frameTicks <= 0) g.state = 17;
      break;
    case 17: {
      const i = nearest(game, g.x, g.y);
      if (i >= 0 && Math.hypot(game.players[i]!.x - g.x, game.players[i]!.y - g.y) < 50 * SUBPX) {
        g.state = 8;
        break;
      }
      if (!g.ball) {
        g.state = 6;
        break;
      }
      if (g.group === 1 && rewind(g, GANON_FRAMES.swing)) setFrames(g, 2, GANON_FRAMES.wait);
      else if (g.group === 2) play(g, GANON_FRAMES.wait, true);
      break;
    }
    case 18:
      // His first two falls fling Force Gems out of him (a GOLD worth 99 at his place and height).
      if (g.falls < GANON.falls) burstGems(game, g.x, g.y, g.z, GANON.fallGems), g.falls++;
      setFrames(g, 3, GANON_FRAMES.hurt);
      Object.assign(g, { lock: true, frameTicks: 10, state: 19 });
      break;
    case 19:
      if (play(g, GANON_FRAMES.hurt)) {
        Object.assign(g, { zTarget: 0, zMax: 3 * SUBPX, c250: 0, c254: 0, lock: false, stun: 0, state: 20 });
        setFrames(g, 0, GANON_FRAMES.dawn);
      }
      break;
    case 20:
      if (g.z < 26) g.z = 0;
      if (g.c254 === 0) {
        // His hurt frames (again after each blow, from the first): open to the sword a tick into the last (traced).
        play(g, GANON_FRAMES.dawn);
        if (g.frame === GANON_FRAMES.dawn.length - 1 && g.frameTicks < GANON_FRAMES.dawn[g.frame]!) g.c254 = 1;
      } else if (--g.frameTicks <= 0) {
        g.frame = g.frame === 4 ? 5 : 4;
        g.frameTicks = g.frame === 4 ? 4 : 8;
      }
      if (++g.c250 > GANON.downTicks) {
        Object.assign(g, { zMax: 0, state: 21 });
        setFrames(g, 0, GANON_FRAMES.dawn, 5);
      }
      break;
    case 21:
      g.zMax = SUBPX;
      if (rewind(g, GANON_FRAMES.dawn) || g.frame <= 0) {
        Object.assign(g, { c250: 0, state: 6 });
      }
      break;
    case 22:
      setFrames(g, 3, GANON_FRAMES.hurt, 4);
      Object.assign(g, { lock: false, zMax: 10 * SUBPX, zTarget: GANON.hover * SUBPX, ball: null, shards: [], state: 23 });
      break;
    case 23:
      // Up to z 40, then the bosses' death there (state 24 above).
      if (Math.abs(g.z - GANON.hover * SUBPX) <= SUBPX) Object.assign(g, { c250: GANON.dying, vx: 0, vy: 0, tvx: 0, tvy: 0, state: 24 });
      break;
  }
  swordsOnGanon(game, g);
  stepBall(game, g, world);
  stepShards(game, g);
  if (g.state === 9 && g.group === 1) {
    // His dash's sword: 2, hit type 6 (the hard knockback).
    const box = ganonBox(g);
    game.players.forEach((p, i) => {
      const f = game.battle.fighters[i]!;
      if (!vulnerable(f) || !onGround(f) || !meet(box, linkBox(p))) return;
      const hit = hurtFighter(p, f, i, GANON.damage, g.x, g.y - g.z, { cause: "enemy", knock: KNOCK_HARD });
      if (hit) game.battle.hits.push(hit);
    });
  }
}

/** The Links' swords on him while he's down (state 20, on the ground): each swing strikes once. */
function swordsOnGanon(game: AdventureGame, g: Ganon): void {
  game.players.forEach((p, i) => {
    const attack = linkAttack(game, i);
    if (!attack) {
      g.struck &= ~(1 << i);
      return;
    }
    if (g.state !== 20 || g.c254 === 0 || g.struck & (1 << i) || !attackMeets(attack, ganonBox(g))) return;
    g.struck |= 1 << i;
    // Each blow plays his hurt frames again from the first: no other lands till they're through (traced).
    Object.assign(g, { c254: 0, frame: 0 });
    g.stun += attack.power;
    g.hp -= attack.power;
    if (g.stun > GANON.stunLimit) g.c250 = GANON.downTicks;
    if (g.hp <= 0) g.state = 22;
  });
}

function stepBall(game: AdventureGame, g: Ganon, world: World): void {
  const ball = g.ball;
  if (!ball || (ball.vx === 0 && ball.vy === 0)) return;
  // Back at him in states 16 and 17, in his catch box round his place on the ground (before it moves; traced): the
  // fourth return strikes him down, else he bats it back. (The game tests the ball's color byte against his, which a
  // Link's return sets: here, sent back since his bat.)
  const [cl, ct, cr, cb] = GANON.catchBox.map((v) => v * SUBPX) as [number, number, number, number];
  const dx = ball.x - g.x, dy = ball.y - g.y;
  if ((g.state === 16 || g.state === 17) && ball.back && dx >= cl && dx <= cr && dy >= ct && dy <= cb) {
    if (g.rally >= GANON.rally) Object.assign(g, { ball: null, state: 18 });
    else {
      Object.assign(ball, { vx: 0, vy: 0, fly: 0, safe: 0, flown: 0 });
      Object.assign(g, { t238: 0, state: 14 });
    }
    return;
  }
  ball.x += ball.vx;
  ball.y += ball.vy;
  if (ball.safe > 0) ball.safe--;
  if (ball.flown <= GANON.burstAfter) ball.flown++;
  if (ball.fly > 0) ball.fly--;
  else {
    // A Link's sword sends it back at him at its own speed (while it's slower than 5 px/tick); his next bat is
    // 0.26 px/tick × the returns faster.
    const speed = ball.speed;
    for (let i = 0; i < game.players.length; i++) {
      const attack = linkAttack(game, i);
      if (!attack || !attackMeets(attack, ballBox(ball, 7)) || speed >= GANON.ballMax) continue;
      ball.hits++;
      g.rally = Math.min(GANON.rally, g.rally + 1);
      g.speed = Math.min(GANON.ballMax, g.speed + GANON.ballStep * ball.hits);
      [ball.vx, ball.vy] = vec(toward(ball.x, ball.y, g.x, g.y - g.z - 8 * SUBPX), speed);
      Object.assign(ball, { fly: GANON.returnFly, safe: 100, back: true });
      return;
    }
  }
  // More than 50 ticks after his bat, 16 px off the screen (the room's edges) it bursts into seven shards fanned at
  // the nearest Link.
  const m = GANON.burstMargin * SUBPX, area = world.widthCells * 8 * SUBPX, areaH = world.heightCells * 8 * SUBPX;
  if (ball.flown > GANON.burstAfter && (ball.x <= -m || ball.y <= -m || ball.x >= area + m || ball.y >= areaH + m)) {
    const i = nearest(game, ball.x, ball.y);
    const a0 = (i >= 0 ? toward(ball.x, ball.y, game.players[i]!.x, game.players[i]!.y) : 0) - 12288;
    for (let k = 0; k < 7; k++) {
      const [vx, vy] = vec((a0 + k * 4096) & 0xffff, GANON.shardSpeed);
      g.shards.push({ x: ball.x, y: ball.y, vx, vy, tick: 0 });
    }
    Object.assign(g, { ball: null, speed: GANON.ballSpeed, rally: 0 });
    return;
  }
  // It hurts a Link it meets (unless he just sent it back), and bursts.
  if (ball.safe > 0) return;
  for (let i = 0; i < game.players.length; i++) {
    const p = game.players[i]!, f = game.battle.fighters[i]!;
    if (!vulnerable(f) || !meet(ballBox(ball, 7), linkBox(p))) continue;
    const hit = hurtFighter(p, f, i, GANON.damage, ball.x, ball.y, { cause: "enemy" });
    if (hit) game.battle.hits.push(hit);
    Object.assign(g, { ball: null, speed: GANON.ballSpeed });
    return;
  }
}

function stepShards(game: AdventureGame, g: Ganon): void {
  g.shards = g.shards.filter((s) => {
    // Through walls, for 78 ticks (traced).
    s.x += s.vx;
    s.y += s.vy;
    if (++s.tick > GANON.shardTicks) return false;
    for (let i = 0; i < game.players.length; i++) {
      const p = game.players[i]!, f = game.battle.fighters[i]!;
      if (!vulnerable(f) || !meet(ballBox(s, 2), linkBox(p))) continue;
      const hit = hurtFighter(p, f, i, GANON.damage, s.x, s.y, { cause: "enemy" });
      if (hit) game.battle.hits.push(hit);
      return false;
    }
    return true;
  });
}
