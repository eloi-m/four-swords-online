// Bombchus (`BMTY`): wind-up bombs that run along the ground and blow up. Read from main.dol (init 0x803264C0, update
// 0x80325A30, movement 0x8032506C, explosion 0x80326208; docs/measurements/battle-constants.md "Battle constants from main.dol") and
// traced in Dolphin (the Tower of Flames' eight, docs/measurements/side-rooms.md "Side rooms"):
// - They come from GEN3 spawners (switches.ts: kind 0x17, one at a random angle; 0x18, left or right) when a side
//   room's crystals say so (the Tower of Flames' eight on switch 30, Hyrule Castle's four on 25, the Dark Tower of
//   Winds' two on 17 and 18), and out of a broken crystal ball whose roulette stopped on them (orbs.ts).
// - They run 2.5 px a tick in a straight line, bouncing off walls and plain pits (they cross lava): blocked across x
//   they turn back across x, across y back across y. The one a crystal ball lets out turns a quarter at its first wall
//   (×0.7), then bounces. On a side-view screen they crawl round the surfaces instead: along a floor, up the wall it
//   runs into, along a ceiling, round an outer corner, keeping the surface on the same side.
// - Harmless for their first 30 ticks (10 in side view); then a Link whose body meets one's ±8 px box takes 2 (the
//   sword's knockback), and it runs on. Its fuse of 300 ticks (counted from its first one) ends in a blast of ±16 px
//   that takes 2 (type 1 again, unlike a bomb's 4) every tick of its 32; a sword or another blast sets it off early,
//   and of two that meet, the newer one goes.
import type { BattleState } from "./battle.ts";
import { BLAST_BOMBCHU, BLAST_HALF, blastTicks } from "./bombs.ts";
import { hurtbox, hurtFighter, KNOCK_DEFAULT, onGround, vulnerable, type PixelBox } from "./combat.ts";
import { boxAround, boxesOverlap, cos4096, isRemoved, randomInt, removeEntity, sin4096, spawnEntity, TRIG_ONE, type Entity } from "./entities.ts";
import type { GameState } from "./game.ts";
import { SUBPX, type Facing } from "./player.ts";
import { sideViewAt } from "./siderooms.ts";
import { isSolidAt, type World } from "./world.ts";

export const BOMBCHU_SPEED = 640; // 2.5 px/tick (init: kind 3 ±2.5, kind 4 2.5 at a random angle; traced ≈ 2.5)
export const BOMBCHU_FUSE = 300; // +0x23C (traced: 299 on its first tick)
export const BOMBCHU_ARM = 30; // +0x248 on its first tick out of a hand: harmless until it runs out…
export const BOMBCHU_ARM_SIDE = 10; // …on a side-view screen
export const BOMBCHU_DAMAGE = 2; // its init's atcp, on touch and in its blast alike (0x801F2B7C(2, type 1))
export const BOMBCHU_HALF = 8; // ±8 px: its hit box (+0x60…+0x6C), and what sets it off
export const BOMBCHU_BLAST_TICKS = 32; // its explosion's frames (4, 4, 2, 2, 4, 4, 4, 4, 4), hurting on each
/** Its tile box (+0x80…+0x8C): (-7, -4)-(7, 7) around its anchor. */
export const BOMBCHU_BOX: PixelBox = { left: -7, top: -4, right: 7, bottom: 7 };
/** The first wall of one a crystal ball let out turns it (×0.7 across), once. */
const TURN = 7 / 10;
/** Side view: before it first lands it falls at 0.3 px/tick² (its "press" toward the surface, +0x234). */
export const BOMBCHU_PRESS = 77;

/** What a GEN3 or a crystal ball makes (BMTY params & 15). */
export const BOMBCHU_KIND = { orb: 1, fan: 2, sideways: 3, anyway: 4 } as const;
// Entity.param: the kind (bits 0-3), turned at its first wall (bit 4), on a side-view screen's surface (bit 5), px of
// an outer corner still to go round (bits 8-15).
const TURNED = 16, ATTACHED = 32, GRACE_SHIFT = 8;

