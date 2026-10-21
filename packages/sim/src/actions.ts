// Sword actions on top of walking, as measured in Dolphin (docs/measurements/walking-and-sword.md). A Sword press doesn't interrupt
// the tick it is seen on (Link walks or stands as usual); the attack starts on the next tick and depends on how he
// was moving: walking with the stick pushed (on either tick) swings, the stick neutral on both ticks stabs, and
// standing with the stick pushed lunges that way. Presses during an attack are ignored. Holding the button through
// the attack charges (slow walk, facing locked); releasing after a full charge spins. Like the game, the next action
// is decided from the previous tick's buttons, so every change shows one tick after the input that caused it.
import { CHARGE, LUNGE, PLAYER_ANIMATIONS, SPIN, STAB, SWING, SWORD_BOXES } from "./animations.ts";
import { Button, moveAxis, nextFacing, playerFrame, stepPlayer, SUBPX, type PlayerState } from "./player.ts";
import type { World } from "./world.ts";

/**
 * "swing", "stab" and "lunge" with actionTick 0 are presses waiting for the next tick to pick the attack. "tink" is the
 * sword bouncing off another Link's (a clash in Shadow Battle, combat.ts): the held-sword-in-a-wall pose, 15 ticks.
 */
export type Action = "none" | "swing" | "stab" | "lunge" | "charge" | "spin" | "tink";

const sum = (ticks: readonly number[]) => ticks.reduce((a, b) => a + b, 0);
export const SWING_TICKS = sum(SWING.ticks); // 8
export const STAB_TICKS = sum(STAB.ticks); // 8
export const LUNGE_TICKS = sum(LUNGE.ticks); // 31
export const SPIN_TICKS = sum(SPIN.ticks); // 26
/** The clash's recoil (state 55, traced: 2, 4, 4, 5 ticks on 273-276 right, 277-280 left, 281-284 down, 285-288 up). */
export const TINK = { frames: PLAYER_ANIMATIONS.swordTink.frames as Readonly<Record<string, readonly number[]>>, ticks: [2, 4, 4, 5] as readonly number[] };
export const TINK_TICKS = sum(TINK.ticks); // 15
const ATTACK_TICKS: Partial<Record<Action, number>> = { swing: SWING_TICKS, stab: STAB_TICKS, lunge: LUNGE_TICKS };

const DIRECTIONS = Button.Up | Button.Down | Button.Left | Button.Right;
const STEP: Record<string, [number, number]> = { right: [1, 0], left: [-1, 0], down: [0, 1], up: [0, -1] };

export const isAttack = (action: Action) => action === "swing" || action === "stab" || action === "lunge" || action === "spin";

function become(p: PlayerState, action: Action, tick: number): void {
  p.action = action;
  p.actionTick = tick;
  p.moving = false;
  p.walkTicks = 0;
}

/** Advances Link one 60 Hz tick: sword actions, or plain walking. Mutates and returns `p`. */
export function stepLink(p: PlayerState, buttons: number, world: World): PlayerState {
  const last = p.held; // what the game's previous update saw
  p.held = buttons;
  switch (p.action) {
    case "none":
      return idle(p, buttons, last, world);
    case "swing":
    case "stab":
    case "lunge": {
      if (p.actionTick === 0) return startAttack(p, buttons, last, world);
      if (p.actionTick >= ATTACK_TICKS[p.action]!) {
        if (last & Button.Sword) {
          become(p, "charge", 0);
          return charge(p, buttons, world);
        }
        become(p, "none", 0);
        return idle(p, buttons, last, world);
      }
      p.actionTick++;
      if (p.action === "lunge" && p.actionTick <= LUNGE.moveTicks) lunge(p, world);
      return p;
    }
    case "charge":
      if (!(last & Button.Sword)) {
        const full = p.actionTick >= CHARGE.fullTicks;
        become(p, full ? "spin" : "none", full ? 1 : 0);
        return full ? p : idle(p, buttons, last, world);
      }
      return charge(p, buttons, world);
    case "spin":
      if (p.actionTick >= SPIN_TICKS) {
        become(p, "none", 0);
        return idle(p, buttons, last, world);
      }
      p.actionTick++;
      return p;
    case "tink":
      if (p.actionTick >= TINK_TICKS) {
        become(p, "none", 0);
        return idle(p, buttons, last, world);
      }
      p.actionTick++;
      return p;
  }
}

// Plain walking; a new press is noted (the attack starts next tick) without interrupting this tick.
function idle(p: PlayerState, buttons: number, last: number, world: World): PlayerState {
  const walking = p.moving;
  if (buttons & ~last & Button.Sword) {
    p.action = walking ? "swing" : "lunge"; // provisional: startAttack settles it
    p.actionTick = 0;
  }
  return stepPlayer(p, buttons, world);
}

