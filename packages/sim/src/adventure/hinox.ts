// The Hinox and the rocks it throws, read from main.dol (not traced: no savestate reaches Death Mountain). Records and
// the common rules are enemies.ts's; velocities 1/256 px per tick, z up.
import type { SubBox } from "../attacks.ts";
import { onGround, vulnerable, type Knock } from "../combat.ts";
import { cos4096, sin4096, TRIG_ONE } from "../entities.ts";
import { angleTo } from "../hazards.ts";
import { moveAxis, SUBPX, type Facing } from "../player.ts";
import type { World } from "../world.ts";
import { nextRandom, type AdventureGame } from "./adventure.ts";
import type { Enemy, EnemyState } from "./enemies.ts";

const random = (game: AdventureGame, n: number) => nextRandom(game.adventure) % n;
const fraction = (game: AdventureGame) => random(game, 256) / 256;

/** `v` eased `ease`/10 of the way to `target`, by at most `max` (0x801F71A4); at least 1/256 px. */
function easeTo(v: number, target: number, ease: number, max: number): number {
  const d = target - v, step = Math.trunc((d * ease) / 10) || Math.sign(d);
  return v + Math.max(-max, Math.min(max, step));
}

// --- the Hinox (HINO; init 0x8014F9FC, update 0x8014DD14 with its states' table 0x8049FA08, draw 0x8014DCD4, its
// death hook 0x8014F76C; tables from 0x8049F840) ---
// A big one-eyed brute facing only down or up (at random). Life 48, atcp 2, drops by dasu 5 (a 100 or a 150 Force Gem).
// Box x −14…14, y −14…+8 round its anchor (walls ±8). Never knocked back while it lives; swords hurt it, and of the rest
// only bombs' blasts (0x801F2DB4 with HBMB the only type: the bomb's atcn, 32); any other attack touching it does no
// harm but counts as a strike. Its velocity eases 0.3 of the way to its target, by at most 1 px/tick a tick. Params
// bit 0: it drops in from above (none placed). Placed in Death Mountain Foothills, Tingle's Tower 7-2 and the Seal.
// - walking ("walk", states 0/1): strides along its facing, steps of 8, 15, 8, 15 ticks moving (1.2 px/tick) then
//   standing, frames 0-3 (up 4-7); every third stride its speed swings ±0x3000 off its axis at random. A wall turns it
//   about (frame 28 / 29, 8 ticks). A Link in its quadrant within 128 px with its cool-down over, or any once it's been
//   struck, makes it attack: farther than 48 px, one time in two it throws rocks, else it charges.
// - wind-up ("stop", 2/3): stopped, frames 20/21 (up 22/23) swapped every 5 ticks, 4 rounds.
// - charge ("chase", 4/5): it faces the nearest Link (up if he's above it) and runs at 2 px/tick along the line to where
//   he was, frames 8, 9, 10, 11, 10, 9 (up 12-15, 14, 13) for 5, 2, 2, 5, 2, 2 ticks, 70 ticks or until a wall; then
//   one time in two it turns about, 100 ticks of cool-down, walking. Charging, touching it hurts by 4 (hit type 3, 6
//   px/tick), else by its atcp (hit type 1). In the game a Link with Force Gems within 24 px as it charges is grabbed
//   instead (states 8/9: held in its hand, shaken a gem out every 12 ticks until he struggles free with 10 presses,
//   then flung at 15 px/tick): not simulated here (the charge hurts him).
// - rocks ("spit", 6/7): frames 16/17 (up 18/19) 7 ticks each; as the first 7 ticks end a rock (OIWA kind 1) appears
//   over its head (8 px left, 21 up, 25 high facing down; 8 right, 31 up, 15 high facing up); on the 8th step (frames
//   9, 2, 25 / 13, 6, 27 for 2, 2, 10 ticks) it throws it along its facing ±45° at random, 2 + rand(2) px/tick, 3
//   px/tick up; three rocks 70 ticks apart, a 100-tick cool-down from each, then it turns about and walks.
// - struck: holding a rock it drops it (straight up 3 px/tick); walking or dropping its rock, the first strike makes it
//   face the nearest Link and attack him next whatever his distance and its cool-down.
// Look: gc 43 + frame. Its rock (OIWA kind 1; update 0x800F5248): box ±10, held still until thrown or dropped; moving it
// hurts a Link it touches by 2 (hit type 6), falls 0.2 px/tick² over everything and breaks on the ground; nothing hurts
// it; gc 177.
export const HINOX = {
  box: { left: -14, top: -14, right: 14, bottom: 8 },
  walkSpeed: 307, // 1.2 px/tick
  chargeSpeed: 512, // 2 px/tick
  ease: 3,
  maxEase: SUBPX,
  walkTicks: [8, 15, 8, 15] as readonly number[],
  turnTicks: 8,
  turnStep: 4,
  sway: 0x3000,
  swayStrides: 3,
  notice: 128,
  near: 48,
  windupTicks: 5,
  windupRounds: 4,
  chargeTicks: 70,
  cool: 100,
  chargeDamage: 4,
  throwTicks: [7, 7, 7, 7, 7, 7, 7, 7, 2, 2, 10] as readonly number[],
  throwAt: 8,
  rocks: 3,
  rockSpread: 0x2000, // ±45°
  rockSpeed: 512, // 2 + rand(2) px/tick
  hand: { down: [-8, -21, 25], up: [8, -31, 15] } as Readonly<Record<"down" | "up", readonly [number, number, number]>>,
  /** A bomb's blast on it: the bomb's atcn (HBMB 32). */
  blastDamage: 32,
};
/** Hit type 3 (a charge): 6 px/tick. TODO(measure): its hop. */
export const HINOX_CHARGE_KNOCK: Knock = { speed: 1536, hop: 768 };
export const HINOX_FRAMES = {
  walk: { down: [0, 1, 2, 3, 28], up: [4, 5, 6, 7, 29] },
  windup: { down: [20, 21], up: [22, 23] },
  charge: { down: [8, 9, 10, 11, 10, 9], up: [12, 13, 14, 15, 14, 13] },
  rocks: { down: [16, 17, 16, 17, 16, 17, 16, 17, 9, 2, 25], up: [18, 19, 18, 19, 18, 19, 18, 19, 13, 6, 27] },
} as const;
const CHARGE_TICKS: readonly number[] = [5, 2, 2, 5, 2, 2];
export const HINOX_ROCK = { half: 10, damage: 2, vz: 768, gravity: 51, reach: 32 * SUBPX };
/** OIWA's kind for the Hinox's rock (its params 1). */
export const ROCK_KIND = 1;

