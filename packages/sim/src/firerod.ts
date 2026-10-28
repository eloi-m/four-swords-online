// The Fire Rod (item 6), found only in Hyrule Castle's side rooms (their generators' mask 0x97E2), and the fire it
// sets. Traced in Shadow Battle (docs/measurements/battle-combat.md "The Magic Hammer and the Fire Rod, traced"; the
// addresses from main.dol, G4SE01):
// - Item pressed: the press tick is an ordinary one, then the Link's state 68 (update 0x8025A15C, entry 0x8025A9C0): a
//   13-tick pose (its counter +0x3FA 0…12; frames 0x802677BC: 395 + 6 × direction + the index; facing right 395 ×2,
//   396, 397, 398 ×6, 399, 400 ×2). On its 12th tick a fireball (FIRE kind 0, params 0x1000 | facing << 4 | player)
//   leaves 8 px ahead (up: at the Link), one at a time: its speed from 0 eases 0.3 of the way to 2 px/tick before each
//   move, the first on the tick it appears (0.6, 1.02, 1.31 …), with no range limit (FIRE 0x802BB468).
// - Held from the press through that 12th tick, the pose stays on it instead: a stream of flame (FIRE kind 1) while the
//   button stays held, the rod held out (466…, walking on the charge's cycle), the Link walking at 1.125 px/tick with
//   his facing kept (0x802808E8), for as long as his magic lasts (+0xC08, 384, one a tick; full again once the button
//   is up: 0x8027F16C); then the pose's last two ticks (one more when the magic ran out), and a fireball only when the
//   stream's flame wasn't out. The stream's box (0x8025A258): 36 × 12 px from 18 px ahead (right (18…54, −6…6), left
//   (−54…−18, −6…6), down (−2…10, 12…48), up (−10…2, −56…−20)) around where the Link stood a tick before.
// - Fire on another Link (the fireball's ±6 px box, the stream's, a burning Link's ±7 px body: 0x801F2B7C with FIRE's
//   atcp 2, hit type 22): 2 life, 2 invincibility ticks, and he burns (state 80, entry 0x80281760, update 0x8028126C):
//   the hit tick still shows him as he was; then he turns away from the fire, hops (3.0 up, 0.25 px/tick² down) on the
//   spot, then runs at 2 px/tick the way he faces, the stick turning him at once (0x8027EB04, as walking turns: a
//   diagonal keeps the facing it holds, else goes sideways), for 300 ticks after landing, into pits as walking does;
//   standing in shallow water (tile type 0x39) puts him out, walls only stop him. A burning Link can't be set alight
//   again, and sets alight the Links his flame (FIRE kind 6, where he stood a tick before) meets. A fireball that sets
//   a Link alight is gone (on the TV: +0x11C cleared); burning Links let it through.
// - Fire meeting a wall leaves a BLZE flame that hurts any Link (BLAZE): a fireball bursts, the BLZE on the tile beyond
//   it; the stream's flame bursts at its middle and comes back 60 ticks later; a burning Link's bursts where it is (and
//   usually hurts him: that ends his run). Fireballs and the stream burn the bushes they pass (a BLZE on each).
// - Fire on Hyrule Castle's soldiers takes 32 of their life (FIRE_ON_SOLDIERS): a fireball is spent on one and knocks
//   it along its flight, the stream knocks it nowhere. Orbs and pots are nothing to it (traced): a fireball flies
//   through an orb, and bursts on a pot as on a wall (its BLZE on the pot's tile, the pot left whole).
// Not modelled: a burning Link's flame and BLZE flames on soldiers, the eternal flames and burnable tiles other than
// bushes, the stream's flame lingering two ticks after the button is let go.
import { CHARGE } from "./animations.ts";
import { bodyBox, subBoxesOverlap } from "./attacks.ts";
import type { BattleState } from "./battle.ts";
import { hurtFighter, interrupt, KNOCK_SLOW, makeInvincible, stopActing, vulnerable, type Fighter, type Hit } from "./combat.ts";
import { FACING_STEP, isRemoved, removeEntity, setPhase, spawnEntity, TILE, tileIndexAt, type Entity } from "./entities.ts";
import type { GameState } from "./game.ts";
import { knockedOut } from "./hammer.ts";
import { touching } from "./hazards.ts";
import { FIRE_ROD, ITEM_OVER as OVER, STREAMING, streaming } from "./itemframes.ts";
import { Button, moveAxis, nextFacing, SUBPX, type Facing, type PlayerState } from "./player.ts";
import { sameScreen } from "./siderooms.ts";
import { bushesIn, strikeEntity, strikeHalf } from "./strike.ts";
import { CELL, isSolidAt, surfaceAt, type World } from "./world.ts";

