// Link-vs-Link combat for Shadow Battle: sword hits and blocks, clashes, knockback, invincibility frames, the Links'
// pushes, pits and death. Per-player combat state lives in `Fighter`, index-aligned with GameState.players.
// Measured in Dolphin in battle (docs/measurements/battle-combat.md "Battle measurements: combat"): the sword's boxes, damage and
// live ticks (attacks.ts), the knockback and invincibility, the shield's push, clashes, the Links pushing each other,
// pits. The knockback of the other kinds of hits is read from main.dol ("Battle constants from main.dol").
import { SPIN_TICKS, stepLink } from "./actions.ts";
import { PLAYER_ANIMATIONS } from "./animations.ts";
import { attackMeets, attacksMeet, bodyBox, bootsAttack, swordAttack, type SwordAttack } from "./attacks.ts";
import { isqrt, velocityAlong, type ItemKind } from "./entities.ts";
import { moveFrame } from "./moveframes.ts";
import { Button, moveAxis, playerFrame, STAND_FRAME, SUBPX, WALK_FRAME_TICKS, WALK_SPEED, WALK_SPEED_DIAGONAL, type Facing, type PlayerState } from "./player.ts";
import { createPush, pushingFrame, type PushState } from "./push.ts";
import { sameScreen } from "./siderooms.ts";
import { CELL, isSolidAt, ROOM_W, surfaceAt, type World } from "./world.ts";

export const HEART = 4; // health is counted in quarter hearts (an Octorok hit, atcp 2, takes 16 life to 14: measured)
/**
 * Sword damage between Links: half the attack's power (attacks.ts). Traced in battle: a swing or a stab 2, a lunge 4,
 * a charged spin 4, the sword held out while charging 1.
 */
export const SWORD_DAMAGE = 2;
export const LUNGE_DAMAGE = 4;
export const SPIN_DAMAGE = 4;
export const CHARGE_DAMAGE = 1;
/** A pit: 2 life, taken when Link lands back on the edge (traced: 12 → 10; 2 → 0 is death on the edge). */
export const PIT_DAMAGE = 2;

/** Link's body for hits, relative to the sprite anchor (inclusive px): ±7, the game's Link +0x4C0 box (traced). */
export const HURTBOX = { left: -7, right: 7, top: -7, bottom: 7 } as const;
/** Point tested for pits, relative to the anchor: the anchor itself (traced: from below he falls in at y 207.5, not 209). */
export const PIT_PROBE = { x: 0, y: 0 } as const;

/**
 * Knockback: from the tick after the hit Link slides away from the source at `speed` (1/256 px per tick, at any angle,
 * not 8-way) while hopping (up at `hop`, falling at KNOCKBACK_GRAVITY), until he lands. Traced in battle: every sword
 * attack (swing, stab, lunge, spin, the charging sword, a level-2 stab of 3) 1.5 px/tick with a 3.0 hop (25 ticks),
 * another Link's bomb 1.0 and 4.0 (33 ticks), a thrown Link 0.75 and 4.0 (33 ticks). The game's hit function
 * (0x802710C8) picks them by the hit's type: 1 (swords, soldiers, fire bars, bees, thrown bushes, pots and orbs)
 * 1.5 px and a 3.0 hop, 4.0 above 4 damage; 4 and 7 (a thrown Link, the eternal flames) 0.75 and 4.0; 5 and 8 (a bomb's
 * blast) 1.0 and 4.0; 6 and 9 (the fire pit's jets, explosions) 1.5 and 4.0.
 */
export interface Knock {
  speed: number;
  hop: number;
}
export const KNOCK_DEFAULT: Knock = { speed: 384, hop: 768 }; // traced (every sword hit up to 4 damage); hit type 1
export const KNOCK_HARD: Knock = { speed: 384, hop: 1024 }; // hit type 1 above 4 damage, and types 6 and 9
export const KNOCK_BOMB: Knock = { speed: 256, hop: 1024 }; // traced: another Link's bomb; hit types 5 and 8
export const KNOCK_SLOW: Knock = { speed: 192, hop: 1024 }; // traced: a thrown Link hitting a third; hit types 4 and 7
/** Trampled by Epona (traced: state 16): shoved 6 px/tick on the ground, then bounced back 2 px/tick with a 4.0 hop. */
export const SHOVE_SPEED = 6 * 256;
export const SHOVE_BOUNCE: Knock = { speed: 512, hop: 1024 };
/** …once stopped this many ticks in a row with Epona off him (traced: the bounce's step on the 4th). */
export const SHOVE_STOP_TICKS = 3;
/** The knockback of a type-1 hit (a sword's) of this much damage. */
export const knockFor = (damage: number): Knock => (damage > 4 ? KNOCK_HARD : KNOCK_DEFAULT);
export const KNOCKBACK_GRAVITY = 64; // 0.25 px/tick²: measured
export const KNOCKBACK_SPEED = KNOCK_DEFAULT.speed;
/** Ticks a knockback lasts: the hop's flight, 25 for the default knock. */
export const knockTicks = (k: Knock) => Math.floor((2 * k.hop) / KNOCKBACK_GRAVITY) + 1;
export const KNOCKBACK_TICKS = knockTicks(KNOCK_DEFAULT);
export const HURT_FRAME_TICKS = 4; // knockback frames k ×4, k+1 ×4, k+2 ×4, then k+3 until landing, from the tick after the hit: traced
export const HURT_TICKS = KNOCKBACK_TICKS; // no control until he lands
export const INVINCIBLE_TICKS = 60; // after a hit: measured (main.dol 0x80272038 sets +0x464 = 60 with the hurt state)
export const RESPAWN_INVINCIBLE_TICKS = 180; // after climbing out of a pit: traced (the adventure's revive sets 180 too)
/**
 * The blink: the sprite is replaced by the blank frame 289 while (invincibility mod 4) ≥ 2, except for the first 5
 * ticks after it was set: traced after a hit (60: hidden from 55) and after a pit (180: hidden from 175).
 */
export const BLINK_DELAY = 5;
export const BLINK_FROM = INVINCIBLE_TICKS - BLINK_DELAY;
export const FLASH_TICKS = 2;

/**
 * The shield's block (traced: a stab, a swing, a lunge, a charging sword and a spin into a Link facing them): no damage,
 * no invincibility, no loss of control; both Links get a push of 2 px/tick apart along the line between them, set
 * again on every tick the attack's box still meets the blocker's body (so its length depends on how fast they part: 5
 * ticks for a stab, 7 when the attacker's back is to a wall or he lunges on), then the push decays (PUSH_DECAY).
 */
export const BLOCK_PUSH_SPEED = 512; // 2 px/tick, in 1/256 px
/** Pushes: added to the position every tick, then × 0.9 (× 0.95 while above 2 px/tick), dropped under 0.2 (traced). */
export const PUSH_DECAY = { slow: 9 / 10, fast: 19 / 20, fastAbove: 512, stopUnder: 256 / 5 } as const;
/** The blocker's counter (+0x3F4): 5 on every tick of a block, then down to 0. */
export const GUARD_TICKS = 5;
/** The spin is blocked by a shield facing it (traced, with the facing its boxes have on that tick). */
export const SHIELD_BLOCKS_SPIN = true;
/**
 * Two sword attacks whose boxes meet clash (traced: two stabs face to face, and a stab started into a live one): no
 * damage, both Links recoil with the held-sword-in-a-wall pose (state 55, actions.ts "tink": 15 ticks) and are pushed
 * 2 px/tick apart. That their attacks must face each other is assumed.
 */

