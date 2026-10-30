// CPU opponents for Shadow Battle: a battle AI that plays one Link through the same button mask a player's pad gives
// (player.ts Button), one tick at a time. A CPU slot therefore works wherever a human one does: local matches, and
// online, where every peer computes the CPUs' buttons inside the game step (nothing is sent; spectators and rollback
// replay it like everything else). Deterministic: the buttons are a pure function of the game state, in integer math;
// what a CPU remembers (its target, plan, waypoint, a charge in progress, its own random generator) is a flat record in
// BattleState.cpus, so cloneGame and hashGame cover it. Navigation is cpunav.ts (walkable cells, distance fields).
//
// A CPU thinks every few ticks (its reaction time) and picks a plan: fight the rival it can reach (the nearest, the
// current one favored, on the same screen), fetch an item a broken orb dropped, break an orb when it has no item, keep
// away from healthier rivals when low on hearts. The doors to the side rooms are walls to it (cpunav.ts) unless it means
// to go through one: after a rival who is in a side room (nobody left to fight on its screen), out of a side room with
// nobody in it, or into the Tower of Winds' gallery while the giant bomb burns on the TV ("warp" plan). On a side-view
// screen it walks, climbs ladders and drops off ledges (cpunav.ts's side-view moves), steering clear of cannons as it
// falls. Between decisions it walks its plan (straight when the way is
// clear, else down a distance field), steers around pits and hazards every tick (fire bars, jets, flames, BLZE flames,
// burning Links, explosions, bombs about to go off, a trick floor about to open; for the better levels also shots,
// fireballs, and rivals about to spin), steers its run when set alight (off pits, walls and swords, into water or a
// rival),
// swats soldiers and bees in its way, and plays out what it started: turning to face a rival before the swing, holding a charge until the spin can reach, cooking a bomb
// before throwing it, mashing free when held. Its attacks: the swing (a press while walking), stab, lunge, charge and
// spin, lift and throw (into a pit when one is in range), rolling in, and the items (bow, slingshot and boomerang along
// a clear line, the Fire Rod's fireball, bombs, the cucco, Epona; the Pegasus Boots' dash at a rival ahead, held and
// steered onto him; the hammer's pound on a rival in front, or held to a charged pound whose impact makes a rival close
// by hop and land dizzy). A raised shield gets gone round, spun through, lifted, or (easy) hit anyway.
// The arena's switches (cpuswitches.ts): a floor switch or crystal whose attack would catch more rivals than itself
// gets pressed ("press": its pot or bush lifted off first, then stood on) or lit ("light": a bomb thrown against it);
// for an attack on the whole TV, a hard CPU goes into the side room it's in ("trip"). Crystals lit together (an SWT4
// over several: the Tower of Winds' gallery, Hyrule Castle's dark side) get a blast on each of their spots before the
// first goes out ("volley": its bombs put down by them, or, under crystals overhead in side view, thrown up to blow
// against them, one VOLLEY_GAP after the other). With a rival in a side room and nobody on the TV, a CPU near its door
// or hole throws a bomb or a pot into it at him ("toss": things thrown in come out of the other side, siderooms.ts).
// The difficulty levels differ in reaction time, reach accuracy, aggression, tricks and switches (TUNING).
import { isAttack, isFullyCharged } from "./actions.ts";
import type { BattleState } from "./battle.ts";
import { LUNGE, SPIN, STAB, SWING, SWORD_BOXES } from "./animations.ts";
import { BOMBCHU_HALF, bombchuArmed } from "./bombchus.ts";
import { BLAST_GIANT, BLAST_HALF, blastTicks, BOMB_FUSE } from "./bombs.ts";
import { BODY_HALF, BOOTS } from "./attacks.ts";
import { isCarrying, LIFT_REACH, LIFT_TICKS, liftTarget } from "./carry.ts";
import { AWAY, HEART, HURTBOX, PIT_PROBE, shieldBlocks, shieldUp, type Fighter, type PixelBox } from "./combat.ts";
import { cellAt, cellX, cellY, fieldGoal, flowField, lineClear, NAV, navGrid, nearestInRegion, nearestWalkable, nextStep, openSpots, pitAt, region, runClear, safeCell, sideStep, solidGround, UNREACHABLE, walkable, type NavGrid } from "./cpunav.ts";
import { battleWorld, cos4096, entityById, FACING_STEP, isqrt, isRemoved, ROOM_TILES_X, sin4096, TILE, TRAPDOOR_TILES, TRIG_ONE, type Entity } from "./entities.ts";
import type { GameState } from "./game.ts";
import { FIRE_ROD, HAMMER, hammerCharged, POUND_AT } from "./itemframes.ts";
import { BLAZE, BURNING } from "./firerod.ts";
import { FIREBALL_HALF, FIREBAR_RING, firebarSpeed, FLAME_HALF, flameLit, jetBox, JET_HURT_SIZE, switchCovered } from "./hazards.ts";
import { BOMB_PLACE_DISTANCE, MAX_BOMBS } from "./items.ts";
import { takenByHand, takeTarget } from "./orbs.ts";
import { Button, moveAxis, SUBPX, WALK_SPEED, WALK_SPEED_DIAGONAL, type Facing, type PlayerState } from "./player.ts";
import { PANEL_DEFAULT_PERIOD, PANEL_PERIOD_UNIT } from "./panels.ts";
import { BIG_BOMB } from "./giantbomb.ts";
import { battleWarps, DOOR_STYLES, GATE_STYLES, HOLE_STYLE, inWarp, launchFlying, sameScreen, screenAt, sideViewAt, SPOT_STYLE, type Warp } from "./siderooms.ts";
import { caughtBy, switchTriggers, volleyOf, type BlastSpot, type SwitchAttack, type Trigger, type Volley } from "./cpuswitches.ts";
import { ownSwitch, switchOn } from "./switches.ts";
import { CELL, isSolidAt, surfaceAt, type World } from "./world.ts";

export const CPU_LEVELS = ["easy", "normal", "hard"] as const;
export type CpuLevel = (typeof CPU_LEVELS)[number];

/** What a CPU is up to between decisions. */
export type CpuPlan = "fight" | "pickup" | "orb" | "retreat" | "bomb" | "roam" | "warp" | "press" | "light" | "trip" | "volley" | "toss";

/** A move a CPU has started and plays out over the next ticks (turning first, letting go of a button before a press). */
export type CpuAct = "" | "swing" | "stab" | "lunge" | "charge" | "item" | "lift" | "roll" | "throw" | "face";

/** One CPU's memory: plain numbers and strings, part of the game state (BattleState.cpus). */
export interface CpuBrain {
  player: number;
  level: CpuLevel;
  rng: number; // its own xorshift32 state (the battle's generator stays the orbs')
  plan: CpuPlan;
  target: number; // the rival (player index) the plan is about, -1 = none
  thing: number; // the entity (id) the plan is about: an orb, a pickup, a bomb, a critter; the warp (index + 1); 0 = none
  goalX: number; // where the plan leads, px: the distance field's goal while the way isn't straight
  goalY: number;
  offX: number; // fighting: where to stand relative to the rival, px (0, 0 = straight at him)
  offY: number;
  think: number; // ticks to the next decision
  planTicks: number; // ticks since the plan was picked
  act: CpuAct;
  actDir: number; // the direction (buttons) the act faces, 0 = as he is
  actTicks: number;
  charge: number; // ticks the sword has been held for a spin, 0 = not charging
  hold: number; // ticks it may go on holding the item button (the boots' dash, the hammer's charge), 0 = let go
  wait: number; // ticks left walking `waitDir` whatever the plan (hesitating, getting unstuck), 0 = none
  waitDir: number;
  stuck: number; // ticks it has been walking without moving
  lastX: number; // px, last tick
  lastY: number;
  closest: number; // fighting: the closest (px, Manhattan) it got to the rival in this plan…
  closestTick: number; // …and when (planTicks)
}

interface Tuning {
  think: number; // ticks between decisions…
  jitter: number; // …plus 0 to jitter - 1
  slack: number; // px added to the sword's reach on SLACK_CHANCE of decisions to swing (more: swings from too far)
  whiff: number; // ‰ per decision: swing at a rival who is merely close (≤ 44 px)
  flank: number; // ‰: go round a raised shield rather than hit it
  charge: number; // ‰: start charging a spin at a rival 48-80 px ahead (twice that when his shield faces us)
  lunge: number; // ‰: lunge at a rival 30-60 px ahead whose shield doesn't face us
  roll: number; // ‰: roll toward a rival 40-70 px ahead
  dodge: number; // ‰: face a rival swinging nearby (his hits land on the shield); > 0: mind shots and charged rivals
  lift: number; // ‰: lift a rival in reach instead of swinging (twice that against a raised shield)
  mash: number; // ticks per escape press while held
  hesitate: number; // ‰ per decision: stand still until the next one
  cautious: number; // hearts (quarters) at or under which it keeps away from healthier rivals; 0 = never
  predict: number; // ticks of a rival's walk it leads its swings by
  item: number; // ‰ per decision: use the item in hand when it could
  bombFuse: number; // a carried bomb is thrown with this much fuse left (it lands about 35 ticks after the press)
  orbs: number; // ‰ per decision: go for an orb (with no item in hand)
  placement: number; // ‰ per decision: mind pits when picking where to stand (none behind us; hard: one behind him)
  switches: number; // ‰ per decision: look for a floor switch or crystal that sets off an attack on rivals (cpuswitches.ts)
  trips: number; // ‰ of those: also into a side room for one whose attack reaches the whole TV (bombchus, the giant bomb)
  tosses: number; // ‰ per decision: throw a load into a side room at a rival in it (nobody on the TV), from by its door
  burnLook: number; // burning (firerod.ts): ticks of each way's run it looks ahead…
  burnEvery: number; // …and how often (ticks) it steers
  burnWater: number; // …px of walking within which it makes for shallow water (it puts him out), 0 = never
  spread: number; // …px within which it runs into a rival to set him alight too, 0 = never
}

export const TUNING: Readonly<Record<CpuLevel, Tuning>> = {
  easy: { think: 20, jitter: 14, slack: 6, whiff: 250, flank: 250, charge: 40, lunge: 30, roll: 0, dodge: 0, lift: 40, mash: 9, hesitate: 200, cautious: 0, predict: 0, item: 250, bombFuse: 95, orbs: 400, placement: 0, switches: 0, trips: 0, tosses: 0, burnLook: 12, burnEvery: 4, burnWater: 0, spread: 0 },
  normal: { think: 10, jitter: 8, slack: 2, whiff: 50, flank: 550, charge: 120, lunge: 70, roll: 60, dodge: 450, lift: 120, mash: 5, hesitate: 40, cautious: HEART, predict: 2, item: 600, bombFuse: 65, orbs: 700, placement: 500, switches: 120, trips: 0, tosses: 400, burnLook: 40, burnEvery: 1, burnWater: 120, spread: 60 },
  hard: { think: 4, jitter: 4, slack: 2, whiff: 0, flank: 850, charge: 150, lunge: 110, roll: 140, dodge: 900, lift: 220, mash: 3, hesitate: 0, cautious: HEART, predict: 4, item: 900, bombFuse: 48, orbs: 900, placement: 1000, switches: 450, trips: 500, tosses: 800, burnLook: 60, burnEvery: 1, burnWater: 200, spread: 90 },
};

const DIRS = Button.Up | Button.Down | Button.Left | Button.Right;
const FACING_BUTTON: Readonly<Record<Facing, number>> = { right: Button.Right, left: Button.Left, down: Button.Down, up: Button.Up };
const FACINGS: readonly Facing[] = ["right", "left", "down", "up"];
const px = (v: number) => Math.floor(v / SUBPX);
const ACT_TIMEOUT = 12; // ticks an act may take (turning, walking a tick, letting go) before it's dropped
const CHARGE_GIVE_UP = 200; // ticks holding the sword before letting go anyway
const CLOSE = 44; // px: a whiff's range
const WALK_LOOK = 6; // px ahead checked for pits and hazards while walking…
const RIDE_LOOK = 14; // …and riding Epona
const STUCK_TICKS = 30;
const PICKUP_RANGE = 120; // px
const CRITTER_RANGE = 40; // px: soldiers and bees closer than this get swatted
const HOVER = 34; // px from a rival who can't be hit right now
const SLACK_CHANCE = 350; // ‰ of swing decisions that use the level's reach slack
const CHASE_TICKS = 300; // fighting without getting closer for this long: wait for him
const RETREAT_TICKS = 360; // then it fights for a while (FIGHT_BACK_TICKS) before keeping away again
const FIGHT_BACK_TICKS = 240;
const SHOT_RANGE: Readonly<Record<string, number>> = { bow: 220, slingshot: 90, boomerang: 100, fireRod: 140 };
const DASH_RANGE = 200; // px along the dash's line to a rival it runs at with the boots…
const DASH_MIN = 28; // …and at least this (closer, the sword)

// --- the sword's reach ---

/** Per frame of an attack: the box (px, relative to the attacker's anchor) its sword covers. */
type Reach = readonly (readonly [number, number, number, number])[];
const LINK_BOX: PixelBox = HURTBOX;
const ORB_BOX: PixelBox = { left: -7, top: -7, right: 6, bottom: 6 }; // strike.ts: ±7 px (bees ±5)

/** Each frame's sword box; for the lunge, each frame stretched over how far the dash goes while it shows. */
function frameBoxes(frames: readonly number[], ticks: readonly number[], facing: Facing, dash: number, dashTicks: number): Reach {
  const [sx, sy] = FACING_STEP[facing];
  const out: [number, number, number, number][] = [];
  let t = 0;
  frames.forEach((frame, k) => {
    const box = SWORD_BOXES[frame];
    const from = Math.min(t, dashTicks) * dash, to = Math.min(t + ticks[k]!, dashTicks) * dash;
    t += ticks[k]!;
    if (!box) return;
    const [l, tp, r, b] = box;
    out.push([l + Math.min(sx * from, sx * to), tp + Math.min(sy * from, sy * to), r + Math.max(sx * from, sx * to), b + Math.max(sy * from, sy * to)]);
  });
  return out;
}

const reachTable = (a: { frames: Readonly<Record<Facing, readonly number[]>>; ticks: readonly number[] }, dash = 0, dashTicks = 0) =>
  Object.fromEntries(FACINGS.map((f) => [f, frameBoxes(a.frames[f], a.ticks, f, dash, dashTicks)])) as Record<Facing, Reach>;
const SWING_REACH = reachTable(SWING);
const STAB_REACH = reachTable(STAB);
const LUNGE_REACH = reachTable(LUNGE, LUNGE.speed / SUBPX, LUNGE.moveTicks);
const SPIN_REACH = reachTable(SPIN);

/** Can a frame of `reach` touch a target `box` whose anchor is (rx, ry) px from the attacker's, give or take `slack`? */
function canHit(reach: Reach, rx: number, ry: number, box: PixelBox, slack: number): boolean {
  for (const [l, t, r, b] of reach) {
    if (rx + box.left <= r + slack && l - slack <= rx + box.right && ry + box.top <= b + slack && t - slack <= ry + box.bottom) return true;
  }
  return false;
}

// --- CPU players in a battle ---

