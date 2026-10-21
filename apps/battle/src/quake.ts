// The screen quakes (main.dol 0x802D79E8 asks for one: per screen, a strength along x and along y; the stage's update
// 0x802DD54C moves the TV's view by it, its sign flipping every 2 frames, and takes 0.2 px off it each frame). Battle's
// are all along y: a bombchu going off 4 (BMTY 0x8032626C), the giant bomb landing 8 (BBMB 0x80342D60) and its blast 16
// (0x8034338C). Only the TV quakes here (a side room's GBA inset doesn't). Read from the state, as everything drawn is.
import { BIG_BOMB, BIG_BOMB_SQUASH, BLAST_BOMBCHU, BLAST_GIANT, screenAt, type GameState } from "@fso/sim";

export const QUAKE_DECAY = 0.2;
export const QUAKE = { bombchu: 4, giantBombLanding: 8, giantBomb: 16 } as const;

/** How far the TV's view is shaken along y this tick (px; 0 when nothing quakes). */
export function quakeOffset(game: GameState): number {
  const b = game.battle;
  if (!b) return 0;
  let strength = 0;
  const shake = (start: number, ticks: number) => (strength = Math.max(strength, start - QUAKE_DECAY * ticks));
  for (const e of b.entities) {
    if (e.hp < 0 || screenAt(e.y) !== 0) continue;
    if (e.kind === "explosion" && e.param & BLAST_GIANT) shake(QUAKE.giantBomb, e.tick);
    else if (e.kind === "explosion" && e.param & BLAST_BOMBCHU) shake(QUAKE.bombchu, e.tick);
    else if (e.kind === "bigBomb" && e.param === BIG_BOMB.squashing) shake(QUAKE.giantBombLanding, e.tick);
    else if (e.kind === "bigBomb" && e.param === BIG_BOMB.burning) shake(QUAKE.giantBombLanding, BIG_BOMB_SQUASH + e.tick);
  }
  if (strength <= QUAKE_DECAY) return 0;
  return game.tick & 2 ? -strength : strength;
}
