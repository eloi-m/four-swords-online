// What happens when a sword, a shot, an explosion or a thrown thing strikes something that isn't a Link: orbs break
// and release their item, pots and bushes break, soldiers take damage, bees die (and wake the others), and bush tiles
// get cut. Swords striking entities and bushes are handled here too (`swordStrikes`).
import { swordHitbox } from "./actions.ts";
import { bootsAttack, BOOTS_POWER, swordAttack, type SubBox } from "./attacks.ts";
import type { BattleState } from "./battle.ts";
import { hurtbox, hurtFighter, vulnerable, type Fighter, type PixelBox } from "./combat.ts";
import { boxAround, boxesOverlap, distance2, isRemoved, removeEntity, setPhase, spawnEntity, TILE, ROOM_TILES_X, velocityAlong, type Entity } from "./entities.ts";
import type { GameState } from "./game.ts";
import { bombchuArmed, explodeBombchu } from "./bombchus.ts";
import { strikeBigBomb } from "./giantbomb.ts";
import { strikeHen } from "./hens.ts";
import { breakOrb } from "./orbs.ts";
import { ballClanks, BALL_SOLDIER, BOWMAN, CAPTAIN, shieldStops, SOLDIER_ARROW_HALF, strikeBallSoldier } from "./castlesoldiers.ts";
import { SUBPX, type PlayerState } from "./player.ts";

export const SOLDIER_HP = 1; // SLR1 kind 2 (Hyrule Castle's): life 1 in the kind table at 0x8049FA40
/** An SLR1's life by its kind (params & 7: the table at 0x8049FA40); traced: the GEN3 0x1B soldier's 16. */
export const SOLDIER_LIFE: readonly number[] = [12, 12, 1, 12, 16, 8, 20];
export const soldierLife = (params: number): number => SOLDIER_LIFE[params & 7] ?? SOLDIER_HP;
/** A soldier's first look standing (hazards.ts `patrol`: SLR1 state 3's first 8 ticks). */
export const SOLDIER_FIRST_LOOK = 8;
/** A new soldier's fields: its life, standing on its first round of looks (hazards.ts `patrol`). */
export const newSoldier = (params: number): Partial<Entity> => ({ hp: soldierLife(params), param: 1 << 2, timer: SOLDIER_FIRST_LOOK });
/** A stage soldier killed doesn't come back at home (traced: Hyrule Castle's, not back 1077 frames later); the castle's
 *  GEN3 spawners bring new ones through the switch network (switches.ts). */
/**
 * A soldier struck and still standing (traced: a 16-life one stabbed, SLR1 state 4) is knocked away from the attacker
 * at 16 px/tick, × 0.78 each tick before it moves (12.48, 9.73, 7.60 … px: 56.7 px in all), for 25 ticks; then its
 * wind-up (state 5, 20 ticks) and a chase.
 */
export const SOLDIER_STUN_TICKS = 25;
export const SOLDIER_STUN_SPEED = 16 * 256;
export const SOLDIER_STUN_DECAY = 78; // /100 a tick
export const BEE_RESPAWN_TICKS = 600; // TODO(measure)
export const BEE_WAKE_RADIUS = 32; // px: a bee struck dead this close to a resting one sends it after the Links. TODO(measure)
/** A ground impact this close to The Field's bees wakes them (BEEE kind 0: 6400 = 80²; kind 1's 64 isn't in battle). */
export const BEE_WAKE_DISTANCE = 80;
export const BEE_CHASE_TICKS = 480; // TODO(measure): still chasing 400 ticks on (traced)
export const BEE_WAKE_TICKS = 92; // out of the tree and hovering before it flies (traced: hazards.ts stepBee)

/** Debris kinds (Entity.param of a "debris" effect). */
export const DEBRIS = { bush: 0, pot: 1, orb: 2, soldier: 3, bee: 4, smoke: 5 } as const;
export const DEBRIS_TICKS = 16;

/**
 * Damage of a thrown or slammed load on a Link: its enemyparam.csv atcp (TUBO pot 2, GRAS grass 1, CRTL crystal ball 2,
 * THCL "attack when a player is thrown" 2), which main.dol's flight code passes in multiplayer (0 when playing alone),
 * hit type 1 (type 4 for a thrown Link). Thrown bombs don't hurt by themselves.
 */
export const THROWN_DAMAGE: Readonly<Record<string, number>> = { pot: 2, bush: 1, orb: 2, link: 2 };

/**
 * A load (kind "link", "bush", "pot", "orb", "bomb") slammed onto the ground at (x, y) (1/256 px): the Links there
 * (except `skip`) take its thrown damage, and what can be struck is struck. TODO(measure) (the slam's effect in battle).
 */
