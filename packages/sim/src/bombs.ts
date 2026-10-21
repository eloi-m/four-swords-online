// Bombs and explosions. A Link's bomb (the Bomb item) is lit when he puts it down; a Tower of Flames bomb (HBMB, one
// per 0x0c socket tile) is lit when someone lifts it, and a new one grows in its socket after it went off. When the
// fuse runs out the bomb explodes: its ±7 px hit box grows to ±16 px (measured), everyone in it takes damage and is
// knocked away (the bomber too, in battle), bushes are cut, orbs break, soldiers and bees are hit, and other bombs in
// the blast go off at once. Fuse, flash, blast box, duration, chain and knockback are measured (docs/measurements/battle-combat.md; in
// battle: "Battle measurements: arenas, orbs and camera").
import type { BattleState } from "./battle.ts";
import { BOMBCHU_BLAST_TICKS, BOMBCHU_DAMAGE } from "./bombchus.ts";
import { hurtbox, hurtFighter, KNOCK_DEFAULT, type Knock } from "./combat.ts";
import { boxAround, boxesOverlap, isRemoved, removeEntity, spawnEntity, type Entity } from "./entities.ts";
import type { GameState } from "./game.ts";
import { bushesIn, cutBush, strikeEntity, struckBy } from "./strike.ts";

/**
 * The fuse (HBMB +0x238): 299 on the tick a Link puts it down, the blast (state 5) on the tick after it reads 0, and
 * the blast hurts from the tick after that (traced in battle: a press seen on frame 21, the blast on 321, a Link 9 px
 * away hurt on 322). Here the count includes the lighting tick, and a bomb's explosion hurts from its second tick.
 */
export const BOMB_FUSE = 301;
/**
 * The bomb's flash (HBMB +0x24C, traced; sprite 233 while it's set): with the fuse (+0x238 = `timer` − 1) under 100 a
 * counter steps 1 a tick, under 50 2 a tick, and the flag flips each time it wraps at 8: lit on 91–84, 75–68, 59–52,
 * then every 4 ticks from 46 (46–43, 38–35 … 6–3). The same for every bomb, lit at 299 (placed or lifted).
 */
export function bombFlashing(timer: number): boolean {
  const fuse = timer - 1;
  if (fuse < 0 || fuse > 99) return false;
  return (fuse >= 47 ? Math.floor((99 - fuse) / 8) : 7 + Math.floor((46 - fuse) / 4)) % 2 === 1;
}
export const EXPLOSION_TICKS = 32; // the explosion actor's life (measured)
/**
 * It hurts during its first ticks: HBMB's state 5 steps through frames of 4, 4, 2, 2, 4, 4, 4, 4, 4 ticks (+0x24C,
 * +0x234; the table at 0x8049F760) and attacks during the first four (traced: a Link walking in was hurt on the blast's
 * 12th hurting tick, P+313, not on the 13th).
 */
export const EXPLOSION_HURT_TICKS = 12;
export const BLAST_HALF = 16; // the exploding bomb's hit box: ±16 px (traced: a Link 22 px away hit, 23 not)
export const BLAST_RADIUS = BLAST_HALF;
/** A level-2 bomb's blast: ±32 px (traced: a Link 38 px away hit, 39 not); its fuse and damage as level 1's. */
export const BIG_BLAST_HALF = 32;
/**
 * HBMB "bomb": atcp 4 in enemyparam.csv (one heart). Measured in battle (The Field's socket bomb held until it went
 * off, lifted on frame 87, blast on 387): its holder lost 4 and flew off at 1.0 px/frame with a 4.0 hop (33 frames),
 * hit type 5. The player's bombs are HBMBs too.
 */
export const BOMB_DAMAGE = 4;
export const BLAST_KNOCK: Knock = { speed: 256, hop: 1024 };
/**
 * A bomb caught in a blast goes off at once (traced: a bomb 15–21 px from another went off on the same tick as it), its
 * ±7 px box (a socket's ±10) meeting the blast's, from the blast's first tick through its hurting ones.
 */
export const BOMB_HALF = 7;
export const SOCKET_BOMB_HALF = 10;
/** A socket grows a new bomb this long after its bomb went off (measured, The Field's: blast on frame 387, a new one 447). */
export const BOMB_REGROW_TICKS = 60;