export { FIRE_ROD, fireRodFrame, streaming } from "./itemframes.ts";

export const BURNING = {
  /** The hop (table 0x8046BEA8: 3.0 up) and its fall (0.25 px/tick²). */
  hop: 3 * SUBPX,
  gravity: 64,
  /** The run: 2 px/tick, for this many ticks on the ground. */
  speed: 2 * SUBPX,
  ticks: 300,
} as const;

/** The stream's box around the Link (px, inclusive), by facing. */
export const STREAM_BOX: Readonly<Record<Facing, { left: number; top: number; right: number; bottom: number }>> = {
  right: { left: 18, top: -6, right: 54, bottom: 6 },
  left: { left: -54, top: -6, right: -18, bottom: 6 },
  down: { left: -2, top: 12, right: 10, bottom: 48 },
  up: { left: -10, top: -56, right: 2, bottom: -20 },
};

/** Starts the Fire Rod from the press tick (items.ts useItem); the press tick itself is ordinary. */
export function startFireRod(p: PlayerState, f: Fighter): void {
  stopActing(p);
  f.move = "fireRod";
  f.moveTick = -1; // the pose's counter (+0x3FA) before its first tick
  f.charge = 0; // the stream's ticks so far
  f.shot = STREAMING;
}

/** The Fire Rod's pose and a burning Link's run (moves.ts). Returns false when the Link isn't in either. */
export function stepFireRod(state: GameState, i: number, buttons: number, world: World): boolean {
  const p = state.players[i]!, f = state.battle!.fighters[i]!;
  if (f.move === "burning") return stepBurning(p, f, buttons, world);
  if (f.move !== "fireRod") return false;
  if (f.shot === OVER) return endMove(f);
  p.held = buttons;
  if (f.shot === STREAMING && !(buttons & Button.Item)) f.shot = 0;
  const c = f.moveTick + 1; // this tick's counter
  p.moving = false;
  if (c === FIRE_ROD.fire && f.shot === STREAMING) {
    // The stream: the pose stays on this counter while it lasts. Its flame (FIRE kind 1) trails him by a tick, as a
    // burning Link's does (stepFire).
    if (f.charge === 0) [f.fireX, f.fireY, f.fireWait] = [p.x, p.y, 0];
    streamWalk(p, buttons, world);
    if (++f.charge > FIRE_ROD.magic) f.shot = 0;
    return true;
  }
  // A fireball when no stream's flame is out (traced: a tap, or letting go while the stream's was out after a wall).
  if (c === FIRE_ROD.fire && (f.charge === 0 || f.fireWait > 0)) shootFireball(state, i);
  f.moveTick = c;
  if (c >= FIRE_ROD.pose - 1) f.shot = OVER;
  return true;
}

const WALK_CYCLE = CHARGE.walkTicks.reduce((a, b) => a + b, 0);

/** Walking through the stream: the charge's speed (1.125 px/tick) and walk cycle, the facing kept (traced). */
function streamWalk(p: PlayerState, buttons: number, world: World): void {
  const dx = (buttons & Button.Right ? 1 : 0) - (buttons & Button.Left ? 1 : 0);
  const dy = (buttons & Button.Down ? 1 : 0) - (buttons & Button.Up ? 1 : 0);
  p.moving = dx !== 0 || dy !== 0;
  p.walkTicks = p.moving ? (p.walkTicks + 1) % WALK_CYCLE : 0; // (the walk frames: itemframes.ts)
  if (!p.moving) return;
  const straight = dx === 0 || dy === 0, speed = straight ? CHARGE.speed : CHARGE.speedDiagonal;
  moveAxis(p, world, dx * speed, "x", straight);
  moveAxis(p, world, dy * speed, "y", straight);
}

function endMove(f: Fighter): false {
  f.move = "none";
  f.moveTick = 0;
  f.shot = -1;
  return false;
}

function shootFireball(state: GameState, i: number): void {
  const b = state.battle!, p = state.players[i]!;
  if (b.entities.some((e) => e.kind === "fireball" && e.owner === i && e.phase === "flying" && !isRemoved(e))) return;
  const [sx, sy] = FACING_STEP[p.facing], out = p.facing === "up" ? 0 : FIRE_ROD.out * SUBPX;
  spawnEntity(b, "fireball", p.x + sx * out, p.y + sy * out, { owner: i, facing: p.facing, phase: "flying", param: 0, hitMask: 1 << i });
}

