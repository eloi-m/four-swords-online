// The arenas' switch network, read from main.dol (docs/formats/battle-arenas.md "Switches"): each room has 32 switches (a u32 bit
// field in the stage; switch 0 means "none"), set and cleared by floor switches, crystals and "logic" actors, and read
// by the hazards (the fire pit's jets, the trick floor, the eternal flames, magic circles, orb generators, spawners).
// The logic actors are placed in the room's actor list like any other and run every tick in list order:
// - SWOR "switch OR": its switch is on while any of its inputs is.
// - SWT4 "4-switch monitor": its switch turns on when all four inputs are (then off again when one goes off).
// - CHSW "chain switch": a rising edge of its switch starts a delay, after which it sets or clears a target and/or
//   clears its own switch (1-frame to 128-frame pulses, timers).
// - OFFS "OFF switch": clears, toggles or inverts a switch from another one.
// - CKSW "check switch": turns on one of four switches at random (at once, or on each rising edge of its switch).
// - RNSW "random toggle switch": every period, turns on one of four switches at random and the others off.
// - WTSW "wait switch": sets its switch a delay after another one turns on.
// - GEN3 "enemy generator 3": spawns a lit bomb or a soldier on each rising edge of its switch.
// - ONOF "on/off switch": a crystal lit by a blast (tile 0xBF dark, 0xBE green); its switch is on while it glows.
// The randomness is the battle's seeded generator (the game uses its own LCG). The side rooms' actors (the GBA screens:
// siderooms.ts) share the room's switches: The Field's house crystal rains bombs on the TV, the Tower of Flames' north
// room lights the eternal flames, the Tower of Winds' gallery crystals call the giant-bomb Shadow Link (giantbomb.ts).
import type { BattleState } from "./battle.ts";
import { BOMBCHU_KIND, spawnBombchu } from "./bombchus.ts";
import { BLAST_BOMBCHU, BLAST_GIANT, blastTicks, BOMB_FUSE } from "./bombs.ts";
import { boxAround, boxesOverlap, isRemoved, randomInt, removeEntity, spawnEntity, type Entity } from "./entities.ts";
import { SUBPX } from "./player.ts";
import type { Prop } from "./props.ts";
import { sideViewAt } from "./siderooms.ts";
import { newBallSoldier, newBowSoldier, newCaptain } from "./castlesoldiers.ts";
import { newSoldier } from "./strike.ts";

/** Actor types of the switch logic (entity kind "logic", `home` = the prop). */
export const LOGIC_TYPES = ["SWOR", "SWT4", "CHSW", "OFFS", "CKSW", "RNSW", "WTSW", "GEN3"] as const;
/** ONOF crystals: entity kind "crystal". */
export const CRYSTAL_TYPES = ["ONOF"] as const;

/** Is switch `n` on (switch 0 is "none": never on)? */
export function switchOn(b: BattleState, n: number): boolean {
  return n > 0 && n < 32 && ((b.switches >>> n) & 1) === 1;
}

export function setSwitch(b: BattleState, n: number, on: boolean): void {
  if (n <= 0 || n >= 32) return;
  b.switches = (on ? b.switches | (1 << n) : b.switches & ~(1 << n)) >>> 0;
}

/** The switch number in an actor's top 5 bits (what most actors set or wait for). */
export const ownSwitch = (params: number) => params >>> 27;

/** A 5-bit field of the params (the logic actors keep their inputs at shifts 22, 17, 12 and 7). */
const field = (params: number, shift: number) => (params >>> shift) & 31;
const inputs = (params: number) => [field(params, 22), field(params, 17), field(params, 12), field(params, 7)];

export const RNSW_PERIOD_UNIT = 10; // frames per unit of RNSW's period field (0x802C0E00…)
export const CRYSTAL_LOCKOUT = 25; // frames an ONOF ignores fire after going out or toggling
export const CRYSTAL_LIGHT = { radius: 70, alpha: 128 } as const; // lights.ts: timed and toggle crystals while lit
export const GEN3_SMOKE_TICK = 1; // the smoke puff, a frame after the switch turned on
export const GEN3_SPAWN_TICK = 3; // …and the spawn two frames after it
export const GEN3_CAP = 30; // no spawn while 30 of that kind are in the arena

