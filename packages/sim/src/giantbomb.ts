// The Tower of Winds' giant-bomb Shadow Link (`BBSL`, on its TV at (256, 128), switch 21) and his giant bomb (`BBMB`).
// Switch 21 is the gallery's four crystals lit together (a side room: siderooms.ts; switches.ts SWT4). Traced in
// Dolphin (switch 21 poked on, docs/measurements/side-rooms.md "Side rooms") and read from main.dol (BBSL init 0x803418B8, update
// 0x803410DC with its state table 0x804AC524; BBMB init 0x803435F8, update 0x80342850, blast 0x8034335C):
// - He comes 3 ticks after the switch: 60 ticks unseen, 115 of dark sparkles (JPA 1048-1050), then he rises (a Roc's
//   Feather jump: 3.0 px/tick up, 0.1 less each tick, to 46.5 px; 32 ticks), hovers 60, and holds a giant bomb over his
//   head 24 px higher that grows from nothing to its size (0.75 of its 96 px texture) in 80 ticks; he throws it (60),
//   fades out (10) and stays away until it's gone; 300 ticks later, once the switch is on again, he fades back in (60)
//   with a new bomb and throws again. He can't be hit and hurts nobody.
// - The bomb waits 8 ticks, goes up at 3.0 px/tick falling 0.2 px/tick² to the ground under him (47 ticks), squashes
//   (15), hurting Links it meets on the way (1, a 3.0 px/tick knockback), and burns 600 ticks (each hit takes 60 off),
//   then blows up: every Link on the TV, wherever he is, has his life at 0; a Link in a side room or going through a
//   door is spared. It also sets off the TV's bombs and bombchus.
import type { BattleState } from "./battle.ts";
import { hurtbox, hurtFighter, knockOut, type Knock } from "./combat.ts";
import { boxAround, boxesOverlap, isRemoved, removeEntity, spawnEntity, type Entity } from "./entities.ts";
import { explodeBombchu } from "./bombchus.ts";
import { BLAST_GIANT, explode } from "./bombs.ts";
import type { GameState } from "./game.ts";
import { askMessage, MESSAGE } from "./messages.ts";
import { SUBPX } from "./player.ts";
import { AWAY } from "./combat.ts";
import { screenAt } from "./siderooms.ts";
import { ownSwitch, switchOn } from "./switches.ts";

/** His states (Entity.param) and how long each lasts (ticks; 0 = until something happens). */
export const SHADOW = { waiting: 0, coming: 1, unseen: 2, sparkles: 3, rising: 4, hovering: 5, holding: 6, throwing: 7, fading: 8, away: 9, resting: 10, back: 11 } as const;
const SHADOW_TICKS: readonly number[] = [0, 1, 60, 115, 32, 60, 80, 60, 10, 0, 300, 60];
/** On a side-view screen his init puts him 4 px lower (measured: at (256, 132)). */
export const SHADOW_SIDE_DROP = 4;
/** His rise: 3.0 px/tick up, 0.1 less each tick (z after t ticks, 1/256 px; 46.5 px from the 30th). */
export const shadowRise = (t: number): number => Math.trunc((Math.min(t, 30) * (61 - Math.min(t, 30)) * SUBPX) / 20);
export const SHADOW_HEIGHT = shadowRise(30);
/** The bomb over his head: 24 px over him. */
export const BOMB_HOLD = 24 * SUBPX;

/** The bomb's states (Entity.param), its size (Entity.angle: 0-750 thousandths of its texture), its fuse (timer). */
export const BIG_BOMB = { growing: 0, waiting: 1, flying: 4, squashing: 5, burning: 6 } as const;
export const BIG_BOMB_GROW = 80;
export const BIG_BOMB_SIZE = 750;
export const BIG_BOMB_WAIT = 8;
export const BIG_BOMB_SQUASH = 15;
export const BIG_BOMB_FUSE = 600;
/** A hit takes this off its fuse, then nothing more for 15 ticks. */
export const BIG_BOMB_HIT = 60;
export const BIG_BOMB_HIT_PAUSE = 15;
/** Its box: ±24 px (its three boxes, init). */
export const BIG_BOMB_HALF = 24;
export const BIG_BOMB_DAMAGE = 1; // flying and squashing: 0x801F2B7C(1, hit type 2)
export const BIG_BOMB_KNOCK: Knock = { speed: 768, hop: 768 }; // hit type 2: 3.0 px/tick, the 3.0 hop
/** Up at 3.0 px/tick, 0.2 less each tick: its height after t ticks over where it started (1/256 px). */
export const bigBombFlight = (t: number): number => Math.trunc((t * (31 - t) * SUBPX) / 10);

/** The prop's entity at the round's start (hazards.ts spawnProp). */
export function spawnShadowLink(b: BattleState, k: number, sideView: boolean): Entity {
  const prop = b.props.actors[k]!;
  return spawnEntity(b, "shadowLink", prop.x * SUBPX, (prop.y + (sideView ? SHADOW_SIDE_DROP : 0)) * SUBPX, { home: k, param: SHADOW.waiting });
}

function become(e: Entity, state: number): void {
  e.param = state;
  e.tick = 0;
}