export function strikeAt(state: GameState, attacker: number, x: number, y: number, load: string, skip: readonly number[]): void {
  const b = state.battle!;
  const damage = THROWN_DAMAGE[load] ?? 0;
  const box = boxAround(x, y, 6);
  if (damage > 0) {
    state.players.forEach((p, j) => {
      const f = b.fighters[j]!;
      if (skip.includes(j) || !vulnerable(f) || !boxesOverlap(box, hurtbox(p))) return;
      const hit = hurtFighter(p, f, j, damage, x, y, { attacker, cause: "slam" });
      if (hit) b.hits.push(hit);
    });
  }
  for (const e of struckBy(b, box)) strikeEntity(b, e, Math.max(1, damage), x, y);
  // A pot tile under the slam breaks and uncovers its switch (0x802A3164, called at the slam's impact point).
  for (const tile of potsIn(b, box)) {
    b.cut.push(tile);
    const tx = ((tile % ROOM_TILES_X) * TILE + TILE / 2) * SUBPX, ty = (Math.floor(tile / ROOM_TILES_X) * TILE + TILE / 2) * SUBPX;
    spawnEntity(b, "debris", tx, ty, { param: DEBRIS.pot, timer: DEBRIS_TICKS, home: tile });
  }
}

/** Unbroken pot tiles overlapping a pixel box. */
export function potsIn(b: BattleState, box: PixelBox): number[] {
  return (b.props.pots ?? []).filter((tile) => !b.cut.includes(tile) && tileInBox(tile, box));
}

function tileInBox(tile: number, box: PixelBox): boolean {
  const tx = (tile % ROOM_TILES_X) * TILE, ty = Math.floor(tile / ROOM_TILES_X) * TILE;
  return box.left <= tx + TILE - 1 && tx <= box.right && box.top <= ty + TILE - 1 && ty <= box.bottom;
}

/** Entity box half sizes (px) for strikes. */
export function strikeHalf(e: Entity): number {
  switch (e.kind) {
    case "soldier":
      return 7;
    case "bowSoldier":
      return BOWMAN.half;
    case "captain":
      return CAPTAIN.half;
    case "ballSoldier":
      return BALL_SOLDIER.half;
    case "soldierArrow":
      return SOLDIER_ARROW_HALF;
    case "bee":
      return 5;
    case "bombchu":
      return 8;
    case "bigBomb":
      return 24;
    default:
      return 7;
  }
}

/** Sends resting bees near (x, y) (1/256 px) after the Links. */
export function disturb(b: BattleState, x: number, y: number): void {
  for (const e of b.entities) {
    if (e.kind !== "bee" || e.phase !== "rest") continue;
    if (distance2(e.x, e.y, x, y) > BEE_WAKE_RADIUS * BEE_WAKE_RADIUS) continue;
    setPhase(e, "chase");
    // Out of its tree and hovering before it flies (hazards.ts stepBee).
    Object.assign(e, { timer: BEE_CHASE_TICKS, param: BEE_WAKE_TICKS, angle: 0, vx: 0, vy: 0, target: -1 });
  }
}

/**
 * Strikes an entity with `damage` from (x, y). Returns true when it reacted (a shot stops there). The attacker may be
 * -1 (the arena). A `sword` stroke from ahead of a captain meets his shield.
 */
export function strikeEntity(b: BattleState, e: Entity, damage: number, x: number, y: number, sword = false): boolean {
  if (isRemoved(e)) return false;
  switch (e.kind) {
    case "orb":
      if (e.phase === "held") return false;
      breakOrb(b, e);
      return true;
    case "pot":
    case "bush":
      if (e.phase === "held") return false;
      removeEntity(e);
      spawnEntity(b, "debris", e.x, e.y, { param: e.kind === "pot" ? DEBRIS.pot : DEBRIS.bush, timer: DEBRIS_TICKS });
      return true;
    case "soldier":
    case "bowSoldier":
    case "captain": {
      if (e.phase === "stun") return true;
      // An enemy takes the attack's power, twice what a Link takes (traced: a stab 4 off a 16-life soldier); a
      // captain's shield takes a sword from the Link he faces: no harm, he's pushed back (castlesoldiers.ts).
      if (!(sword && e.kind === "captain" && shieldStops(e, x, y))) e.hp -= 2 * Math.max(1, damage);
      if (e.hp <= 0) {
        removeEntity(e);
        spawnEntity(b, "debris", e.x, e.y, { param: DEBRIS.soldier, timer: DEBRIS_TICKS });
        return true;
      }
      [e.vx, e.vy] = velocityAlong(e.x - x, e.y - y, SOLDIER_STUN_SPEED);
      if (!e.vx && !e.vy) [e.vx, e.vy] = [0, SOLDIER_STUN_SPEED]; // (struck from its own spot)
      setPhase(e, "stun");
      return true;
    }
    case "ballSoldier":
      return strikeBallSoldier(b, e, damage, x, y); // (its ball is struck by nothing: a sword clanks on it, swordStrikes)
    case "soldierArrow":
      removeEntity(e); // (struck out of the air, as the adventure's)
      return true;
    case "bee":
      removeEntity(e);
      spawnEntity(b, "debris", e.x, e.y, { param: DEBRIS.bee, timer: DEBRIS_TICKS });
      if (e.home >= 0) b.respawn[e.home] = BEE_RESPAWN_TICKS;
      disturb(b, e.x, e.y);
      return true;
    case "hen":
      return strikeHen(e); // (hens.ts: it counts the hits, and gets angry)
    case "bombchu":
      // A Link's attack sets it off, once it's armed (0x801F305C: bombchus.ts).
      if (!bombchuArmed(b, e)) return false;
      explodeBombchu(b, e);
      return true;
    case "bigBomb":
      return strikeBigBomb(e); // 60 ticks off its fuse (giantbomb.ts)
    default:
      return false;
  }
}