/**
 * The pit (traced falling into the Tower of Flames' middle hole from the side and from below): Link is placed 8 px
 * inside the pit's edge, shows his walking pose for 2 ticks, falls (58 ticks: 183 ×8, 184 ×8, 185 ×8, 186 ×6, 187 ×6,
 * 188 ×6, 187 ×6, 186 ×10), then jumps out (64 ticks: up at 8 px/tick falling 0.25 px/tick², drawn with the knockback
 * frames) onto the edge he fell from, 7 px outside it; he lands there with PIT_DAMAGE and 180 invincibility ticks, or
 * dies there when that was his last life.
 */
export const FALL_EDGE_IN = 8;
export const FALL_EDGE_OUT = 7;
export const FALL_SEQUENCE = { frames: [183, 184, 185, 186, 187, 188, 187, 186], ticks: [8, 8, 8, 6, 6, 6, 6, 10] } as const;
export const FALL_START_TICKS = 2;
export const FALL_JUMP_TICKS = 64;
export const FALL_JUMP_HOP = 8 * SUBPX;
export const FALL_DROP_TICKS = FALL_SEQUENCE.ticks.reduce((a, b) => a + b, 0); // 58
/** Ticks from falling in to landing back on the edge (the landing tick is the last). */
export const FALL_TICKS = FALL_START_TICKS + FALL_DROP_TICKS + FALL_JUMP_TICKS + 1;
/**
 * A plain pit (tile type 0x03: Above the Clouds' outer void; traced walking off the island left, down, and left after
 * standing at its edge, and a burning Link running off it): placed 8 px inside its nearest edge, but 4 ticks before he
 * falls (state 30: the same 58 frames; meanwhile the game's walking Link stops, stands, walks a step and is put back
 * where he was placed; a burning one runs on 2 ticks, stops, and is put back a step), then no jump: on the next tick
 * he's back where he last stood with his whole body (x − 7 … x + 7, y − 7 … y + 7) off the pit (traced at 1.5 and
 * 2 px a tick: 71 and 72 left of the edge at 64; not where he was a few ticks before), with PIT_DAMAGE and 180
 * invincibility, and stands there (state 31, his standing frame, blinking) 60 ticks more, out of control, his
 * invincibility set back to 180 on the last of them (blinking at once); then he faces the arena's middle.
 */
export const PLAIN_FALL_START_TICKS = 4;
export const PLAIN_FALL_STAND_TICKS = 60;
/**
 * Dying (traced after a pit): 189, 190, 191, 192 ×6 three times, 193 ×4, then lying on 195 until the round ends. The sim
 * hides a dead Link instead ("dead" also stands for a player gone from an online match, who mustn't be drawn).
 */
export const DEATH_SEQUENCE = { frames: [189, 190, 191, 192, 189, 190, 191, 192, 189, 190, 191, 192, 193], ticks: [6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 4] } as const;
export const DEATH_TICKS = DEATH_SEQUENCE.ticks.reduce((a, b) => a + b, 0); // 76
export const DEAD_FRAME = 195;

/**
 * Links push each other apart (traced walking and rolling into a standing Link, and a knocked-back one landing on
 * another): at the start of a tick, while two Links' ±7 px bodies overlap (14 px apart or closer on both axes), each
 * moves 1 px away from the other along the line between them, their component across it at least 0.1 px.
 */
export const SEPARATE_DISTANCE = 2 * 7 * SUBPX;
export const SEPARATE_STEP = SUBPX;
export const SEPARATE_ACROSS = 26; // 0.1 px
/** Links more than this apart in height don't push each other (traced: a knocked-back Link 17.5 px up passed over one,
 *  and was pushed off him once 14.5 px up). */
export const SEPARATE_HEIGHT = 16 * SUBPX;
const SEPARATE_ROUNDS = 8;

const KNOCKBACK_FRAMES = PLAYER_ANIMATIONS.knockback.frames;

/**
 * active: normal control. recoil: no longer entered (a block now pushes; kept for older checks). hurt: knocked back
 * after a hit. stunned: dizzy after a slingshot seed. hooked: dragged back by a boomerang. pinned: carried off by a
 * drawn arrow (projectiles.ts). falling: into a pit and back out. dying: the death animation. dead: out of the round.
 */
export type FighterMode = "active" | "recoil" | "hurt" | "stunned" | "hooked" | "pinned" | "falling" | "dying" | "dead";

/**
 * What an active Link does besides walking and his sword (carry.ts, roll.ts, items.ts, siderooms.ts): lifting,
 * carrying, throwing and slamming something, being held or thrown by another Link, rolling (after "ready", the two
 * walking ticks before an Action press with nothing to lift turns into a roll or an empty lift), using an item, riding
 * Epona, taking an item off the ground ("take": orbs.ts), going through a door or into a hole (a side room:
 * siderooms.ts), riding a side room's cannon, shot from it, taken to Hyrule Castle's dark side by a magic circle and
 * back ("circle", "circleBack"), out of it by its middle ("spot").
 */
export type Move =
  | "none"
  | "ready"
  | "lift"
  | "emptyLift"
  | "carry"
  | "throw"
  | "slam"
  | "held"
  | "thrown"
  | "roll"
  | "use"
  | "ride"
  | "take"
  | "warp"
  | "hole"
  | "cannon"
  | "launch"
  | "circle"
  | "circleBack"
  | "spot"
  | "dash"
  | "crash"
  | "jolt"
  | "hammer"
  | "squash"
  | "fireRod"
  | "burning";
/**
 * The moves that take a Link away from the fight (siderooms.ts): no hits, no pushes, no pits. TODO(measure): assumed
 * (the game's states 28-37, 76, 77).
 */
export const AWAY: ReadonlySet<Move> = new Set(["warp", "hole", "cannon", "launch", "circle", "circleBack", "spot"]);