/** Is he to be seen now (states 4-8 and 11; 8 and 11 fading)? */
export function shadowShown(e: Entity): boolean {
  return (e.param >= SHADOW.rising && e.param <= SHADOW.fading) || e.param === SHADOW.back;
}

/** One tick of BBSL (hazards.ts). */
export function stepShadowLink(state: GameState, e: Entity): void {
  const b = state.battle!, prop = b.props.actors[e.home];
  if (!prop) return;
  const t = ++e.tick, length = SHADOW_TICKS[e.param]!;
  switch (e.param) {
    case SHADOW.waiting:
      if (switchOn(b, ownSwitch(prop.params))) become(e, SHADOW.coming);
      return;
    case SHADOW.rising:
      e.z = shadowRise(t);
      break;
    case SHADOW.away:
      if (!b.entities.some((x) => x.kind === "bigBomb" && x.home === e.home && !isRemoved(x))) become(e, SHADOW.resting);
      return;
    case SHADOW.resting:
      if (t >= length && switchOn(b, ownSwitch(prop.params))) become(e, SHADOW.back);
      return;
  }
  if (t < length) return;
  if (e.param === SHADOW.back) become(e, SHADOW.holding);
  else become(e, e.param + 1);
  if (e.param === SHADOW.holding) spawnEntity(b, "bigBomb", e.x, e.y, { home: e.home, z: e.z + BOMB_HOLD, param: BIG_BOMB.growing, timer: BIG_BOMB_FUSE });
}

/** One tick of BBMB (hazards.ts): `homeY` keeps the height it starts its flight from. */
export function stepBigBomb(state: GameState, e: Entity): void {
  const b = state.battle!;
  const t = ++e.tick;
  if (e.target > 0) e.target--; // (a hit's pause)
  switch (e.param) {
    case BIG_BOMB.growing:
      e.angle = Math.trunc((BIG_BOMB_SIZE * Math.min(t, BIG_BOMB_GROW)) / BIG_BOMB_GROW);
      if (t >= BIG_BOMB_GROW) become(e, BIG_BOMB.waiting);
      return;
    case BIG_BOMB.waiting:
      if (t >= BIG_BOMB_WAIT) {
        become(e, BIG_BOMB.flying);
        e.homeY = e.z;
      }
      return;
    case BIG_BOMB.flying:
      e.z = Math.max(0, e.homeY + bigBombFlight(t));
      if (e.z === 0) {
        become(e, BIG_BOMB.squashing);
        askMessage(state, MESSAGE.giantBomb); // (as it lands: messages.ts)
      }
      hurtUnder(state, e);
      return;
    case BIG_BOMB.squashing:
      hurtUnder(state, e);
      if (t >= BIG_BOMB_SQUASH) become(e, BIG_BOMB.burning);
      return;
    case BIG_BOMB.burning:
      if (--e.timer <= 0) blowUp(state, e);
      return;
  }
}

/** Flying down and squashing, it hurts the Links on the TV its box meets (within 32 px of its height). */
function hurtUnder(state: GameState, e: Entity): void {
  const b = state.battle!;
  if (e.z > 32 * SUBPX) return;
  const box = boxAround(e.x, e.y, BIG_BOMB_HALF);
  state.players.forEach((p, i) => {
    if (screenAt(p.y) !== screenAt(e.y) || !boxesOverlap(box, hurtbox(p))) return;
    const hit = hurtFighter(p, b.fighters[i]!, i, BIG_BOMB_DAMAGE, e.x, e.y, { cause: "bigBomb", knock: BIG_BOMB_KNOCK });
    if (hit) b.hits.push(hit);
  });
}

/** A hit on the burning bomb (strike.ts): 60 ticks off its fuse, then 15 ticks it ignores hits. */
export function strikeBigBomb(e: Entity): boolean {
  if (e.param !== BIG_BOMB.burning || e.target > 0) return e.param === BIG_BOMB.burning;
  e.timer = Math.max(1, e.timer - BIG_BOMB_HIT);
  e.target = BIG_BOMB_HIT_PAUSE;
  return true;
}

/**
 * The blast: every Link on its screen (the TV) out, but one going through a door or held overhead; the screen's bombs
 * and bombchus go off; a white flash (an explosion entity with BLAST_GIANT, which hurts nobody itself).
 */
function blowUp(state: GameState, e: Entity): void {
  const b = state.battle!, screen = screenAt(e.y);
  removeEntity(e);
  state.players.forEach((p, i) => {
    const f = b.fighters[i]!;
    if (f.hearts <= 0 || screenAt(p.y) !== screen || AWAY.has(f.move) || f.move === "held") return;
    knockOut(p, f);
    b.hits.push({ attacker: -1, victim: i, blocked: false, damage: 0, cause: "bigBomb" });
  });
  for (const x of b.entities) {
    if (isRemoved(x) || screenAt(x.y) !== screen) continue;
    if (x.kind === "bomb") explode(b, x);
    else if (x.kind === "bombchu") explodeBombchu(b, x);
  }
  spawnEntity(b, "explosion", e.x, e.y, { phase: "active", timer: BLAST_GIANT_TICKS, param: BLAST_GIANT });
}
export const BLAST_GIANT_TICKS = 32;