/** A new CPU for player `player`, its generator seeded from `seed` (the battle's: every peer builds the same one). */
export function createCpu(player: number, level: CpuLevel, seed: number): CpuBrain {
  let rng = Math.imul((seed >>> 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(player + 1, 0xc2b2ae35);
  rng = (rng ^ (rng >>> 15)) >>> 0 || 1;
  return {
    player,
    level,
    rng,
    plan: "roam",
    target: -1,
    thing: 0,
    goalX: 0,
    goalY: 0,
    offX: 0,
    offY: 0,
    think: 1 + player * 2,
    planTicks: 0,
    act: "",
    actDir: 0,
    actTicks: 0,
    charge: 0,
    hold: 0,
    wait: 0,
    waitDir: 0,
    stuck: 0,
    lastX: 0,
    lastY: 0,
    closest: 0,
    closestTick: 0,
  };
}

/** Hands players of a battle to CPUs (replacing any CPU they had); the others stay human. Returns the state. */
export function addCpus(state: GameState, cpus: readonly { player: number; level: CpuLevel }[]): GameState {
  const b = state.battle;
  if (!b) throw new Error("CPU players need a battle");
  for (const { player, level } of cpus) {
    if (!Number.isInteger(player) || player < 0 || player >= state.players.length) throw new Error(`no player ${player} for a CPU`);
    if (!CPU_LEVELS.includes(level)) throw new Error(`no CPU level ${String(level)}`);
  }
  const kept = (b.cpus ?? []).filter((c) => !cpus.some((n) => n.player === c.player));
  const all = [...kept, ...cpus.map(({ player, level }) => createCpu(player, level, b.rng))].sort((a, z) => a.player - z.player);
  if (all.length) b.cpus = all;
  else delete b.cpus;
  return state;
}

/** The level of player `i` if a CPU plays him, else null. */
export function cpuLevel(state: GameState, i: number): CpuLevel | null {
  return state.battle?.cpus?.find((c) => c.player === i)?.level ?? null;
}

/**
 * Every player's buttons for this tick: `inputs` (the humans'; missing ones are 0) with each CPU's slot set to what it
 * presses. Call it on the state about to be stepped, with the same world: it updates the CPUs' memory in that state.
 */
export function cpuInputs(state: GameState, world: World, inputs: readonly number[]): readonly number[] {
  const b = state.battle, cpus = b?.cpus;
  if (!b || !cpus?.length) return inputs;
  const out = state.players.map((_, i) => inputs[i] ?? 0);
  const view = battleWorld(world, b), hazards = b.phase === "play" ? hazardBoxes(state) : [];
  for (const brain of cpus) if (brain.player < out.length) out[brain.player] = think(state, view, hazards, brain);
  return out;
}

// --- one tick ---

/** What a tick's decisions work with. */
interface Ctx {
  state: GameState;
  b: NonNullable<GameState["battle"]>;
  brain: CpuBrain;
  t: Tuning;
  i: number;
  p: PlayerState;
  f: Fighter;
  x: number; // px
  y: number;
  world: World; // the battle's view of the arena (cut bushes, open trapdoors)
  nav: NavGrid;
  danger: Danger[]; // anchor positions (px) that get hurt now or within a few ticks
}

/** The buttons CPU `brain` presses this tick (updating its memory). */
export function cpuButtons(state: GameState, world: World, brain: CpuBrain): number {
  const b = state.battle;
  return b ? think(state, battleWorld(world, b), b.phase === "play" ? hazardBoxes(state) : [], brain) : 0;
}

/** cpuButtons on the battle's view of the arena, with the arena's hazard boxes (hazardBoxes) worked out already. */
function think(state: GameState, view: World, hazards: readonly Danger[], brain: CpuBrain): number {
  const b = state.battle, i = brain.player, p = state.players[i], f = b?.fighters[i];
  if (!b || !p || !f) return 0;
  if (b.phase !== "play") {
    rest(brain, p);
    return 0;
  }
  if (f.hearts <= 0 || f.mode !== "active") {
    // Hurt, recoiling, falling or out: nothing pressed counts. Think again once back on his feet.
    brain.charge = 0;
    brain.act = "";
    brain.think = Math.min(brain.think, 1);
    return 0;
  }
  const screen = screenAt(p.y), nav = navGrid(view, b.props, panelsOpen(b, i), screen);
  const ctx: Ctx = { state, b, brain, t: TUNING[brain.level], i, p, f, x: px(p.x), y: px(p.y), world: view, nav, danger: [] };
  ctx.danger = threats(ctx, hazards);
  // A door, a hole, a cannon: back to the fight (siderooms.ts). Up or Down in a gate's box only to go through it.
  const buttons = keepOutOfGates(ctx, AWAY.has(f.move) ? away(ctx) : tick(ctx));
  const moved = ctx.x !== brain.lastX || ctx.y !== brain.lastY;
  brain.stuck = buttons & DIRS && !moved && f.move === "none" && p.action === "none" ? brain.stuck + 1 : 0;
  brain.lastX = ctx.x;
  brain.lastY = ctx.y;
  brain.planTicks++;
  return buttons;
}

/**
 * Can Link `i` walk the colored panels now: all of them show his color, with at least PANEL_MARGIN ticks before they
 * change (panels.ts; a panel whose force switch is on may change any time: not then)?
 */
function panelsOpen(b: BattleState, i: number): boolean {
  if (!b.panels.length) return false;
  let k = 0;
  for (const a of b.props.actors) {
    if (a.id !== "RBPN") continue;
    const packed = b.panels[k++]!, period = (a.params & 0x7f) * PANEL_PERIOD_UNIT || PANEL_DEFAULT_PERIOD;
    if (packed >>> 16 !== i || period - (packed & 0xffff) < PANEL_MARGIN || switchOn(b, (a.params >>> 22) & 31)) return false;
  }
  return true;
}
const PANEL_MARGIN = 70; // ticks: enough to cross a ring 2 tiles wide (a corner too), or get back off it

/** Between rounds: forget the round, and stagger the CPUs' first decisions. */
function rest(brain: CpuBrain, p: PlayerState): void {
  Object.assign(brain, { plan: "roam", target: -1, thing: 0, offX: 0, offY: 0, act: "", charge: 0, wait: 0, stuck: 0, planTicks: 0 });
  brain.think = 1 + brain.player * 2;
  brain.lastX = px(p.x);
  brain.lastY = px(p.y);
}

function tick(ctx: Ctx): number {
  const { brain, p, f, t } = ctx;
  switch (f.move) {
    case "held":
      // Wriggle free: a new press of a direction every `mash` ticks, alternating so each one counts (only directions
      // do: carry.ts ESCAPE_PRESSES).
      if (ctx.state.tick % t.mash) return 0;
      return Math.floor(ctx.state.tick / t.mash) & 1 ? Button.Left : Button.Right;
    case "ready":
      // Two ticks after an Action press with nothing to lift: still walking makes it a roll (if the way is clear).
      return runAhead(ctx, p.facing, 66) ? p.held & DIRS || FACING_BUTTON[p.facing] : 0;
    case "roll":
      return runAhead(ctx, p.facing, 24) ? FACING_BUTTON[p.facing] : 0; // the stick along the roll: 3 px/tick
    case "carry":
      return safeCell(ctx.nav, cellAt(ctx.nav, ctx.x, ctx.y)) ? carrying(ctx) : rescue(ctx);
    case "ride":
      return safeCell(ctx.nav, cellAt(ctx.nav, ctx.x, ctx.y)) ? avoid(ctx, riding(ctx), RIDE_LOOK) : rescue(ctx);
    case "dash":
      return dashing(ctx);
    case "hammer":
      return hammering(ctx);
    case "burning":
      return burning(ctx);
    case "none":
      break;
    default:
      return 0; // lifting, throwing, an item's pose: they play out by themselves
  }
  // Into a door, the last steps go through the cells cpunav.ts walls off round it: no rescue, no steering there.
  if (entering(ctx) && p.action === "none" && brain.charge === 0 && !brain.act) return follow(ctx);
  if (!safeCell(ctx.nav, cellAt(ctx.nav, ctx.x, ctx.y)) && p.action === "none") return rescue(ctx);
  if (ctx.nav.side && !walkable(ctx.nav, cellAt(ctx.nav, ctx.x, ctx.y)) && p.action === "none" && brain.charge === 0) return steerFall(ctx);
  if (brain.charge > 0) return charging(ctx);
  if (p.action !== "none") {
    // The tick after a press picks the attack from the stick on either tick: keep it; then nothing (no charge).
    return p.actionTick === 0 && isAttack(p.action) ? p.held & DIRS : 0;
  }
  const acting = doAct(ctx);
  if (acting !== null) return acting;
  if (--brain.think <= 0) {
    brain.think = t.think + rand(brain, t.jitter);
    const buttons = decide(ctx);
    if (buttons !== null) return buttons;
  }
  if (brain.wait > 0) {
    brain.wait--;
    return brain.waitDir ? avoid(ctx, brain.waitDir, WALK_LOOK) : escapeDanger(ctx);
  }
  if (brain.stuck >= STUCK_TICKS) {
    // Walking into something: a few steps some other way.
    brain.stuck = 0;
    brain.wait = 12 + rand(brain, 12);
    brain.waitDir = ROSE[rand(brain, 8)]!;
    return avoid(ctx, brain.waitDir, WALK_LOOK);
  }
  return avoid(ctx, follow(ctx), WALK_LOOK);
}

/** Plans that go through a warp (its index + 1 in `thing`). */
const throughWarpPlan = (brain: CpuBrain) => brain.plan === "warp" || brain.plan === "trip";

/** Is the CPU on its last steps into the warp its plan goes through (within 40 px of it)? */
function entering(ctx: Ctx): boolean {
  const w = throughWarpPlan(ctx.brain) ? battleWarps(ctx.b)[ctx.brain.thing - 1] : undefined;
  return !!w && Math.abs(w.x - ctx.x) + Math.abs(w.y - ctx.y) <= 40;
}

// --- decisions ---

/** A rival or critter to hit: where it is (px), its box, and who (player index) or what (entity id). */
interface Mark {
  x: number;
  y: number;
  box: PixelBox;
  link: number;
  id: number;
}

/** Picks a plan; returns buttons when it starts an act right away. */
function decide(ctx: Ctx): number | null {
  const { b, brain, t, f } = ctx;
  const previous = brain.plan, since = brain.planTicks;
  if (inDanger(ctx, ctx.x, ctx.y)) {
    brain.think = 2; // out of the way first (tick() steers out), then decide
    return null;
  }
  if (chance(brain, t.hesitate)) {
    brain.wait = brain.think;
    brain.waitDir = 0;
    return 0;
  }
  // (Vaati knocks out everyone, in a house or not: no shelter to run to. Measured, timeup.ts.) The Tower of Winds' giant
  // bomb only gets the Links on the TV: into the gallery while it burns (giantbomb.ts), and stay there.
  if (bigBombBurning(ctx)) {
    if (screenAt(ctx.p.y) === 0) {
      const shelter = warpTo(ctx, (k) => k > 0);
      if (shelter >= 0) return setPlan(ctx, "warp", ctx.x, ctx.y, -1, shelter + 1);
    }
  }
  const target = pickTarget(ctx);
  const rival = target >= 0 ? linkMark(ctx, target) : null;
  // A floor switch or a crystal that sets off an attack on the rivals (cpuswitches.ts), unless one is upon us.
  const switching = switchPlan(ctx, rival);
  if (switching !== undefined) return switching;
  // Nobody to fight on this screen: out of a side room (unless the giant bomb burns on the TV), or after a rival into
  // the one he's in (cpunav.ts walls the doors off; throughWarp goes in on purpose).
  // (Not while a rival is on his way through one: two CPUs could cross in the doorway for ever.)
  if (!rival && !bigBombBurning(ctx) && !ctx.b.fighters.some((g, j) => j !== ctx.i && g.hearts > 0 && AWAY.has(g.move))) {
    const here = screenAt(ctx.y * SUBPX);
    const away = here > 0 ? null : rivalAway(ctx);
    // Close to his room's door or hole, with a load at hand: throw it in at him (and keep at it).
    if (away && t.tosses) {
      if (previous === "toss" && brain.thing > 0) return null;
      if (chance(brain, t.tosses)) {
        const toss = pickToss(ctx, away);
        if (toss !== undefined) return toss;
      }
    }
    // (Into his room by a way that leads to him: the gallery's gates come out on ledges with no way between them.)
    const way = here > 0 ? warpTo(ctx, (k) => k === 0) : away ? warpTo(ctx, (k) => k === away.screen, away) : -1;
    if (way >= 0) return setPlan(ctx, "warp", ctx.x, ctx.y, -1, way + 1);
  }
  // Soldiers and bees in the way get swatted.
  const critter = nearestCritter(ctx);
  if (critter && (!rival || dist(ctx, critter) < dist(ctx, rival))) {
    const swing = strike(ctx, critter);
    if (swing !== null) return swing;
    return setPlan(ctx, "fight", critter.x, critter.y, -1, critter.id);
  }
  // An item a broken orb released. (Not another one while keeping away: a generator by the spot it keeps away at would
  // hand it one after another, each restarting the retreat's time, and it would never move again.)
  const pickup = previous === "retreat" && f.item ? undefined : nearestEntity(ctx, (e) => e.kind === "pickup" && e.phase === "rest", PICKUP_RANGE);
  if (pickup && (!rival || dist(ctx, rival) > 28 || emptyHanded(f))) return setPlan(ctx, "pickup", px(pickup.x), px(pickup.y), target, pickup.id);
  if (rival && f.item && chance(brain, t.item)) {
    const use = useItem(ctx, rival);
    if (use !== null) return use;
  }
  // A bomb in its socket (the Tower of Flames': lifting lights it) with a rival within throwing range, not so close
  // he'd catch us at it.
  if (rival && dist(ctx, rival) < 160 && !rivalWithin(ctx, SOCKET_GUARD) && chance(brain, t.lift)) {
    const socket = nearestEntity(ctx, (e) => e.kind === "bomb" && e.phase === "rest" && e.timer === 0 && e.home >= 0, 40);
    if (socket) return setPlan(ctx, "bomb", px(socket.x), px(socket.y), target, socket.id);
  }
  // With nothing in hand, an orb.
  const orb = emptyHanded(f) ? nearestEntity(ctx, (e) => e.kind === "orb" && e.phase === "rest", 400) : undefined;
  if (orb && (!rival || dist(ctx, { x: px(orb.x), y: px(orb.y) }) < dist(ctx, rival) + 40) && (previous === "orb" || chance(brain, t.orbs))) {
    const mark: Mark = { x: px(orb.x), y: px(orb.y), box: ORB_BOX, link: -1, id: orb.id };
    const swing = strike(ctx, mark);
    if (swing !== null) return swing;
    return setPlan(ctx, "orb", mark.x, mark.y, target, orb.id);
  }
  if (!rival) {
    // A rival out of reach (the far side of the colored panels): wait where he's closest, to cross when we can.
    const far = pickTarget(ctx, true);
    if (far >= 0) {
      const q = ctx.state.players[far]!, home = region(ctx.nav, nearestWalkable(ctx.nav, ctx.x, ctx.y, 3));
      const spot = home ? nearestInRegion(ctx.nav, home, px(q.x), px(q.y)) : -1;
      if (spot >= 0) return setPlan(ctx, "roam", cellX(ctx.nav, spot), cellY(ctx.nav, spot), -1);
    }
    // Nobody to fight here (everyone else is out, or in the other world): wander.
    if (previous !== "roam" || since > 180) {
      const spots = openSpots(ctx.nav);
      if (spots.length) {
        const spot = spots[rand(brain, spots.length)]!;
        return setPlan(ctx, "roam", cellX(ctx.nav, spot), cellY(ctx.nav, spot), -1);
      }
    }
    return null;
  }
  // Low on hearts against a healthier rival: keep away for a while (but hit back when cornered).
  const g = b.fighters[target]!;
  const keepAway = previous === "retreat" ? since < RETREAT_TICKS : previous !== "fight" || since > FIGHT_BACK_TICKS;
  if (t.cautious && f.hearts <= t.cautious && g.hearts > f.hearts && dist(ctx, rival) > 30 && keepAway) {
    const spot = fleeSpot(ctx);
    if (spot >= 0) return setPlan(ctx, "retreat", cellX(ctx.nav, spot), cellY(ctx.nav, spot), target);
  }
  return fight(ctx, rival);
}

function setPlan(ctx: Ctx, plan: CpuPlan, x: number, y: number, target: number, thing = 0, offX = 0, offY = 0): null {
  const brain = ctx.brain;
  // A retreat is timed from its start whoever it keeps away from (else two rivals by turns keep it going for good).
  if (brain.plan !== plan || brain.thing !== thing || (brain.target !== target && plan !== "retreat")) brain.planTicks = 0;
  Object.assign(brain, { plan, goalX: x, goalY: y, target, thing, offX, offY });
  return null;
}

/** Fighting a rival: an attack when one can land, else closing in (beside his shield when it faces us). */
function fight(ctx: Ctx, rival: Mark): number | null {
  const { brain, t, state } = ctx;
  const q = state.players[rival.link]!, g = ctx.b.fighters[rival.link]!;
  const rx = rival.x - ctx.x, ry = rival.y - ctx.y, face = facingOf(rx, ry), [sx] = FACING_STEP[face];
  const along = Math.abs(sx ? rx : ry), across = Math.abs(sx ? ry : rx), d = dist(ctx, rival);
  const continuing = brain.plan === "fight" && brain.target === rival.link && !brain.thing;
  // Where to stand: at him, or round him (his shield, pits behind: standOffset); off his line while he can't be hit.
  let off: [number, number] = [0, 0];
  if (!hittable(g)) {
    const [ax, ay] = ctx.nav.side ? [rx > 0 ? -1 : 1, 0] : FACING_STEP[facingOf(-rx, -ry)];
    off = [ax * HOVER, ay * HOVER];
  } else {
    const going = continuing && (brain.offX !== 0 || brain.offY !== 0);
    const flank = shieldBlocks(q, ctx.p) && (going || chance(brain, t.flank));
    // Straight at him would put a pit behind us (or, hard, he has one behind him): somewhere better.
    const [dx, dy] = scaled(-rx, -ry, STAND) ?? [0, 0];
    const pits = chance(brain, t.placement) && (knockedInto(ctx, rival.x + dx, rival.y + dy, dx, dy) || (brain.level === "hard" && nearPit(ctx, rival.x, rival.y)));
    if (flank || going || pits) off = standOffset(ctx, q, flank || brain.level === "hard", pits);
  }
  setPlan(ctx, "fight", rival.x + off[0], rival.y + off[1], rival.link, 0, off[0], off[1]);
  // Not getting any closer (he's going round the same loop the same way): let him come for a while. Close by all that
  // time without a way in (his shield always facing us): swing anyway.
  if (!continuing) (brain.closest = d), (brain.closestTick = 0);
  else if (d < brain.closest) (brain.closest = d), (brain.closestTick = brain.planTicks);
  else if (brain.planTicks - brain.closestTick > CHASE_TICKS) {
    brain.closest = d;
    brain.closestTick = brain.planTicks;
    if (d <= CLOSE && hittable(g)) return startAct(ctx, "swing", face);
    brain.wait = 45 + rand(brain, 120);
    brain.waitDir = 0;
    return 0;
  }
  if (!hittable(g)) return null;
  const swing = strike(ctx, rival);
  if (swing !== null) return swing;
  // A rival swinging at us up close: face him (the shield is up whenever the sword isn't out).
  if (isAttack(q.action) && q.action !== "spin" && d < 40 && ctx.p.facing !== face && chance(brain, t.dodge)) return startAct(ctx, "face", face);
  if (along >= 40 && along <= 70 && across <= 8 && ctx.p.moving && ctx.p.facing === face && chance(brain, t.roll) && runAhead(ctx, face, 66)) return startAct(ctx, "roll", face);
  const shielded = shieldBlocks(q, ctx.p);
  if (!shielded && along >= 30 && along <= 60 && across <= 6 && chance(brain, t.lunge) && runAhead(ctx, face, 44) && canHit(LUNGE_REACH[face], rx, ry, rival.box, 0)) {
    return startAct(ctx, "lunge", face);
  }
  // A spin from afar: the charge (about 56 ticks, walking at him slowly) is full about when it reaches him.
  if (along >= 48 && along <= 80 && across <= 12 && chance(brain, shielded ? t.charge * 2 : t.charge)) return startAct(ctx, "charge", face);
  if (d <= CLOSE && chance(brain, t.whiff)) return startAct(ctx, "swing", face);
  return null;
}

/** Starts a swing (or a charge, a lift, a stab) at `mark` if it's in reach for the facing toward it; returns its buttons. */
function strike(ctx: Ctx, mark: Mark): number | null {
  const { brain, t, state } = ctx;
  let rx = mark.x - ctx.x, ry = mark.y - ctx.y;
  const q = mark.link >= 0 ? state.players[mark.link]! : null;
  if (q && t.predict && q.moving) {
    // Lead a walking rival by where he'll be (1.5 px a tick).
    const [dx, dy] = stepOf(q.held);
    rx += (dx * 3 * t.predict) >> 1;
    ry += (dy * 3 * t.predict) >> 1;
  }
  const face = facingOf(rx, ry);
  // Misjudging the reach (slack > 0: swinging from too far) only now and then, and only at a rival.
  const slack = q && chance(brain, SLACK_CHANCE) ? t.slack : Math.min(0, t.slack);
  if (!canHit(SWING_REACH[face], rx, ry, mark.box, slack)) {
    if (!ctx.p.moving && ctx.p.facing === face && canHit(STAB_REACH[face], rx, ry, mark.box, Math.min(0, slack))) return startAct(ctx, "stab", face);
    return null;
  }
  if (!q) return startAct(ctx, "swing", face);
  const shielded = shieldBlocks(q, ctx.p);
  if (canLift(ctx, mark.link, face) && chance(brain, shielded ? t.lift * 2 : t.lift)) return startAct(ctx, "lift", face);
  // Into his shield only when not already on the way round it.
  const flanking = brain.plan === "fight" && brain.target === mark.link && (brain.offX !== 0 || brain.offY !== 0);
  if (!shielded || (!flanking && !chance(brain, t.flank))) return startAct(ctx, "swing", face);
  return null;
}

/** Starts an act; returns its first tick's buttons. */
function startAct(ctx: Ctx, what: CpuAct, facing: Facing | null): number {
  const brain = ctx.brain;
  brain.act = what;
  brain.actDir = facing ? FACING_BUTTON[facing] : 0;
  brain.actTicks = 0;
  return doAct(ctx) ?? 0;
}

/** One tick of the act in progress; null once there's none (the plan goes on). */
function doAct(ctx: Ctx): number | null {
  const { brain, p, state, i } = ctx;
  if (!brain.act) return null;
  // Timed out, or a hazard is coming: an attack or a pose would pin him there.
  if (++brain.actTicks > ACT_TIMEOUT || (brain.act !== "throw" && brain.act !== "face" && inDanger(ctx, ctx.x, ctx.y))) {
    brain.act = "";
    return null;
  }
  const want = brain.actDir, faced = !want || p.facing === facingOfButton(want);
  const done = (buttons: number) => {
    brain.act = "";
    return buttons;
  };
  switch (brain.act) {
    case "face":
      return faced ? done(0) : want;
    case "swing":
    case "charge":
      // A swing is a press while walking (standing, it would be a lunge or a stab): walk a tick first, facing him.
      if (!faced || !p.moving) return want || FACING_BUTTON[p.facing];
      if (p.held & Button.Sword) return want; // let go first: only a new press counts
      if (brain.act === "charge") brain.charge = 1;
      return done(want | Button.Sword);
    case "stab":
      if (!faced) return want;
      if (p.moving || p.held & Button.Sword) return 0; // standing, the stick neutral, then the press
      return done(Button.Sword);
    case "lunge":
      if (p.moving || p.held & Button.Sword) return 0; // from standing, with the stick pushed
      return done(want | Button.Sword);
    case "item":
      if (!faced) return want;
      if (p.held & Button.Item) return 0;
      return done(Button.Item);
    case "lift":
      if (!faced) return want;
      if (p.held & Button.Action) return 0;
      return done(liftTarget(state, i) ? Button.Action : 0);
    case "roll":
      if (!faced || !p.moving || p.held & Button.Action) return want;
      return done(liftTarget(state, i) ? want : want | Button.Action); // (with something in front, it would lift)
    case "throw":
      if (!faced) return want;
      if (p.held & (Button.Action | Button.Item)) return 0;
      return done(Button.Action);
    default:
      return done(0);
  }
}

/** Nothing in hand. */
const emptyHanded = (f: Fighter) => f.item === "";

/** Uses the item in hand on a rival when the moment is right; returns the first buttons, or null. */
function useItem(ctx: Ctx, rival: Mark): number | null {
  const { f } = ctx;
  const rx = rival.x - ctx.x, ry = rival.y - ctx.y, d = dist(ctx, rival);
  switch (f.item) {
    case "bow":
    case "slingshot":
    case "boomerang":
    case "fireRod": {
      const g = ctx.b.fighters[rival.link]!;
      if (!hittable(g) || d < 20 || d > SHOT_RANGE[f.item]!) return null;
      const face = facingOf(rx, ry);
      // In line: shots fly from about 4 px above the anchor (projectiles.ts SHOT_SPAWN), ±3 px, into the hurtbox; a
      // fireball from the anchor, ±6 px (firerod.ts), one at a time, and a burning Link can't be set alight again.
      const fire = f.item === "fireRod";
      if (fire && (g.move === "burning" || ctx.b.entities.some((e) => e.kind === "fireball" && e.owner === ctx.i && !isRemoved(e)))) return null;
      const inLine = face === "right" || face === "left" ? (fire ? Math.abs(ry) <= 10 : ry >= -8 && ry <= 14) : Math.abs(rx) <= (f.item === "slingshot" ? 10 : fire ? 8 : 6);
      if (!inLine || !clearShot(ctx, rival.x, rival.y)) return null;
      // An arrow into a raised shield only pushes him back (projectiles.ts: blockable): not at a shield facing us.
      const q = ctx.state.players[rival.link]!;
      if (f.item === "bow" && shieldUp(q, ctx.b.fighters[rival.link]) && FACING_STEP[q.facing][0] === -FACING_STEP[face][0] && FACING_STEP[q.facing][1] === -FACING_STEP[face][1]) return null;
      return startAct(ctx, "item", face);
    }
    case "bomb": {
      // Put one down in front (the "bomb" plan then lifts it, and carrying() cooks and throws it).
      if (d < 30 || d > 150 || ctx.b.entities.some((e) => e.kind === "bomb" && e.owner === ctx.i && !isRemoved(e))) return null;
      const [sx, sy] = FACING_STEP[ctx.p.facing];
      if (!safeCell(ctx.nav, cellAt(ctx.nav, ctx.x + sx * 13, ctx.y + sy * 13))) return null;
      setPlan(ctx, "bomb", ctx.x + sx * 13, ctx.y + sy * 13, rival.link);
      return startAct(ctx, "item", null);
    }
    case "boots":
      return bootsAt(ctx, rival);
    case "hammer":
      return hammerAt(ctx, rival);
    default:
      return null; // (an orb's cucco and carrot act by themselves)
  }
}

/**
 * The boots: a dash at a rival ahead (into his shield too: it pushes him off), from DASH_MIN to DASH_RANGE px along the
 * line and not too far off it (the dash steers 45°), the way clear of pits, hazards and walls. dashing() then holds the
 * button and steers.
 */
function bootsAt(ctx: Ctx, rival: Mark): number | null {
  if (!hittable(ctx.b.fighters[rival.link]!)) return null;
  const rx = rival.x - ctx.x, ry = rival.y - ctx.y, face = facingOf(rx, ry), [sx] = FACING_STEP[face];
  const along = Math.abs(sx ? rx : ry), across = Math.abs(sx ? ry : rx);
  if (along < DASH_MIN || along > DASH_RANGE || across > 8 + (along >> 1) || !runAhead(ctx, face, Math.min(along, 66))) return null;
  setPlan(ctx, "fight", rival.x, rival.y, rival.link);
  ctx.brain.hold = BOOTS.charge + 12 + Math.ceil(along / 3);
  return startAct(ctx, "item", face);
}

/** The dash (boots.ts): the button held through the boots' charge and on, steered toward the rival; let go before a pit,
 *  a hazard or a wall ahead, once he's hit or behind, or after `hold` ticks. */
function dashing(ctx: Ctx): number {
  const { brain, p, f } = ctx;
  if (brain.hold <= 0) return 0;
  brain.hold--;
  const q = brain.target >= 0 ? ctx.state.players[brain.target] : undefined, g = brain.target >= 0 ? ctx.b.fighters[brain.target] : undefined;
  if (!q || !g || !hittable(g) || !runAhead(ctx, p.facing, 16)) return (brain.hold = 0);
  const [sx, sy] = FACING_STEP[p.facing], rx = px(q.x) - ctx.x, ry = px(q.y) - ctx.y;
  const along = sx ? sx * rx : sy * ry, across = sx ? ry : rx;
  if (along < -4) return (brain.hold = 0);
  // A direction across the facing steers the dash (2.1 px a tick each way) onto his line.
  const steer = f.moveTick < BOOTS.charge || Math.abs(across) <= 3 ? 0 : sx ? (across > 0 ? Button.Down : Button.Up) : across > 0 ? Button.Right : Button.Left;
  return Button.Item | steer;
}

/**
 * The hammer (hammer.ts): a pound on a rival in front, where the pound's box will meet his body; or (normal and hard)
 * held to a charged pound when he stands about or keeps away within the reach of its impact (he hops and lands dizzy:
 * boots.ts impact). Not on a flattened Link: the hammer can't hit him again, the sword follows up.
 */
function hammerAt(ctx: Ctx, rival: Mark): number | null {
  const { brain, f, state } = ctx;
  const g = ctx.b.fighters[rival.link]!, q = state.players[rival.link]!;
  if (!hittable(g) || g.flat > 0) return null;
  const rx = rival.x - ctx.x, ry = rival.y - ctx.y, face = facingOf(rx, ry), d = dist(ctx, rival);
  if (inPound(rx, ry, face)) {
    setPlan(ctx, "fight", rival.x, rival.y, rival.link);
    brain.hold = 0;
    return startAct(ctx, "item", face);
  }
  const reach = joltReach(f) - 10;
  const idle = !q.moving && q.action === "none" && g.move === "none";
  if (brain.level === "easy" || d > reach || d < 30 || !(idle || d > 60) || g.z > 0) return null;
  setPlan(ctx, "fight", rival.x, rival.y, rival.link);
  brain.hold = HAMMER.charge + 4;
  return startAct(ctx, "item", face);
}

/** How near a charged pound other Links hop (boots.ts impact). */
const joltReach = (f: Fighter) => HAMMER.joltReach * (f.itemLevel >= 2 ? 2 : 1);

/** Is a rival (rx, ry px off) where an uncharged pound for `face` would meet his ±7 px body (a margin for his steps)? */
function inPound(rx: number, ry: number, face: Facing): boolean {
  const [ax, ay] = POUND_AT[face], reach = HAMMER.half + HURTBOX.right - 2;
  return Math.abs(rx - ax) <= reach && Math.abs(ry - ay) <= reach;
}

/** The hammer held up: turned toward the rival until it's charged, then let go (the pound); let go at once when he
 *  steps in front of it or gets out of the impact's reach. */
function hammering(ctx: Ctx): number {
  const { brain, f } = ctx;
  if (f.shot !== 0 || brain.hold <= 0) return 0;
  brain.hold--;
  const q = brain.target >= 0 ? ctx.state.players[brain.target] : undefined, g = brain.target >= 0 ? ctx.b.fighters[brain.target] : undefined;
  if (!q || !g || hammerCharged(f)) return (brain.hold = 0);
  const rx = px(q.x) - ctx.x, ry = px(q.y) - ctx.y;
  if (!hittable(g) || inPound(rx, ry, ctx.p.facing) || Math.abs(rx) + Math.abs(ry) > joltReach(f) + 20) return (brain.hold = 0);
  return Button.Item | FACING_BUTTON[facingOf(rx, ry)];
}

// --- burning ---

/** What a burning run straight one way comes to (the higher, the better; a run that ends badly is below 0). */
const RUN = { water: 50_000, spread: 30_000, clear: 10_000, blocked: 5_000, hurt: -20_000, pit: -50_000 } as const;
/** px (Manhattan): rivals farther than this from a burning run don't matter to it (nearer, it keeps off them)… */
const BURN_KEEP = 80;
/** …and how much each px of it is worth. */
const BURN_KEEP_WORTH = 20;
/** px (Chebyshev) from a rival within which his sword can reach a burning Link (a swing, a stab: about 24 px ahead). */
const RIVAL_REACH = 28;
/** px (Chebyshev) between two anchors at which a burning Link's ±7 px flame meets the other's ±7 px body. */
const FLAME_MEETS = 2 * BODY_HALF;

/**
 * Burning (firerod.ts): he runs 2 px a tick the way he faces for 300 ticks, the stick turning him (the next tick's
 * step goes the new way). Each of the four ways' runs is played out straight ahead (burnLook ticks, through the sim's
 * own walls): the best one stays clear of pits, hazards and BLZE flames, and of walls his flame would burst on (its
 * BLZE hurts him), keeping off rivals who could hit him; better still, it makes for shallow water close by (it puts
 * him out: the nearest along the cells, burnWater px) or runs into a rival close by (spread px), whose body his flame
 * sets alight. Easy looks less far ahead, steers every few ticks, and does neither.
 */
function burning(ctx: Ctx): number {
  const { brain, f, p, t } = ctx;
  brain.charge = 0;
  brain.act = "";
  brain.think = Math.min(brain.think, 1);
  // (The hop: the stick does nothing until he lands. Side view: not seen in the game, left running.)
  if (f.z > 0 || f.vz > 0 || f.moveTick < 0 || ctx.nav.side || ctx.state.tick % t.burnEvery) return 0;
  const left = BURNING.ticks - f.charge;
  const water = t.burnWater ? waterWay(ctx, Math.min(t.burnWater, left * (BURNING.speed / SUBPX))) : null;
  const rivals = burnRivals(ctx);
  let best = p.facing, bestScore = -Infinity;
  for (const face of [p.facing, ...FACINGS.filter((d) => d !== p.facing)]) {
    const run = burnRun(ctx, face, Math.min(left, t.burnLook), rivals);
    let score = run.score;
    // Toward the water: unless the run goes wrong before the way there turns.
    if (water && water.face === face && (score >= 0 || run.at * (BURNING.speed / SUBPX) > water.straight + CELL)) score = Math.max(score, RUN.water - water.length);
    if (score > bestScore) (best = face), (bestScore = score);
  }
  return FACING_BUTTON[best];
}

/** A rival as a burning run sees him: where he is (px), and whether it may run into him (else it keeps off his sword). */
interface Burnt {
  rx: number;
  ry: number;
  open: boolean;
}

/**
 * The rivals who could hit a burning CPU (not burning too); those within `spread` px with their back or side to him,
 * or busy, he can run into (his flame sets them alight).
 */
function burnRivals(ctx: Ctx): Burnt[] {
  const { state, b, p, t } = ctx;
  return state.players.flatMap((r, j) => {
    const g = b.fighters[j]!;
    if (j === ctx.i || !hittable(g) || g.move === "burning" || !sameScreen(r, p)) return [];
    const rx = px(r.x), ry = px(r.y), [fx, fy] = FACING_STEP[r.facing];
    const open = (r.action !== "none" || g.move !== "none" || fx * (ctx.x - rx) + fy * (ctx.y - ry) <= 0) && Math.abs(rx - ctx.x) + Math.abs(ry - ctx.y) <= t.spread;
    return [{ rx, ry, open }];
  });
}

/**
 * A burning run from here, turned to `face` (this tick's step still goes the way he faced), played out for `ticks`
 * ticks: its RUN score, and the tick it ends at (put out, fallen, hurt, meeting a rival, stopped by a wall).
 */
function burnRun(ctx: Ctx, face: Facing, ticks: number, rivals: readonly Burnt[]): { score: number; at: number } {
  const { f, p, nav, world } = ctx;
  const q = { x: p.x, y: p.y }, [sx, sy] = FACING_STEP[face];
  let vx = f.flyX, vy = f.flyY, keep = BURN_KEEP;
  const flame = f.fireWait >= 0; // (once burst on a wall, his flame is out: firerod.ts stepFire)
  // (Only the hazards along the way: the run, a corner's slide and this tick's step aside.)
  const reach = ticks * (BURNING.speed / SUBPX) + RUN_SLACK;
  const lane = { left: ctx.x - (sx < 0 ? reach : RUN_SLACK), right: ctx.x + (sx > 0 ? reach : RUN_SLACK), top: ctx.y - (sy < 0 ? reach : RUN_SLACK), bottom: ctx.y + (sy > 0 ? reach : RUN_SLACK) };
  const danger = ctx.danger.filter((d) => d.right >= lane.left && d.left <= lane.right && d.bottom >= lane.top && d.top <= lane.bottom);
  for (let k = 1; k <= ticks; k++) {
    const x0 = q.x, y0 = q.y;
    // As firerod.ts stepBurning, then stepFire and the pit check (combat.ts) on the tick's end. (Corners slide him, as
    // walking does, but that's costly to play out: the first few ticks only.)
    if (surfaceAt(world, px(x0), px(y0)) === "shallow") return { score: RUN.water - k, at: k };
    moveAxis(q, world, vx, "x", k <= RUN_SLIDES);
    moveAxis(q, world, vy, "y", k <= RUN_SLIDES);
    [vx, vy] = [sx * BURNING.speed, sy * BURNING.speed];
    const x = px(q.x), y = px(q.y);
    if (pitAt(nav, x, y)) return { score: RUN.pit + k, at: k };
    if (flame && flameBursts(ctx, x0, y0)) return { score: RUN.hurt + k, at: k };
    for (const d of danger) if (inBox(d, x, y)) return { score: RUN.hurt + k, at: k };
    for (const { rx, ry, open } of rivals) {
      if (open && flame && Math.abs(px(x0) - rx) <= FLAME_MEETS && Math.abs(px(y0) - ry) <= FLAME_MEETS) return { score: RUN.spread - k, at: k };
      if (!open && Math.abs(x - rx) <= RIVAL_REACH && Math.abs(y - ry) <= RIVAL_REACH) return { score: RUN.hurt + k, at: k };
      keep = Math.min(keep, Math.abs(x - rx) + Math.abs(y - ry));
    }
    if (q.x === x0 && q.y === y0) return { score: RUN.blocked + k * 10 + keep * BURN_KEEP_WORTH, at: k };
  }
  return { score: RUN.clear + keep * BURN_KEEP_WORTH, at: ticks };
}
/** Ticks of a burning run played out with the walls' corner slides (player.ts moveAxis), and px they may take him aside. */
const RUN_SLIDES = 6;
const RUN_SLACK = 8;

/** Does a burning Link's flame at (x, y) (1/256 px: his ±7 px body) meet a wall, bursting into a BLZE (firerod.ts)? */
function flameBursts(ctx: Ctx, x: number, y: number): boolean {
  const c = cellAt(ctx.nav, px(x), px(y));
  if (c >= 0 && ctx.nav.flags[c]! & NAV.open) return false; // (no wall in the cells around)
  const world = ctx.world, h = BODY_HALF * SUBPX, cell = CELL * SUBPX;
  for (let cy = Math.floor((y - h) / cell); cy <= Math.floor((y + h) / cell); cy++) {
    for (let cx = Math.floor((x - h) / cell); cx <= Math.floor((x + h) / cell); cx++) if (isSolidAt(world, cx * CELL, cy * CELL)) return true;
  }
  return false;
}

/**
 * The nearest shallow water (firerod.ts: it puts a burning Link out) within `range` px of walking along the cells
 * (4 ways, as a burning Link runs; off pits' edges and hazards): the way to set off, the way's length and how far it
 * goes straight first (px). Null when there's none.
 */
function waterWay(ctx: Ctx, range: number): { face: Facing; length: number; straight: number } | null {
  const { nav, world } = ctx, start = cellAt(nav, ctx.x, ctx.y);
  if (start < 0 || !waterCells(nav, world).some((c) => Math.abs(cellX(nav, c) - ctx.x) + Math.abs(cellY(nav, c) - ctx.y) <= range + CELL)) return null;
  const danger = ctx.danger.filter((d) => d.right >= ctx.x - range && d.left <= ctx.x + range && d.bottom >= ctx.y - range && d.top <= ctx.y + range);
  const size = nav.w * nav.h, max = Math.floor(range / CELL);
  if (waterFrom.length < size) (waterFrom = new Int32Array(size)), (waterSteps = new Int32Array(size));
  waterFrom.fill(-1, 0, size);
  const queue = [start];
  waterFrom[start] = start;
  waterSteps[start] = 0;
  for (let head = 0; head < queue.length; head++) {
    const c = queue[head]!, x = cellX(nav, c), y = cellY(nav, c);
    if (surfaceAt(world, x, y) === "shallow") return c === start ? null : wayTo(nav, c, start);
    if (waterSteps[c]! >= max) continue;
    for (const face of FACINGS) {
      const [dx, dy] = FACING_STEP[face], cx = (c % nav.w) + dx, cy = Math.floor(c / nav.w) + dy;
      if (cx < 0 || cy < 0 || cx >= nav.w || cy >= nav.h) continue;
      const n = cy * nav.w + cx;
      if (waterFrom[n]! >= 0 || !walkable(nav, n) || nav.flags[n]! & NAV.edge || danger.some((d) => inBox(d, cellX(nav, n), cellY(nav, n)))) continue;
      waterFrom[n] = c;
      waterSteps[n] = waterSteps[c]! + 1;
      queue.push(n);
    }
  }
  return null;
}
let waterFrom = new Int32Array(0), waterSteps = new Int32Array(0);

/** waterWay's answer, walking back from the water's cell `c` to `start`. */
function wayTo(nav: NavGrid, c: number, start: number): { face: Facing; length: number; straight: number } {
  const cells = [c];
  while (waterFrom[cells.at(-1)!] !== start) cells.push(waterFrom[cells.at(-1)!]!);
  cells.reverse(); // the first step's cell first
  const step = (a: number, z: number) => (z === a + 1 ? "right" : z === a - 1 ? "left" : z > a ? "down" : "up") as Facing;
  const face = step(start, cells[0]!);
  let straight = 1;
  while (straight < cells.length && step(cells[straight - 1]!, cells[straight]!) === face) straight++;
  return { face, length: cells.length * CELL, straight: straight * CELL };
}

/** The shallow water's cells on this grid's screen (memoized: no search far from any). */
function waterCells(nav: NavGrid, world: World): readonly number[] {
  let cells = watered.get(nav);
  if (!cells) {
    cells = [];
    for (let c = 0; c < nav.w * nav.h; c++) if (surfaceAt(world, cellX(nav, c), cellY(nav, c)) === "shallow") cells.push(c);
    watered.set(nav, cells);
  }
  return cells;
}
const watered = new WeakMap<NavGrid, number[]>();

// --- following a plan ---

/** This tick's walk for the current plan (before steering round trouble). */
function follow(ctx: Ctx): number {
  const { brain, b, state } = ctx;
  switch (brain.plan) {
    case "fight": {
      if (brain.thing) {
        const e = entityById(b, brain.thing);
        if (!e || isRemoved(e)) return replan(ctx);
        return goTo(ctx, px(e.x), px(e.y), brain.goalX, brain.goalY);
      }
      const q = state.players[brain.target], g = b.fighters[brain.target];
      if (!q || !g || g.hearts <= 0 || !sameScreen(q, ctx.p)) return replan(ctx);
      const qx = px(q.x), qy = px(q.y), rx = qx - ctx.x, ry = qy - ctx.y, face = facingOf(rx, ry);
      const gx = qx + brain.offX, gy = qy + brain.offY;
      // In reach (or where we meant to stand): face him and wait for the next decision; his swings hit the shield.
      const there = brain.offX || brain.offY ? Math.abs(gx - ctx.x) <= 2 && Math.abs(gy - ctx.y) <= 2 : hittable(g) && canHit(SWING_REACH[face], rx, ry, LINK_BOX, -2);
      if (there) return ctx.p.facing === face || ctx.p.moving ? 0 : FACING_BUTTON[face];
      return goTo(ctx, gx, gy, brain.goalX, brain.goalY);
    }
    case "pickup":
    case "orb": {
      const e = entityById(b, brain.thing);
      if (!e || isRemoved(e) || e.phase !== "rest") return replan(ctx);
      if (brain.plan === "orb") {
        const swing = strike(ctx, { x: px(e.x), y: px(e.y), box: ORB_BOX, link: -1, id: e.id });
        if (swing !== null) return swing;
      }
      if (takenByHand(e)) return takeItem(ctx, e);
      return goTo(ctx, px(e.x), px(e.y), px(e.x), px(e.y), 0);
    }
    case "bomb":
      return bombPlan(ctx);
    case "retreat":
    case "roam":
      return goTo(ctx, brain.goalX, brain.goalY, brain.goalX, brain.goalY);
    case "press":
      return pressPlan(ctx);
    case "light":
      return lightPlan(ctx);
    case "volley":
      return volleyPlan(ctx);
    case "toss":
      return tossPlan(ctx);
    case "warp":
    case "trip": {
      const w = battleWarps(b)[brain.thing - 1];
      if (!w || screenAt(w.y * SUBPX) !== screenAt(ctx.y * SUBPX)) return replan(ctx);
      return throughWarp(ctx, w);
    }
  }
}

/** A generator's item is taken with Action, facing it from 12 px (orbs.ts; walking onto it only pushes it away). */
function takeItem(ctx: Ctx, e: Entity): number {
  const ex = px(e.x), ey = px(e.y), dx = ex - ctx.x, dy = ey - ctx.y;
  if (takeTarget(ctx.state, ctx.i) === e) return ctx.p.held & Button.Action ? 0 : Button.Action;
  // The nearest safe spot beside it (side view: left or right, on its ground).
  let best: [number, number] | null = null;
  for (const [sx, sy] of ctx.nav.side ? TAKE_SIDES.slice(0, 2) : TAKE_SIDES) {
    const gx = ex + sx * 12, gy = ey + sy * 12;
    if (!safeCell(ctx.nav, cellAt(ctx.nav, gx, gy))) continue;
    if (!best || Math.abs(gx - ctx.x) + Math.abs(gy - ctx.y) < Math.abs(best[0] - ctx.x) + Math.abs(best[1] - ctx.y)) best = [gx, gy];
  }
  if (!best) return goTo(ctx, ex, ey, ex, ey, 0); // (nowhere to stand: onto it)
  const [gx, gy] = best;
  if (Math.abs(gx - ctx.x) <= 2 && Math.abs(gy - ctx.y) <= 2) {
    const face = facingOf(ex - gx, ey - gy);
    return ctx.p.facing === face ? 0 : FACING_BUTTON[face];
  }
  return goTo(ctx, gx, gy, gx, gy, 1);
}
const TAKE_SIDES: readonly (readonly [number, number])[] = [[-1, 0], [1, 0], [0, -1], [0, 1]];

function replan(ctx: Ctx): number {
  ctx.brain.think = 1;
  ctx.brain.thing = 0;
  return 0;
}

/**
 * Walking toward (x, y) px: straight when the line is clear, else down the distance field toward (fx, fy) (the plan's
 * goal, which moves less often than a rival: fields are memoized per goal cell).
 */
function goTo(ctx: Ctx, x: number, y: number, fx: number, fy: number, arrive = 2): number {
  const nav = ctx.nav;
  if (Math.abs(x - ctx.x) <= arrive && Math.abs(y - ctx.y) <= arrive) return 0;
  if (nav.side) return sideGoTo(ctx, x, y, fx, fy, arrive);
  if (lineClear(nav, ctx.x, ctx.y, x, y)) return toward(ctx.x, ctx.y, x, y, 1);
  const goal = fieldGoal(nav, fx, fy);
  if (goal < 0) return toward(ctx.x, ctx.y, x, y, 1);
  const next = nextStep(nav, flowField(nav, goal), ctx.x, ctx.y);
  // At the field's goal (near the real one): straight on.
  if (next < 0) return cellAt(nav, ctx.x, ctx.y) === goal ? toward(ctx.x, ctx.y, x, y, 1) : 0;
  return toward(ctx.x, ctx.y, cellX(nav, next), cellY(nav, next), 1);
}

/**
 * goTo on a side-view screen (cpunav.ts sideStep): along the ground when it leads straight there, else the field's
 * next move (Left or Right, off a ledge too; Up or Down on a ladder); nothing while falling.
 */
function sideGoTo(ctx: Ctx, x: number, y: number, fx: number, fy: number, arrive: number): number {
  const nav = ctx.nav, here = cellAt(nav, ctx.x, ctx.y);
  if (!walkable(nav, here)) return 0;
  const level = (gx: number) => (gx - ctx.x > arrive ? Button.Right : gx - ctx.x < -arrive ? Button.Left : 0);
  let dir: number;
  if (lineClear(nav, ctx.x, ctx.y, x, y)) dir = level(x);
  else {
    const goal = fieldGoal(nav, fx, fy);
    if (goal < 0) dir = level(x);
    else dir = sideStep(nav, flowField(nav, goal), ctx.x, ctx.y)?.dir ?? (here === goal ? level(x) : 0);
  }
  // Off a ladder onto ground: up to its height first (lower, his foot's corner sensor meets the ledge).
  if (dir === Button.Left || dir === Button.Right) {
    const next = here + (dir === Button.Right ? 1 : -1), ground = (nav.flags[next]! & (NAV.stand | NAV.ladder)) === NAV.stand;
    if (nav.flags[here]! & NAV.ladder && ground && ctx.y > Math.floor(here / nav.w) * CELL + nav.y0 + 1) return Button.Up;
  }
  return dir;
}

/**
 * Falling on a side-view screen (he moves sideways at walking speed as he falls): clear of an empty cannon under him
 * (siderooms.ts: it would shoot him back up), else toward the plan's goal.
 */
function steerFall(ctx: Ctx): number {
  const cannon = ctx.b.entities.find((e) => e.kind === "cannon" && e.owner < 0 && !isRemoved(e) && sameScreen(e, ctx.p) && e.y > ctx.p.y && Math.abs(px(e.x) - ctx.x) <= 20);
  if (cannon) return px(cannon.x) >= ctx.x ? Button.Left : Button.Right;
  const dx = ctx.brain.goalX - ctx.x;
  return dx > 8 ? Button.Right : dx < -8 ? Button.Left : 0;
}

/** Can we get to (x, y) px on a side-view screen (its field reaches us: some ledges have no way up)? */
function sideReachable(ctx: Ctx, x: number, y: number): boolean {
  const goal = fieldGoal(ctx.nav, x, y), here = nearestWalkable(ctx.nav, ctx.x, ctx.y, 3);
  return goal >= 0 && here >= 0 && flowField(ctx.nav, goal)[here]! < UNREACHABLE;
}

/** The bomb plan: to the bomb (the one just put down, or a socket's), then lift it; carrying() cooks and throws it. */
function bombPlan(ctx: Ctx): number {
  const { brain, b } = ctx;
  if (!brain.thing) {
    // Ours, just put down in front.
    const own = b.entities.find((o) => o.kind === "bomb" && o.owner === ctx.i && o.phase === "rest" && !isRemoved(o));
    if (own) brain.thing = own.id;
  }
  const e = brain.thing ? entityById(b, brain.thing) : undefined;
  if (!e || isRemoved(e) || e.phase !== "rest" || (e.timer > 0 && e.timer < 120) || brain.planTicks > 150) return replan(ctx);
  if (e.home >= 0 && rivalWithin(ctx, SOCKET_GUARD)) return replan(ctx);
  const bx = px(e.x), by = px(e.y), face = facingOf(bx - ctx.x, by - ctx.y), [sx, sy] = FACING_STEP[face];
  // Lift from 16 px away (carry.ts liftTarget: the point 16 px ahead within ±7 px of it).
  const gx = bx - sx * LIFT_REACH, gy = by - sy * LIFT_REACH;
  if (Math.abs(gx - ctx.x) <= 4 && Math.abs(gy - ctx.y) <= 4) return startAct(ctx, "lift", face);
  return goTo(ctx, gx, gy, gx, gy, 1);
}

/** Carrying something overhead: throw a Link (into a pit if one is in range), cook and throw a bomb, throw a pot. */
function carrying(ctx: Ctx): number {
  const { f, b, brain } = ctx;
  if (brain.act === "throw") return doAct(ctx) ?? 0;
  if (f.carryLink >= 0) return startAct(ctx, "throw", throwDirection(ctx));
  const e = entityById(b, f.carryEntity);
  if (!e) return 0;
  const target = brain.target >= 0 && b.fighters[brain.target]!.hearts > 0 ? brain.target : pickTarget(ctx);
  const rival = target >= 0 ? linkMark(ctx, target) : null;
  const bomb = e.kind === "bomb", fuse = bomb ? e.timer : Infinity;
  // Thrown up against crystals overhead; into a side room's door or hole.
  const planned = brain.plan === "volley" && bomb ? volleyCarry(ctx, e) : brain.plan === "toss" ? toss(ctx, e) : null;
  if (planned !== null) return planned;
  if (bomb && fuse <= 30) return startAct(ctx, "throw", rival ? facingOf(rival.x - ctx.x, rival.y - ctx.y) : openFacing(ctx));
  // A bomb for a crystal; the pot or bush off a switch: away (at a rival in line).
  if (brain.plan === "light" && bomb) {
    const lobbed = lob(ctx);
    if (lobbed !== null) return lobbed;
  }
  if (brain.plan === "press" && !bomb) {
    const face = rival ? facingOf(rival.x - ctx.x, rival.y - ctx.y) : null;
    return startAct(ctx, "throw", face && inLine(ctx, ctx.state.players[rival!.link]!, face, 80) ? face : openFacing(ctx));
  }
  if (!rival) return bomb || brain.planTicks > 60 ? startAct(ctx, "throw", openFacing(ctx)) : 0;
  const rx = rival.x - ctx.x, ry = rival.y - ctx.y, face = ctx.nav.side ? (rx >= 0 ? "right" : "left") : facingOf(rx, ry), [sx, sy] = FACING_STEP[face];
  const along = Math.abs(sx ? rx : ry), across = sx ? ry : rx;
  // A bomb flies 96 px before its bounce; pots, bushes and orbs 80.
  const [near, far] = bomb ? [56, 118] : [24, 84];
  const ready = !bomb || fuse <= ctx.t.bombFuse;
  if (ready && along >= near && along <= far && Math.abs(across) <= 14 && clearShot(ctx, rival.x, rival.y)) return startAct(ctx, "throw", face);
  if (!bomb && brain.planTicks > 150) return startAct(ctx, "throw", face);
  // Line up with him at a good distance: on his line, (near + far) / 2 away on our side.
  const mid = (near + far) >> 1;
  const gx = sx ? rival.x - sx * mid : rival.x, gy = sx ? rival.y : rival.y - sy * mid;
  return avoid(ctx, goTo(ctx, gx, gy, gx, gy, 3), WALK_LOOK);
}

/** Where to throw a held Link: toward a pit he'd land in, else a rival in line, else anywhere open. */
function throwDirection(ctx: Ctx): Facing {
  let best: Facing = ctx.p.facing, bestScore = -1;
  for (const face of FACINGS) {
    const [sx, sy] = FACING_STEP[face];
    // He flies about 80 px (like a bush) unless a wall stops him.
    let land = 80;
    for (let d = 8; d <= 80; d += 8) {
      if (isSolidAt(ctx.world, ctx.x + sx * d, ctx.y + sy * d)) {
        land = d - 8;
        break;
      }
    }
    let score = land < 24 ? 0 : 2;
    if (land >= 48 && !safeCell(ctx.nav, cellAt(ctx.nav, ctx.x + sx * land, ctx.y + sy * land))) score = 8;
    else if (ctx.b.fighters.some((g, j) => j !== ctx.i && j !== ctx.f.carryLink && g.hearts > 0 && inLine(ctx, ctx.state.players[j]!, face, land))) score = 6;
    if (face === ctx.p.facing) score += 1; // no turn needed
    if (score > bestScore) (best = face), (bestScore = score);
  }
  return best;
}

function inLine(ctx: Ctx, q: PlayerState, face: Facing, length: number): boolean {
  const [sx, sy] = FACING_STEP[face], rx = px(q.x) - ctx.x, ry = px(q.y) - ctx.y;
  const along = sx * rx + sy * ry, across = sx ? ry : rx;
  return along > 8 && along <= length && Math.abs(across) <= 10;
}

/** A facing with room to throw (no wall within 32 px), the current one first. */
function openFacing(ctx: Ctx): Facing {
  const order = [ctx.p.facing, ...FACINGS.filter((f) => f !== ctx.p.facing)];
  const open = order.find((face) => {
    const [sx, sy] = FACING_STEP[face];
    return !isSolidAt(ctx.world, ctx.x + sx * 32, ctx.y + sy * 32);
  });
  return open ?? ctx.p.facing;
}

/** Holding the sword for a spin: walk at him (slowly, facing locked), let go once charged with him inside the spin. */
function charging(ctx: Ctx): number {
  const { brain, p, b, state } = ctx;
  if (p.action === "none" && brain.charge > 2) {
    brain.charge = 0; // interrupted
    return 0;
  }
  brain.charge++;
  const q = state.players[brain.target], g = b.fighters[brain.target];
  if (!q || !g || g.hearts <= 0 || !sameScreen(q, ctx.p) || brain.charge > CHARGE_GIVE_UP) {
    brain.charge = 0;
    return 0;
  }
  const qx = px(q.x), qy = px(q.y);
  if (isFullyCharged(p) && hittable(g) && canHit(SPIN_REACH[p.facing], qx - ctx.x, qy - ctx.y, LINK_BOX, -3)) {
    brain.charge = 0;
    return 0; // let go: the spin
  }
  return Button.Sword | avoid(ctx, goTo(ctx, qx, qy, brain.goalX, brain.goalY, 6), WALK_LOOK);
}

/** On Epona: ride at a rival (trampling), round pits and hazards. */
function riding(ctx: Ctx): number {
  const target = pickTarget(ctx);
  if (target < 0) return 0;
  const q = ctx.state.players[target]!;
  return goTo(ctx, px(q.x), px(q.y), px(q.x), px(q.y), 0);
}

// --- steering round trouble ---

/** The 8 directions, clockwise from right. */
const ROSE = [
  Button.Right,
  Button.Right | Button.Down,
  Button.Down,
  Button.Down | Button.Left,
  Button.Left,
  Button.Left | Button.Up,
  Button.Up,
  Button.Up | Button.Right,
] as const;

const stepOf = (buttons: number): [number, number] => [(buttons & Button.Right ? 1 : 0) - (buttons & Button.Left ? 1 : 0), (buttons & Button.Down ? 1 : 0) - (buttons & Button.Up ? 1 : 0)];

/** Would a Link at (x, y) px get hurt (or be in a hazard's way)? */
function inDanger(ctx: Ctx, x: number, y: number): boolean {
  for (const d of ctx.danger) if (inBox(d, x, y)) return true;
  return false;
}

const inBox = (d: PixelBox, x: number, y: number) => x >= d.left && x <= d.right && y >= d.top && y <= d.bottom;

/** Is the point `look` px along `buttons` pit-safe ground, out of harm's way? */
function clearAt(ctx: Ctx, buttons: number, look: number): boolean {
  const [sx, sy] = stepOf(buttons);
  const x = ctx.x + sx * look, y = ctx.y + sy * look;
  return safeCell(ctx.nav, cellAt(ctx.nav, x, y)) && !inDanger(ctx, x, y);
}

/**
 * The walk `buttons` (other buttons pass through), or the direction nearest to it that doesn't lead into a pit or a
 * hazard, or none; out of harm's way first when he's in it.
 */
function avoid(ctx: Ctx, buttons: number, look: number): number {
  const dirs = buttons & DIRS, rest = buttons & ~DIRS;
  if (inDanger(ctx, ctx.x, ctx.y)) return escapeDanger(ctx, dirs) | rest;
  if (!dirs || clearAt(ctx, dirs, look)) return buttons;
  const k = ROSE.indexOf(dirs as (typeof ROSE)[number]);
  if (k < 0) return rest;
  // A flame in the way: round it on the side of it he's on, still on along the other axis if he can (a walk at a goal
  // beyond it would otherwise turn one way, then the other, as its diagonal flips). (Not a moving one: a fire bar's
  // balls are best let by.)
  const [sx, sy] = stepOf(dirs), box = ctx.danger.find((d) => inBox(d, ctx.x + sx * look, ctx.y + sy * look));
  const alts = [1, -1, 2, -2].map((turn) => ROSE[(k + turn + 8) % 8]! as number);
  if (box?.still) {
    const bx = (box.left + box.right) >> 1, by = (box.top + box.bottom) >> 1;
    const across = Math.abs(bx - ctx.x) >= Math.abs(by - ctx.y);
    const slide = across ? (ctx.y >= by ? Button.Down : Button.Up) : ctx.x >= bx ? Button.Right : Button.Left;
    const on = dirs & (across ? Button.Left | Button.Right : Button.Up | Button.Down);
    alts.unshift(...(on ? [on | slide, slide] : [slide]));
  }
  for (const alt of alts) if (clearAt(ctx, alt, look)) return alt | rest;
  return rest; // stop rather than step into it
}

/**
 * Out of harm's way: the direction that leaves the danger soonest over walkable ground (a sweeping fire bar is
 * best left sideways or outward, not toward the goal), `prefer` and its neighbors first on a tie; 0 when none does
 * within ESCAPE_RANGE px.
 */
function escapeDanger(ctx: Ctx, prefer = 0): number {
  if (!inDanger(ctx, ctx.x, ctx.y)) return 0;
  const k = Math.max(0, ROSE.indexOf(prefer as (typeof ROSE)[number]));
  let best = 0, bestTicks = Infinity;
  for (const turn of [0, 1, -1, 2, -2, 3, -3, 4]) {
    const dir = ROSE[(k + turn + 8) % 8]!, [sx, sy] = stepOf(dir);
    for (let d = 4; d <= ESCAPE_RANGE; d += 4) {
      const x = ctx.x + sx * d, y = ctx.y + sy * d;
      if (!walkable(ctx.nav, cellAt(ctx.nav, x, y))) break;
      if (inDanger(ctx, x, y)) continue;
      // Ticks to get there, times WALK_SPEED × WALK_SPEED_DIAGONAL: d / 1.5 px a tick straight, d / 1.06 diagonally.
      const ticks = sx && sy ? d * WALK_SPEED : d * WALK_SPEED_DIAGONAL;
      if (ticks < bestTicks) (best = dir), (bestTicks = ticks);
      break;
    }
  }
  return best;
}
const ESCAPE_RANGE = 40;

/**
 * Standing where the pit probe is over a pit or a colored panel (knocked there; a panel of his own color holds him
 * until it changes): straight to the nearest solid ground, whatever else is going on.
 */
function rescue(ctx: Ctx): number {
  const cell = nearestWalkable(ctx.nav, ctx.x, ctx.y, 8, solidGround);
  return cell < 0 ? 0 : toward(ctx.x, ctx.y, cellX(ctx.nav, cell), cellY(ctx.nav, cell), 1);
}

/** Is the run (a roll, a lunge) from here along `face` clear of pits and hazards? */
function runAhead(ctx: Ctx, face: Facing, length: number): boolean {
  const [sx, sy] = FACING_STEP[face];
  if (!runClear(ctx.nav, ctx.x, ctx.y, sx, sy, length)) return false;
  for (let d = 8; d <= length; d += 8) if (inDanger(ctx, ctx.x + sx * d, ctx.y + sy * d)) return false;
  return true;
}

/** Fire-bar balls are foreseen this many ticks ahead (every FIREBAR_STEP): a bar sweeps under 1 px a tick. */
const FIREBAR_AHEAD = 16;
const FIREBAR_STEP = 4;
/** Ticks ahead a burning rival's run is foreseen (2 px a tick) by CPUs that dodge. */
const BURN_AHEAD = 12;
/** Where a Link gets hurt (anchorBox); `still`: a flame that stays put (one to go round). */
type Danger = PixelBox & { still?: boolean };

/** Only hazards this close (px) matter for a CPU's next steps (runs of up to 66 px, a margin). */
const NEAR = 90;

// A box (world px) hurts a Link whose hurtbox overlaps it: the anchor positions (px) that do, plus a margin.
function anchorBox(box: PixelBox, margin: number): PixelBox {
  return { left: box.left - HURTBOX.right - margin, right: box.right - HURTBOX.left + margin, top: box.top - HURTBOX.bottom - margin, bottom: box.bottom - HURTBOX.top + margin };
}
const around = (x: number, y: number, half: number, margin: number) => anchorBox({ left: px(x) - half, top: px(y) - half, right: px(x) + half - 1, bottom: px(y) + half - 1 }, margin);

/**
 * Anchor positions (px) where any Link gets hurt now or within a few ticks: burning flames (BLZE too) and jets,
 * fire-bar balls where they'll be, explosions, bombs about to go off, a trick floor about to open (soldiers and bees
 * get swatted instead: decide()). The same for every CPU: worked out once a tick.
 */
function hazardBoxes(state: GameState): Danger[] {
  const b = state.battle!;
  const out: Danger[] = [];
  for (const e of b.entities) {
    if (isRemoved(e)) continue;
    switch (e.kind) {
      case "trapdoor":
        // Its 4×4 tiles, where the pit probe would be over them, once it opens or someone is by its switch.
        if (e.phase !== "rest" || switchOn(b, e.param) || trapdoorTrodden(state, e.param)) {
          const x = px(e.x), y = px(e.y), size = TRAPDOOR_TILES * TILE;
          out.push({ left: x - PIT_PROBE.x - 4, right: x + size - 1 - PIT_PROBE.x + 4, top: y - PIT_PROBE.y - 4, bottom: y + size - 1 - PIT_PROBE.y + 4 });
        }
        break;
      case "flame":
        if (flameLit(b, e)) out.push({ ...around(e.x, e.y, FLAME_HALF, 3), still: true });
        break;
      case "blaze":
        // A BLZE (firerod.ts): its ±6 px box hurts while it's young (stepFire counts the tick up first).
        if (e.tick < BLAZE.hurtTicks) out.push({ ...around(e.x, e.y, BLAZE.half + 1, 3), still: true });
        break;
      case "jet":
        if (e.phase === "active" || e.timer > JET_HURT_SIZE / 2) out.push(anchorBox(jetBox(e), 4));
        break;
      case "firebar": {
        // hazards.ts fireballs(), at the angles to come.
        const params = b.props.actors[e.home]?.params ?? 0, speed = firebarSpeed(b, e);
        const count = Math.max(1, Math.min(16, params & 0xff)), first = ((params >>> 20) & 15) + 1;
        for (let ahead = 0; ahead <= FIREBAR_AHEAD; ahead += FIREBAR_STEP) {
          const angle = (e.angle + speed * ahead) & 0xffff, cos = cos4096(angle), sin = sin4096(angle);
          for (let k = 0; k < count; k++) {
            const r = (first + k) * FIREBAR_RING * SUBPX;
            out.push(around(e.x + Math.trunc((r * cos) / TRIG_ONE), e.y + Math.trunc((r * sin) / TRIG_ONE), FIREBALL_HALF, 2));
          }
        }
        break;
      }
      case "explosion":
        if (e.tick < blastTicks(e) && !(e.param & BLAST_GIANT)) out.push(around(e.x, e.y, BLAST_HALF, 2));
        break;
      case "bombchu": {
        // Where it runs over the next ticks (armed, or about to be), and its blast once its fuse is short.
        if (e.timer <= 40) out.push(around(e.x, e.y, BLAST_HALF, 6));
        if (!bombchuArmed(b, e) && e.tick + 12 < 30) break;
        for (let k = 0; k <= 12; k += 4) out.push(around(e.x + e.vx * k, e.y + e.vy * k, BOMBCHU_HALF, 3));
        break;
      }
      case "bomb":
        if (e.timer > 0 && e.timer <= 80 && e.phase !== "held") out.push(around(e.x + e.vx * 8, e.y + e.vy * 8, BLAST_HALF, 6));
        break;
    }
  }
  return out;
}

/** Is a Link standing by an uncovered floor switch that opens trick floor `n` (hazards.ts: within 8 px of its middle)? */
function trapdoorTrodden(state: GameState, n: number): boolean {
  const b = state.battle!;
  return b.props.actors.some((a) => {
    if (a.id !== "SWTH" || ownSwitch(a.params) !== n || switchCovered(b, a)) return false;
    const cx = a.x + TILE / 2, cy = a.y + TILE / 2;
    return state.players.some((p, i) => b.fighters[i]!.hearts > 0 && Math.abs(px(p.x) - cx) <= 20 && Math.abs(px(p.y) - cy) <= 20);
  });
}

/**
 * The anchor positions near a CPU where it would get hurt: the arena's hazards close by, burning rivals (their flame
 * sets it alight), and, for CPUs that mind them, where those run next, shots on their way and rivals about to spin.
 */
function threats(ctx: Ctx, hazards: readonly Danger[]): Danger[] {
  const { b, state, t, i, x, y } = ctx;
  const out = hazards.filter((d) => d.right >= x - NEAR && d.left <= x + NEAR && d.bottom >= y - NEAR && d.top <= y + NEAR);
  const alight = ctx.f.move === "burning"; // (fire can't set him alight again)
  state.players.forEach((q, j) => {
    const g = b.fighters[j]!;
    if (alight || j === i || g.move !== "burning" || g.fireWait < 0 || !sameScreen(q, ctx.p) || Math.abs(px(q.x) - x) + Math.abs(px(q.y) - y) > NEAR) return;
    for (let k = 0; k <= (t.dodge > 0 ? BURN_AHEAD : 0); k += 4) out.push(around(q.x + g.flyX * k, q.y + g.flyY * k, BODY_HALF + 1, 3));
  });
  if (t.dodge <= 0) return out;
  for (const e of b.entities) {
    if (isRemoved(e) || e.owner === i) continue;
    if (e.kind === "fireball" && e.phase === "flying" && !alight) {
      // Slow at first (firerod.ts: it eases up to 2 px a tick): where it'll be at that speed.
      const [sx, sy] = FACING_STEP[e.facing];
      for (let k = 0; k <= 16; k += 4) out.push(around(e.x + sx * FIRE_ROD.speed * k, e.y + sy * FIRE_ROD.speed * k, FIRE_ROD.half + 1, 2));
    } else if ((e.kind === "arrow" || e.kind === "seed") && e.phase === "flying") {
      for (let k = 2; k <= 12; k += 5) out.push(around(e.x + e.vx * k, e.y + e.vy * k, 4, 1));
    } else if (e.kind === "boomerang") for (let k = 2; k <= 10; k += 4) out.push(around(e.x + e.vx * k, e.y + e.vy * k, 5, 1));
  }
  state.players.forEach((q, j) => {
    const g = b.fighters[j]!;
    if (j === i || g.hearts <= 0 || g.mode !== "active" || !sameScreen(q, ctx.p)) return;
    if (isFullyCharged(q) || (q.action === "spin" && q.actionTick < 20)) out.push({ left: px(q.x) - 34, right: px(q.x) + 34, top: px(q.y) - 34, bottom: px(q.y) + 38 });
  });
  return out;
}

// --- targets and places ---

/** Can this rival be hurt now (not blinking, held, thrown or on Epona; stunned by a seed he can: combat.ts vulnerable)? */
function hittable(g: Fighter): boolean {
  return g.hearts > 0 && g.invincible === 0 && (g.mode === "active" || g.mode === "recoil" || g.mode === "stunned") && g.move !== "held" && g.move !== "thrown" && g.move !== "ride";
}

/**
 * The rival to fight: the nearest one in this world we can walk to (the current one favored; the weakest, when hard);
 * `anywhere`: reachable or not.
 */
function pickTarget(ctx: Ctx, anywhere = false): number {
  const { b, state, brain, f, nav } = ctx;
  const mine = region(nav, nearestWalkable(nav, ctx.x, ctx.y, 3));
  let best = -1, bestScore = Infinity;
  b.fighters.forEach((g, j) => {
    if (j === ctx.i || g.hearts <= 0 || g.mode === "dying" || g.mode === "dead" || !sameScreen(state.players[j]!, ctx.p)) return;
    const q = state.players[j]!, qx = px(q.x), qy = px(q.y);
    const theirs = region(nav, nearestWalkable(nav, qx, qy, 3));
    if (!anywhere && mine && theirs && mine !== theirs && g.mode === "active" && g.move !== "held") return; // across a pit
    if (!anywhere && nav.side && g.mode === "active" && !sideReachable(ctx, qx, qy)) return; // (up a ledge with no way up)
    let score = Math.abs(qx - ctx.x) + Math.abs(qy - ctx.y);
    if (j === brain.target) score -= 30;
    if (g.invincible > 0 || g.mode === "falling") score += 60;
    if (g.move === "held") score += 80;
    if (brain.level === "hard") score -= (b.rules.hearts * HEART - g.hearts) * 4;
    if (score < bestScore) (best = j), (bestScore = score);
  });
  return best;
}

function linkMark(ctx: Ctx, j: number): Mark {
  const q = ctx.state.players[j]!;
  return { x: px(q.x), y: px(q.y), box: LINK_BOX, link: j, id: 0 };
}

const dist = (ctx: Ctx, m: { x: number; y: number }) => Math.abs(m.x - ctx.x) + Math.abs(m.y - ctx.y);

/**
 * A socket bomb is lifted facing the rim, and its socket opens into the lava once it's off (entities.ts battleWorld): a
 * rival this close (px, as dist) would reach us during the lift (LIFT_TICKS) and knock us through it.
 */
const SOCKET_GUARD = 72;

/** Is another Link still in the round within `range` px (as dist)? */
function rivalWithin(ctx: Ctx, range: number): boolean {
  return ctx.b.fighters.some((g, j) => j !== ctx.i && g.hearts > 0 && dist(ctx, linkMark(ctx, j)) < range);
}

/** The nearest entity passing `test` within `range` px (Manhattan) that we can walk up to. */
function nearestEntity(ctx: Ctx, test: (e: Entity) => boolean, range: number): Entity | undefined {
  let best: Entity | undefined, bestD = range;
  for (const e of ctx.b.entities) {
    if (isRemoved(e) || !test(e)) continue;
    const d = Math.abs(px(e.x) - ctx.x) + Math.abs(px(e.y) - ctx.y);
    if (d <= bestD && reachable(ctx, px(e.x), px(e.y))) (best = e), (bestD = d);
  }
  return best;
}

/** Can we walk up to (x, y) px (its nearest walkable cell is in our region)? */
function reachable(ctx: Ctx, x: number, y: number): boolean {
  const nav = ctx.nav;
  const mine = region(nav, nearestWalkable(nav, ctx.x, ctx.y, 3)), theirs = region(nav, nearestWalkable(nav, x, y, 3));
  return !mine || (theirs !== 0 && theirs === mine);
}

/** A soldier or bee close enough to swat. */
function nearestCritter(ctx: Ctx): Mark | null {
  const e = nearestEntity(ctx, (o) => ((o.kind === "soldier" || o.kind === "bowSoldier" || o.kind === "captain" || o.kind === "ballSoldier") && o.phase !== "stun") || (o.kind === "bee" && o.phase === "chase"), CRITTER_RANGE);
  if (!e) return null;
  const half = e.kind === "bee" ? 5 : 7;
  return { x: px(e.x), y: px(e.y), box: { left: -half, top: -half, right: half - 1, bottom: half - 1 }, link: -1, id: e.id };
}

// Where to stand round a rival: 8 spots STAND px from him (swing range: SWING_REACH), clockwise from his right.
const STAND = 24;
const DIAG = 17;
const AROUND: readonly (readonly [number, number])[] = [[STAND, 0], [DIAG, DIAG], [0, STAND], [-DIAG, DIAG], [-STAND, 0], [-DIAG, -DIAG], [0, -STAND], [DIAG, -DIAG]];
const LEVEL_AROUND = AROUND.filter(([, oy]) => oy === 0);
/** How far a sword hit knocks a Link: 1.5 px a tick for the 25 ticks of the hop (combat.ts KNOCK_DEFAULT). */
const KNOCK_REACH = 36;

/**
 * Where to fight a rival from, relative to him (px); [0, 0] = straight at him when the way is straight (ending about
 * STAND px away on that line). Scored on the walk there, on his raised shield facing it (`shield`), and (`pits`) on a
 * pit behind us, where his hit would knock us, or, for a hard CPU, behind him. The spot we're heading for is kept
 * unless another is clearly better.
 */
function standOffset(ctx: Ctx, q: PlayerState, shield: boolean, pits: boolean): [number, number] {
  const qx = px(q.x), qy = px(q.y), brain = ctx.brain, [fx, fy] = FACING_STEP[q.facing];
  const raised = q.action === "none" || (isAttack(q.action) && q.actionTick === 0);
  const score = (ox: number, oy: number) => {
    let s = Math.abs(qx + ox - ctx.x) + Math.abs(qy + oy - ctx.y);
    // In front of him, diagonals included (a diagonal spot is a tie that a pixel off turns into his front).
    if (shield && raised && ox * fx + oy * fy > 0) s += 120; // (a blocked hit gains nothing)
    if (pits && knockedInto(ctx, qx + ox, qy + oy, ox, oy)) s += 80;
    if (pits && ctx.brain.level === "hard" && knockedInto(ctx, qx, qy, -ox, -oy)) s -= 30;
    return s;
  };
  const keep = (ox: number, oy: number) => (ox === brain.offX && oy === brain.offY ? KEEP_SPOT : 0);
  let best: [number, number] = [0, 0], bestScore = Infinity;
  // (Side view: beside him on his ground, not over or under him.)
  const [dx, dy] = ctx.nav.side ? [ctx.x >= qx ? STAND : -STAND, 0] : (scaled(ctx.x - qx, ctx.y - qy, STAND) ?? [0, 0]);
  if ((dx || dy) && lineClear(ctx.nav, ctx.x, ctx.y, qx + dx, qy + dy)) bestScore = score(dx, dy) - keep(0, 0);
  for (const [ox, oy] of ctx.nav.side ? LEVEL_AROUND : AROUND) {
    if (!solidGround(ctx.nav, cellAt(ctx.nav, qx + ox, qy + oy))) continue;
    const s = score(ox, oy) - keep(ox, oy);
    if (s < bestScore) (best = [ox, oy]), (bestScore = s);
  }
  return best;
}
const KEEP_SPOT = 12; // px of walking another spot must save before a CPU changes its mind

/** Could a hit knock a Link at (x, y) px into a pit (along any of the 4 directions)? */
function nearPit(ctx: Ctx, x: number, y: number): boolean {
  return FACINGS.some((face) => knockedInto(ctx, x, y, FACING_STEP[face][0], FACING_STEP[face][1]));
}

/** Would a Link at (x, y) px knocked along (dx, dy) land in a pit (walls ignored: they'd stop him first)? */
function knockedInto(ctx: Ctx, x: number, y: number, dx: number, dy: number): boolean {
  for (const d of [KNOCK_REACH / 3, (KNOCK_REACH * 2) / 3, KNOCK_REACH]) {
    const [sx, sy] = scaled(dx, dy, d) ?? [0, 0];
    if (!safeCell(ctx.nav, cellAt(ctx.nav, x + sx, y + sy))) return true;
  }
  return false;
}

/** (dx, dy) scaled to `length` px (integer math), or null for no direction. */
function scaled(dx: number, dy: number, length: number): [number, number] | null {
  const len = isqrt(dx * dx + dy * dy);
  return len ? [Math.trunc((dx * length) / len), Math.trunc((dy * length) / len)] : null;
}

/** Somewhere away from every rival and not too far to go (a lattice spot scored on the rivals' distances), or -1. */
function fleeSpot(ctx: Ctx): number {
  const { nav, b, state } = ctx;
  const rivals = b.fighters.flatMap((g, j) => (j !== ctx.i && g.hearts > 0 && sameScreen(state.players[j]!, ctx.p) ? [state.players[j]!] : []));
  const mine = region(nav, nearestWalkable(nav, ctx.x, ctx.y, 3));
  let best = -1, bestScore = -Infinity;
  for (const spot of openSpots(nav)) {
    if (mine && region(nav, spot) !== mine) continue;
    const x = cellX(nav, spot), y = cellY(nav, spot);
    let near = 160 * 160;
    for (const q of rivals) near = Math.min(near, (px(q.x) - x) ** 2 + (px(q.y) - y) ** 2);
    const score = near - (((x - ctx.x) ** 2 + (y - ctx.y) ** 2) >> 2);
    if (score > bestScore) (best = spot), (bestScore = score);
  }
  return best;
}

/**
 * Going through a door or into a hole plays out by itself; in a cannon it fires at once (Item, a new press every other
 * tick); shot out of a hole it steers for where it started the round, away from the hole (which would take it again).
 */
function away(ctx: Ctx): number {
  const { f } = ctx;
  if (f.move === "cannon") return ctx.state.tick & 1 ? Button.Item : 0;
  if (f.move === "launch" && launchFlying(f)) return toward(ctx.x, ctx.y, f.spawnX, f.spawnY, 2);
  return 0;
}

// --- floor switches and crystals ---

/** Per attack a switch sets off (cpuswitches.ts): its worth per rival it catches, and against us if it would catch us. */
const ATTACK_WORTH: Readonly<Record<SwitchAttack, readonly [number, number]>> = {
  bombchus: [6, 6], // (from a side room, nothing against us)
  giant: [12, 40],
  bombs: [6, 8],
  jets: [6, 8],
  flames: [6, 8],
  lava: [8, 8],
  floor: [8, 8],
};
const WORTH_PX = 60; // px of walking one point of worth pays for
const SWITCH_RANGE: Readonly<Record<CpuLevel, number>> = { easy: 0, normal: 200, hard: 420 }; // px (Manhattan) to one
const SPOT_RANGE = 64; // px (Manhattan) to a switch whose attack is on a spot of the same screen
const TRIP_COST = 60; // px of walking: what going into a side room for one costs on top
const TRIP_CLEAR = 100; // px: no trip with a rival closer than this
const SWITCH_BUSY = 40; // px: a rival this close (and hittable) gets fought instead
const SWITCH_TICKS = 600; // the longest a CPU goes on with a switch plan (trying to light a crystal)…
const HOLD_TICKS = 300; // …and with a floor switch (getting there, standing on it)
const SOCKET_RANGE = 300; // px: a socket bomb this close on the screen will do for a crystal
const CRYSTAL_THROW = [48, 56, 64, 72, 80] as const; // px from a crystal to throw a bomb at it (it stops against it)

/**
 * The switches part of decide(): keeps on with a switch plan while it's still worth it, or (now and then: the level's
 * `switches`; on arriving from a trip, at once; alone in a side room, its crystals lit together at once) picks the
 * best switch to go for. Returns the decision's buttons, null when it set a plan, or undefined when it's not about
 * switches.
 */
function switchPlan(ctx: Ctx, rival: Mark | null): number | null | undefined {
  const { brain, t } = ctx;
  if (!t.switches) return undefined;
  const busy = !!rival && dist(ctx, rival) < SWITCH_BUSY && hittable(ctx.b.fighters[rival.link]!);
  const was = brain.plan;
  if (was === "press" || was === "light" || was === "trip" || was === "volley") {
    if (!busy && brain.planTicks < SWITCH_TICKS && stillWorth(ctx)) return null;
    setPlan(ctx, "roam", ctx.x, ctx.y, -1);
  }
  if (busy) return undefined;
  if (was === "trip" || chance(brain, t.switches)) return pickSwitch(ctx, rival);
  // Alone in a side room, about to leave it: crystals to light together there, at once.
  return !rival && screenAt(ctx.p.y) > 0 ? pickSwitch(ctx, rival, true) : undefined;
}

/** Is the switch plan under way still worth going on with? */
function stillWorth(ctx: Ctx): boolean {
  const { brain, b } = ctx;
  if (brain.plan === "trip") {
    const w = battleWarps(b)[brain.thing - 1];
    return !!w && screenAt(w.y * SUBPX) === screenAt(ctx.p.y);
  }
  const e = brain.thing ? entityById(b, brain.thing) : undefined, tr = e ? triggerOf(b, e.home) : undefined;
  if (!e || !tr || isRemoved(e) || triggerWorth(ctx, tr) <= 0) return false;
  if (brain.plan === "volley") {
    const v = volleyOf(b.props, tr), left = v ? spotsLeft(ctx, v) : null;
    return !!v && !!left?.length && (isCarrying(ctx.f) || canVolley(ctx, v, left));
  }
  if (!ready(ctx, tr, e, true)) return false;
  if (!tr.crystal && brain.planTicks > HOLD_TICKS) return false;
  return !tr.crystal || isCarrying(ctx.f) || bombSource(ctx);
}

/**
 * The best switch to go for now (setting the plan: "press", "light", "volley", or "trip" into its side room), else
 * undefined; `groups`: only crystals lit together.
 */
function pickSwitch(ctx: Ctx, rival: Mark | null, groups = false): null | undefined {
  const { b, brain, t } = ctx;
  const here = screenAt(ctx.p.y), range = SWITCH_RANGE[brain.level];
  const trips = here === 0 && (!rival || dist(ctx, rival) > TRIP_CLEAR) && chance(brain, t.trips);
  let best: Entity | null = null, bestScore = 0, bestWarp = -1, bestVolley = false;
  for (const tr of switchTriggers(b.props)) {
    if (tr.screen !== here && !trips) continue;
    if (tr.partners.some((k) => k < tr.prop) || (groups && !tr.partners.length)) continue; // (a group once, for its first)
    const worth = triggerWorth(ctx, tr);
    if (worth <= 0) continue;
    const e = b.entities.find((o) => o.home === tr.prop && (o.kind === "switch" || o.kind === "crystal") && !isRemoved(o));
    const v = volleyOf(b.props, tr);
    if (!e || (!v && !ready(ctx, tr, e, false))) continue;
    let score = worth * WORTH_PX, warp = -1;
    if (tr.screen === here) {
      // (An attack on a spot of this screen only while we're close: the rivals don't stay there long.)
      const fleeting = tr.effects.every((ef) => ef.spots.length && ef.screen === here);
      let d = Math.abs(tr.x - ctx.x) + Math.abs(tr.y - ctx.y);
      if (v) {
        const left = spotsLeft(ctx, v);
        if (!left || !canVolley(ctx, v, left)) continue;
        d = Math.min(...left.map((s) => Math.abs(s.x - ctx.x) + Math.abs(s.y - ctx.y)));
        if (d > (fleeting ? SPOT_RANGE : range)) continue;
      } else if (d > (fleeting ? SPOT_RANGE : range) || (tr.crystal && !bombSource(ctx)) || !(ctx.nav.side ? sideReachable(ctx, tr.x, tr.y) : reachable(ctx, tr.x, tr.y))) continue;
      score -= d;
    } else {
      // Into a side room for an attack on the whole TV (by then the rivals have moved: not for one on a spot).
      if (tr.effects.some((ef) => ef.spots.length) || (tr.crystal && ctx.f.item !== "bomb" && (v || !socketIn(b, tr.screen)))) continue;
      warp = warpTo(ctx, (k) => k === tr.screen, { x: tr.x, y: tr.y, screen: tr.screen });
      if (warp < 0) continue;
      const w = battleWarps(b)[warp]!;
      score -= TRIP_COST + Math.abs(w.x - ctx.x) + Math.abs(w.y - ctx.y);
    }
    if (score > bestScore) (best = e), (bestScore = score), (bestWarp = warp), (bestVolley = !!v);
  }
  if (!best) return undefined;
  if (bestWarp >= 0) return setPlan(ctx, "trip", ctx.x, ctx.y, -1, bestWarp + 1);
  return setPlan(ctx, best.kind !== "crystal" ? "press" : bestVolley ? "volley" : "light", px(best.x), px(best.y), -1, best.id);
}

/** The trigger (cpuswitches.ts) of the switch or crystal made from prop `k`. */
function triggerOf(b: BattleState, k: number): Trigger | undefined {
  return switchTriggers(b.props).find((tr) => tr.prop === k);
}

/**
 * What turning a trigger on now would be worth (ATTACK_WORTH): the rivals its attacks catch where they are, less us
 * where we'd be (at the switch). Half when one other switch it needs is still off (its partner crystals don't count:
 * a volley lights them too); nothing for bombchus while some are about, or when more is missing.
 */
function triggerWorth(ctx: Ctx, tr: Trigger): number {
  const { b, state } = ctx;
  let missing = 0;
  for (const s of tr.needs) if (!switchOn(b, s) && !tr.partners.some((k) => ownSwitch(b.props.actors[k]!.params) === s)) missing++;
  if (missing > (tr.crystal ? 1 : 0)) return 0;
  let worth = 0;
  for (const ef of tr.effects) {
    if (ef.attack === "bombchus" && b.entities.some((e) => e.kind === "bombchu" && !isRemoved(e))) continue;
    const [rival, self] = ATTACK_WORTH[ef.attack];
    b.fighters.forEach((g, j) => {
      if (g.hearts <= 0 || g.mode === "dying" || g.mode === "dead") return;
      const q = state.players[j]!, us = j === ctx.i;
      const [x, y, screen] = us ? [tr.x, tr.y, tr.screen] : [px(q.x), px(q.y), screenAt(q.y)];
      // (Bombchus run all over the screen: called from a side room, they're no threat to us there.)
      if (screen === ef.screen && caughtBy(ef, x, y)) worth += us ? -self : rival;
    });
  }
  return missing ? worth >> 1 : worth;
}

/**
 * Can the trigger be turned on now: a floor switch not on already (`holding` one whose attack lasts while it's on: on
 * because we stand on it), a crystal dark, out of its lockout, with no lit bomb by it.
 */
function ready(ctx: Ctx, tr: Trigger, e: Entity, holding: boolean): boolean {
  if (!tr.crystal) return e.phase !== "active" || (holding && tr.hold && Math.abs(tr.x - ctx.x) <= TILE && Math.abs(tr.y - ctx.y) <= TILE);
  if (e.phase !== "rest" || e.timer > 0 || e.param === 1) return false;
  return !ctx.b.entities.some((o) => o.kind === "bomb" && o.timer > 0 && o.phase !== "held" && !isRemoved(o) && Math.abs(o.x - e.x) <= CRYSTAL_BLAST && Math.abs(o.y - e.y) <= CRYSTAL_BLAST);
}
const CRYSTAL_BLAST = 24 * SUBPX; // a blast (±16 px) on a crystal (±8 px): switches.ts stepCrystal

/** A bomb to light a crystal with: carried, ours on the ground, a socket's on this screen, or one in hand to put down. */
function bombSource(ctx: Ctx): boolean {
  const { b, f } = ctx;
  if (f.item === "bomb" || (f.carryEntity && entityById(b, f.carryEntity)?.kind === "bomb")) return true;
  return !!ownBomb(ctx) || !!nearestEntity(ctx, socketBomb, SOCKET_RANGE);
}
const socketBomb = (e: Entity) => e.kind === "bomb" && e.phase === "rest" && e.timer === 0 && e.home >= 0;
const socketIn = (b: BattleState, screen: number) => b.entities.some((e) => socketBomb(e) && !isRemoved(e) && screenAt(e.y) === screen);

/** Our bomb, lit, on the ground on this screen and not by a crystal already. */
function ownBomb(ctx: Ctx): Entity | undefined {
  return ctx.b.entities.find((o) => o.kind === "bomb" && o.owner === ctx.i && o.phase === "rest" && o.timer > CRYSTAL_FUSE && !isRemoved(o) && sameScreen(o, ctx.p) && !byCrystal(ctx.b, o));
}
const CRYSTAL_FUSE = 60; // ticks of fuse a bomb needs left to be carried to a crystal

function byCrystal(b: BattleState, o: Entity): boolean {
  return b.entities.some((c) => c.kind === "crystal" && Math.abs(o.x - c.x) <= CRYSTAL_BLAST && Math.abs(o.y - c.y) <= CRYSTAL_BLAST);
}

/** The "press" plan: off with the pot or bush over the switch (carrying() throws it away), then onto it and stay. */
function pressPlan(ctx: Ctx): number {
  const { brain, b } = ctx;
  const e = entityById(b, brain.thing), prop = e ? b.props.actors[e.home] : undefined;
  if (!e || !prop || isRemoved(e)) return replan(ctx);
  const cx = px(e.x) + TILE / 2, cy = px(e.y) + TILE / 2;
  if (switchCovered(b, prop)) return liftAt(ctx, cx, cy);
  return goTo(ctx, cx, cy, cx, cy, 1);
}

/** The "light" plan: a bomb (ours on the ground, a socket's, or one put down now) lifted; carrying() throws it. */
function lightPlan(ctx: Ctx): number {
  const { brain, b, f } = ctx;
  const c = entityById(b, brain.thing);
  if (!c || isRemoved(c) || c.phase !== "rest") return replan(ctx);
  const bomb = ownBomb(ctx) ?? nearestEntity(ctx, socketBomb, SOCKET_RANGE);
  if (bomb && bomb.home >= 0 && rivalWithin(ctx, SOCKET_GUARD)) return replan(ctx);
  if (bomb) return liftAt(ctx, px(bomb.x), px(bomb.y));
  if (f.item === "bomb" && !b.entities.some((o) => o.kind === "bomb" && o.owner === ctx.i && !isRemoved(o))) {
    const [sx, sy] = FACING_STEP[ctx.p.facing];
    if (ctx.nav.side || safeCell(ctx.nav, cellAt(ctx.nav, ctx.x + sx * 13, ctx.y + sy * 13))) return startAct(ctx, "item", null);
    return avoid(ctx, ROSE[rand(brain, 8)]!, WALK_LOOK); // (a step to find room in front)
  }
  return replan(ctx);
}

/** To the spot LIFT_REACH px from (x, y) px (the nearest safe side; side view: left or right), facing it, and lift. */
function liftAt(ctx: Ctx, x: number, y: number): number {
  let best: Facing | null = null, bestD = Infinity;
  for (const face of ctx.nav.side ? LEVEL_FACINGS : FACINGS) {
    const [sx, sy] = FACING_STEP[face], gx = x - sx * LIFT_REACH, gy = y - sy * LIFT_REACH;
    if (!safeCell(ctx.nav, cellAt(ctx.nav, gx, gy))) continue;
    const d = Math.abs(gx - ctx.x) + Math.abs(gy - ctx.y);
    if (d < bestD) (best = face), (bestD = d);
  }
  if (!best) return replan(ctx);
  const [sx, sy] = FACING_STEP[best], gx = x - sx * LIFT_REACH, gy = y - sy * LIFT_REACH;
  if (Math.abs(gx - ctx.x) <= 3 && Math.abs(gy - ctx.y) <= 3) return startAct(ctx, "lift", best);
  return goTo(ctx, gx, gy, gx, gy, 1);
}
const LEVEL_FACINGS: readonly Facing[] = ["right", "left"];

// --- crystals lit together ---

/** A bomb's fuse at the press throwing it up under crystals overhead (side view): it blows against them (12-22 do). */
const UP_FUSE = 17;
/** Ticks between our bombs' fuses when they're thrown up one after the other (the next lifted once one is thrown). */
const VOLLEY_GAP = 100;
/** A bomb for an upward throw is lifted with this much fuse left (lying, under 80 it's a hazard to keep off). */
const LIFT_AT = 110;
/** px from the ground up to the bottom of crystals overhead that a bomb thrown up reaches (the gallery's: 48). */
const CEILING = [40, 56] as const;
/** px under a spot a bomb thrown up at it still counts as on its way. */
const RISE = 32;

const crystalOf = (b: BattleState, k: number) => b.entities.find((o) => o.kind === "crystal" && o.home === k && !isRemoved(o));
const ownBombs = (ctx: Ctx) => ctx.b.entities.filter((o) => o.kind === "bomb" && o.owner === ctx.i && !isRemoved(o));

/**
 * The volley's spots still wanting a blast (a dark crystal there, no lit bomb on its way to it), or null when it can't
 * go on (a crystal gone; a lit toggle crystal sharing a spot with a dark one: the blast would put it out).
 */
function spotsLeft(ctx: Ctx, v: Volley): BlastSpot[] | null {
  const out: BlastSpot[] = [];
  for (const s of v.spots) {
    let dark = false, toggled = false;
    for (const k of s.crystals) {
      const c = crystalOf(ctx.b, k);
      if (!c) return null;
      if (c.phase === "rest") dark = true;
      else if (c.param !== 1 && v.toggles.includes(k)) toggled = true;
    }
    if (!dark) continue;
    if (toggled) return null;
    if (!blastComing(ctx, s)) out.push(s);
  }
  return out;
}

/** A lit bomb (not in a hand) by the spot, or thrown under it on its way up (side view). */
function blastComing(ctx: Ctx, s: BlastSpot): boolean {
  const below = ctx.nav.side ? RISE : 0;
  return ctx.b.entities.some((o) => {
    if (o.kind !== "bomb" || o.timer <= 0 || o.phase === "held" || isRemoved(o)) return false;
    const dy = px(o.y) - s.y;
    return Math.abs(px(o.x) - s.x) <= s.slackX && dy >= -s.slackY && dy <= s.slackY + (o.phase === "flying" ? below : 0);
  });
}

/**
 * Where to stand for a spot's blast (px), facing which way: top-down, a bomb put down there (BOMB_PLACE_DISTANCE px
 * ahead) touches its crystals; side view, a bomb thrown up from the ground under crystals overhead (CEILING) blows
 * against them. Null when there's no such place.
 */
function shotAt(ctx: Ctx, s: BlastSpot): { x: number; y: number; face: Facing } | null {
  const { nav, world } = ctx;
  if (nav.side) {
    let y = s.y;
    while (y < s.y + TILE && isSolidAt(world, s.x, y)) y++;
    const ceiling = y; // the first open row under them
    if (s.crystals.some((k) => Math.abs(ctx.b.props.actors[k]!.y + TILE - ceiling) > 1)) return null;
    while (y < ceiling + CEILING[1] && !isSolidAt(world, s.x, y)) y++;
    if (y - ceiling < CEILING[0] || y - ceiling >= CEILING[1]) return null;
    const gy = y - 8; // (his anchor standing on that ground)
    return sideReachable(ctx, s.x, gy) ? { x: s.x, y: gy, face: "up" } : null;
  }
  let best: { x: number; y: number; face: Facing } | null = null, bestD = Infinity;
  for (const face of FACINGS) {
    // (As far off as the spot's slack lets the bomb fall short: clear of the crystals' tiles.)
    const [sx, sy] = FACING_STEP[face], off = BOMB_PLACE_DISTANCE + Math.min(sx ? s.slackX : s.slackY, 8);
    const gx = s.x - sx * off, gy = s.y - sy * off;
    if (!safeCell(nav, cellAt(nav, gx, gy)) || isSolidAt(world, gx, gy) || !reachable(ctx, gx, gy)) continue;
    const d = Math.abs(gx - ctx.x) + Math.abs(gy - ctx.y);
    if (d < bestD) (best = { x: gx, y: gy, face }), (bestD = d);
  }
  return best;
}

/** Lit bombs lying on our screen that we can walk up to (ours, a socket's, the gallery's rain), shortest fuse first. */
function lyingBombs(ctx: Ctx): Entity[] {
  return ctx.b.entities
    .filter((o) => o.kind === "bomb" && o.timer > UP_FUSE && o.phase === "rest" && !isRemoved(o) && sameScreen(o, ctx.p) && (ctx.nav.side ? sideReachable(ctx, px(o.x), px(o.y)) : reachable(ctx, px(o.x), px(o.y))))
    .sort((a, z) => a.timer - z.timer || a.id - z.id);
}

/**
 * Can we light the group from here: a place to blast every spot left from, and bombs enough (top-down: ours, put down
 * at once, MAX_BOMBS; side view: carried, lying, or ours put down VOLLEY_GAP apart) in time (the shortest burn)?
 */
function canVolley(ctx: Ctx, v: Volley, left: readonly BlastSpot[]): boolean {
  if (!left.length) return false;
  const shots = left.map((s) => shotAt(ctx, s));
  if (shots.some((s) => !s)) return false;
  const out = ownBombs(ctx).length;
  if (!ctx.nav.side) {
    if (ctx.f.item !== "bomb" || left.length > MAX_BOMBS - out) return false;
    // From one spot to the next at 1 px a tick (walking is 1.5), every bomb down in time.
    let walk = 0;
    for (let k = 1; k < shots.length; k++) walk += Math.abs(shots[k]!.x - shots[k - 1]!.x) + Math.abs(shots[k]!.y - shots[k - 1]!.y);
    return !v.timer || walk + 30 * left.length < v.timer;
  }
  if (left.length > 1 && v.timer && v.timer < VOLLEY_GAP + 60) return false;
  const carried = ctx.f.carryEntity && entityById(ctx.b, ctx.f.carryEntity)?.kind === "bomb" ? 1 : 0;
  return carried + lyingBombs(ctx).length + (ctx.f.item === "bomb" ? MAX_BOMBS - out : 0) >= left.length;
}

/** The volley's spot nearest us still wanting a blast, with where to blast it from; null when there's none. */
function nextShot(ctx: Ctx): { x: number; y: number; face: Facing } | null {
  const c = entityById(ctx.b, ctx.brain.thing), tr = c ? triggerOf(ctx.b, c.home) : undefined, v = tr ? volleyOf(ctx.b.props, tr) : null;
  const left = v ? spotsLeft(ctx, v) : null;
  let best: { x: number; y: number; face: Facing } | null = null, bestD = Infinity;
  for (const s of left ?? []) {
    const shot = shotAt(ctx, s);
    if (!shot) return null;
    const d = Math.abs(shot.x - ctx.x) + Math.abs(shot.y - ctx.y);
    if (d < bestD) (best = shot), (bestD = d);
  }
  return best;
}

/**
 * The "volley" plan (not carrying): top-down, to each spot's place and a bomb put down there; side view, a bomb lifted
 * (the one burning shortest, once under LIFT_AT) for volleyCarry, ours put down VOLLEY_GAP after the last, else
 * waiting by the next spot.
 */
function volleyPlan(ctx: Ctx): number {
  const { b, f, nav } = ctx;
  const shot = nextShot(ctx);
  if (!shot) return giveUp(ctx);
  const there = Math.abs(shot.x - ctx.x) <= 1 && Math.abs(shot.y - ctx.y) <= (nav.side ? 4 : 1);
  const own = ownBombs(ctx);
  if (!nav.side) {
    if (f.item !== "bomb" || own.length >= MAX_BOMBS) return giveUp(ctx);
    return there ? startAct(ctx, "item", shot.face) : goTo(ctx, shot.x, shot.y, shot.x, shot.y, 1);
  }
  // (Time enough to get it there: walking 1.5 px a tick, the lift, a few ticks to spare.)
  const lying = lyingBombs(ctx).filter((o) => o.timer >= UP_FUSE + LIFT_TICKS + 8 + (((Math.abs(px(o.x) - ctx.x) + Math.abs(px(o.x) - shot.x)) * 2) / 3));
  const v = volleyOf(b.props, triggerOf(b, entityById(b, ctx.brain.thing)!.home)!)!, wanted = spotsLeft(ctx, v)!.length;
  const youngest = Math.max(0, ...own.filter((o) => o.phase === "rest").map((o) => o.timer));
  const near = Math.abs(shot.x - ctx.x) + Math.abs(shot.y - ctx.y) <= 40;
  if (near && lying.length < wanted && f.item === "bomb" && own.length < MAX_BOMBS && youngest <= BOMB_FUSE - VOLLEY_GAP) {
    // One of ours down beside us, by the spot (it drops to the ground), on whichever side there's room.
    const face = LEVEL_FACINGS.find((fc) => !isSolidAt(ctx.world, ctx.x + FACING_STEP[fc][0] * BOMB_PLACE_DISTANCE, ctx.y)) ?? ctx.p.facing;
    return startAct(ctx, "item", face);
  }
  const next = lying[0];
  if (next && next.timer <= LIFT_AT) return liftAt(ctx, px(next.x), px(next.y));
  if (!next && !(f.item === "bomb" && own.length < MAX_BOMBS)) return giveUp(ctx);
  return there ? 0 : goTo(ctx, shot.x, shot.y, shot.x, shot.y, 1);
}

/**
 * Carrying a bomb for the volley (side view): to the next spot's place, facing up, and up at UP_FUSE; null when it's
 * no use (top-down, nothing left, too short a fuse: thrown as usual).
 */
function volleyCarry(ctx: Ctx, e: Entity): number | null {
  if (!ctx.nav.side || e.timer < UP_FUSE - 4) return null;
  const shot = nextShot(ctx);
  if (!shot) return null;
  if (Math.abs(shot.x - ctx.x) > 1 || Math.abs(shot.y - ctx.y) > 4) return avoid(ctx, goTo(ctx, shot.x, shot.y, shot.x, shot.y, 1), WALK_LOOK);
  if (e.timer <= UP_FUSE) return startAct(ctx, "throw", "up");
  return ctx.p.facing === "up" ? 0 : Button.Up;
}

/** Drops a plan for good (replan alone keeps it: its next decision could pick it up again). */
function giveUp(ctx: Ctx): number {
  setPlan(ctx, "roam", ctx.x, ctx.y, -1);
  return replan(ctx);
}

/**
 * Carrying a bomb for a crystal: to a spot in line with it, CRYSTAL_THROW px off with nothing solid between (the bomb
 * stops against the crystal and goes off there), and throw; null when there's none (the bomb is thrown as usual).
 */
function lob(ctx: Ctx): number | null {
  const c = entityById(ctx.b, ctx.brain.thing);
  if (!c || isRemoved(c) || c.phase !== "rest") return null;
  const cx = px(c.x), cy = px(c.y);
  let best: [number, number, Facing] | null = null, bestD = Infinity;
  for (const face of ctx.nav.side ? LEVEL_FACINGS : FACINGS) {
    const [sx, sy] = FACING_STEP[face];
    for (const d of CRYSTAL_THROW) {
      const gx = cx - sx * d, gy = cy - sy * d, walk = Math.abs(gx - ctx.x) + Math.abs(gy - ctx.y);
      if (walk >= bestD || !safeCell(ctx.nav, cellAt(ctx.nav, gx, gy))) continue;
      if (!(ctx.nav.side ? sideReachable(ctx, gx, gy) : reachable(ctx, gx, gy))) continue;
      let clear = true;
      for (let k = 8; k <= d - 12 && clear; k += 4) clear = !isSolidAt(ctx.world, gx + sx * k, gy + sy * k);
      if (clear) (best = [gx, gy, face]), (bestD = walk);
    }
  }
  if (!best) return null;
  const [gx, gy, face] = best;
  if (Math.abs(gx - ctx.x) <= 3 && Math.abs(gy - ctx.y) <= 3) return startAct(ctx, "throw", face);
  return avoid(ctx, goTo(ctx, gx, gy, gx, gy, 2), WALK_LOOK);
}

// --- the side rooms ---

/** Warp styles a CPU goes through on purpose: doors, holes, gates, the dark side's middle spot (siderooms.ts). */
const usable = (w: Warp) => DOOR_STYLES.has(w.style) || w.style === HOLE_STYLE || GATE_STYLES.has(w.style) || w.style === SPOT_STYLE;

/**
 * The nearest warp (index) on our screen that we can walk to and that leads to a screen `want`s, or -1 (a side room's
 * own warps lead back to the TV; the TV's into the side rooms); with `to` (px), only one whose way out reaches it.
 */
function warpTo(ctx: Ctx, want: (screen: number) => boolean, to?: { x: number; y: number; screen: number }): number {
  const screen = screenAt(ctx.y * SUBPX);
  const there = to ? navGrid(ctx.world, ctx.b.props, panelsOpen(ctx.b, ctx.i), to.screen) : null;
  let best = -1, bestD = Infinity;
  battleWarps(ctx.b).forEach((w, k) => {
    if (!usable(w) || screenAt(w.y * SUBPX) !== screen || !want(screenAt(w.toY * SUBPX)) || (w.gate && !switchOn(ctx.b, w.gate))) return;
    const [ax, ay] = approach(w);
    if (ctx.nav.side ? !sideReachable(ctx, ax, ay) : !reachable(ctx, ax, ay)) return;
    if (there && to && !leadsTo(there, w.toX, w.toY, to.x, to.y)) return;
    const d = Math.abs(ax - ctx.x) + Math.abs(ay - ctx.y);
    if (d < bestD) (best = k), (bestD = d);
  });
  return best;
}

/**
 * Can a Link coming out at (x, y) px get to (tx, ty) on `nav`'s screen? (Coming out in the air, a hole's drop: as far
 * as we know.)
 */
function leadsTo(nav: NavGrid, x: number, y: number, tx: number, ty: number): boolean {
  const from = nearestWalkable(nav, x, y, 3), goal = fieldGoal(nav, tx, ty);
  if (from < 0 || goal < 0) return true;
  return nav.side ? flowField(nav, goal)[from]! < UNREACHABLE : region(nav, from) === region(nav, goal);
}

/** The nearest rival still in the round on another screen than ours: who, where he is (px) and his screen, or null. */
function rivalAway(ctx: Ctx): Away | null {
  let best: Away | null = null, bestD = Infinity;
  ctx.b.fighters.forEach((g, j) => {
    const q = ctx.state.players[j]!;
    if (j === ctx.i || g.hearts <= 0 || g.mode === "dying" || g.mode === "dead" || sameScreen(q, ctx.p) || AWAY.has(g.move)) return;
    const d = Math.abs(px(q.x) - ctx.x);
    if (d < bestD) (best = { link: j, x: px(q.x), y: px(q.y), screen: screenAt(q.y) }), (bestD = d);
  });
  return best;
}

interface Away {
  link: number;
  x: number;
  y: number;
  screen: number;
}

/** Is the giant bomb burning on the TV (giantbomb.ts: everyone on the TV is out when it goes)? */
function bigBombBurning(ctx: Ctx): boolean {
  return ctx.b.entities.some((e) => e.kind === "bigBomb" && !isRemoved(e) && e.param >= BIG_BOMB.flying && screenAt(e.y) === 0);
}

/**
 * Where to stand to go through a warp (px): in front of a door, out of the cell of wall cpunav.ts puts round it (below
 * one walked up into, above one walked down into), beside a hole, on a gate or the dark side's spot.
 */
function approach(w: Warp): [number, number] {
  if (DOOR_STYLES.has(w.style) && w.style !== 1) return [w.x, w.y + w.bottom / SUBPX + 16];
  if (w.style === 1) return [w.x, w.y + w.top / SUBPX - 16];
  if (w.style === HOLE_STYLE) return [w.x, w.y + 20];
  return [w.x, w.y];
}

/** The "warp" plan: to the warp's approach (cpunav.ts walls the doors off), then into it: walking on, or Up at a gate. */
function throughWarp(ctx: Ctx, w: Warp): number {
  const { p, brain } = ctx, [ax, ay] = approach(w);
  if (brain.planTicks > 900) return replan(ctx);
  if (GATE_STYLES.has(w.style)) {
    // A gate wants a new press of Up (or Down) with his body in its box (siderooms.ts).
    if (inWarp(p, w)) return p.held & Button.Up ? 0 : Button.Up;
    return goTo(ctx, ax, ay, ax, ay, 1);
  }
  const close = Math.abs(ax - ctx.x) <= 3 && Math.abs(ay - ctx.y) <= 3;
  const lined = Math.abs(w.x - ctx.x) <= 3 && Math.abs(ay - ctx.y) <= 24;
  if (!close && !(lined && brain.act === "")) return goTo(ctx, ax, ay, ax, ay, 2);
  return toward(ctx.x, ctx.y, w.x, w.y, 0) || FACING_BUTTON[p.facing];
}

/**
 * On a side-view screen Up and Down in a gate's box take a Link through it (siderooms.ts): a CPU that doesn't mean to go
 * presses neither there.
 */
function keepOutOfGates(ctx: Ctx, buttons: number): number {
  if (!ctx.nav.side || !(buttons & (Button.Up | Button.Down)) || (throughWarpPlan(ctx.brain) && ctx.brain.thing)) return buttons;
  const gate = battleWarps(ctx.b).some((w) => GATE_STYLES.has(w.style) && inWarp(ctx.p, w, 2 * SUBPX));
  return gate ? buttons & ~(Button.Up | Button.Down) : buttons;
}

/** Could we lift rival `j` facing `face` (carry.ts liftTarget: the point 16 px ahead inside his body)? */
function canLift(ctx: Ctx, j: number, face: Facing): boolean {
  const g = ctx.b.fighters[j]!, q = ctx.state.players[j]!;
  if (g.mode !== "active" || (g.move !== "none" && g.move !== "ready") || g.invincible > 0 || g.carryLink >= 0 || g.carryEntity !== 0) return false;
  const [sx, sy] = FACING_STEP[face];
  const x = ctx.x + sx * LIFT_REACH, y = ctx.y + sy * LIFT_REACH, qx = px(q.x), qy = px(q.y);
  return x >= qx + HURTBOX.left && x <= qx + HURTBOX.right && y >= qy + HURTBOX.top && y <= qy + HURTBOX.bottom;
}

/** No wall between (fromX, fromY) (us) and (x, y) px, at shot height (shots and throws stop at walls). */
function clearShot(ctx: Ctx, x: number, y: number, fromX = ctx.x, fromY = ctx.y): boolean {
  const dx = x - fromX, dy = y - fromY, steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 6));
  for (let k = 1; k < steps; k++) if (isSolidAt(ctx.world, fromX + Math.trunc((dx * k) / steps), fromY - 4 + Math.trunc((dy * k) / steps))) return false;
  return true;
}

