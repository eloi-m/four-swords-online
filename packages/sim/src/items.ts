// The Item button (A on the GameCube pad) with the item from an orb. Measured in Dolphin (adventure mode, the item
// written into Link's +0xC10; docs/measurements/battle-combat.md):
// - bomb: puts a bomb down 13 px in front, lit (300-tick fuse), with no pose, at most 2 at a time; lift it with Action.
// - bow: a 14-tick pose, the arrow leaves on the 7th tick (projectiles.ts has its flight).
// - boomerang: a 17-tick pose, thrown on the 7th tick, 6 px out.
// - slingshot: a 14-tick pose, one seed.
// - the Pegasus Boots, the hammer and the Fire Rod run their own moves (boots.ts, hammer.ts, firerod.ts).
// The bow and the slingshot draw while the button stays held (traced in battle, docs/measurements/battle-combat.md "Items, levels
// and the Four Sword"): the pose holds its second frame, the Link walks at the charge's 1.125 px/tick with his facing
// kept, and the shot leaves on the tick the button is up (on the pose's 7th tick at the earliest), then the pose's
// last 7 ticks play. main.dol's draw counter (Link +0x3FC, 0x8025C894 and 0x8025BEB0) runs from the 7th tick, 1 a tick
// (the bow at level 2: 2); a shot that leaves with it at 48 is drawn: a drawn arrow takes 2 life and carries the Link
// off (combat.ts pinFighter), a drawn seed takes 1 with the sword's knockback; both fly on to the wall.
// Item levels (Link +0xC14; a generator's item is level 2 one time in five: orbs.ts), traced at level 1 and 2:
// - bow: level 2 draws twice as fast (30 ticks instead of 54) and has 2 arrows out at once (1 at level 1);
// - slingshot: up to 3 seeds out; at level 2 a drawn shot with none out fires three, the side ones 45° off;
// - boomerang: level 2 flies 3 px/tick faster both ways (9 px/tick out, about 234 px, 8.8 back);
// - bomb: level 2's blast is ±32 px (bombs.ts), its fuse and count as level 1's.
// An orb's cucco and carrot aren't held: the cucco flies off as the orb breaks (cucco.ts), the carrot calls Epona when
// touched (epona.ts, whose ride runs here). The Four Sword isn't held either: taking it makes the Link's sword level 2
// (orbs.ts giveItem; combat.ts).
import type { BattleState } from "./battle.ts";
import { BOMB_FUSE } from "./bombs.ts";
import { stopActing, type Fighter } from "./combat.ts";
import { stepCucco } from "./cucco.ts";
import { FACING_STEP, isRemoved, spawnEntity, type Entity } from "./entities.ts";
import { stepRide, trample } from "./epona.ts";
import type { GameState } from "./game.ts";
import { sumTicks, USE, USE_RELEASE_TICK, USE_WALK } from "./moveframes.ts";
import { ARROW_SPEED, BOOMERANG_LEVEL2, SEED_SIDE, SEED_SPEED, shoot, SHOT_DRAWN, SHOT_SPAWN } from "./projectiles.ts";
import { Button, moveAxis, SUBPX } from "./player.ts";
import { CHARGE } from "./animations.ts";
import { startDash } from "./boots.ts";
import { startFireRod } from "./firerod.ts";
import { startHammer } from "./hammer.ts";
import type { World } from "./world.ts";

export const MAX_BOMBS = 2; // a Link's bombs out at once, either level (traced)
export const BOMB_PLACE_DISTANCE = 13; // px in front (measured)
/** Arrows a Link can have out (flying or stuck in a wall) by the bow's level; past that the pose plays empty (main.dol
 *  0x8025C894's two arrow slots, the second for level 2). */
export const MAX_ARROWS = [1, 1, 2] as const;
/** Seeds out at once (0x8025BEB0's three slots). */
export const MAX_SEEDS = 3;
/** The draw counter: it counts from the pose's 7th tick, `drawStep` a tick, and a shot is drawn at DRAW_FULL. */
export const DRAW_FULL = 48;
export const drawStep = (f: Pick<Fighter, "item" | "itemLevel">) => (f.item === "bow" && f.itemLevel >= 2 ? 2 : 1);
/** Is a shot leaving on pose tick `moveTick` drawn? */
export const isDrawn = (f: Pick<Fighter, "item" | "itemLevel">, moveTick: number) => drawStep(f) * (moveTick - (USE_RELEASE_TICK - 1)) >= DRAW_FULL;
/** The pose's last ticks after the shot: b+2 ×3, b+3 ×4 (traced). */
export const USE_AFTER_TICKS = 8;
export const USE_TICKS = { bow: USE_RELEASE_TICK + USE_AFTER_TICKS, slingshot: USE_RELEASE_TICK + USE_AFTER_TICKS, boomerang: sumTicks(USE.boomerang.ticks) } as const;
export const BOOMERANG_OUT = 6; // px in front where it appears (measured)
const own = (b: BattleState, kind: Entity["kind"], i: number) => b.entities.filter((e) => e.kind === kind && e.owner === i && !isRemoved(e)).length;

/**
 * The Item button: uses the item in hand. Returns true when a pose starts (the press tick shows walking; the pose plays
 * from the next tick), false when the tick carries on as usual (a bomb put down, nothing to do).
 */