/** Its fields: `shot2` the game's state (0-7), `frame` the step, `frameTimer` its countdown, `shot` the rounds or
 *  rocks, `timer` the charge's countdown, `grace` the cool-down, `turn` 1 once struck, `angle` the charge's heading,
 *  `leader` the id of the rock in its hands (0 none). */
export function initHinox(game: AdventureGame, e: Enemy): void {
  e.facing = random(game, 2) === 0 ? "up" : "down";
  e.shot2 = 0;
  e.state = "walk";
  e.frame = e.frameTimer = e.shot = e.timer = e.grace = e.turn = e.leader = 0;
}

/** Its hit box (1/256 px, inclusive). */
export function hinoxBox(e: Enemy): SubBox {
  const y = e.y - e.z;
  return { left: e.x + HINOX.box.left * SUBPX, top: y + HINOX.box.top * SUBPX, right: e.x + HINOX.box.right * SUBPX, bottom: y + HINOX.box.bottom * SUBPX };
}

/** Touching it: by how much and how. */
export const hinoxContact = (e: Enemy): { damage: number; knock?: Knock } => (e.shot2 === 5 ? { damage: HINOX.chargeDamage, knock: HINOX_CHARGE_KNOCK } : { damage: e.atcp });

const side = (e: Enemy): "down" | "up" => (e.facing === "up" ? "up" : "down");
function setStage(e: Enemy, n: number, state: EnemyState): void {
  e.shot2 = n;
  e.state = state;
  e.tick = 0;
}
function stopDead(e: Enemy): void {
  e.vx = e.vy = e.tvx = e.tvy = 0;
}
function turnAbout(e: Enemy): void {
  e.facing = e.facing === "up" ? "down" : "up";
  e.frame = HINOX.turnStep;
  e.frameTimer = HINOX.turnTicks;
}
/** 0x801F681C on the heading to (dx, dy). */
const quadrant = (dx: number, dy: number): Facing => (Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy >= 0 ? "down" : "up");