export interface Fighter {
  hearts: number; // quarter hearts; 0 = out of the round
  mode: FighterMode;
  modeTick: number; // ticks since the mode started
  invincible: number; // invincibility ticks left
  blinkFrom: number; // the blink runs once `invincible` is this low (BLINK_DELAY ticks after it was set)
  pushX: number; // knockback velocity, 1/256 px per tick (also the pit jump's and a hook's step)
  pushY: number;
  slideX: number; // push velocity (a block, a clash), 1/65536 px per tick (SLIDE_SCALE), decaying
  slideY: number;
  guard: number; // the block counter: GUARD_TICKS on every tick of a block, then down to 0
  endCharge: number; // the charging sword hit a Link: ticks until the charge ends (2: it plays one more tick)
  hitMask: number; // players already hit by the current swing or spin, one bit per player index
  spawnX: number; // start position, px
  spawnY: number;
  spawnFacing: Facing;
  stars: number; // rounds won
  // Moves, carrying and items (carry.ts, roll.ts, items.ts); all reset with the fighter at each round.
  move: Move;
  moveTick: number; // ticks since the move started
  carryLink: number; // player index carried overhead, -1 = none
  carryEntity: number; // entity id carried overhead (BattleState.entities), 0 = none
  heldBy: number; // player index carrying this Link, -1 = none
  z: number; // height above the ground while held, thrown or jumping out of a pit, 1/256 px
  vz: number; // vertical speed while thrown, 1/256 px per tick (up is positive)
  flyX: number; // horizontal speed while thrown or rolling, 1/256 px per tick
  flyY: number;
  thrower: number; // who threw this Link (or whose boomerang hooked him), -1 = dropped
  escape: number; // presses so far toward wriggling free while held
  item: ItemKind | ""; // the item in hand, from an orb
  itemLevel: number; // its level, 1 or 2 (Link +0xC14; what level 2 does: items.ts)
  swordLevel: number; // 1, or 2 once he took the Four Sword (Link +0xC18: +2 power)
  itemTimer: number; // ticks left on a timed item (Epona)
  shot: number; // the bow's or slingshot's pose: the moveTick its shot left on, -1 while it's drawn (items.ts)
  dark: number; // ticks left on Hyrule Castle's dark side (a magic circle's side room) before he's sent back, 0 = none
  circle: number; // the magic circle (BattleState.props.actors) that took him there, -1 = none (siderooms.ts)
  warp: number; // the warp (BattleState.props.warps) he's going through, -1 = none (siderooms.ts)
  warpLatch: number; // one bit per warp he hasn't left yet since he came out of one (it won't take him back)
  pressed: number; // the directions he newly pressed last tick (a gate takes a press of this tick or the last: siderooms.ts)
  push: PushState; // leaning on a wall (push.ts)
  shove: number; // while trampled by Epona and shoved along the ground ("hurt": epona.ts): 1 + the ticks he's been stopped
  bumped: number; // ticks in a row another Link's body moved him (separateLinks), 0 when it didn't this tick
  bumpedBefore: number; // the same count the tick before (he shows his walk this tick when it's not 0)
  charge: number; // the hammer's charge (Link +0x3FC) or the Fire Rod's flame ticks (its magic used: firerod.ts)
  flat: number; // ticks left flattened by a hammer (Link +0xC9C: hammer.ts), 0 = none
  squash: number; // his height in hundredths (Link +0xC8C: 50 flattened, growing back to 100)
  fireX: number; // his Fire Rod stream's flame or his flame while burning (firerod.ts): where he stood last tick, 1/256 px
  fireY: number;
  fireWait: number; // ticks before his stream's flame comes back after it burst on a wall; -1: his burning flame burst
  plainFall: boolean; // falling into a plain pit (tile type 0x03: put back on the edge, no jump), not a hole or lava
  safeX: number; // where he last stood with his whole body off any pit (a plain pit puts him back there), 1/256 px
  safeY: number;
}

export function createFighter(hearts: number, spawn: { x: number; y: number; facing: Facing }): Fighter {
  return {
    hearts,
    mode: "active",
    modeTick: 0,
    invincible: 0,
    blinkFrom: 0,
    pushX: 0,
    pushY: 0,
    slideX: 0,
    slideY: 0,
    guard: 0,
    endCharge: 0,
    hitMask: 0,
    spawnX: spawn.x,
    spawnY: spawn.y,
    spawnFacing: spawn.facing,
    stars: 0,
    move: "none",
    moveTick: 0,
    carryLink: -1,
    carryEntity: 0,
    heldBy: -1,
    z: 0,
    vz: 0,
    flyX: 0,
    flyY: 0,
    thrower: -1,
    escape: 0,
    item: "",
    itemLevel: 1,
    swordLevel: 1,
    itemTimer: 0,
    shot: -1,
    dark: 0,
    circle: -1,
    warp: -1,
    warpLatch: 0,
    pressed: 0,
    push: createPush(),
    shove: 0,
    bumped: 0,
    bumpedBefore: 0,
    charge: 0,
    flat: 0,
    squash: 100,
    fireX: 0,
    fireY: 0,
    fireWait: 0,
    plainFall: false,
    safeX: spawn.x * SUBPX,
    safeY: spawn.y * SUBPX,
  };
}

function setMode(f: Fighter, mode: FighterMode): void {
  f.mode = mode;
  f.modeTick = 0;
}

export function stopActing(p: PlayerState): void {
  p.action = "none";
  p.actionTick = 0;
  p.moving = false;
  p.walkTicks = 0;
}

/** Ends any sword action and move (a carried load is dropped by carry.ts once the carrier can't hold it). */
export function interrupt(p: PlayerState, f: Fighter): void {
  stopActing(p);
  f.endCharge = 0;
  if (f.move !== "held" && f.move !== "thrown") {
    f.move = "none";
    f.moveTick = 0;
    f.flyX = f.flyY = 0;
  }
}

/** Sets the invincibility, blinking from `delay` ticks later (traced: 5 after a hit or a pit, none after a stun). */
export function makeInvincible(f: Fighter, ticks: number, delay = BLINK_DELAY): void {
  f.invincible = ticks;
  f.blinkFrom = ticks - delay;
}

/**
 * Takes over an active fighter's tick when it returns true (lifting, carrying, rolling, items: moves.ts); otherwise the
 * Link walks and uses his sword as usual.
 */
export type MoveHook = (p: PlayerState, f: Fighter, buttons: number, world: World) => boolean;

const DIRECTIONS = Button.Up | Button.Down | Button.Left | Button.Right;

/** Fighter.slideX/Y hold pushes in 1/65536 px per tick (SLIDE_SCALE × 1/256 px), so their decay stays close to the
 *  game's floats. */
export const SLIDE_SCALE = 256;

/**
 * A push (Fighter.slide): decays by a tick, and returns this tick's move (1/256 px) and whether it goes on; while it
 * goes on Link doesn't walk (traced: a charging Link pushed back by a block walks again on the tick it drops under
 * 0.2 px).
 */
function decaySlide(f: Fighter): { dx: number; dy: number; pushed: boolean } {
  if (!f.slideX && !f.slideY) return { dx: 0, dy: 0, pushed: false };
  const dx = Math.round(f.slideX / SLIDE_SCALE), dy = Math.round(f.slideY / SLIDE_SCALE);
  const m2 = (f.slideX / SLIDE_SCALE) ** 2 + (f.slideY / SLIDE_SCALE) ** 2;
  // (A push set to exactly 2 px/tick along a slant rounds a hair above it: that's still 2.)
  const k = m2 > (PUSH_DECAY.fastAbove + 1) ** 2 ? PUSH_DECAY.fast : PUSH_DECAY.slow;
  f.slideX = Math.round(f.slideX * k);
  f.slideY = Math.round(f.slideY * k);
  if ((f.slideX / SLIDE_SCALE) ** 2 + (f.slideY / SLIDE_SCALE) ** 2 < PUSH_DECAY.stopUnder ** 2) f.slideX = f.slideY = 0;
  return { dx, dy, pushed: f.slideX !== 0 || f.slideY !== 0 };
}

/** Moves Link by a push (against the walls, sliding round their corners as walking does: traced, a Link pushed into the
 *  corner of The Field's beehive tree by P2's start), except while he spins (traced: the push decays through the spin
 *  and moves him again once it's over, the state of the tick deciding). */
function slideBy(p: PlayerState, world: World, dx: number, dy: number, corners: boolean): void {
  if (p.action === "spin" || (!dx && !dy)) return;
  moveAxis(p, world, dx, "x", corners);
  moveAxis(p, world, dy, "y", corners);
}

/**
 * Advances one fighter one tick (movement, knockback, falls, death). Hits between fighters are `resolveHits`. `corners`:
 * pushes slide round walls' corners (not on a side-view screen, where that would lift him).
 */