// --- throwing into a side room ---

const TOSS_RANGE = 120; // px (Manhattan) from where to throw into a warp: close enough to throw rather than go in
const LOAD_RANGE = 100; // px to a pot or a socket bomb worth fetching for it
const HOLE_THROW = 92; // px from a hole: a load goes in at most 4 px up, near the end of its flight (it lands at 96)
const TOSS_REACH = 90; // px a load flies on past a door's other side
const TOSS_ACROSS = 14; // px off its line a rival may be (a pot's ±8 px box and his body; a bomb's blast)
const TOSS_WAIT = 150; // ticks at the spot with a pot, waiting for him to step in line, before it goes in anyway

interface Toss {
  x: number;
  y: number;
  face: Facing;
}

/**
 * Where to stand (px) and which way to throw a load into warp `w`: before a door, along its way in (siderooms.ts takes
 * it from the hand); HOLE_THROW px above or below a hole (its rooms are side view: thrown sideways, it would drift). Null
 * when there's no such place.
 */
function tossFrom(ctx: Ctx, w: Warp): Toss | null {
  if (w.style === 0 || w.style === 1 || w.style === 3) {
    const [x, y] = approach(w);
    return safeCell(ctx.nav, cellAt(ctx.nav, x, y)) && reachable(ctx, x, y) ? { x, y, face: w.style === 1 ? "down" : "up" } : null;
  }
  if (w.style !== HOLE_STYLE) return null;
  let best: Toss | null = null, bestD = Infinity;
  for (const face of ["up", "down"] as const) {
    const x = w.x, y = w.y - FACING_STEP[face][1] * HOLE_THROW;
    if (!safeCell(ctx.nav, cellAt(ctx.nav, x, y)) || !reachable(ctx, x, y) || !clearShot(ctx, w.x, w.y, x, y)) continue;
    const d = Math.abs(x - ctx.x) + Math.abs(y - ctx.y);
    if (d < bestD) (best = { x, y, face }), (bestD = d);
  }
  return best;
}