function nearest(game: AdventureGame, e: Enemy): { i: number; d: number; q: Facing | null } {
  let i = -1, d = 0, best = Infinity;
  game.players.forEach((p, k) => {
    const f = game.battle.fighters[k]!;
    if (!vulnerable(f) || !onGround(f)) return;
    const dd = Math.hypot((p.x - e.x) / SUBPX, (p.y - e.y) / SUBPX);
    if (dd < best) [i, d, best] = [k, dd, dd];
  });
  const p = game.players[i];
  return { i, d, q: p ? quadrant(p.x - e.x, p.y - e.y) : null };
}

/** Struck (a sword, a blast, or any attack touching it). `rock` = its rock, if any. */
export function strikeHinox(game: AdventureGame, e: Enemy, rock: Enemy | undefined): void {
  const { q } = nearest(game, e);
  const provoke = () => {
    if (e.turn) return false;
    e.turn = 1;
    if (q !== e.facing) turnAbout(e);
    return true;
  };
  if (e.shot2 === 7) {
    dropHinoxRock(e, rock);
    if (provoke()) {
      e.shot = 0;
      setStage(e, 1, "walk");
    }
  } else if (e.shot2 === 1) provoke();
  e.tvx = e.tvy = 0;
}

/** Its rock drops from its hands (struck, or dying: 0x8014F76C). */
export function dropHinoxRock(e: Enemy, rock: Enemy | undefined): void {
  if (rock && rock.life > 0) [rock.vx, rock.vy, rock.vz] = [0, 0, HINOX_ROCK.vz];
  e.leader = 0;
}