export function stepFighter(p: PlayerState, f: Fighter, buttons: number, world: World, moves?: MoveHook, corners = true): void {
  if (f.invincible > 0) f.invincible--;
  if (f.guard > 0) f.guard--;
  switch (f.mode) {
    case "active":
    case "recoil": {
      const push = decaySlide(f);
      // The charging sword that hit plays one more tick, then Link stands (traced: moving on, then a turn tick).
      if (f.endCharge > 0 && --f.endCharge === 0 && p.action === "charge") stopActing(p);
      if (moves?.(p, f, push.pushed ? buttons & ~DIRECTIONS : buttons, world)) {
        p.held = buttons;
        // (A dashing Link's push decays without moving him: it carries him once the dash is over. Traced: blocked.)
        if (f.move !== "dash") slideBy(p, world, push.dx, push.dy, corners);
      } else {
        // While pushed he doesn't walk, though his walk (or charge walk) animation runs on (traced).
        const x0 = p.x, y0 = p.y, walking = p.action === "none" || p.action === "charge";
        stepLink(p, buttons, world);
        if (push.pushed && walking && (p.action === "none" || p.action === "charge")) [p.x, p.y] = [x0, y0];
        slideBy(p, world, push.dx, push.dy, corners);
      }
      // (A swing started through the move hook too: a side-view screen's walking, siderooms.ts.)
      if (p.action === "swing" || p.action === "stab" || p.action === "lunge" || p.action === "spin") {
        if (p.actionTick === 1) f.hitMask = 0; // a new swing, stab, lunge or spin
      }
      break;
    }
    case "hurt": {
      // Sliding away while hopping, until he lands (measured).
      p.held = buttons;
      const push = decaySlide(f);
      slideBy(p, world, push.dx, push.dy, corners);
      const x0 = p.x, y0 = p.y;
      moveAxis(p, world, f.pushX, "x");
      moveAxis(p, world, f.pushY, "y");
      f.modeTick++;
      if (f.shove) {
        // Trampled (epona.ts): shoved along on the ground until he's stopped (a step under a pixel) SHOVE_STOP_TICKS in
        // a row with Epona off him, then bounced back off what stopped him with the hop (traced: shoved into the house
        // wall, 3 ticks there; trampled against it at once, held there while she pushed on, 19 ticks, then 3 more).
        const stopped = Math.abs(p.x - x0) + Math.abs(p.y - y0) < SUBPX;
        f.shove = stopped ? f.shove + 1 : 1;
        if (f.shove > SHOVE_STOP_TICKS) {
          [f.pushX, f.pushY] = velocityAlong(-f.pushX, -f.pushY, SHOVE_BOUNCE.speed);
          [f.vz, f.shove] = [SHOVE_BOUNCE.hop, 0];
        }
        break;
      }
      f.z += f.vz;
      f.vz -= KNOCKBACK_GRAVITY;
      if (f.z <= 0) {
        f.z = f.vz = 0;
        setMode(f, f.hearts > 0 ? "active" : "dying");
      }
      break;
    }
    case "stunned": {
      p.held = buttons;
      const push = decaySlide(f);
      slideBy(p, world, push.dx, push.dy, corners);
      if (++f.modeTick > STUN_TICKS) {
        // Back in control with 60 invincibility ticks, of which this one already counts (traced: 59, blinking at once).
        setMode(f, "active");
        makeInvincible(f, STUN_INVINCIBLE_TICKS, 0);
        f.invincible--;
      }
      break;
    }
    case "hooked":
      p.held = buttons; // dragged by dragHooked, which knows where the thrower is
      f.modeTick++;
      break;
    case "pinned":
      p.held = buttons; // carried by the arrow (projectiles.ts)
      if (++f.modeTick > PIN_TICKS) setMode(f, "active");
      break;
    case "falling":
      p.held = buttons;
      stepFall(p, f);
      break;
    case "dying":
      p.held = buttons;
      if (++f.modeTick >= DEATH_TICKS) setMode(f, "dead");
      break;
    case "dead":
      p.held = buttons;
      break;
  }
  if ((f.mode === "active" || f.mode === "recoil" || f.mode === "hurt") && !AWAY.has(f.move) && onGround(f)) {
    if (overPit(p, world)) startFall(p, f, world);
    else if (offPits(p, world)) [f.safeX, f.safeY] = [p.x, p.y];
  }
}

/**
 * Is his whole body (x − 7 … x + 7, y − 7 … y + 7, the far sides open) off any pit, off Above the Clouds' colored
 * panels, even of his own color (traced: back at 137 left of the ring after standing on his own panel 50 ticks), and
 * off empty bomb sockets (World.ledges)?
 */
function offPits(p: Pick<PlayerState, "x" | "y">, world: World): boolean {
  const half = 7 * SUBPX, l = Math.floor((p.x - half) / SUBPX), r = Math.ceil((p.x + half) / SUBPX) - 1;
  const t = Math.floor((p.y - half) / SUBPX), b = Math.ceil((p.y + half) / SUBPX) - 1;
  for (const [x, y] of [[l, t], [r, t], [l, b], [r, b]] as const) {
    const cell = Math.floor(y / CELL) * world.widthCells + Math.floor(x / CELL);
    if (surfaceAt(world, x, y) === "pit" || world.panels?.[cell] || world.ledges?.[cell]) return false;
  }
  return true;
}

/** On the ground (not held overhead or flying after a throw), so pits and floor hazards apply. */
export function onGround(f: Fighter): boolean {
  return f.move !== "held" && f.move !== "thrown" && f.z === 0;
}

export function overPit(p: PlayerState, world: World): boolean {
  return surfaceAt(world, Math.floor(p.x / SUBPX) + PIT_PROBE.x, Math.floor(p.y / SUBPX) + PIT_PROBE.y) === "pit";
}

/** Is this world pixel a pit to the falling Link? (Above the Clouds' panels are, unless of his color: panels.ts.) */
export type PitAt = (x: number, y: number) => boolean;

/** How far a fall looks back for the pit's edge (px): a trick floor is 64 px across. */
const PIT_EDGE_REACH = 96;

/**
 * The pit's edge Link came in by: looking back the way he was going (his knockback or flight, else the directions held,
 * else behind his facing: traced, a Link standing on the trick floor as it opened jumped back out behind him, past
 * the nearer edge ahead), the nearest 8 px cell that isn't pit; any side when there's none that way (a wall, the
 * arena's border). Returns the axis, the edge coordinate (px: the first pit pixel's side) and which way is outside, or
 * null inside a pit wider than PIT_EDGE_REACH.
 */