export const isLit = (e: Entity) => e.kind === "bomb" && e.timer > 0;
/**
 * Explosion.param bits: 1 a socket's bomb, BLAST_BOMBCHU a bombchu's blast (bombchus.ts: 2, type 1, all its 32 ticks),
 * BLAST_GIANT the giant bomb's flash (giantbomb.ts: it did its work itself), BLAST_BIG a level-2 bomb's (±32 px).
 */
export const BLAST_BOMBCHU = 2;
export const BLAST_GIANT = 4;
export const BLAST_BIG = 8;
/** A bomb's blast hurts from its second tick (traced), a bombchu's from its first. */
export const blastStart = (e: Entity): number => (e.param & (BLAST_BOMBCHU | BLAST_GIANT) ? 1 : 2);
/** The last tick an explosion hurts and sets things off on. */
export const blastTicks = (e: Entity): number => (e.param & BLAST_BOMBCHU ? BOMBCHU_BLAST_TICKS : EXPLOSION_HURT_TICKS + 1);
/** Its hit box's half size, px. */
export const blastHalf = (e: Entity): number => (e.param & BLAST_BIG ? BIG_BLAST_HALF : BLAST_HALF);

/** Counts down lit bombs (resting, carried or flying) and sets off the ones whose fuse ran out. */
export function stepBombs(state: GameState): void {
  const b = state.battle!;
  for (const e of b.entities) if (e.kind === "bomb" && e.timer > 0 && !isRemoved(e) && --e.timer === 0) explode(b, e);
}

/** Replaces a bomb by an explosion (at the ground under it). A Link's bomb keeps its level in `angle`. */
export function explode(b: BattleState, e: Entity): Entity {
  removeEntity(e);
  if (e.home >= 0) b.respawn[e.home] = BOMB_REGROW_TICKS + 1; // (this tick's respawn step already counts one)
  const param = (e.home >= 0 ? 1 : 0) | (e.angle >= 2 ? BLAST_BIG : 0);
  return spawnEntity(b, "explosion", e.x, e.y, { owner: e.owner, phase: "active", timer: EXPLOSION_TICKS, param });
}

function inBlast(ex: number, ey: number, x: number, y: number, half = BLAST_HALF): boolean {
  const dx = Math.abs(Math.floor(x / 256) - Math.floor(ex / 256)), dy = Math.abs(Math.floor(y / 256) - Math.floor(ey / 256));
  return dx <= half && dy <= half;
}

/** Explosions: chain, hurt and cut during their first ticks, then fade. */
export function stepExplosions(state: GameState, harmful: boolean): void {
  const b = state.battle!;
  // (A bomb set off here explodes this tick: its explosion, appended, is stepped in this same loop, as the game's chain.)
  for (const e of b.entities) {
    if (e.kind !== "explosion" || isRemoved(e)) continue;
    e.tick++;
    if (--e.timer <= 0) {
      removeEntity(e);
      continue;
    }
    if (!harmful || e.tick > blastTicks(e) || e.param & BLAST_GIANT) continue; // (the giant bomb's: giantbomb.ts)
    const half = blastHalf(e), reach = boxAround(e.x, e.y, half);
    for (const other of b.entities) {
      if (other.kind !== "bomb" || isRemoved(other)) continue;
      if (boxesOverlap(reach, boxAround(other.x, other.y, other.home >= 0 ? SOCKET_BOMB_HALF : BOMB_HALF))) explode(b, other);
    }
    if (e.tick < blastStart(e)) continue;
    const chu = (e.param & BLAST_BOMBCHU) !== 0;
    state.players.forEach((p, i) => {
      const f = b.fighters[i]!;
      if (e.hitMask & (1 << i)) return;
      if (!boxesOverlap(boxAround(e.x, e.y, half), hurtbox(p))) return;
      const hit = hurtFighter(p, f, i, chu ? BOMBCHU_DAMAGE : BOMB_DAMAGE, e.x, e.y, { attacker: e.owner, cause: chu ? "bombchu" : "bomb", knock: chu ? KNOCK_DEFAULT : BLAST_KNOCK });
      if (hit) {
        e.hitMask |= 1 << i;
        b.hits.push(hit);
      }
    });
    if (e.tick !== blastStart(e)) continue;
    for (const other of struckBy(b, reach)) if (inBlast(e.x, e.y, other.x, other.y, half)) strikeEntity(b, other, BOMB_DAMAGE, e.x, e.y);
    for (const tile of bushesIn(b, reach)) cutBush(b, tile);
  }
}