/**
 * Would a load thrown into warp `w` along `face` come out at rival `j` (`margin` px more off its line)? Through a door
 * it flies on about TOSS_REACH px; into a side-view room it drops from where it comes out.
 */
function tossReaches(ctx: Ctx, w: Warp, face: Facing, j: number, margin = 0): boolean {
  const q = ctx.state.players[j]!, dx = px(q.x) - w.toX, dy = px(q.y) - w.toY;
  if (screenAt(q.y) !== screenAt(w.toY * SUBPX)) return false;
  if (sideViewAt(ctx.b, w.toY * SUBPX)) return Math.abs(dx) <= TOSS_ACROSS + margin && dy >= -8;
  const [sx, sy] = FACING_STEP[face], along = sx * dx + sy * dy;
  return along >= -8 && along <= TOSS_REACH + margin && Math.abs(sx ? dy : dx) <= TOSS_ACROSS + margin;
}

/** A load to throw: carried, our lit bomb, a socket bomb or a pot close by, or a bomb in hand to put down. */
function tossLoad(ctx: Ctx): boolean {
  const carried = ctx.f.carryEntity ? entityById(ctx.b, ctx.f.carryEntity) : undefined;
  if (carried) return carried.kind === "bomb" || carried.kind === "pot";
  return ctx.f.item === "bomb" || !!ownBomb(ctx) || !!nearestEntity(ctx, socketBomb, LOAD_RANGE) || !!nearestPot(ctx);
}