function pitEdge(p: PlayerState, f: Fighter, world: World, pitAt: PitAt, plain: boolean): { axis: "x" | "y"; edge: number; out: number } | null {
  const px = Math.floor(p.x / SUBPX), py = Math.floor(p.y / SUBPX);
  const cx = Math.floor(px / CELL) * CELL, cy = Math.floor(py / CELL) * CELL;
  const held = (a: number, b: number) => (p.held & a ? 1 : 0) - (p.held & b ? 1 : 0);
  const [mx, my] =
    f.mode === "hurt"
      ? [Math.sign(f.pushX), Math.sign(f.pushY)]
      : f.move === "thrown" || f.move === "roll"
        ? [Math.sign(f.flyX), Math.sign(f.flyY)]
        : [held(Button.Right, Button.Left), held(Button.Down, Button.Up)];
  const [fx, fy] = mx || my ? [mx, my] : FACING_STEP[p.facing];
  type Side = { axis: "x" | "y"; edge: number; out: number; d: number };
  // Along each side: the first cell out of the pit, if it's floor he can stand on inside the arena.
  const side = (axis: "x" | "y", out: number): Side | null => {
    for (let n = 0; n * CELL <= PIT_EDGE_REACH; n++) {
      const edge = (axis === "x" ? cx : cy) + (out > 0 ? CELL * (n + 1) : -CELL * n);
      const probe = out > 0 ? edge : edge - 1;
      const [probeX, probeY] = axis === "x" ? [probe, py] : [px, probe];
      if (probeX < 0 || probeY < 0 || probeX >= world.widthCells * CELL || probeY >= world.heightCells * CELL) return null;
      if (isSolidAt(world, probeX, probeY)) return null;
      if (pitAt(probeX, probeY)) continue;
      // A trick floor's pit reaches a pixel past its tiles on its right and bottom (traced: back down at 280, not 279).
      const wide = out > 0 && world.widePits?.some((r) => (axis === "x" ? r.right === edge - 1 && py >= r.top && py <= r.bottom : r.bottom === edge - 1 && px >= r.left && px <= r.right));
      return { axis, edge: wide ? edge + 1 : edge, out, d: Math.abs((axis === "x" ? p.x : p.y) - edge * SUBPX) };
    }
    return null;
  };
  const sides = [side("x", 1), side("x", -1), side("y", 1), side("y", -1)].filter((e): e is Side => e !== null);
  const behind = sides.filter((e) => (e.axis === "x" ? fx !== 0 && e.out === -fx : fy !== 0 && e.out === -fy));
  // (A plain pit: the nearest edge, whichever way he went. Traced: a Link standing on a panel as it turned another's
  // color was put 8 px in from its nearer side beside him, not from the side behind him.)
  const pool = behind.length && !plain ? behind : sides;
  return pool.reduce<Side | null>((best, e) => (!best || e.d < best.d ? e : best), null);
}


/**
 * Starts a fall into the pit Link is over: 8 px inside the edge he came in by, the jump back out aiming 7 px past the
 * floor's first pixel beyond it (edge + 7 going right or down, edge - 8 going left or up: traced) (without `world`, or
 * with no floor next to the pit, where he is, the jump aiming at his start). The jump's step per tick goes in
 * pushX/pushY.
 */
export function startFall(p: PlayerState, f: Fighter, world?: World, opts: { plain?: boolean; pitAt?: PitAt } = {}): void {
  f.plainFall = !!world && (opts.plain ?? plainPitAt(world, p));
  const edge = world ? pitEdge(p, f, world, opts.pitAt ?? ((x, y) => surfaceAt(world, x, y) === "pit"), f.plainFall) : null;
  // A burning Link runs on into a plain pit (firerod.ts: his run's step).
  const run = f.plainFall && f.move === "burning" && f.z === 0 ? [f.flyX, f.flyY] : [0, 0];
  f.pushX = f.pushY = 0;
  f.slideX = f.slideY = 0;
  interrupt(p, f);
  let tx = f.spawnX * SUBPX, ty = f.spawnY * SUBPX;
  if (edge) {
    const inside = (edge.edge - edge.out * FALL_EDGE_IN) * SUBPX;
    const outside = (edge.out > 0 ? edge.edge + FALL_EDGE_OUT : edge.edge - 1 - FALL_EDGE_OUT) * SUBPX;
    if (edge.axis === "x") {
      p.x = edge.out > 0 ? Math.min(p.x, inside) : Math.max(p.x, inside);
      [tx, ty] = [outside, p.y];
    } else {
      p.y = edge.out > 0 ? Math.min(p.y, inside) : Math.max(p.y, inside);
      [tx, ty] = [p.x, outside];
    }
  }
  if (f.plainFall) [tx, ty, f.flyX, f.flyY] = [f.safeX, f.safeY, run[0]!, run[1]!];
  // Come in over an empty bomb socket, the jump lands back where he last stood clear of it (traced: in the lava at 440
  // past the Tower of Flames' socket at 416-431, back at 409).
  else if (world?.ledges && !offPits({ x: tx, y: ty }, world)) [tx, ty] = [f.safeX, f.safeY];
  // The jump's step a tick; a plain pit's way back (from where he falls: one run step on from here).
  const steps = f.plainFall ? 1 : FALL_JUMP_TICKS;
  f.pushX = Math.round((tx - p.x - run[0]!) / steps);
  f.pushY = Math.round((ty - p.y - run[1]!) / steps);
  f.z = f.vz = 0;
  setMode(f, "falling");
}

const plainPitAt = (world: World, p: PlayerState) =>
  !!world.plainPit?.[Math.floor(p.y / SUBPX / CELL) * world.widthCells + Math.floor(p.x / SUBPX / CELL)];

function stepFall(p: PlayerState, f: Fighter): void {
  if (f.plainFall) return stepPlainFall(p, f);
  const t = ++f.modeTick;
  const jump = t - FALL_START_TICKS - FALL_DROP_TICKS + 1; // 1…64 in the air, 65 landing
  if (jump < 1) return;
  if (jump <= FALL_JUMP_TICKS) {
    p.x += f.pushX;
    p.y += f.pushY;
    f.z += FALL_JUMP_HOP - KNOCKBACK_GRAVITY * (jump - 1);
    return;
  }
  if (jump === FALL_JUMP_TICKS + 1) {
    // Landing: the pit's damage, then back in control (or dying) from the next tick.
    f.z = 0;
    f.pushX = f.pushY = 0;
    f.hearts = Math.max(0, f.hearts - PIT_DAMAGE);
    if (f.hearts > 0) {
      // Set to 180 on the landing tick, which already counts one (traced: 179 on it, blinking from 175).
      makeInvincible(f, RESPAWN_INVINCIBLE_TICKS);
      f.invincible--;
    }
    return;
  }
  setMode(f, f.hearts > 0 ? "active" : "dying");
}

function stepPlainFall(p: PlayerState, f: Fighter): void {
  const t = ++f.modeTick - PLAIN_FALL_START_TICKS - FALL_DROP_TICKS; // 0 back on the edge, then standing
  // A burning Link's run goes on 2 ticks, then he's put back a step as he falls (traced). A walking one stops, stands,
  // takes one walking step the way he holds on the 3rd tick and is put back as he falls (traced at 1.5 px: walking
  // right onto a panel, left off the island; standing still, no step).
  if (f.modeTick === PLAIN_FALL_START_TICKS - 1 && !f.flyX && !f.flyY) {
    const dx = (p.held & Button.Right ? 1 : 0) - (p.held & Button.Left ? 1 : 0), dy = (p.held & Button.Down ? 1 : 0) - (p.held & Button.Up ? 1 : 0);
    const speed = dx && dy ? WALK_SPEED_DIAGONAL : WALK_SPEED;
    [f.flyX, f.flyY] = [dx * speed, dy * speed];
    p.x += f.flyX;
    p.y += f.flyY;
  }
  const run = f.modeTick <= 2 ? 1 : f.modeTick === PLAIN_FALL_START_TICKS ? -1 : 0;
  if (run) {
    p.x += run * f.flyX;
    p.y += run * f.flyY;
  }
  if (f.modeTick === PLAIN_FALL_START_TICKS) f.flyX = f.flyY = 0;
  if (t < 0) return;
  if (t === 0) {
    p.x += f.pushX; // (the way back stays in pushX / pushY: he turns that way when he stands up)
    p.y += f.pushY;
    f.hearts = Math.max(0, f.hearts - PIT_DAMAGE);
    if (f.hearts > 0) {
      makeInvincible(f, RESPAWN_INVINCIBLE_TICKS);
      f.invincible--;
    } else setMode(f, "dying"); // TODO(measure): a plain pit's last life (taken as the hole's: dying on the edge)
    return;
  }
  if (t < PLAIN_FALL_STAND_TICKS) return;
  // His invincibility starts over, blinking at once (traced: 179 on this tick, hidden), and he's back in control from
  // the next, turned toward the arena's middle as at a round's start (arena.ts startFacing; traced: right, coming back
  // right off the island's left edge and left out of the colored panels' ring, both left of the middle; TODO(measure)
  // the right half).
  makeInvincible(f, RESPAWN_INVINCIBLE_TICKS, 0);
  f.invincible--;
  p.facing = p.x < (ROOM_W / 2) * SUBPX ? "right" : "left";
  f.pushX = f.pushY = 0;
  f.plainFall = false;
  setMode(f, "active");
}