/**
 * GEN3 kinds (params & 0x7F, table 0x8046F398 with spawn params at 0x8046F450) the sim can spawn: 0x16 HBMB (a lit
 * bomb), the SLR1 sword soldiers, the BMTY bombchus (0x17: params 4, at a random angle; 0x18: params 3, left or right:
 * bombchus.ts), Hyrule Castle's SLR2 bow soldier (0x08, params 0), SLR4 captain (0x1D, params 0x1008800) and SLR3
 * ball-and-chain soldier (0x15, params 0: castlesoldiers.ts). The others in the arenas (MOZO, BZBR) aren't implemented:
 * their generators fire but spawn nothing.
 */
export const GEN3_KINDS: Readonly<Record<number, "bomb" | "soldier" | "bombchu" | "bowSoldier" | "captain" | "ballSoldier">> = {
  0x02: "soldier",
  0x03: "soldier",
  0x08: "bowSoldier",
  0x15: "ballSoldier",
  0x16: "bomb",
  0x17: "bombchu",
  0x18: "bombchu",
  0x1a: "soldier",
  0x1b: "soldier",
  0x1d: "captain",
  0x22: "soldier",
  0x24: "soldier",
};
/** The spawned soldier's params by GEN3 kind (table 0x8046F450): an SLR1's kind, so its life (strike.ts soldierLife); the
 *  SLR2's, SLR4's and SLR3's (castlesoldiers.ts). */
export const GEN3_SOLDIER_PARAMS: Readonly<Record<number, number>> = { 0x02: 0x00100000, 0x03: 2, 0x08: 0, 0x15: 0, 0x1a: 0x102, 0x1b: 0x01000004, 0x1d: 0x01008800, 0x22: 0, 0x24: 6 };
/** A GEN3's bomb on a side-view screen appears this far under it (1/256 px; measured: the Tower of Winds' gallery). */
export const GEN3_SIDE_DROP = 7 * SUBPX;

/** Creates the logic entity of prop `k` and runs the actors that act once at load (OFFS, CKSW). */
export function spawnLogic(b: BattleState, k: number): Entity {
  const prop = b.props.actors[k]!;
  const e = spawnEntity(b, "logic", prop.x * SUBPX, prop.y * SUBPX, { home: k, target: 0 });
  if (prop.id === "OFFS") e.param = switchOn(b, field(prop.params, 22)) ? 1 : 0; // mode 1's value at load
  if (prop.id === "OFFS" || prop.id === "CKSW") stepLogic(b, e);
  return e;
}

/** A crystal (ONOF): anchored on its tile's center; lit from the start in 2- or 3-player matches for some params. */
export function spawnCrystal(b: BattleState, k: number): Entity {
  const prop = b.props.actors[k]!;
  const e = spawnEntity(b, "crystal", (prop.x + 8) * SUBPX, (prop.y + 8) * SUBPX, { home: k });
  const start = (prop.params >>> 25) & 3, players = b.fighters.length;
  if ((start === 1 && players === 2) || (start === 2 && players <= 3)) {
    e.phase = "active";
    e.param = 1; // lit for good
    setSwitch(b, ownSwitch(prop.params), true);
  }
  return e;
}

