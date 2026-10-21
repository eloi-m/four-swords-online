// The Pegasus Boots (item 1), The Field's third item (its generator's mask 0x1182: bow, bombs, boots) and one of Hyrule
// Castle's side rooms'. Traced in Shadow Battle (`field-2p`, the boots poked into P1's +0xC10; docs/measurements/
// battle-combat.md "The Pegasus Boots"), the crash read from main.dol (state 65's entry 0x8025D7E4):
// - Item pressed: after the press tick (an ordinary one) Link stands 10 ticks playing his walk frames at 2 ticks a
//   frame (state 57),
//   then dashes at 3 px/tick along his facing while the button stays held; a direction across it steers him 45° off
//   (2.1 px a tick on each axis), his facing kept. On the tick the button is up he still moves, then stands (the
//   charge too: let go early, nothing).
// - The whole state is a sword attack (+0x458 = 1 from its entry): the sword's two boxes for the facing (attacks.ts),
//   set before the tick's step (trailing it), power 6 (3 life, the 3.0-hop knockback), blocked by a shield facing it
//   (the blocker is pushed off, the dasher keeps on), at either item level.
// - Meeting a wall head on (the middle of his leading side) he crashes (state 65): bounced back 2 px a tick off his
//   facing with a 4.0 hop (table 0x8046AFE0), the knockback frames, 33 ticks to the ground. The crash is a ground
//   impact (+0xB9C, read by 0x8026FCE0): it sets the `DOSN` thud switches and wakes The Field's bees within 80 px, and
//   other Links standing within 50 px hop on the spot (state 63: the same hop, their standing pose; 100 px when the
//   crashing Link's boots are level 2: 0x8024BBB8 doubles the reach by the impact's Link's item level, read from
//   main.dol). They land dizzy: state 63's update (0x8028434C) goes to state 12, the seed's stun (90 ticks, its exit
//   0x80279F94 then 60 invincible), for a Link whose bit is in the game's playing-players mask (+0x82: all of them in
//   battle) or who follows a leader (+0xD60 ≥ 0); otherwise to state 0. Read from main.dol, the stun not traced.
// - The dash strikes what the sword strikes (strike.ts dashStrikes): orbs, pots, bushes, soldiers, bees.
import { BOOTS } from "./attacks.ts";
import { onGround, stopActing, type Fighter } from "./combat.ts";
import { FACING_STEP } from "./entities.ts";
import type { GameState } from "./game.ts";
import { Button, moveAxis, SUBPX, wallAhead } from "./player.ts";
import { BEE_WAKE_DISTANCE, wakeBees } from "./strike.ts";
import { ownSwitch, setSwitch } from "./switches.ts";
import type { World } from "./world.ts";

/** Fighter.shot of a dash, crash or hop whose last tick was this one. */
const DASH_OVER = -2;
/** The hop's fall: the knockback's 0.25 px/tick². */
const GRAVITY = 64;

/** Starts the boots from the press tick (items.ts useItem). */
export function startDash(f: Fighter): void {
  f.move = "dash";
  f.moveTick = -1;
  f.flyX = f.flyY = 0;
  f.hitMask = 0;
}

/** The dash's step this tick (1/256 px), for the attack's trailing boxes (attacks.ts bootsAttack). */
export const dashing = (f: Fighter) => f.move === "dash" && f.moveTick >= BOOTS.charge;