export type PixelBox = { left: number; top: number; right: number; bottom: number };

/** Link's body box in world pixels (inclusive). */
export function hurtbox(p: PlayerState): PixelBox {
  const px = Math.floor(p.x / SUBPX), py = Math.floor(p.y / SUBPX);
  return { left: px + HURTBOX.left, top: py + HURTBOX.top, right: px + HURTBOX.right, bottom: py + HURTBOX.bottom };
}

/**
 * Can this fighter be hit right now? Not while held or thrown (off the ground), riding Epona (invincible), or away
 * (AWAY: through a door, into a hole, in a cannon).
 */
export function vulnerable(f: Fighter): boolean {
  return (
    f.hearts > 0 &&
    f.invincible === 0 &&
    (f.mode === "active" || f.mode === "recoil" || f.mode === "stunned") &&
    f.move !== "held" &&
    f.move !== "thrown" &&
    f.move !== "ride" &&
    !AWAY.has(f.move)
  );
}

const OPPOSITE: Readonly<Record<Facing, Facing>> = { right: "left", left: "right", down: "up", up: "down" };

/** The shield is up while Link isn't using his sword (a press tick keeps it up) or a move. */
export function shieldUp(victim: PlayerState, f?: Fighter): boolean {
  if (f && ((f.move !== "none" && f.move !== "ready") || f.mode !== "active")) return false;
  return victim.action === "none" || (victim.action !== "charge" && victim.action !== "tink" && victim.actionTick === 0);
}

/**
 * The shield stops a sword attack when Link faces against the attack's direction (traced: the game compares the
 * facings, not where the attacker stands; a Link facing left blocks a stab to the right from above-left of him).
 */
export function shieldBlocks(victim: PlayerState, attacker: PlayerState): boolean {
  if (!shieldUp(victim)) return false;
  const attack = swordAttack(attacker);
  if (!attack) return OPPOSITE[attacker.facing] === victim.facing;
  if (attacker.action === "spin" && !SHIELD_BLOCKS_SPIN) return false;
  return OPPOSITE[attack.facing] === victim.facing;
}

const FACING_STEP: Record<Facing, [number, number]> = { right: [1, 0], left: [-1, 0], down: [0, 1], up: [0, -1] };

export interface Hit {
  attacker: number; // player index, -1 for the arena (hazards, soldiers, bees, Vaati)
  victim: number;
  blocked: boolean;
  damage: number;
  /** What hit, when it wasn't the attacker's sword: "thrown", "arrow", "bomb", "flame", "clash"… */
  cause?: string;
}

/** A Link's live sword attack; the Four Sword (swordLevel 2: taking it sets Link +0xC18 = 2, traced) adds power. The
 *  boots' dash is one too (boots.ts). */
function swordOf(p: PlayerState, f: Fighter): SwordAttack | null {
  if (f.mode === "active" && f.move === "dash") return f.moveTick >= 0 ? bootsAttack(p, f.flyX, f.flyY) : null;
  if (f.mode !== "active" || (f.move !== "none" && f.move !== "ready")) return null;
  return swordAttack(p, f.swordLevel);
}

/** Pushes two Links apart at `speed` along the line between them (away from each other; along a's facing on one spot). */
function pushApart(a: PlayerState, fa: Fighter, v: PlayerState, fv: Fighter, speed: number): void {
  let [vx, vy] = velocityAlong(v.x - a.x, v.y - a.y, speed * SLIDE_SCALE);
  if (vx === 0 && vy === 0) [vx, vy] = FACING_STEP[a.facing].map((s) => s * speed * SLIDE_SCALE) as [number, number];
  fv.slideX = vx;
  fv.slideY = vy;
  fa.slideX = -vx;
  fa.slideY = -vy;
}

/**
 * Sword hits, blocks and clashes between fighters this tick. Every overlap is found on the positions before any of
 * them is applied, so the result doesn't depend on player order (except that a Link hit twice at once only takes the
 * first hit). A block is pushed again on every tick it lasts but reported (in the hits) on its first tick only.
 */
export function resolveHits(players: readonly PlayerState[], fighters: readonly Fighter[]): Hit[] {
  const attacks = players.map((p, i) => swordOf(p, fighters[i]!));
  const applied: Hit[] = [];
  // Clashes: two live attacks facing each other whose boxes meet.
  const clashed = new Set<number>();
  players.forEach((a, i) => {
    const aa = attacks[i];
    if (!aa || clashed.has(i)) return;
    players.forEach((b, j) => {
      const ab = attacks[j];
      if (j <= i || !ab || clashed.has(j) || OPPOSITE[aa.facing] !== ab.facing || !attacksMeet(aa, ab)) return;
      clashed.add(i).add(j);
      for (const [p, f] of [[a, fighters[i]!], [b, fighters[j]!]] as const) {
        f.endCharge = 0;
        stopActing(p);
        p.action = "tink";
      }
      pushApart(a, fighters[i]!, b, fighters[j]!, BLOCK_PUSH_SPEED);
      applied.push({ attacker: i, victim: j, blocked: true, damage: 0, cause: "clash" });
    });
  });
  const found: { attacker: number; victim: number; blocked: boolean; damage: number }[] = [];
  players.forEach((a, i) => {
    const attack = attacks[i];
    if (!attack || clashed.has(i)) return;
    players.forEach((v, j) => {
      const fv = fighters[j]!;
      if (j === i || clashed.has(j) || fighters[i]!.hitMask & (1 << j) || !vulnerable(fv)) return;
      if (!attackMeets(attack, bodyBox(v))) return;
      const blocked = shieldUp(v, fv) && (a.action !== "spin" || SHIELD_BLOCKS_SPIN) && OPPOSITE[attack.facing] === v.facing;
      found.push({ attacker: i, victim: j, blocked, damage: attack.power >> 1 || 1 });
    });
  });
  for (const hit of found) {
    const a = players[hit.attacker]!, v = players[hit.victim]!, fa = fighters[hit.attacker]!, fv = fighters[hit.victim]!;
    if (!vulnerable(fv)) continue;
    if (hit.blocked) {
      pushApart(a, fa, v, fv, BLOCK_PUSH_SPEED);
      if (fv.guard === 0) applied.push(hit);
      fv.guard = GUARD_TICKS;
      continue;
    }
    fa.hitMask |= 1 << hit.victim;
    fv.hearts = Math.max(0, fv.hearts - hit.damage);
    makeInvincible(fv, INVINCIBLE_TICKS);
    interrupt(v, fv);
    // The charging sword that hits ends the charge (traced: idle two ticks later).
    if (a.action === "charge") fa.endCharge = 2;
    // Away from the attacker; on the same spot, along his facing.
    const same = a.x === v.x && a.y === v.y, [fx, fy] = FACING_STEP[a.facing];
    knockBack(v, fv, same ? v.x - fx : a.x, same ? v.y - fy : a.y, knockFor(hit.damage));
    applied.push(hit);
  }
  return applied;
}