/** The nearest pot tile on our screen within LOAD_RANGE px (Manhattan) that we can walk up to: its middle (px). */
function nearestPot(ctx: Ctx): [number, number] | null {
  const { b } = ctx;
  let best: [number, number] | null = null, bestD = LOAD_RANGE;
  for (const tile of b.props.pots ?? []) {
    if (b.cut.includes(tile)) continue;
    const x = (tile % ROOM_TILES_X) * TILE + TILE / 2, y = Math.floor(tile / ROOM_TILES_X) * TILE + TILE / 2;
    const d = Math.abs(x - ctx.x) + Math.abs(y - ctx.y);
    if (d <= bestD && screenAt(y * SUBPX) === screenAt(ctx.p.y) && reachable(ctx, x, y)) (best = [x, y]), (bestD = d);
  }
  return best;
}

/** A warp into the rival's room close by (TOSS_RANGE) that a load thrown in would come out of at him: the "toss" plan. */
function pickToss(ctx: Ctx, away: Away): null | undefined {
  if (!tossLoad(ctx)) return undefined;
  let best = -1, bestD = TOSS_RANGE;
  battleWarps(ctx.b).forEach((w, k) => {
    if (screenAt(w.y * SUBPX) !== screenAt(ctx.p.y) || screenAt(w.toY * SUBPX) !== away.screen) return;
    const from = tossFrom(ctx, w);
    if (!from || !tossReaches(ctx, w, from.face, away.link, TOSS_ACROSS)) return;
    const d = Math.abs(from.x - ctx.x) + Math.abs(from.y - ctx.y);
    if (d <= bestD) (best = k), (bestD = d);
  });
  return best < 0 ? undefined : setPlan(ctx, "toss", ctx.x, ctx.y, away.link, best + 1);
}