/** A new bombchu at (x, y) (1/256 px): `kind`, and its velocity (else the kind's: sideways or at a random angle). */
export function spawnBombchu(b: BattleState, x: number, y: number, kind: number, vx?: number, vy?: number, owner = -1): Entity {
  if (vx === undefined || vy === undefined) {
    if (kind === BOMBCHU_KIND.sideways || sideViewAt(b, y)) [vx, vy] = [randomInt(b, 2) ? BOMBCHU_SPEED : -BOMBCHU_SPEED, 0];
    else {
      const angle = randomInt(b, 0x10000);
      [vx, vy] = [Math.trunc((BOMBCHU_SPEED * cos4096(angle)) / TRIG_ONE), Math.trunc((BOMBCHU_SPEED * sin4096(angle)) / TRIG_ONE)];
    }
  }
  return spawnEntity(b, "bombchu", x, y, { phase: "active", timer: BOMBCHU_FUSE, param: kind, vx, vy, owner, facing: "down" });
}

/** Is its tile box at (x, y) in a wall or over a plain pit (it crosses lava)? */
function blocked(world: World, x: number, y: number): boolean {
  const px = Math.floor(x / SUBPX), py = Math.floor(y / SUBPX), b = BOMBCHU_BOX;
  for (const [dx, dy] of [[b.left, b.top], [b.right, b.top], [b.left, b.bottom], [b.right, b.bottom], [0, b.top], [0, b.bottom], [b.left, 0], [b.right, 0]] as const) {
    const cx = px + dx, cy = py + dy;
    if (isSolidAt(world, cx, cy)) return true;
    if (world.plainPit && world.plainPit[Math.floor(cy / 8) * world.widthCells + Math.floor(cx / 8)]) return true;
  }
  return false;
}

/** Top-down: along its velocity, bouncing off what blocks it (its first wall turns a crystal ball's). */
function run(e: Entity, world: World): void {
  const nx = e.x + e.vx;
  if (blocked(world, nx, e.y)) {
    if ((e.param & 15) === BOMBCHU_KIND.orb && !(e.param & TURNED)) {
      [e.vx, e.vy] = [Math.trunc(-e.vx * TURN), Math.trunc(e.vx * TURN)];
      e.param |= TURNED;
    } else e.vx = -e.vx;
  } else e.x = nx;
  const ny = e.y + e.vy;
  if (blocked(world, e.x, ny)) {
    if ((e.param & 15) === BOMBCHU_KIND.orb && !(e.param & TURNED)) {
      [e.vx, e.vy] = [Math.trunc(-e.vy * TURN), Math.trunc(-e.vy * TURN)];
      e.param |= TURNED;
    } else e.vy = -e.vy;
  } else e.y = ny;
}

const UNIT: Readonly<Record<Facing, readonly [number, number]>> = { right: [1, 0], left: [-1, 0], down: [0, 1], up: [0, -1] };
const facingOf = (dx: number, dy: number): Facing => (dx > 0 ? "right" : dx < 0 ? "left" : dy > 0 ? "down" : "up");
/** Is there something solid just outside its ±7 px box on the side (dx, dy), at the middle of that side? */
const touching = (world: World, e: Entity, dx: number, dy: number) => isSolidAt(world, Math.floor(e.x / SUBPX) + dx * 8, Math.floor(e.y / SUBPX) + dy * 8);

/**
 * Side view (0x8032506C with the screen's side-view flag): until it first lands it falls (its press, 0.3 px/tick²) as it
 * runs; then it keeps to a surface (`facing`: the side the surface is on) at its speed, 1 px at a time: a wall ahead (an
 * inner corner) becomes its surface, and when its surface ends (an outer corner) it goes round it, its surface the
 * way it came from, the next 12 px without looking for one.
 */