function stepBurning(p: PlayerState, f: Fighter, buttons: number, world: World): boolean {
  if (f.shot === OVER) return endMove(f);
  p.held = buttons;
  p.moving = false;
  // He turns away from the fire after the hit tick, which still shows the pose he was in.
  if (++f.moveTick === 0) {
    p.facing = f.flyX > 0 ? "right" : f.flyX < 0 ? "left" : f.flyY > 0 ? "down" : "up";
    [f.fireX, f.fireY] = [p.x, p.y]; // his flame (FIRE kind 6) appears
  }
  if (f.z > 0 || f.vz > 0) {
    f.vz -= BURNING.gravity;
    f.z += f.vz;
    if (f.z <= 0) f.z = f.vz = 0;
    return true;
  }
  // Shallow water (tile type 0x39) under him puts him out (traced: standing from that tick).
  if (surfaceAt(world, Math.floor(p.x / SUBPX), Math.floor(p.y / SUBPX)) === "shallow") return endMove(f);
  p.facing = nextFacing(p.facing, buttons); // the stick (0x8027EB04), as walking turns (traced)
  moveAxis(p, world, f.flyX, "x", true);
  moveAxis(p, world, f.flyY, "y", true);
  const [sx, sy] = FACING_STEP[p.facing];
  [f.flyX, f.flyY] = [sx * BURNING.speed, sy * BURNING.speed];
  if (++f.charge >= BURNING.ticks) f.shot = OVER;
  return true;
}

/**
 * Hit type 22 from fire at (x, y) (1/256 px): 2 life and 2 invincibility ticks, and the Link burns (state 80), turned
 * away from the fire. Nothing on a Link burning already. Returns the hit, or null.
 */