/** The "toss" plan, before the load is in hand: a bomb or a pot lifted (ours put down first); carrying, toss(). */
function tossPlan(ctx: Ctx): number {
  const { brain, b, f } = ctx;
  const w = battleWarps(b)[brain.thing - 1], q = ctx.state.players[brain.target], g = b.fighters[brain.target];
  if (!w || !q || !g || g.hearts <= 0 || screenAt(q.y) !== screenAt(w.toY * SUBPX) || brain.planTicks > 450) return giveUp(ctx);
  const bomb = ownBomb(ctx) ?? nearestEntity(ctx, socketBomb, LOAD_RANGE);
  if (bomb) return liftAt(ctx, px(bomb.x), px(bomb.y));
  const pot = nearestPot(ctx);
  if (pot) return liftAt(ctx, pot[0], pot[1]);
  if (f.item === "bomb" && !ownBombs(ctx).length) {
    const [sx, sy] = FACING_STEP[ctx.p.facing];
    if (safeCell(ctx.nav, cellAt(ctx.nav, ctx.x + sx * BOMB_PLACE_DISTANCE, ctx.y + sy * BOMB_PLACE_DISTANCE))) return startAct(ctx, "item", null);
    return avoid(ctx, ROSE[rand(brain, 8)]!, WALK_LOOK); // (a step to find room in front)
  }
  return giveUp(ctx);
}