/** One tick of a logic actor. `e.target` keeps its trigger's state last tick (rising edges), `e.tick` its timer. */
export function stepLogic(b: BattleState, e: Entity): void {
  const prop = b.props.actors[e.home];
  if (!prop || isRemoved(e)) return;
  const p = prop.params, own = ownSwitch(p);
  switch (prop.id) {
    case "SWOR": {
      // 0x802C… OR gate: `p & 31` inputs.
      const n = Math.min(4, p & 31), any = inputs(p).slice(0, n).some((s) => switchOn(b, s));
      setSwitch(b, own, any);
      return;
    }
    case "SWT4": {
      // All four inputs on → on (a jingle); mode 2 keeps it on for good, else any input off turns it off.
      const all = inputs(p).every((s) => switchOn(b, s));
      if (e.phase === "rest" && all) {
        setSwitch(b, own, true);
        if ((p & 31) === 2) removeEntity(e);
        else e.phase = "active";
      } else if (e.phase === "active" && !all) {
        setSwitch(b, own, false);
        e.phase = "rest";
      }
      return;
    }
    case "CHSW": {
      // A rising edge of its switch starts `delay` frames; then its own switch and a target are set or cleared.
      const on = switchOn(b, own), rising = on && e.target === 0;
      e.target = on ? 1 : 0;
      const delay = p & 0x1ffff;
      if (e.phase === "rest" && rising && delay > 0) {
        e.phase = "active";
        e.tick = 0;
      } else if (e.phase === "active" && ++e.tick >= delay) {
        e.phase = "rest";
        const ownAct = (p >>> 20) & 3, targetAct = (p >>> 18) & 3;
        if (ownAct === 1) setSwitch(b, own, true);
        else if (ownAct === 2) setSwitch(b, own, false);
        if (targetAct === 0) setSwitch(b, field(p, 22), true);
        else if (targetAct === 1) setSwitch(b, field(p, 22), false);
        e.target = switchOn(b, own) ? 1 : 0;
        if ((p >>> 17) & 1) removeEntity(e);
      }
      return;
    }
    case "OFFS": {
      const t = switchOn(b, own), x = field(p, 22), rising = t && e.target === 0;
      e.target = t ? 1 : 0;
      switch (p & 31) {
        case 0:
          if (rising) setSwitch(b, x, false);
          break;
        case 1:
          setSwitch(b, x, t ? false : e.param === 1);
          break;
        case 2:
          if (rising) setSwitch(b, x, !switchOn(b, x));
          break;
        case 3:
          setSwitch(b, x, !t);
          break;
        case 4:
          if (t) setSwitch(b, x, false);
          break;
      }
      return;
    }
    case "CKSW": {
      // With no trigger (0) it fires at once; mode 1 re-arms when its trigger goes off, the others act once.
      const t = own === 0 || switchOn(b, own);
      if (e.phase === "rest" && t) {
        setSwitch(b, inputs(p)[randomInt(b, 100) & 3]!, true);
        if ((p & 31) === 1) e.phase = "active";
        else removeEntity(e);
      } else if (e.phase === "active" && !t) e.phase = "rest";
      return;
    }
    case "RNSW": {
      // Every period (paused while its enable switch is off), one of four outputs on and the others off.
      if (own !== 0 && !switchOn(b, own)) return;
      const period = (p & 0x3f) * RNSW_PERIOD_UNIT;
      if (period === 0 || ++e.tick < period) return;
      e.tick = 0;
      const outs = [field(p, 7), field(p, 12), field(p, 17), field(p, 22)];
      const pick = randomInt(b, 4);
      const k = (p >>> 6) & 1 ? e.param++ % 4 : pick;
      for (const s of outs) if (s !== outs[k]) setSwitch(b, s, false);
      setSwitch(b, outs[k]!, true);
      return;
    }
    case "WTSW": {
      // `delay` frames after its input comes on, it sets its switch and is done.
      if (e.phase === "rest" && switchOn(b, field(p, 22))) e.phase = "active";
      if (e.phase === "active" && ++e.tick >= (p & 0x3ffff)) {
        setSwitch(b, own, true);
        removeEntity(e);
      }
      return;
    }
    case "GEN3":
      stepGenerator(b, e, prop);
      return;
  }
}