/** The boots' dash, the crash and the hop near a crash. Returns false when the Link isn't in one of them. */
export function stepBoots(state: GameState, i: number, buttons: number, world: World): boolean {
  const p = state.players[i]!, f = state.battle!.fighters[i]!;
  if (f.move === "dash") {
    // Let go, the tick plays out and the next is an ordinary one; dashing, the release counts a tick late (he moves on
    // the tick it's up and the next, in the dash's pose).
    if (f.shot === DASH_OVER) {
      endBoots(f);
      return false;
    }
    const held = p.held & Button.Item;
    p.held = buttons;
    if (++f.moveTick === 0) stopActing(p);
    f.flyX = f.flyY = 0;
    if (dashing(f)) {
      const [sx, sy] = FACING_STEP[p.facing];
      // A direction across the facing steers it.
      const across = sx ? (buttons & Button.Down ? 1 : 0) - (buttons & Button.Up ? 1 : 0) : (buttons & Button.Right ? 1 : 0) - (buttons & Button.Left ? 1 : 0);
      const v = across ? BOOTS.speedSteered : BOOTS.speed;
      [f.flyX, f.flyY] = sx ? [sx * v, across * v] : [across * v, sy * v];
      const x0 = p.x, y0 = p.y;
      moveAxis(p, world, f.flyX, "x", !across);
      moveAxis(p, world, f.flyY, "y", !across);
      [f.flyX, f.flyY] = [p.x - x0, p.y - y0];
      if (wallAhead(world, p, p.facing)) {
        f.move = "crash";
        f.shot = f.moveTick; // (for its frame: moveframes.ts)
        f.moveTick = -1;
        return true;
      }
    }
    if (!(dashing(f) ? held : buttons & Button.Item)) f.shot = DASH_OVER;
    return true;
  }
  if (f.move === "crash" || f.move === "jolt") {
    if (f.shot === DASH_OVER) {
      endBoots(f);
      return false;
    }
    p.held = buttons;
    if (++f.moveTick === 0) {
      f.vz = BOOTS.hop;
      if (f.move === "crash") impact(state, i, BOOTS.joltReach * (f.itemLevel >= 2 ? 2 : 1));
      else return true; // (the tick it felt the crash: the hop starts on the next)
    }
    if (f.move === "crash") {
      const [sx, sy] = FACING_STEP[p.facing];
      moveAxis(p, world, -sx * BOOTS.bounce, "x");
      moveAxis(p, world, -sy * BOOTS.bounce, "y");
    }
    f.z += f.vz;
    f.vz -= GRAVITY;
    if (f.z <= 0) {
      f.z = f.vz = 0;
      if (f.move === "crash") f.shot = DASH_OVER; // (the landing tick keeps the pose)
      else {
        // A jolted Link lands dizzy (state 63 → 12 when he's a playing player, as every battle Link is: the seed's stun,
        // 90 ticks, then 60 invincible: combat.ts STUN_TICKS).
        endBoots(f);
        f.mode = "stunned";
        f.modeTick = 0;
      }
    }
    return true;
  }
  return false;
}

function endBoots(f: Fighter): void {
  f.move = "none";
  f.moveTick = 0;
  f.shot = -1;
  f.flyX = f.flyY = 0;
}

/** A Link's ground impact at his feet (a boots crash, a charged hammer's pound: hammer.ts): thud switches, bees, and
 *  the other Links within `joltReach` px of him hop and land dizzy (main.dol 0x8024BBB8: 50 px, twice that when the
 *  impact's Link holds a level-2 item). */
export function impact(state: GameState, i: number, joltReach: number = BOOTS.joltReach): void {
  const b = state.battle!, p = state.players[i]!;
  const near = (x: number, y: number, reach: number) => (x - p.x) ** 2 + (y - p.y) ** 2 <= (reach * SUBPX) ** 2;
  for (const prop of b.props.actors) if (prop.id === "DOSN" && near(prop.x * SUBPX, prop.y * SUBPX, BOOTS.impactReach)) setSwitch(b, ownSwitch(prop.params), true);
  wakeBees(b, p.x, p.y, BEE_WAKE_DISTANCE);
  state.players.forEach((o, j) => {
    const fo = b.fighters[j]!;
    if (j === i || fo.mode !== "active" || (fo.move !== "none" && fo.move !== "ready") || !onGround(fo) || !near(o.x, o.y, joltReach)) return;
    stopActing(o);
    fo.move = "jolt";
    fo.moveTick = -1;
  });
}