/** Starts a knockback away from (x, y) (1/256 px): any angle, with the hop; away from his facing on the same spot. */
export function knockBack(p: PlayerState, f: Fighter, x: number, y: number, knock: Knock): void {
  let [vx, vy] = velocityAlong(p.x - x, p.y - y, knock.speed);
  if (vx === 0 && vy === 0) {
    const [fx, fy] = FACING_STEP[p.facing];
    [vx, vy] = [-fx * knock.speed, -fy * knock.speed];
  }
  f.pushX = vx;
  f.pushY = vy;
  f.z = 0;
  f.vz = knock.hop;
  f.shove = 0;
  setMode(f, "hurt");
}

/** The shield faces a source at (x, y) (1/256 px): Link isn't using his sword or a move, and faces that way. */
export function shieldFaces(victim: PlayerState, f: Fighter, x: number, y: number): boolean {
  if (!shieldUp(victim, f)) return false;
  const dx = x - victim.x, dy = y - victim.y;
  if (dx === 0 && dy === 0) return false;
  const toward: Facing = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
  return toward === victim.facing;
}

/**
 * Damage from anything but a sword (thrown things, shots, explosions, hazards): the same knockback away from (x, y),
 * invincibility and stun as a sword hit. `blockable` hits from the front are stopped by the shield, which pushes the
 * Link back like a blocked sword (assumed; only sword blocks were traced). Returns the hit, or null when the fighter
 * can't be hit right now.
 */
export function hurtFighter(
  p: PlayerState,
  f: Fighter,
  victim: number,
  damage: number,
  x: number,
  y: number,
  opts: { attacker?: number; cause?: string; blockable?: boolean; knock?: Knock } = {},
): Hit | null {
  if (!vulnerable(f)) return null;
  const blocked = opts.blockable === true && shieldFaces(p, f, x, y);
  if (blocked) {
    [f.slideX, f.slideY] = velocityAlong(p.x - x, p.y - y, BLOCK_PUSH_SPEED * SLIDE_SCALE);
    f.guard = GUARD_TICKS;
  } else {
    f.hearts = Math.max(0, f.hearts - damage);
    makeInvincible(f, INVINCIBLE_TICKS);
    interrupt(p, f);
    knockBack(p, f, x, y, opts.knock ?? KNOCK_DEFAULT);
  }
  const hit: Hit = { attacker: opts.attacker ?? -1, victim, blocked, damage };
  if (opts.cause) hit.cause = opts.cause;
  return hit;
}

/**
 * A quick slingshot seed, or a Link slammed onto him (traced): no damage, no knockback; the Link turns round dizzy for
 * 90 ticks (the standing poses down, left, up, right, 6 ticks each), then gets 60 invincibility ticks.
 */
export const STUN_TICKS = 90;
export const STUN_INVINCIBLE_TICKS = 60;
export const STUN_FRAME_TICKS = 6;

export function stunFighter(p: PlayerState, f: Fighter): boolean {
  if (!vulnerable(f) || f.mode === "stunned") return false;
  interrupt(p, f);
  setMode(f, "stunned");
  return true;
}

/**
 * A boomerang that meets a Link (traced): no damage and no invincibility; it drags him toward its thrower at 6 px/tick
 * until he's 18 px from him, then lets go.
 */
export const HOOK_SPEED = 1536;
export const HOOK_RELEASE = 18 * SUBPX;

export function hookFighter(p: PlayerState, f: Fighter, thrower: number): boolean {
  if (!vulnerable(f)) return false;
  interrupt(p, f);
  f.thrower = thrower;
  setMode(f, "hooked");
  return true;
}

/**
 * A drawn arrow (traced: the bow held 30 ticks at level 2, 54 at level 1): 2 life and 180 invincibility ticks, no hop;
 * the Link (state 67) turns to face the shooter and rides the arrow for 13 ticks, then stands one more and is free.
 * projectiles.ts moves him; the hit tick shows his pose, the next the knockback frame of the arrow's way, then his own
 * facing's, 8 ticks a frame.
 */
export const PIN_DAMAGE = 2;
export const PIN_INVINCIBLE_TICKS = 180;
export const PIN_CARRY_TICKS = 13;
export const PIN_TICKS = PIN_CARRY_TICKS + 1;
const PIN_FRAME_TICKS = 8;

export function pinFighter(p: PlayerState, f: Fighter, victim: number, x: number, y: number, opts: { attacker?: number; cause?: string } = {}): Hit | null {
  if (!vulnerable(f)) return null;
  // (A shield facing it pushes him back, as for the quick arrow: assumed.)
  if (shieldFaces(p, f, x, y)) return hurtFighter(p, f, victim, PIN_DAMAGE, x, y, { ...opts, blockable: true });
  f.hearts = Math.max(0, f.hearts - PIN_DAMAGE);
  makeInvincible(f, PIN_INVINCIBLE_TICKS);
  interrupt(p, f);
  f.pushX = f.pushY = f.z = f.vz = 0;
  setMode(f, "pinned");
  const hit: Hit = { attacker: opts.attacker ?? -1, victim, blocked: false, damage: PIN_DAMAGE };
  if (opts.cause) hit.cause = opts.cause;
  return hit;
}

/**
 * Drags the hooked Links (after every Link moved): main.dol's state 66 (0x8025AED0) moves him 6 px a frame toward the
 * boomerang that hooked him (its handle in +0x11F8), and lets him go once it's gone, caught by its thrower (traced:
 * 18 px from the thrower behind a level-1 boomerang, 24 px behind a level-2 one, which comes back faster). The tick he
 * stops is still hooked, control from the next. Without the entities (older callers), toward the thrower until he's
 * HOOK_RELEASE from him.
 */
export function dragHooked(players: readonly PlayerState[], fighters: readonly Fighter[], world: World, entities?: readonly { kind: string; owner: number; hp: number; x: number; y: number }[]): void {
  fighters.forEach((f, i) => {
    if (f.mode !== "hooked" || f.modeTick === 0) return;
    const p = players[i]!, t = players[f.thrower], ft = fighters[f.thrower];
    const boomerang = entities?.find((e) => e.kind === "boomerang" && e.owner === f.thrower && e.hp >= 0);
    const d = t ? isqrt((t.x - p.x) ** 2 + (t.y - p.y) ** 2) : 0;
    // (Let go too when the thrower went through a door into another room: siderooms.ts.)
    if (!t || !ft || ft.hearts <= 0 || (entities ? !boomerang : d - HOOK_SPEED < HOOK_RELEASE) || !sameScreen(p, t)) {
      // Let go facing the way his spin had turned him (traced).
      p.facing = hookedFacing(p, f);
      f.thrower = -1;
      setMode(f, "active");
      return;
    }
    const goal = boomerang ?? t;
    const [vx, vy] = velocityAlong(goal.x - p.x, goal.y - p.y, HOOK_SPEED);
    moveAxis(p, world, vx, "x");
    moveAxis(p, world, vy, "y");
  });
}

