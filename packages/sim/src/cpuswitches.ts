// What the arenas' floor switches and crystals do, for the CPU Links (cpu.ts): read once per arena from its props by
// following the switch network (switches.ts) from each switch a Link can turn on (a SWTH floor switch, standing on it;
// an ONOF crystal, with a blast) to what it sets off: bombchus (BMTY spawners), the giant-bomb Shadow Link (BBSL), lit
// bombs raining on a spot (HBMB spawners, on the TV or in a side room), the fire pit's jets (FLME), the eternal flames
// (BLZ2), the lava stripes (PNPC) and the trick floor (TFLR). Through the logic actors: SWOR, SWT4 (whose other inputs
// must be on: `needs`), CHSW setting its target, CKSW (any of its four), WTSW. Not followed: OFFS (clears), RNSW
// (timed, not set by a Link), soldiers, MOZO and BZBR (not simulated), magic circles and the fire bars' reverse (no
// attack). Crystals that must be lit together (an SWT4 over several) are a group: volleyOf gives the spots blasts light
// them from. A pure function of the props, memoized per props object.
import { TILE, TRAPDOOR_TILES } from "./entities.ts";
import { FLAME_HALF, JET_HALF_WIDTH, JET_LENGTH } from "./hazards.ts";
import type { ArenaProps, Prop } from "./props.ts";
import { screenAt } from "./siderooms.ts";
import { GEN3_KINDS, ownSwitch } from "./switches.ts";
import { SUBPX } from "./player.ts";
import type { PixelBox } from "./combat.ts";

/** What a switch sets off: screen-wide (bombchus, the giant bomb) or on spots (anchor boxes, px, a Link inside is hit). */
export type SwitchAttack = "bombchus" | "giant" | "bombs" | "jets" | "flames" | "lava" | "floor";

export interface SwitchEffect {
  attack: SwitchAttack;
  screen: number;
  /** Where a Link's anchor (px) gets caught; empty: anywhere on the screen. */
  spots: PixelBox[];
}

/** A switch a CPU can turn on: a floor switch (stood on) or a crystal (a blast on it). */
export interface Trigger {
  prop: number; // the SWTH or ONOF actor's index (its entity's `home`)
  crystal: boolean;
  x: number; // px: the switch's middle (the crystal's)
  y: number;
  screen: number;
  /**
   * A floor switch that's on only while stood on (kinds 0, 2, 5, 6) and an attack that lasts while it's on (jets,
   * flames, lava, the trick floor; the spawners only fire as it comes on): stay on it.
   */
  hold: boolean;
  /** Switches that must be on too (SWT4's other inputs). */
  needs: number[];
  /**
   * The crystals (props) whose switches are among `needs`: a group lit together, by as many blasts at once as it takes
   * to cover them all (the Tower of Winds' gallery's four, Hyrule Castle's dark side's two). Empty for the others.
   */
  partners: number[];
  effects: SwitchEffect[];
}

const triggers = new WeakMap<ArenaProps, Trigger[]>();

/** The switches a Link can turn on in the arena that set off an attack, with what they set off. */
export function switchTriggers(props: ArenaProps): readonly Trigger[] {
  let out = triggers.get(props);
  if (!out) {
    const all = props.actors.flatMap((a, k) => triggerOf(props.actors, a, k) ?? []);
    for (const tr of all) {
      if (!tr.crystal) continue;
      tr.partners = tr.needs.flatMap((s) => {
        const k = props.actors.findIndex((a) => a.id === "ONOF" && ownSwitch(a.params) === s);
        return k >= 0 ? [k] : [];
      });
    }
    triggers.set(props, (out = all));
  }
  return out;
}

/** A 5-bit field of the params (the logic actors' inputs at shifts 22, 17, 12 and 7). */
const field = (params: number, shift: number) => (params >>> shift) & 31;
const inputs = (p: number) => [field(p, 22), field(p, 17), field(p, 12), field(p, 7)];