/** One tick of a Hinox: `newRock(x, y, z)` makes a rock (its id); `rock` finds it by id. */
export function stepHinox(game: AdventureGame, e: Enemy, world: World, newRock: (x: number, y: number, z: number) => number, rock: (id: number) => Enemy | undefined): void {
  const near = nearest(game, e);
  e.vx = easeTo(e.vx, e.tvx, HINOX.ease, HINOX.maxEase);
  e.vy = easeTo(e.vy, e.tvy, HINOX.ease, HINOX.maxEase);
  const x0 = e.x, y0 = e.y;
  moveAxis(e, world, e.vx, "x");
  moveAxis(e, world, e.vy, "y");
  const blocked = (e.vx !== 0 && e.x - x0 !== e.vx) || (e.vy !== 0 && e.y - y0 !== e.vy);
  const s = side(e);
  switch (e.shot2) {
    case 0:
      e.frame = e.shot = e.turn = 0;
      setStage(e, 1, "walk");
    // falls through
    case 1: {
      if (blocked) {
        turnAbout(e);
        stopDead(e);
      }
      if (e.frameTimer === 0) {
        e.frame = (e.frame + 1) & 3;
        e.tvx = e.tvy = 0;
        if ((e.frame & 1) === 0) {
          let sway = 0;
          if (e.frame === 0 && ++e.shot >= HINOX.swayStrides) {
            e.shot = 0;
            sway = Math.trunc(HINOX.sway - 2 * HINOX.sway * fraction(game));
          }
          // (Along its axis, swung off it by the sway.)
          const a = ((s === "up" ? 0xc000 : 0x4000) + sway) & 0xffff;
          e.tvx = Math.trunc((HINOX.walkSpeed * cos4096(a)) / TRIG_ONE);
          e.tvy = Math.trunc((HINOX.walkSpeed * sin4096(a)) / TRIG_ONE);
        }
        e.frameTimer = HINOX.walkTicks[e.frame]!;
      }
      if (e.frame === HINOX.turnStep) break;
      if (!((e.grace === 0 && near.q === e.facing && near.i >= 0 && near.d < HINOX.notice) || (e.turn && near.i >= 0))) break;
      e.turn = 0;
      if (near.d > HINOX.near && random(game, 2) === 0) {
        e.shot = 0;
        setStage(e, 6, "spit");
      } else setStage(e, 2, "stop");
      break;
    }
    case 2:
      e.frameTimer = HINOX.windupTicks;
      e.frame = e.shot = 0;
      stopDead(e);
      setStage(e, 3, "stop");
    // falls through
    case 3:
      if (e.frameTimer === 0) {
        e.frameTimer = HINOX.windupTicks;
        e.frame = (e.frame + 1) & 1;
        if (e.frame === 0 && ++e.shot > HINOX.windupRounds - 1) setStage(e, 4, "chase");
      }
      break;
    case 4: {
      e.frameTimer = e.frame = e.shot = 0;
      stopDead(e);
      const p = game.players[near.i];
      if (p) {
        e.angle = angleTo(e.x, e.y, p.x, p.y);
        e.facing = p.y < e.y ? "up" : "down";
      }
      e.timer = p ? HINOX.chargeTicks : 0;
      setStage(e, 5, "chase");
    }
    // falls through
    case 5:
      if (e.timer === 0 || blocked) {
        e.frameTimer = 0;
        if (random(game, 2) === 0) turnAbout(e);
        e.shot = 0;
        e.grace = HINOX.cool;
        stopDead(e);
        setStage(e, 1, "walk");
        break;
      }
      e.tvx = Math.trunc((HINOX.chargeSpeed * cos4096(e.angle)) / TRIG_ONE);
      e.tvy = Math.trunc((HINOX.chargeSpeed * sin4096(e.angle)) / TRIG_ONE);
      if (e.frameTimer === 0) {
        if (++e.frame > 5) e.frame = 0;
        e.frameTimer = CHARGE_TICKS[e.frame]!;
      }
      break;
    case 6:
      e.frame = 0;
      e.leader = 0;
      e.frameTimer = HINOX.throwTicks[0]!;
      stopDead(e);
      setStage(e, 7, "spit");
    // falls through
    case 7:
      if (e.frameTimer === 0) {
        if (e.frame === 0) {
          const [hx, hy, hz] = HINOX.hand[s];
          e.leader = newRock(e.x + hx * SUBPX, e.y + hy * SUBPX, e.z + hz * SUBPX);
        }
        if (++e.frame === HINOX.throwAt) {
          const r = e.leader ? rock(e.leader) : undefined;
          if (r && r.life > 0) {
            const speed = HINOX.rockSpeed + Math.trunc(HINOX.rockSpeed * fraction(game));
            const off = Math.trunc(HINOX.rockSpread - 2 * HINOX.rockSpread * fraction(game));
            const a = ((s === "up" ? 0xc000 : 0x4000) - off) & 0xffff;
            [r.vx, r.vy, r.vz] = [Math.trunc((speed * cos4096(a)) / TRIG_ONE), Math.trunc((speed * sin4096(a)) / TRIG_ONE), HINOX_ROCK.vz];
          }
          e.leader = 0;
        }
        if (e.frame > HINOX.throwTicks.length - 1) {
          e.grace = HINOX.cool;
          if (++e.shot < HINOX.rocks) setStage(e, 6, "spit");
          else {
            turnAbout(e);
            setStage(e, 1, "walk");
          }
          return;
        }
        e.frameTimer = HINOX.throwTicks[e.frame]!;
      }
      break;
  }
  if (e.frameTimer > 0) e.frameTimer--;
  if (e.timer > 0) e.timer--;
  if (e.grace > 0) e.grace--;
}

/** One tick of a Hinox's rock: still while held, else flying and falling; it breaks (life −1) on the ground. */
export function stepHinoxRock(e: Enemy): void {
  if (!(e.vx || e.vy || e.vz)) return;
  e.vz -= HINOX_ROCK.gravity;
  e.x += e.vx;
  e.y += e.vy;
  e.z += e.vz;
  if (e.z <= 0) e.life = -1;
}

/** The rock hurts what it touches: moving, within reach of the ground. */
export const rockHurts = (e: Enemy) => (e.vx !== 0 || e.vy !== 0 || e.vz !== 0) && e.z <= HINOX_ROCK.reach;

/** Its frame (gc 43 + it) as its state shows it. */
export function hinoxFrame(e: Enemy): number {
  const s = side(e), n = Math.max(0, e.frame);
  const table = e.shot2 === 2 || e.shot2 === 3 ? HINOX_FRAMES.windup[s] : e.shot2 === 4 || e.shot2 === 5 ? HINOX_FRAMES.charge[s] : e.shot2 === 6 || e.shot2 === 7 ? HINOX_FRAMES.rocks[s] : HINOX_FRAMES.walk[s];
  return table[Math.min(n, table.length - 1)]!;
}