/** Knocks a fighter out on the spot (Vaati's giant bomb): the death animation, then out of the round. */
export function knockOut(p: PlayerState, f: Fighter): void {
  f.hearts = 0;
  f.pushX = f.pushY = 0;
  f.slideX = f.slideY = 0;
  interrupt(p, f);
  setMode(f, "dying");
}

/** Is this fighter on the field for the Links' pushes: standing, walking, attacking or knocked back, not held. */
function onField(f: Fighter): boolean {
  return f.hearts > 0 && (f.mode === "active" || f.mode === "recoil" || f.mode === "hurt" || f.mode === "stunned") && f.move !== "held" && f.move !== "thrown" && !AWAY.has(f.move);
}

/**
 * The Links' pushes, at the start of a tick (before anyone moves): while two Links are SEPARATE_DISTANCE apart or
 * closer on both axes, both step SEPARATE_STEP away from each other (against the walls).
 */
export function separateLinks(players: readonly PlayerState[], fighters: readonly Fighter[], world: World): void {
  const from = players.map((p) => [p.x, p.y] as const);
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i]!, b = players[j]!, fa = fighters[i]!, fb = fighters[j]!;
      if (!onField(fa) || !onField(fb) || Math.abs(fa.z - fb.z) >= SEPARATE_HEIGHT) continue;
      for (let n = 0; n < SEPARATE_ROUNDS; n++) {
        const dx = b.x - a.x, dy = b.y - a.y;
        if (Math.abs(dx) > SEPARATE_DISTANCE || Math.abs(dy) > SEPARATE_DISTANCE) break;
        let [ux, uy] = dx === 0 && dy === 0 ? [SEPARATE_STEP, 0] : velocityAlong(dx, dy, SEPARATE_STEP);
        // The component across the line is at least 0.1 px (traced: exactly lined-up Links part 0.1 px sideways).
        if (Math.abs(ux) < SEPARATE_ACROSS) ux = ux > 0 ? SEPARATE_ACROSS : -SEPARATE_ACROSS;
        if (Math.abs(uy) < SEPARATE_ACROSS) uy = uy > 0 ? SEPARATE_ACROSS : -SEPARATE_ACROSS;
        moveAxis(b, world, ux, "x");
        moveAxis(b, world, uy, "y");
        moveAxis(a, world, -ux, "x");
        moveAxis(a, world, -uy, "y");
      }
    }
  }
  fighters.forEach((f, i) => {
    const p = players[i]!, moved = p.x !== from[i]![0] || p.y !== from[i]![1];
    f.bumpedBefore = f.bumped;
    f.bumped = moved ? f.bumped + 1 : 0;
  });
}

/**
 * A Link standing while another's body moves him shows his walk (traced, a Link walked into, rolled into and pushed by a
 * charging one: state 2) on the ticks after one it moved him, its frames running as a walk's over those ticks, but the
 * walk's first frame on a tick it doesn't move him.
 */
function bumpedFrame(p: PlayerState, f: Fighter): number {
  if (!f.bumpedBefore || p.moving || p.action !== "none") return -1;
  return { right: 0, left: 8, down: 16, up: 24 }[p.facing] + (f.bumped ? Math.floor(f.bumpedBefore / WALK_FRAME_TICKS) % 8 : 0);
}

const STUN_ORDER: readonly Facing[] = ["down", "left", "up", "right"];
const CLOCKWISE: readonly Facing[] = ["right", "down", "left", "up"];

/** A hooked Link spins as he's dragged, a quarter turn clockwise every 2 ticks (traced facing down: right first). */
function hookedFacing(p: PlayerState, f: Fighter): Facing {
  const turn = CLOCKWISE.indexOf(p.facing) - 1 + Math.floor(f.modeTick / 2);
  return CLOCKWISE[((turn % 4) + 4) % 4]!;
}

/** Sprite frame (player_sob) for a fighter, or -1 when he isn't shown. */
export function fighterFrame(p: PlayerState, f: Fighter, linkFrame: (p: PlayerState) => number): number {
  const at = (frames: readonly number[], ticks: readonly number[], tick: number) => {
    for (let i = 0; i < ticks.length; i++) {
      tick -= ticks[i]!;
      if (tick < 0) return frames[i]!;
    }
    return frames[frames.length - 1]!;
  };
  const knock = (tick: number) => KNOCKBACK_FRAMES[p.facing][Math.min(3, Math.floor(tick / HURT_FRAME_TICKS))]!;
  switch (f.mode) {
    case "hurt":
      // The hit tick still shows the pose he was in; the knockback frames from the next (traced).
      return f.modeTick === 0 ? playerFrame(p) : knock(f.modeTick - 1);
    case "stunned":
      // The hit tick still shows his pose; then down, left, up, right whatever his facing, which he keeps (traced).
      return f.modeTick === 0 ? playerFrame(p) : STAND_FRAME[STUN_ORDER[Math.floor(f.modeTick / STUN_FRAME_TICKS) % 4]!];
    case "hooked":
      // The hit tick still shows his pose; then he spins as he's dragged.
      return f.modeTick === 0 ? playerFrame(p) : STAND_FRAME[hookedFacing(p, f)];
    case "pinned":
      if (f.modeTick === 0) return playerFrame(p);
      if (f.modeTick === 1) return KNOCKBACK_FRAMES[OPPOSITE[p.facing]][0]!;
      return KNOCKBACK_FRAMES[p.facing][Math.min(3, Math.floor((f.modeTick - 2) / PIN_FRAME_TICKS))]!;
    case "falling": {
      const t = f.modeTick - (f.plainFall ? PLAIN_FALL_START_TICKS : FALL_START_TICKS);
      if (t < 0) return linkFrame(p);
      // (A plain pit: the fall's last frame still on the tick he's back on the edge, then standing.)
      if (f.plainFall) return t <= FALL_DROP_TICKS ? at(FALL_SEQUENCE.frames, FALL_SEQUENCE.ticks, t) : STAND_FRAME[p.facing];
      if (t < FALL_DROP_TICKS) return at(FALL_SEQUENCE.frames, FALL_SEQUENCE.ticks, t);
      return knock(t - FALL_DROP_TICKS);
    }
    case "dying":
      return at(DEATH_SEQUENCE.frames, DEATH_SEQUENCE.ticks, f.modeTick);
    case "dead":
      return -1;
    default: {
      const push = f.move === "none" ? pushingFrame(f.push, p) : -1;
      if (push >= 0) return push;
      const bumped = f.move === "none" ? bumpedFrame(p, f) : -1;
      return bumped >= 0 ? bumped : (moveFrame(p, f) ?? linkFrame(p));
    }
  }
}

/** How high to draw a fighter above his ground position (held overhead, thrown), in whole px. */
export function fighterHeight(f: Fighter): number {
  return Math.floor(f.z / SUBPX);
}

/** Blinks while invincible: hidden (the blank frame 289) while (counter mod 4) ≥ 2, from `blinkFrom` down (traced). */
export function fighterVisible(f: Fighter): boolean {
  if (f.mode === "dead") return false;
  return !(f.invincible > 0 && f.invincible <= f.blinkFrom && f.invincible % 4 >= FLASH_TICKS);
}