function triggerOf(actors: readonly Prop[], a: Prop, k: number): Trigger | null {
  const crystal = a.id === "ONOF";
  if (!crystal && a.id !== "SWTH") return null;
  const n = ownSwitch(a.params);
  if (n === 0) return null;
  // (A crystal lit from the start, or lit for good once lit, still counts: entities tell which are lit.)
  const reached = new Set([n]), queue = [n], gates: number[][] = [], effects: SwitchEffect[] = [];
  const reach = (s: number) => {
    if (s > 0 && !reached.has(s)) reached.add(s), queue.push(s);
  };
  while (queue.length) {
    const s = queue.shift()!;
    for (const b of actors) {
      const p = b.params, own = ownSwitch(p), x = b.x, y = b.y, screen = screenAt(y * SUBPX);
      switch (b.id) {
        case "SWOR":
          if (inputs(p).slice(0, Math.min(4, p & 31)).includes(s)) reach(own);
          break;
        case "SWT4":
          if (inputs(p).includes(s)) gates.push(inputs(p)), reach(own);
          break;
        case "CHSW":
          if (own === s && ((p >>> 18) & 3) === 0) reach(field(p, 22));
          break;
        case "CKSW":
          if (own === s) inputs(p).forEach(reach);
          break;
        case "WTSW":
          if (field(p, 22) === s) reach(own);
          break;
        case "GEN3": {
          const kind = GEN3_KINDS[p & 0x7f];
          if (own !== s || (kind !== "bomb" && kind !== "bombchu")) break;
          if (kind === "bombchu") addWide(effects, "bombchus", screen);
          else addSpot(effects, "bombs", screen, box(x, y, BOMB_REACH));
          break;
        }
        case "BBSL":
          if (own === s) addWide(effects, "giant", screen);
          break;
        case "BLZ2":
          if (own === s && (p >>> 4) & 1) addSpot(effects, "flames", screen, box(x, y, FLAME_HALF + 7));
          break;
        case "FLME": {
          if (own !== s) break;
          // hazards.ts jetBox: JET_LENGTH from its anchor along its direction, ±JET_HALF_WIDTH across (+ a hurtbox).
          const [sx, sy] = JET_STEPS[(p >>> 16) & 3]!, x1 = x + sx * JET_LENGTH, y1 = y + sy * JET_LENGTH, w = JET_HALF_WIDTH + 7;
          addSpot(effects, "jets", screen, { left: Math.min(x, x1) - (sx ? 7 : w), right: Math.max(x, x1) + (sx ? 7 : w), top: Math.min(y, y1) - (sy ? 7 : w), bottom: Math.max(y, y1) + (sy ? 7 : w) });
          break;
        }
        case "PNPC":
          // Its tile turns to lava (a pit: the pit probe is 4 px under the anchor).
          if (own === s) addSpot(effects, "lava", screen, { left: x - 2, right: x + TILE + 1, top: y - 6, bottom: y + TILE - 3 });
          break;
        case "TFLR":
          if (field(p, 7) === s) addSpot(effects, "floor", screen, { left: x, right: x + TRAPDOOR_TILES * TILE - 1, top: y - 4, bottom: y + TRAPDOOR_TILES * TILE - 5 });
          break;
      }
    }
  }
  if (!effects.length) return null;
  const needs = [...new Set(gates.flat())].filter((s) => !reached.has(s));
  const kind = a.params & 31;
  const [x, y] = crystal ? [a.x + 8, a.y + 8] : [a.x + TILE / 2, a.y + TILE / 2];
  return { prop: k, crystal, x, y, screen: screenAt(a.y * SUBPX), hold: !crystal && [0, 2, 5, 6].includes(kind) && effects.some((ef) => LASTING.has(ef.attack)), needs, partners: [], effects };
}

const LASTING: ReadonlySet<SwitchAttack> = new Set(["jets", "flames", "lava", "floor"]);
const BOMB_REACH = 28; // px round a bomb spawner: the bomb's blast (±16) and a hurtbox, give or take where it lands
const JET_STEPS: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]]; // FLME directions: right, left, down, up
const box = (x: number, y: number, half: number): PixelBox => ({ left: x - half, top: y - half, right: x + half, bottom: y + half });