export function setAlight(state: GameState, victim: number, x: number, y: number, attacker: number): Hit | null {
  const p = state.players[victim]!, f = state.battle!.fighters[victim]!;
  if (!vulnerable(f) || f.move === "burning") return null;
  f.hearts = Math.max(0, f.hearts - FIRE_ROD.damage);
  makeInvincible(f, FIRE_ROD.invincible);
  interrupt(p, f);
  f.pushX = f.pushY = f.slideX = f.slideY = 0;
  const hit: Hit = { attacker, victim, blocked: false, damage: FIRE_ROD.damage, cause: "fire" };
  if (knockedOut(f)) return hit;
  const dx = p.x - x, dy = p.y - y;
  const away = dx || dy ? (Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up") : p.facing;
  const [sx, sy] = FACING_STEP[away];
  f.move = "burning";
  f.fireWait = 0;
  f.moveTick = -1;
  f.shot = 0;
  f.charge = 0;
  f.z = 0;
  f.vz = BURNING.hop;
  [f.flyX, f.flyY] = [sx * BURNING.speed, sy * BURNING.speed];
  return hit;
}

/** The stream's box this tick (1/256 px). */
export function streamBox(p: Pick<PlayerState, "x" | "y" | "facing">): { left: number; top: number; right: number; bottom: number } {
  const r = STREAM_BOX[p.facing];
  return { left: p.x + r.left * SUBPX, top: p.y + r.top * SUBPX, right: p.x + r.right * SUBPX, bottom: p.y + r.bottom * SUBPX };
}

/**
 * BLZE, the flame fire leaves where it meets a wall (a fireball on the tile beyond, a stream's flame at its middle, a
 * burning Link's where it trails him) or a bush it burns (the bush's middle). Traced: it lasts 30 ticks (+0x254) and
 * hurts any Link its ±6 px box (0x802BD25C) meets in its first 24 (+0x240 = 1), its maker too: 0x801F2B7C with BLZE's
 * atcp 2, hit type 7 (0.75 px/tick, the 4.0 hop), 60 invincibility ticks.
 */
export const BLAZE = { ticks: 30, hurtTicks: 24, half: 6, damage: 2 } as const;

/** Ticks the stream's flame stays out after it burst on a wall (Link +0xB8C = 60, 0x8025A6D0; traced: 61 apart). */
export const STREAM_WAIT = 60;

/** The stream's flame's middle around the Link (px), where its BLZE goes (traced right: x + 36). */
const STREAM_MID: Readonly<Record<Facing, readonly [number, number]>> = { right: [36, 0], left: [-36, 0], down: [4, 30], up: [-4, -38] };

/** A fireball's BLZE: the tile it's on (16 px grid) + this, by direction (0x802BAE78: the tile beyond it). */
const BURST_AT: Readonly<Record<Facing, readonly [number, number]>> = { right: [24, 8], left: [-8, 8], down: [8, 16], up: [8, -8] };

type SubBox = { left: number; top: number; right: number; bottom: number };

/** Does a box (1/256 px, inclusive) overlap a solid 8 px cell? Bush tiles are left out when the fire burns them. */
function meetsWall(world: World, b: BattleState, box: SubBox, burnsBushes: boolean): boolean {
  const cell = CELL * SUBPX;
  for (let cy = Math.floor(box.top / cell); cy <= Math.floor(box.bottom / cell); cy++) {
    for (let cx = Math.floor(box.left / cell); cx <= Math.floor(box.right / cell); cx++) {
      if (!isSolidAt(world, cx * CELL, cy * CELL)) continue;
      if (burnsBushes && b.props.bushes.includes(tileIndexAt(cx * CELL, cy * CELL))) continue;
      return true;
    }
  }
  return false;
}

/** The bushes a fireball's or a stream's box meets burn (FIRE +0x54, 0x802BABEC: a BLZE on each; the tile cleared). */
function burnBushes(b: BattleState, box: SubBox, owner: number): void {
  const px = { left: Math.floor(box.left / SUBPX), top: Math.floor(box.top / SUBPX), right: Math.floor(box.right / SUBPX), bottom: Math.floor(box.bottom / SUBPX) };
  for (const tile of bushesIn(b, px)) {
    b.cut.push(tile);
    const x = (tile % 32) * TILE + TILE / 2, y = Math.floor(tile / 32) * TILE + TILE / 2;
    spawnBlaze(b, x * SUBPX, y * SUBPX, owner);
  }
}

/**
 * Fire on Hyrule Castle's sword soldiers (SLR1; traced: fireballs from below, the side and above, and the stream, on one
 * whose life was poked to 100 and 16): 32 off its life (FIRE's hit on an enemy; the battle's soldiers have 1 to 20:
 * fire kills any), and stunned as by a sword (strike.ts strikeEntity: 16 px/tick × 0.78, 25 ticks), knocked the way
 * the fireball flew (traced: right, up and down, whatever the soldier's side) and nowhere by the stream's flame (it
 * stood, struck again 25 ticks later, every 25). A fireball is spent on one; one stunned lets it through (assumed).
 * Its box against fire, around its anchor (px): traced met at 9.9 px across, 10.6 above and 6.7 below, not at 11.6,
 * 12.6 and 8.7. The archers, the captain and the ball-and-chain soldier are taken alike in their strike boxes
 * (TODO(measure): not reached in Dolphin).
 */
export const FIRE_ON_SOLDIERS = { damage: 32, box: { left: -5, top: -6, right: 5, bottom: 2 } } as const;
const SOLDIERS: ReadonlySet<string> = new Set(["soldier", "bowSoldier", "captain", "ballSoldier"]);

/** The soldiers a fire box meets, not stunned (1/256 px). */
function soldiersIn(state: GameState, box: SubBox, from: PlayerState | Entity): Entity[] {
  return state.battle!.entities.filter((e) => {
    if (!SOLDIERS.has(e.kind) || isRemoved(e) || !sameScreen(from, e)) return false;
    if (e.kind === "ballSoldier" ? e.timer > 0 : e.phase === "stun") return false;
    const h = strikeHalf(e), r = e.kind === "soldier" ? FIRE_ON_SOLDIERS.box : { left: -h, top: -h, right: h, bottom: h };
    return subBoxesOverlap(box, { left: e.x + r.left * SUBPX, top: e.y + r.top * SUBPX, right: e.x + r.right * SUBPX, bottom: e.y + r.bottom * SUBPX });
  });
}

/** Fire strikes a soldier, knocked along (dx, dy) (none: stunned where it stands). */
function burnSoldier(b: BattleState, e: Entity, dx: number, dy: number): void {
  strikeEntity(b, e, FIRE_ON_SOLDIERS.damage >> 1, e.x - dx, e.y - dy); // (strikeEntity doubles a Link's share)
  if (dx || dy || isRemoved(e)) return;
  e.vx = e.vy = 0;
}

function spawnBlaze(b: BattleState, x: number, y: number, owner: number): void {
  spawnEntity(b, "blaze", x, y, { owner, timer: BLAZE.ticks });
}

/**
 * Fireballs fly and burst; fire (fireballs, streams, burning Links) sets the Links it meets alight, burns bushes and
 * leaves BLZE flames on walls, which hurt (arenastep.ts).
 */
export function stepFire(state: GameState, world: World): Hit[] {
  const b = state.battle!, hits: Hit[] = [];
  const meets = (box: SubBox, from: PlayerState | Entity, skip: number) =>
    b.fighters.findIndex((g, j) => j !== skip && vulnerable(g) && g.move !== "burning" && sameScreen(from, state.players[j]!) && subBoxesOverlap(box, bodyBox(state.players[j]!)));
  for (const e of b.entities) {
    if (e.kind !== "fireball" || isRemoved(e)) continue;
    if (e.phase === "rest") {
      if (--e.timer <= 0) removeEntity(e);
      continue;
    }
    // Its speed eases toward 2 px a tick, then it moves, from the tick it appears on (traced; rounded up, it keeps
    // within 0.1 px of the game's float path).
    e.tick++;
    e.param += Math.ceil(((FIRE_ROD.speed - e.param) * FIRE_ROD.ease) / 10);
    const [sx, sy] = FACING_STEP[e.facing];
    [e.vx, e.vy] = [sx * e.param, sy * e.param];
    e.x += e.vx;
    e.y += e.vy;
    const h = FIRE_ROD.half * SUBPX, box = { left: e.x - h, top: e.y - h, right: e.x + h, bottom: e.y + h };
    // Bushes burn as it passes (traced: it flew on); a wall bursts it, a BLZE on the tile beyond (traced).
    burnBushes(b, box, e.owner);
    if (meetsWall(world, b, box, true) || e.tick > FIRE_ROD.lifetime) {
      const [bx, by] = BURST_AT[e.facing], tile = TILE * SUBPX;
      spawnBlaze(b, Math.floor(e.x / tile) * tile + bx * SUBPX, Math.floor(e.y / tile) * tile + by * SUBPX, e.owner);
      setPhase(e, "rest");
      e.timer = FIRE_ROD.burst;
      continue;
    }
    const victim = meets(box, e, e.owner);
    if (victim < 0) {
      const soldier = soldiersIn(state, box, e)[0];
      if (!soldier) continue;
      burnSoldier(b, soldier, sx, sy);
      removeEntity(e);
      continue;
    }
    const hit = setAlight(state, victim, e.x, e.y, e.owner);
    if (hit) hits.push(hit);
    removeEntity(e);
  }
  b.fighters.forEach((f, i) => {
    const p = state.players[i]!;
    if (f.mode !== "active") return;
    // A stream's flame and a burning Link's trail him by a tick: they're where he stood at the end of the last one
    // (traced), and set alight from there; a wall bursts them into a BLZE (traced), the stream's back 60 ticks later.
    const at = { x: f.fireX, y: f.fireY, facing: p.facing };
    [f.fireX, f.fireY] = [p.x, p.y];
    const stream = streaming(f), burning = f.move === "burning" && f.moveTick >= 0 && f.fireWait >= 0;
    if (stream && f.fireWait > 0) {
      f.fireWait--;
      return;
    }
    const box = stream ? streamBox(at) : burning ? bodyBox(at) : null;
    if (!box) return;
    if (stream) {
      burnBushes(b, box, i);
      for (const soldier of soldiersIn(state, box, p)) burnSoldier(b, soldier, 0, 0);
    }
    if (meetsWall(world, b, box, stream)) {
      const [mx, my] = stream ? STREAM_MID[at.facing] : [0, 0];
      spawnBlaze(b, at.x + mx * SUBPX, at.y + my * SUBPX, i);
      f.fireWait = stream ? STREAM_WAIT : -1;
      return;
    }
    for (let j = meets(box, p, i); j >= 0; j = meets(box, p, i)) {
      const hit = setAlight(state, j, at.x, at.y, i);
      if (!hit) break;
      hits.push(hit);
    }
  });
  // The BLZE flames (the new ones too: they hurt on the tick they appear, traced).
  for (const e of b.entities) {
    if (e.kind !== "blaze" || isRemoved(e)) continue;
    if (++e.tick <= BLAZE.hurtTicks) {
      const h = BLAZE.half, x = Math.floor(e.x / SUBPX), y = Math.floor(e.y / SUBPX);
      for (const j of touching(state, { left: x - h, top: y - h, right: x + h, bottom: y + h })) {
        if (!sameScreen(e, state.players[j]!)) continue;
        const hit = hurtFighter(state.players[j]!, b.fighters[j]!, j, BLAZE.damage, e.x, e.y, { attacker: e.owner, cause: "fire", knock: KNOCK_SLOW });
        if (hit) hits.push(hit);
      }
    }
    if (--e.timer <= 0) removeEntity(e);
  }
  return hits;
}
