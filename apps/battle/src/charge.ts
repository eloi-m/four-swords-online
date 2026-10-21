// What the game shows while a Link charges his sword (main.dol: the charge state 8, entry 0x8027C4FC, update 0x8027BE74,
// exit 0x8027BC90; its counter 0x80274CB8; docs/formats/jpa.md "JPA particles"), derived from the sim's charge count:
// particles.ts draws the JPA effects, entities.ts the glint sprite. The blade keeps its normal frame on the TV: the
// glowing-sword frames (player_sob f + 1) are the GBA screens' (every other 2 ticks once full, 0x80274CB8 +0x404).
import { CHARGE, type Facing, type Fighter, type PlayerState } from "@fso/sim";

/**
 * The counter (Link +0x403) starts at 1 on the charge's first tick and goes up by one a tick; it is the sim's
 * `actionTick` (Dolphin: state 8 from frame 20 with 1, 48 on frame 67, then 49 and no further with the level-1 sword).
 * On 48 (the tick after a release would first spin, `CHARGE.fullTicks`) the charge is full.
 */
export const CHARGE_FULL = CHARGE.fullTicks + 1;

export const SWORD_CHARGE = {
  /**
   * Charging (counter < 48): 623 (layer 0, sublayer 1, lift) along the blade, moved every tick: 6 + ⌊14 c / 48⌋ px
   * ahead of the Link (c the counter), 4 px right of him facing down, 4 left and 5 further facing up. Full, its
   * emission stops (its particles play out where it was).
   */
  sparkle: 623,
  /** Full: 203 and 204 (layer 0, sublayer −1, lift) at the tip, (x, y, z) from the Link by facing (table 0x8046BCE8). */
  burst: [203, 204] as readonly number[],
  tip: { right: [18, 0, 2], left: [-18, 0, 2], down: [4, 18, 2], up: [-4, -18, 2] } as const,
  /**
   * Full: the blade's glow until the charge ends, 624 sideways and 626 facing down or up (625 / 627 with the Four
   * Sword), at the Link's own layer and sublayer − 1 (0, −1 in battle), no lift, (x, y) from him by facing.
   */
  glow: { 1: { side: 624, upright: 626 }, 2: { side: 625, upright: 627 } } as const,
  glowAt: { right: [13, 0], left: [-13, 0], down: [4, 9], up: [-4, -14] } as const,
  /**
   * Full: a PEFF kind 2 actor (params 8 | player) at the tip, drawn on the TV too: enemy_both2 683 when made, then
   * by its tick count (0x8022A038) 683 to 2, 684 to 4, 685 to 6, 686 to 8, 683 to 10, gone after (or with the charge).
   */
  glint: { frames: [683, 683, 683, 684, 684, 685, 685, 686, 686, 683, 683] as readonly number[] },
};

/** Link i's charge counter (the game's +0x403) while he charges in the round, else 0. */
export function chargeCount(p: PlayerState, f: Fighter): number {
  return f.mode === "active" && p.action === "charge" ? p.actionTick : 0;
}

/** The charging sparkle's place (dx, dy) from the Link for counter `c` (update 0x8027BE74). */
export function sparkleAt(facing: Facing, c: number): [number, number] {
  const k = 6 + Math.trunc((14 * Math.min(c, CHARGE_FULL)) / 48);
  switch (facing) {
    case "right":
      return [k, 0];
    case "left":
      return [-k, 0];
    case "down":
      return [4, k - 4];
    case "up":
      return [-4, -(k + 1)];
  }
}

/** The glint's enemy_both2 frame `age` ticks after the charge filled, -1 once it's gone. */
export function glintFrame(age: number): number {
  return age >= 0 && age < SWORD_CHARGE.glint.frames.length ? SWORD_CHARGE.glint.frames[age]! : -1;
}