function addWide(effects: SwitchEffect[], attack: SwitchAttack, screen: number): void {
  if (!effects.some((o) => o.attack === attack && o.screen === screen)) effects.push({ attack, screen, spots: [] });
}

function addSpot(effects: SwitchEffect[], attack: SwitchAttack, screen: number, spot: PixelBox): void {
  const e = effects.find((o) => o.attack === attack && o.screen === screen);
  if (e) e.spots.push(spot);
  else effects.push({ attack, screen, spots: [spot] });
}

/** Is (x, y) px in one of an effect's spots (or anywhere, for a screen-wide one)? */
export function caughtBy(effect: SwitchEffect, x: number, y: number): boolean {
  if (!effect.spots.length) return true;
  for (const s of effect.spots) if (x >= s.left && x <= s.right && y >= s.top && y <= s.bottom) return true;
  return false;
}

/**
 * Where blasts light a group of crystals (a trigger and its partners): the fewest spots, each a blast's middle (px)
 * touching every crystal it's for (a blast's ±16 px box on a crystal's ±8: within 23 px of its middle, switches.ts
 * stepCrystal), with how far off it (`slackX`, `slackY`) a blast may still go off. `timer`: the shortest burn of the
 * group's timed crystals (0: none is timed), the time the blasts have to go off in; `toggles`: the group's toggle
 * crystals (a blast puts a lit one out).
 */
export interface Volley {
  spots: BlastSpot[];
  timer: number;
  toggles: number[];
}

export interface BlastSpot {
  x: number;
  y: number;
  slackX: number;
  slackY: number;
  crystals: number[]; // props
}

const volleys = new WeakMap<Trigger, Volley>();
const BLAST_TOUCH = 23; // px between a blast's middle and a crystal's that still touch
const SPOT_SPAN = 32; // px: crystals at most this far apart (both ways) share a spot

/** The blast spots of a trigger's crystal group (cpu.ts "volley"), or null for a trigger with no partners. */
export function volleyOf(props: ArenaProps, tr: Trigger): Volley | null {
  if (!tr.partners.length) return null;
  let v = volleys.get(tr);
  if (v) return v;
  const group = [tr.prop, ...tr.partners].map((k) => ({ k, x: props.actors[k]!.x + 8, y: props.actors[k]!.y + 8 }));
  group.sort((a, z) => a.x - z.x || a.y - z.y);
  const spots: BlastSpot[] = [], left = new Set(group);
  for (const c of group) {
    if (!left.has(c)) continue;
    let [x0, x1, y0, y1] = [c.x, c.x, c.y, c.y];
    const crystals: number[] = [];
    for (const d of group) {
      if (!left.has(d)) continue;
      const [nx0, nx1, ny0, ny1] = [Math.min(x0, d.x), Math.max(x1, d.x), Math.min(y0, d.y), Math.max(y1, d.y)];
      if (nx1 - nx0 > SPOT_SPAN || ny1 - ny0 > SPOT_SPAN) continue;
      [x0, x1, y0, y1] = [nx0, nx1, ny0, ny1];
      crystals.push(d.k);
      left.delete(d);
    }
    spots.push({ x: (x0 + x1) >> 1, y: (y0 + y1) >> 1, slackX: BLAST_TOUCH - ((x1 - x0 + 1) >> 1), slackY: BLAST_TOUCH - ((y1 - y0 + 1) >> 1), crystals });
  }
  // (ONOF params: (p >> 12) & 7 its kind, 2 timed for p & 0xFFF frames, 1 and 3 toggles: switches.ts.)
  const kind = (k: number) => (props.actors[k]!.params >>> 12) & 7;
  const timers = group.flatMap(({ k }) => (kind(k) === 2 ? [props.actors[k]!.params & 0xfff] : []));
  const toggles = group.flatMap(({ k }) => (kind(k) === 1 || kind(k) === 3 ? [k] : []));
  volleys.set(tr, (v = { spots, timer: timers.length ? Math.min(...timers) : 0, toggles }));
  return v;
}