// GEN3: on each rising edge of its switch, a smoke puff, then (2 frames later) one spawn; it re-arms when the switch
// goes off (mode 1, every generator in the arenas).
function stepGenerator(b: BattleState, e: Entity, prop: Prop): void {
  const on = switchOn(b, ownSwitch(prop.params)), rising = on && e.target === 0;
  e.target = on ? 1 : 0;
  if (e.phase === "rest") {
    if (rising) {
      e.phase = "active";
      e.tick = 0;
    }
    return;
  }
  e.tick++;
  if (e.tick === GEN3_SMOKE_TICK) spawnEntity(b, "debris", e.x, e.y, { param: 5, timer: 16 });
  if (e.tick < GEN3_SPAWN_TICK) return;
  e.phase = "rest";
  const kind = GEN3_KINDS[prop.params & 0x7f];
  if (!kind || b.entities.filter((x) => !isRemoved(x) && x.kind === kind).length >= GEN3_CAP) return;
  // (On a side-view screen it appears 7 px lower and falls: measured in the Tower of Winds' gallery, siderooms.ts.)
  if (kind === "bomb") spawnEntity(b, "bomb", e.x, e.y + (sideViewAt(b, e.y) ? GEN3_SIDE_DROP : 0), { timer: BOMB_FUSE }); // spawned lit (params 0: kind 0)
  else if (kind === "bombchu") spawnBombchu(b, e.x, e.y, (prop.params & 0x7f) === 0x18 ? BOMBCHU_KIND.sideways : BOMBCHU_KIND.anyway);
  else if (kind === "bowSoldier") spawnEntity(b, kind, e.x, e.y, newBowSoldier(b, GEN3_SOLDIER_PARAMS[prop.params & 0x7f] ?? 0));
  else if (kind === "captain") spawnEntity(b, kind, e.x, e.y, newCaptain(b, GEN3_SOLDIER_PARAMS[prop.params & 0x7f] ?? 0));
  else if (kind === "ballSoldier") spawnEntity(b, kind, e.x, e.y, newBallSoldier()); // (params 0: kind 0)
  else spawnEntity(b, "soldier", e.x, e.y, newSoldier(GEN3_SOLDIER_PARAMS[prop.params & 0x7f] ?? 2));
}

/** Crystal fields: timer frames (p & 0xFFF) and kind ((p >> 12) & 7: 0/4 lit for good, 1/3 toggle, 2 timed). */
const crystalKind = (params: number) => (params >>> 12) & 7;

/**
 * ONOF crystals (draw 0x802CB1C4): a fresh blast on the crystal lights it (its switch on); a timed crystal goes out after its
 * timer, a toggle one goes out on the next blast; both then ignore fire for 25 frames. `e.param` = 1 once lit for
 * good, `e.timer` the lockout or burn time left, `e.hitMask` = in contact with a blast last tick.
 */
export function stepCrystal(b: BattleState, e: Entity): void {
  const prop = b.props.actors[e.home]!;
  const kind = crystalKind(prop.params), own = ownSwitch(prop.params);
  const box = boxAround(e.x, e.y, 8);
  // (ONOF looks for bombs by name, 0x801F2718: HBMB, LNBM, TUBO; neither a bombchu's blast nor the giant bomb's.)
  const contact = b.entities.some((x) => x.kind === "explosion" && !isRemoved(x) && !(x.param & (BLAST_BOMBCHU | BLAST_GIANT)) && x.tick <= blastTicks(x) && boxesOverlap(box, boxAround(x.x, x.y, 16)));
  const fresh = contact && e.hitMask === 0;
  e.hitMask = contact ? 1 : 0;
  if (e.param === 1) return; // lit for good
  e.tick++;
  if (e.phase === "active") {
    if (kind === 2) {
      if (--e.timer <= 0) goOut(b, e, own);
    } else if (fresh && e.tick > CRYSTAL_LOCKOUT) goOut(b, e, own); // a toggle crystal
    return;
  }
  if (e.timer > 0) {
    e.timer--;
    return;
  }
  if (!fresh) return;
  e.phase = "active";
  e.tick = 0;
  setSwitch(b, own, true);
  if (kind === 0 || kind === 4) e.param = 1;
  else if (kind === 2) e.timer = prop.params & 0xfff;
}

function goOut(b: BattleState, e: Entity, own: number): void {
  e.phase = "rest";
  e.timer = CRYSTAL_LOCKOUT;
  setSwitch(b, own, false);
}

/** Does a crystal give light now (lights.ts): timed and toggle crystals while they glow. */
export function crystalShines(b: BattleState, e: Entity): boolean {
  const prop = b.props.actors[e.home];
  return !!prop && e.phase === "active" && e.param !== 1 && [1, 2, 3].includes(crystalKind(prop.params));
}