function crawl(e: Entity, world: World): void {
  const speed = Math.max(Math.abs(e.vx), Math.abs(e.vy));
  if (!(e.param & ATTACHED)) {
    const nx = e.x + e.vx;
    if (blocked(world, nx, e.y)) e.vx = -e.vx;
    else e.x = nx;
    e.vy += BOMBCHU_PRESS;
    const ny = e.y + e.vy;
    if (!blocked(world, e.x, ny)) return void (e.y = ny);
    while (!blocked(world, e.x, e.y + SUBPX)) e.y += SUBPX; // down onto it
    e.param |= ATTACHED;
    e.facing = "down";
    e.vy = 0;
    e.vx = Math.sign(e.vx || 1) * BOMBCHU_SPEED;
    return;
  }
  let left = speed;
  while (left > 0) {
    const step = Math.min(SUBPX, left);
    left -= step;
    const [tx, ty] = [Math.sign(e.vx), Math.sign(e.vy)], [nx, ny] = UNIT[e.facing];
    if (touching(world, e, tx, ty)) {
      // An inner corner: up the wall ahead, away from the surface it was on.
      [e.vx, e.vy] = [-nx * speed, -ny * speed];
      e.facing = facingOf(tx, ty);
      continue;
    }
    e.x += tx * step;
    e.y += ty * step;
    const grace = (e.param >>> GRACE_SHIFT) & 0xff;
    if (grace > 0) {
      e.param = (e.param & 0xff) | ((grace - 1) << GRACE_SHIFT);
      continue;
    }
    if (!touching(world, e, nx, ny)) {
      // An outer corner: round it, onto the side it ends with.
      [e.vx, e.vy] = [nx * speed, ny * speed];
      e.facing = facingOf(-tx, -ty);
      e.param = (e.param & 0xff) | (12 << GRACE_SHIFT);
    }
  }
}

/** Blows a bombchu up: its blast (bombs.ts stepExplosions: a bombchu's is 2, type 1, for 32 ticks). */
export function explodeBombchu(b: BattleState, e: Entity): Entity {
  removeEntity(e);
  return spawnEntity(b, "explosion", e.x, e.y, { owner: e.owner, phase: "active", timer: BOMBCHU_BLAST_TICKS, param: BLAST_BOMBCHU });
}

/** Ticks a bombchu is harmless for. */
export const bombchuArming = (b: BattleState, e: Entity) => (sideViewAt(b, e.y) ? BOMBCHU_ARM_SIDE : BOMBCHU_ARM);
export const bombchuArmed = (b: BattleState, e: Entity) => e.tick > bombchuArming(b, e);

/**
 * Every bombchu, one tick (arenastep.ts, after the bombs): its fuse, its run, its bite, and what sets it off (another
 * blast, a newer bombchu it meets; swords: strike.ts).
 */
export function stepBombchus(state: GameState, world: World): void {
  const b = state.battle!;
  for (const e of b.entities) {
    if (e.kind !== "bombchu" || isRemoved(e)) continue;
    e.tick++;
    if (--e.timer <= 0) {
      explodeBombchu(b, e);
      continue;
    }
    if (sideViewAt(b, e.y)) crawl(e, world);
    else run(e, world);
    if (!bombchuArmed(b, e)) continue;
    const box = boxAround(e.x, e.y, BOMBCHU_HALF);
    const blast = b.entities.some((x) => x.kind === "explosion" && !isRemoved(x) && x.tick <= blastTicks(x) && boxesOverlap(box, boxAround(x.x, x.y, BLAST_HALF)));
    const rival = b.entities.some((x) => x.kind === "bombchu" && x !== e && x.id < e.id && !isRemoved(x) && bombchuArmed(b, x) && boxesOverlap(box, boxAround(x.x, x.y, BOMBCHU_HALF)));
    if (blast || rival) {
      explodeBombchu(b, e);
      continue;
    }
    state.players.forEach((p, i) => {
      const f = b.fighters[i]!;
      if (!vulnerable(f) || !onGround(f) || !boxesOverlap(box, hurtbox(p))) return;
      const hit = hurtFighter(p, f, i, BOMBCHU_DAMAGE, e.x, e.y, { attacker: e.owner, cause: "bombchu", knock: KNOCK_DEFAULT });
      if (hit) b.hits.push(hit);
    });
  }
}
