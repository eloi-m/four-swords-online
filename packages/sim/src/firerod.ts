// The Fire Rod (item 6), found only in Hyrule Castle's side rooms (their generators' mask 0x97E2), and the fire it
// sets. Read from main.dol (G4SE01; not traced in battle: every value is TODO(measure) against a trace) unless said:
// - Item pressed: the press tick is an ordinary one, then the Link's state 68 (update 0x8025A15C, entry 0x8025A9C0): a
//   12-tick pose (frames 0x802677BC: 395 + 6 × direction + the index; measured facing down: 407 ×2, 408, 409, 410 ×6,
//   411, 412). On its 12th tick a fireball (FIRE kind 0, params 0x1000 | facing << 4 | player) leaves 8 px ahead
//   (up: at the Link), one at a time; it flies as traced in the adventure (adventure/gear.ts: 1.02 px/tick, easing a
//   tenth of 3 of the way to 2 px/tick each tick) until a wall bursts it, with no range limit (FIRE 0x802BB468).
// - Held from the press through that 12th tick, the pose stays on it instead: a stream of flame (FIRE kind 1) in front
//   while the button stays held, the Link walking at 1.125 px/tick with his facing kept (0x802808E8), for as long as
//   his magic lasts (+0xC08, 384, one a tick; full again whenever the button is up: 0x8027F16C); then the pose's last
//   tick, and no fireball. The stream's box (0x8025A258): 36 × 12 px from 18 px ahead (right (18…54, −6…6), left
//   (−54…−18, −6…6), down (−2…10, 12…48), up (−10…2, −56…−20) around the Link).
// - Fire on another Link (the fireball's ±6 px box, the stream's, a burning Link's body: 0x801F2B7C with FIRE's atcp
//   2, hit type 22): 2 life, 2 invincibility ticks, and he burns (state 80, entry 0x80281760, update 0x8028126C): he
//   turns away from the fire, hops (3.0 up, 0.25 px/tick² down) on the spot, then runs at 2 px/tick the way he faces,
//   turning with the stick (0x8027EB04: assumed), for 300 ticks after landing. A burning Link can't be set alight
//   again, and sets alight the Links his body meets (the FIRE kind 6 that follows him). A fireball that sets a Link
//   alight is gone (on the TV: +0x11C cleared); burning Links let it through.
// Not modelled: what else it burns (FIRE's +0x54 lights a BLZE wherever it meets a burnable tile; which tiles, and the
// eternal flames, not read), water putting a burning Link out (tile type 0x39), fireballs on orbs and soldiers.
import { CHARGE } from "./animations.ts";
import { bodyBox, subBoxesOverlap } from "./attacks.ts";
import { interrupt, makeInvincible, stopActing, vulnerable, type Fighter, type Hit } from "./combat.ts";
import { FACING_STEP, isRemoved, removeEntity, setPhase, spawnEntity, type Entity } from "./entities.ts";
import type { GameState } from "./game.ts";
import { knockedOut } from "./hammer.ts";
import { FIRE_ROD, ITEM_OVER as OVER } from "./itemframes.ts";
import { Button, moveAxis, nextFacing, SUBPX, type Facing, type PlayerState } from "./player.ts";
import { sameScreen } from "./siderooms.ts";
import { isSolidAt, type World } from "./world.ts";

export { FIRE_ROD, fireRodFrame } from "./itemframes.ts";

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

/** Fighter.shot while the stream may go on (+0xB84); ITEM_OVER once the pose's last tick was the last one. */
const STREAMING = 1;

/** Starts the Fire Rod from the press tick (items.ts useItem); the press tick itself is ordinary. */
export function startFireRod(p: PlayerState, f: Fighter): void {
  stopActing(p);
  f.move = "fireRod";
  f.moveTick = -1; // the pose's counter (+0x3FA) before its first tick
  f.charge = 0; // the stream's ticks so far
  f.shot = STREAMING;
}

/** Is this Link's stream of flame out this tick? */
export const streaming = (f: Fighter) => f.move === "fireRod" && f.shot === STREAMING && f.moveTick === FIRE_ROD.pose - 2 && f.charge > 0;

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
  if (c === FIRE_ROD.pose - 1 && f.shot === STREAMING) {
    // The stream: the pose stays on this tick while it lasts.
    streamWalk(p, buttons, world);
    if (++f.charge > FIRE_ROD.magic) f.shot = 0;
    return true;
  }
  if (c === FIRE_ROD.pose - 1 && f.charge === 0) shootFireball(state, i);
  f.moveTick = c;
  if (c >= FIRE_ROD.pose - 1) f.shot = OVER;
  return true;
}

