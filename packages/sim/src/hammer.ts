// The Magic Hammer (item 5), found only in Hyrule Castle's side rooms (their generators' mask 0x97E2). Read from
// main.dol (G4SE01; nothing here traced in Dolphin yet: every value is TODO(measure) against a trace), the Link's
// state 60 (update 0x8025B3F0, its frames 0x80267818) and the hit it deals (0x80232A0C → 0x80256F44, the hit method
// 0x802710C8 types 20/21, state 64's update 0x80284294):
// - Item pressed: the press tick is an ordinary one, then the state. While the button stays held from the start the
//   hammer is raised and charges (+0x3FC counts up; the Link turns with the stick, 0x8027EB04: assumed), charged at
//   48 ticks (+0xB9B; 25 under HAYA, an adventure actor). Let go, a counter (+0x3FA) runs from 1: the pound comes
//   down on 5 and its box is live on 5 and 6 (+0xB99); the pose ends on 17 (charged: 30).
// - The pound's box: ±8 px around the Link + (20, 7) right, (−20, 7) left, (0, 12) down, (0, −8) up (charged: 24, 24,
//   11, −6; table 0x8046B0C0). Another Link on the same screen whose body meets it, not already flattened, takes 2
//   life (charged: 4; type 20 / 21, through no shield) and is flattened: no knockback, 60 invincibility ticks, state
//   64 for 11 ticks (his height 1.0 down to 0.5 by 0.05 a tick), then flat (height 0.5) until a timer of 300 ticks
//   from the hit runs out (charged: 600), growing back 0.05 a tick. While flat the Action button does nothing
//   (0x80261480: no lift, roll or grab) and the hammer can't hit him again (0x8023A3DC).
// - A charged pound is a ground impact (+0xB9A on the counter's 18 and 19): it sets the `DOSN` thud switches and wakes
//   the bees within 80 px, and the other Links standing within 50 px hop (100 px with a level-2 hammer: 0x8024BBB8),
//   as a boots crash does (boots.ts impact).
// Not modelled: the pound on tiles (0x802A1D44: pegs 0x76 → 0x77, 0x3A…; none in the battle arenas, assumed), on pots
// and orbs (TODO(measure)), the quake and the ring effect (0x802F601C), the GBA rooms' own frames.
import { bodyBox, subBoxesOverlap } from "./attacks.ts";
import { impact } from "./boots.ts";
import { interrupt, makeInvincible, stopActing, vulnerable, type Fighter, type Hit } from "./combat.ts";
import type { GameState } from "./game.ts";
import { HAMMER, hammerCharged, ITEM_OVER as OVER, POUND_AT, POUND_AT_CHARGED } from "./itemframes.ts";
import { Button, nextFacing, SUBPX, type PlayerState } from "./player.ts";
import { sameScreen } from "./siderooms.ts";

export { HAMMER, hammerCharged, hammerFrame, POUND_AT, POUND_AT_CHARGED } from "./itemframes.ts";

/** Starts the hammer from the press tick (items.ts useItem); the press tick itself is ordinary. */
export function startHammer(p: PlayerState, f: Fighter): void {
  stopActing(p);
  f.move = "hammer";
  f.moveTick = -1;
  f.charge = 0;
  f.shot = 0; // the release counter (+0x3FA): 0 while the hammer is held up
}

/** Is this Link's pound live this tick? */
export const pounding = (f: Fighter) => f.move === "hammer" && f.shot >= HAMMER.pound && f.shot <= HAMMER.poundLast;

/** The hammer's pose and a flattened Link's squash (moves.ts). Returns false when the Link isn't in either. */
export function stepHammer(state: GameState, i: number, buttons: number): boolean {
  const p = state.players[i]!, f = state.battle!.fighters[i]!;
  if (f.move === "squash") {
    if (f.shot === OVER) return endMove(f);
    p.held = buttons;
    const t = ++f.moveTick;
    f.squash = HAMMER.flatHeight + HAMMER.regrow * Math.max(0, HAMMER.squashTicks - t);
    if (t >= HAMMER.squashTicks) f.shot = OVER;
    return true;
  }
  if (f.move !== "hammer") return false;
  if (f.shot === OVER) return endMove(f);
  p.held = buttons;
  f.moveTick++;
  if (f.shot === 0 && buttons & Button.Item) {
    p.facing = nextFacing(p.facing, buttons); // TODO(measure): 0x8027EB04 read as turning with the stick
    if (f.charge <= HAMMER.charge) f.charge++;
  } else f.shot++;
  const charged = hammerCharged(f);
  if (charged && f.shot >= HAMMER.impact && f.shot <= HAMMER.impactLast) impact(state, i, HAMMER.joltReach * (f.itemLevel >= 2 ? 2 : 1));
  if (f.shot >= (charged ? HAMMER.endCharged : HAMMER.end)) f.shot = OVER;
  return true;
}

function endMove(f: Fighter): false {
  f.move = "none";
  f.moveTick = 0;
  f.shot = -1;
  return false;
}

/** The pound's box this tick (1/256 px). */
export function poundBox(p: PlayerState, f: Fighter): { left: number; top: number; right: number; bottom: number } {
  const [dx, dy] = (hammerCharged(f) ? POUND_AT_CHARGED : POUND_AT)[p.facing];
  const cx = p.x + dx * SUBPX, cy = p.y + dy * SUBPX, h = HAMMER.half * SUBPX;
  return { left: cx - h, top: cy - h, right: cx + h, bottom: cy + h };
}

/** The live pounds flatten the Links they meet (after everyone moved: arenastep.ts). */
export function poundHits(state: GameState): Hit[] {
  const b = state.battle!, hits: Hit[] = [];
  b.fighters.forEach((f, i) => {
    const p = state.players[i]!;
    if (f.mode !== "active" || !pounding(f)) return;
    const box = poundBox(p, f), charged = hammerCharged(f);
    b.fighters.forEach((g, j) => {
      const q = state.players[j]!;
      if (j === i || !vulnerable(g) || g.flat > 0 || !sameScreen(p, q) || !subBoxesOverlap(box, bodyBox(q))) return;
      flatten(q, g, charged ? HAMMER.damageCharged : HAMMER.damage, charged ? HAMMER.flatTicksCharged : HAMMER.flatTicks);
      hits.push({ attacker: i, victim: j, blocked: false, damage: charged ? HAMMER.damageCharged : HAMMER.damage, cause: "hammer" });
    });
  });
  return hits;
}

/** Hit types 20 and 21: life off, 60 invincibility ticks, no knockback; state 64, then flat for `ticks` from the hit. */
export function flatten(p: PlayerState, f: Fighter, damage: number, ticks: number): void {
  f.hearts = Math.max(0, f.hearts - damage);
  makeInvincible(f, 60);
  interrupt(p, f);
  f.pushX = f.pushY = f.slideX = f.slideY = 0;
  f.flat = ticks;
  if (knockedOut(f)) return;
  f.move = "squash";
  f.moveTick = -1;
  f.shot = 0;
}

/** No life left: the hit method goes to state 51 (dying) whatever the hit's type (0x802710C8). */
export function knockedOut(f: Fighter): boolean {
  if (f.hearts > 0) return false;
  f.mode = "dying";
  f.modeTick = 0;
  return true;
}

/** The flat timer and the height growing back, a tick (every fighter: 0x80247F0C). */
export function stepFlat(f: Fighter): void {
  if (f.flat > 0) f.flat--;
  else if (f.squash < 100) f.squash = Math.min(100, f.squash + HAMMER.regrow);
}