/**
 * Carrying a load for the "toss" plan: to where it's thrown from, then in when he's in line (a bomb cooked to the
 * level's fuse first; with its fuse nearly out, or a pot after TOSS_WAIT, in anyway); null when it's off (thrown as usual).
 */
function toss(ctx: Ctx, e: Entity): number | null {
  const { brain, b } = ctx;
  const w = battleWarps(b)[brain.thing - 1], q = ctx.state.players[brain.target], g = b.fighters[brain.target];
  if (!w || !q || !g || g.hearts <= 0 || screenAt(q.y) !== screenAt(w.toY * SUBPX)) return null;
  const from = tossFrom(ctx, w), bomb = e.kind === "bomb";
  if (!from || (!bomb && e.kind !== "pot")) return null;
  if (Math.abs(from.x - ctx.x) > 2 || Math.abs(from.y - ctx.y) > 2) return bomb && e.timer <= 30 ? null : avoid(ctx, goTo(ctx, from.x, from.y, from.x, from.y, 1), WALK_LOOK);
  const lined = tossReaches(ctx, w, from.face, brain.target);
  if ((lined && (!bomb || e.timer <= ctx.t.bombFuse)) || (bomb && e.timer <= 30) || (!bomb && brain.planTicks > TOSS_WAIT)) return startAct(ctx, "throw", from.face);
  return 0; // (a direction would walk him: carrying moves on the first tick)
}

// --- small helpers ---

/** The facing toward an offset: the larger axis (ties horizontal). */
function facingOf(dx: number, dy: number): Facing {
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
  return dy > 0 ? "down" : "up";
}

function facingOfButton(buttons: number): Facing {
  return buttons & Button.Right ? "right" : buttons & Button.Left ? "left" : buttons & Button.Down ? "down" : "up";
}

/** 8-way direction buttons from (x, y) toward (gx, gy) px (none on an axis within `dead` px). */
function toward(x: number, y: number, gx: number, gy: number, dead: number): number {
  const dx = gx - x, dy = gy - y;
  return (dx > dead ? Button.Right : dx < -dead ? Button.Left : 0) | (dy > dead ? Button.Down : dy < -dead ? Button.Up : 0);
}

/** The CPU's own generator (xorshift32): 0 … n-1. */
function rand(brain: CpuBrain, n: number): number {
  if (n <= 1) return 0;
  let x = brain.rng | 0 || 0x2545f491;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  brain.rng = x >>> 0;
  return brain.rng % n;
}

/** True `permille` times in 1000. */
function chance(brain: CpuBrain, permille: number): boolean {
  return permille > 0 && (permille >= 1000 || rand(brain, 1000) < permille);
}