/** Walking through the stream: the charge's speed (1.125 px/tick), the facing kept, as the bow drawn (items.ts). */
function streamWalk(p: PlayerState, buttons: number, world: World): void {
  const dx = (buttons & Button.Right ? 1 : 0) - (buttons & Button.Left ? 1 : 0);
  const dy = (buttons & Button.Down ? 1 : 0) - (buttons & Button.Up ? 1 : 0);
  p.moving = dx !== 0 || dy !== 0;
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
  spawnEntity(b, "fireball", p.x + sx * out, p.y + sy * out, { owner: i, facing: p.facing, phase: "flying", param: FIRE_ROD.startSpeed, hitMask: 1 << i });
}

function stepBurning(p: PlayerState, f: Fighter, buttons: number, world: World): boolean {
  if (f.shot === OVER) return endMove(f);
  p.held = buttons;
  p.moving = false;
  f.moveTick++;
  if (f.z > 0 || f.vz > 0) {
    f.vz -= BURNING.gravity;
    f.z += f.vz;
    if (f.z <= 0) f.z = f.vz = 0;
    return true;
  }
  p.facing = nextFacing(p.facing, buttons); // TODO(measure): 0x8027EB04 read as turning with the stick
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
  if (dx || dy) p.facing = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
  const [sx, sy] = FACING_STEP[p.facing];
  f.move = "burning";
  f.moveTick = -1;
  f.shot = 0;
  f.charge = 0;
  f.z = 0;
  f.vz = BURNING.hop;
  [f.flyX, f.flyY] = [sx * BURNING.speed, sy * BURNING.speed];
  return hit;
}

/** The stream's box this tick (1/256 px). */
export function streamBox(p: PlayerState): { left: number; top: number; right: number; bottom: number } {
  const r = STREAM_BOX[p.facing];
  return { left: p.x + r.left * SUBPX, top: p.y + r.top * SUBPX, right: p.x + r.right * SUBPX, bottom: p.y + r.bottom * SUBPX };
}

/** Fireballs fly and burst; fire (fireballs, streams, burning Links) sets the Links it meets alight (arenastep.ts). */
export function stepFire(state: GameState, world: World): Hit[] {
  const b = state.battle!, hits: Hit[] = [];
  const meets = (box: { left: number; top: number; right: number; bottom: number }, from: PlayerState | Entity, skip: number) =>
    b.fighters.findIndex((g, j) => j !== skip && vulnerable(g) && g.move !== "burning" && sameScreen(from, state.players[j]!) && subBoxesOverlap(box, bodyBox(state.players[j]!)));
  for (const e of b.entities) {
    if (e.kind !== "fireball" || isRemoved(e)) continue;
    if (e.phase === "rest") {
      if (--e.timer <= 0) removeEntity(e);
      continue;
    }
    // It shows where it appeared on its first tick and flies from the next (as the shots: projectiles.ts).
    if (++e.tick > 1) {
      const [sx, sy] = FACING_STEP[e.facing];
      [e.vx, e.vy] = [sx * e.param, sy * e.param];
      e.x += e.vx;
      e.y += e.vy;
      e.param += Math.trunc(((FIRE_ROD.speed - e.param) * FIRE_ROD.ease) / 10);
    }
    if (isSolidAt(world, Math.floor(e.x / SUBPX), Math.floor(e.y / SUBPX)) || e.tick > FIRE_ROD.lifetime) {
      setPhase(e, "rest");
      e.timer = FIRE_ROD.burst;
      continue;
    }
    const h = FIRE_ROD.half * SUBPX;
    const victim = meets({ left: e.x - h, top: e.y - h, right: e.x + h, bottom: e.y + h }, e, e.owner);
    if (victim < 0) continue;
    const hit = setAlight(state, victim, e.x, e.y, e.owner);
    if (hit) hits.push(hit);
    removeEntity(e);
  }
  b.fighters.forEach((f, i) => {
    const p = state.players[i]!;
    if (f.mode !== "active") return;
    const box = streaming(f) ? streamBox(p) : f.move === "burning" ? bodyBox(p) : null;
    if (!box) return;
    for (let j = meets(box, p, i); j >= 0; j = meets(box, p, i)) {
      const hit = setAlight(state, j, p.x, p.y, i);
      if (!hit) break;
      hits.push(hit);
    }
  });
  return hits;
}