// The tick after the press: the stick on either tick makes it a swing (walking, facing kept) or a lunge (standing,
// facing the stick); neither, a stab. TODO(measure): a diagonal stick for the lunge; walking with the stick turned.
function startAttack(p: PlayerState, buttons: number, last: number, world: World): PlayerState {
  const stick = buttons & DIRECTIONS || last & DIRECTIONS;
  if (!stick) become(p, "stab", 1);
  else if (p.action === "swing") become(p, "swing", 1);
  else {
    p.facing = nextFacing(p.facing, stick);
    become(p, "lunge", 1);
    lunge(p, world);
  }
  return p;
}

function lunge(p: PlayerState, world: World): void {
  const [sx, sy] = STEP[p.facing]!;
  moveAxis(p, world, sx * LUNGE.speed, "x");
  moveAxis(p, world, sy * LUNGE.speed, "y");
}

// Charging: counts the ticks the button stays held, and walks at CHARGE speed with the facing locked, straight from
// the first tick (no turn tick). TODO(measure): the sword hitting a wall (state 55, swordTink) isn't modelled.
function charge(p: PlayerState, buttons: number, world: World): PlayerState {
  if (buttons & Button.Sword) p.actionTick++;
  const dx = (buttons & Button.Right ? 1 : 0) - (buttons & Button.Left ? 1 : 0);
  const dy = (buttons & Button.Down ? 1 : 0) - (buttons & Button.Up ? 1 : 0);
  p.moving = dx !== 0 || dy !== 0;
  p.walkTicks = p.moving ? (p.walkTicks + 1) % sum(CHARGE.walkTicks) : 0;
  if (!p.moving) return p;
  const straight = dx === 0 || dy === 0;
  const speed = straight ? CHARGE.speed : CHARGE.speedDiagonal;
  moveAxis(p, world, dx * speed, "x", straight);
  moveAxis(p, world, dy * speed, "y", straight);
  return p;
}

/** Index of the animation frame showing `tick` ticks in, given per-frame durations. */
function frameAt(ticks: readonly number[], tick: number): number {
  for (let i = 0; i < ticks.length; i++) {
    tick -= ticks[i]!;
    if (tick < 0) return i;
  }
  return ticks.length - 1;
}

const ANIMATION = { swing: SWING, stab: STAB, lunge: LUNGE, spin: SPIN } as const;

/** Sprite frame in player_sob for Link's current pose, actions included. */
export function linkFrame(p: PlayerState): number {
  switch (p.action) {
    case "swing":
    case "stab":
    case "lunge":
    case "spin": {
      if (p.actionTick === 0) return playerFrame(p); // the press tick still shows walking or standing
      const a = ANIMATION[p.action];
      return a.frames[p.facing][frameAt(a.ticks, p.actionTick - 1)]!;
    }
    case "charge":
      return p.moving ? CHARGE.walk[p.facing][frameAt(CHARGE.walkTicks, p.walkTicks)]! : CHARGE.stand[p.facing];
    case "tink":
      return p.actionTick === 0 ? playerFrame(p) : TINK.frames[p.facing]![frameAt(TINK.ticks, p.actionTick - 1)]!;
    default:
      return playerFrame(p);
  }
}

/**
 * The lunge's little hop (traced in battle): up at 1 px/tick falling 0.25 px/tick², peaking at 2.5 px, down again on its
 * 9th tick. 1/256 px; for drawing only (the sim keeps Link on the ground).
 */
export function lungeHeight(p: PlayerState): number {
  if (p.action !== "lunge" || p.actionTick < 1 || p.actionTick > 8) return 0;
  const n = p.actionTick;
  return SUBPX * n - (SUBPX / 8) * n * (n - 1);
}

/** A release now would spin (the game flashes the sword; renderers can use this for that). */
export function isFullyCharged(p: PlayerState): boolean {
  return p.action === "charge" && p.actionTick >= CHARGE.fullTicks;
}

export const CHARGE_FLASH_TICKS = 4;

/**
 * linkFrame for display: once fully charged, alternates with the glowing-sword frames every CHARGE_FLASH_TICKS. A stand-in
 * for renderers without the charge's effects: on the TV the game keeps the normal frame (traced: 83 all through a charge
 * facing down) and shows the charge with effects (Shadow Battle draws them: apps/battle charge.ts); the glowing frames
 * are the GBA screens' (main.dol 0x80274CB8).
 */
export function linkDisplayFrame(p: PlayerState, tick: number): number {
  const frame = linkFrame(p);
  return isFullyCharged(p) && Math.floor(tick / CHARGE_FLASH_TICKS) % 2 === 0 ? frame + CHARGE.glowOffset : frame;
}

/** The sword's hitbox in world pixels (inclusive) while it hits: during swings, stabs, lunges and spins. */
export function swordHitbox(p: PlayerState): { left: number; top: number; right: number; bottom: number } | null {
  if (!isAttack(p.action) || p.actionTick === 0) return null;
  const box = SWORD_BOXES[linkFrame(p)];
  if (!box) return null;
  const px = Math.floor(p.x / SUBPX), py = Math.floor(p.y / SUBPX);
  return { left: px + box[0], top: py + box[1], right: px + box[2], bottom: py + box[3] };
}