/** Entities a strike can hit, whose box overlaps `box`. */
export function struckBy(b: BattleState, box: PixelBox): Entity[] {
  return b.entities.filter((e) => {
    if (isRemoved(e) || e.phase === "held") return false;
    return STRIKABLE.has(e.kind) && boxesOverlap(box, boxAround(e.x, e.y, strikeHalf(e)));
  });
}

const STRIKABLE = new Set(["orb", "pot", "bush", "soldier", "bowSoldier", "captain", "ballSoldier", "soldierArrow", "bee", "bombchu", "bigBomb", "hen"]);

/** Cuts the bush tile `tile` (ty * 32 + tx) if it's an uncut bush. Returns true when it did. */
export function cutBush(b: BattleState, tile: number): boolean {
  if (!b.props.bushes.includes(tile) || b.cut.includes(tile)) return false;
  b.cut.push(tile);
  const x = ((tile % ROOM_TILES_X) * TILE + TILE / 2) * SUBPX, y = (Math.floor(tile / ROOM_TILES_X) * TILE + TILE / 2) * SUBPX;
  spawnEntity(b, "debris", x, y, { param: DEBRIS.bush, timer: DEBRIS_TICKS, home: tile });
  return true;
}

/** Uncut bush tiles overlapping a pixel box. */
export function bushesIn(b: BattleState, box: PixelBox): number[] {
  return b.props.bushes.filter((tile) => !b.cut.includes(tile) && tileInBox(tile, box));
}

/** Swords striking entities and bushes this tick (after the Links moved). */
export function swordStrikes(state: GameState): void {
  const b = state.battle!;
  state.players.forEach((p, i) => {
    const f = b.fighters[i]!;
    if (f.mode !== "active") return;
    if (f.move === "dash") return dashStrikes(b, p, f);
    const sword = swordHitbox(p);
    if (!sword || ballClanks(state, i, sword)) return;
    // (A Link's share of the attack's power: the stab's 2, the spin's 4…; strikeEntity doubles it for the soldiers.)
    const damage = Math.max(1, (swordAttack(p, f.swordLevel)?.power ?? 2) >> 1);
    for (const e of struckBy(b, sword)) strikeEntity(b, e, damage, p.x, p.y, true);
    for (const tile of bushesIn(b, sword)) cutBush(b, tile);
  });
}

/**
 * The boots' dash strikes what a sword strikes (boots.ts): its state sets +0x458 = 1 and the attack power +0xBF4 = 6
 * (entry 0x8025E79C → 0x8027221C), and the actors' test for a Link's attack (0x8023B8E4 / 0x8023B9CC → 0x80274238 →
 * 0x802738F0) reads only that flag and the two boxes at +0x4A0, so the dash's trailing boxes (attacks.ts bootsAttack)
 * break orbs and pots, cut bushes and hit soldiers and bees, from the state's first tick. What an actor takes is
 * 0x802721A8's power: +0xBF4, +2 with a level-2 sword (the Four Sword), halved here as for the sword. Read from main.dol;
 * nothing of it traced (TODO(measure)): the bush tiles' own path, and a dash into a ball soldier's ball (no clank
 * modelled: a sword is stopped, the dasher isn't).
 */
function dashStrikes(b: BattleState, p: PlayerState, f: Fighter): void {
  if (f.moveTick < 0) return; // (the press tick)
  const power = BOOTS_POWER + (f.swordLevel >= 2 ? 2 : 0), damage = power >> 1;
  const boxes = bootsAttack(p, f.flyX, f.flyY).boxes.map(pixelBox);
  const struck = new Set(boxes.flatMap((box) => struckBy(b, box)));
  for (const e of struck) strikeEntity(b, e, damage, p.x, p.y);
  for (const box of boxes) for (const tile of bushesIn(b, box)) cutBush(b, tile);
}

const pixelBox = (box: SubBox): PixelBox => ({ left: Math.floor(box.left / SUBPX), top: Math.floor(box.top / SUBPX), right: Math.floor(box.right / SUBPX), bottom: Math.floor(box.bottom / SUBPX) });

/**
 * A Link's ground impact at (x, y) (1/256 px) wakes the resting bees within `reach` px. Only that wakes them (main.dol:
 * their idle state 0x8034423C asks 0x8026FCE0 for a nearby Link's +0xB9A hammer pound, +0xB9C boots crash or +0xB9D
 * ground impact): in Dolphin neither a sword swung 56 px away nor bombs going off 24-26 px away woke them.
 */
export function wakeBees(b: BattleState, x: number, y: number, reach: number): void {
  for (const e of b.entities) if (e.kind === "bee" && e.phase === "rest" && distance2(e.x, e.y, x, y) <= reach * reach) disturb(b, e.x, e.y);
}