export function useItem(state: GameState, i: number): boolean {
  const b = state.battle!, p = state.players[i]!, f = b.fighters[i]!;
  const [sx, sy] = FACING_STEP[p.facing];
  switch (f.item) {
    case "bomb":
      if (own(b, "bomb", i) < MAX_BOMBS) {
        const d = BOMB_PLACE_DISTANCE * SUBPX;
        spawnEntity(b, "bomb", p.x + sx * d, p.y + sy * d, { owner: i, timer: BOMB_FUSE, angle: f.itemLevel });
      }
      return false;
    case "bow":
    case "slingshot":
      break; // (the pose plays whether or not a shot can leave: release)
    case "boomerang":
      if (own(b, "boomerang", i) > 0) return false;
      break;
    case "boots":
      startDash(f); // (the press tick walks on: traced)
      return false;
    case "hammer":
      startHammer(p, f); // (hammer.ts)
      return true;
    case "fireRod":
      startFireRod(p, f); // (firerod.ts)
      return true;
    default:
      return false; // nothing in hand (an orb's cucco and carrot act at once: orbs.ts)
  }
  stopActing(p);
  f.move = "use";
  f.moveTick = -1;
  f.shot = -1;
  return true;
}

// The shot of a bow, slingshot or boomerang pose, on its release tick.
function release(state: GameState, i: number): void {
  const b = state.battle!, p = state.players[i]!, f = b.fighters[i]!;
  const [sx, sy] = FACING_STEP[p.facing];
  const drawn = isDrawn(f, f.moveTick), param = drawn ? SHOT_DRAWN : 0;
  if (f.item === "bow") {
    if (own(b, "arrow", i) < MAX_ARROWS[Math.min(2, f.itemLevel)]!) shoot(b, "arrow", i, p, sx * ARROW_SPEED, sy * ARROW_SPEED, 8, param);
  } else if (f.item === "boomerang") {
    // (Level 2 appears 3 px further, its first step's extra: traced at 9, 18, 27… px.)
    shoot(b, "boomerang", i, p, 0, 0, BOOMERANG_OUT + (f.itemLevel >= 2 ? BOOMERANG_LEVEL2 / SUBPX : 0), f.itemLevel);
  }
  else if (f.item === "slingshot") {
    const out = own(b, "seed", i);
    if (drawn && f.itemLevel >= 2 && out === 0) {
      // Three: along the facing, and 45° to either side, from 5 px behind the middle one's start (traced).
      shoot(b, "seed", i, p, sx * SEED_SPEED, sy * SEED_SPEED, 8, param);
      const [ox, oy] = SHOT_SPAWN[p.facing];
      for (const side of [-1, 1]) {
        const vx = sx ? sx * SEED_SIDE : side * SEED_SIDE, vy = sy ? sy * SEED_SIDE : side * SEED_SIDE;
        const seed = shoot(b, "seed", i, p, vx, vy, 8, param);
        seed.x = p.x + ox * SUBPX - sx * SEED_SPEED + vx;
        seed.y = p.y + oy * SUBPX - sy * SEED_SPEED + vy;
      }
    } else if (out < MAX_SEEDS) shoot(b, "seed", i, p, sx * SEED_SPEED, sy * SEED_SPEED, 8, param);
  }
}

function endUse(p: GameState["players"][number], f: Fighter): void {
  f.move = "none";
  f.moveTick = 0;
  f.shot = -1;
  p.moving = false;
  p.walkTicks = 0;
}

/** Walking while drawing: the charge's speed, the facing kept, the walk cycle USE_WALK (traced). */
function drawWalk(p: GameState["players"][number], buttons: number, world: World): void {
  const dx = (buttons & Button.Right ? 1 : 0) - (buttons & Button.Left ? 1 : 0);
  const dy = (buttons & Button.Down ? 1 : 0) - (buttons & Button.Up ? 1 : 0);
  p.moving = dx !== 0 || dy !== 0;
  p.walkTicks = p.moving ? (p.walkTicks + 1) % USE_WALK.cycle : 0;
  if (!p.moving) return;
  const straight = dx === 0 || dy === 0;
  const speed = straight ? CHARGE.speed : CHARGE.speedDiagonal;
  moveAxis(p, world, dx * speed, "x", straight);
  moveAxis(p, world, dy * speed, "y", straight);
}


/** The pose's second frame, from which a drawing Link can walk (traced from its 10th tick; assumed from its first). */
const DRAW_WALK_FROM = USE.bow.ticks[0]!;

/** The bow, slingshot and boomerang poses, and riding Epona (epona.ts). */
export function stepItemMove(state: GameState, i: number, buttons: number, world: World): boolean {
  const p = state.players[i]!, f = state.battle!.fighters[i]!;
  if (f.move === "use") {
    p.held = buttons;
    f.moveTick++;
    if (f.item !== "bow" && f.item !== "slingshot") {
      // The boomerang (or an item lost meanwhile): a fixed pose.
      if (f.moveTick === USE_RELEASE_TICK) release(state, i);
      if (f.moveTick >= USE_TICKS.boomerang) endUse(p, f);
      return true;
    }
    if (f.shot < 0) {
      const holding = (buttons & Button.Item) !== 0;
      if (f.moveTick >= USE_RELEASE_TICK && !holding) {
        p.moving = false;
        p.walkTicks = 0;
        release(state, i);
        f.shot = f.moveTick;
      } else if (f.moveTick >= DRAW_WALK_FROM) drawWalk(p, buttons, world);
    } else if (f.moveTick - f.shot >= USE_AFTER_TICKS) endUse(p, f);
    return true;
  }
  if (f.move !== "ride") return false;
  stepRide(p, f, buttons, world);
  return true;
}

/** Item effects after the Links moved: Epona trampling, the cuccos' errands. */
export function stepItemEffects(state: GameState): void {
  const b = state.battle!;
  b.fighters.forEach((f, i) => {
    if (f.move === "ride" && f.mode === "active") trample(state, i);
  });
  for (const e of b.entities) if (e.kind === "cucco" && !isRemoved(e)) stepCucco(state, e);
}
