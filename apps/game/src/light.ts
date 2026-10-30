// The adventure's darkness and its lights (the Cave of No Return's rooms; Hyrule Castle's room 12), read from main.dol
// (docs/formats/battle-arenas.md "Lighting and the Dark World" has the light pass, apps/battle lighting.ts draws it):
// - a room's LTEV sets the stage light (init 0x802EFBFC, update 0x802EF80C, its fade 0x802EF76C): kind = params & 0xFF
//   picks a tint and level (apps/battle LTEV_KINDS); kinds 2, 5, 8, 11 and 15 fade there from the light the stage has
//   (the level 4 a tick, each tint channel a quarter of the way while above its target, else set), the others set it at
//   once; kind 16 sets (255, 200, 160) at level 10, waits for its switch ((params >> 22) & 31), then brightens 4 a tick
//   to 200 (the Cave's room 3: once its Keese are beaten). The Cave's rooms are kind 3 (level 10) but 4 and 5 (kind 5:
//   fading to 200);
// - each Link's light (0x802580E0, drawn by 0x80264998 at strength 255): playing alone (one GC player, as apps/game
//   always plays) 100 px while his item is the lamp (2), else none, easing 1 px a tick;
// - TRCH (init 0x802B11D0, update 0x802B0F9C, draw 0x802B0CD8): kind p & 0x7F, switch p >> 27, lit without a switch or
//   while it's on; its light's radius eases 4 px a tick to 70 (kinds 0, 2) or 20 (the others) while lit, back to 0
//   when not; kinds 0 and 2 light at their anchor + (8, 8) at strength 128 while lit, kinds 1 and 3 (the pedestals'
//   glow) at their anchor − (0, 4) at strength 200; the flame (effect 189, and the haze 1354 but for kind 4) shows only
//   while lit, for kinds 0, 2 and 4 (view.ts torchFlames);
// - LWSW (draw 0x802BE8F8): its candle's light at its anchor + (8, 8), strength 128, the radius easing 4 px a tick to 70
//   while lit, back to 0;
// - ARRW (draw 0x8016545C): a burning arrow (+0x94 2 or 4) 32 px, strength 128;
// - FBAL (draw 0x802201D8): a fireball trap's shot (sim traps.ts) 24 px, strength 128;
// - the arena's lights apps/battle lights.ts has (crystals while lit, flames, fire bars).
// The stage light is the stage's, kept from room to room: a room's LTEV starts from the light the last room left, a
// room without one keeps it (the Cave's room 12, the start, has none: lit).
// Assumed: the light full at the stage's start (0x801594E8 makes its tint white; the level wasn't looked for), each
// Link's light at his own place (the game draws it at +0x338).
import { fighterHeight, SUBPX, switchOn } from "@fso/sim";
import { arrowBurning, currentArea, FIRE_TRAP_KIND, FIRE_TRAP_LIGHT, torchLit, type AdventureGame, type AdventureStage } from "@fso/sim/adventure";
import type { Stage } from "@fso/formats";
import { LTEV_KINDS, lightSources, type LightSource, type RoomLight } from "../../battle/src/lights.ts";

/** LTEV kinds that fade to their light (0x802EF76C with state 0); the others set it at once. */
const FADING_KINDS: ReadonlySet<number> = new Set([2, 5, 8, 11, 15]);
/** LTEV kind 16: dark until its switch, then brightening to this level. */
const SWITCH_KIND = 16;
const SWITCH_LEVEL = 200;
/** The level's step a tick while it fades (LTEV update). */
const LEVEL_STEP = 4;
/** A Link's light playing alone with the lamp (0x802580E0), and its strength (0x80264998). */
export const LAMP_LIGHT = { radius: 100, alpha: 255 } as const;
/** TRCH's and LWSW's lights: the radius's step a tick, the strengths (draws 0x802B0CD8, 0x802BE8F8). */
const RADIUS_STEP = 4;
const TORCH_ALPHA = 128;
const GLOW_ALPHA = 200;
const CANDLE_RADIUS = 70;
/** A burning arrow's light (ARRW's draw 0x8016545C). */
export const ARROW_LIGHT = { radius: 32, alpha: 128 } as const;
/** Long enough for any fade or ease to end (the lamp's 100 px at 1 px a tick, a level's 255 at 4). */
const SETTLE_TICKS = 128;

interface Fade {
  tint: [number, number, number];
  level: number;
}

/** The stage light as the current room's LTEV keeps it, and the radii its lights ease through. Step once a tick. */
export class AdventureLight {
  private readonly stage: Stage;
  private room = -1;
  private kind = -1;
  private light: Fade = { tint: [255, 255, 255], level: 255 };
  private target: Fade | null = null;
  private tintStep: [number, number, number] = [0, 0, 0];
  private waiting = 0;
  private readonly linkRadius: number[] = [];
  private readonly radius = new Map<number, number>();

  constructor(stage: Stage) {
    this.stage = stage;
  }

  /** The light of the room the Links are in (null: full light, no pass). */
  current(): RoomLight | null {
    const l = this.light;
    if (l.level >= 255 && l.tint.every((c) => c >= 255)) return null;
    return { kind: this.kind, tint: [...l.tint], tintAlpha: 0, ambient: l.level };
  }

  step(game: AdventureGame, stage: AdventureStage): void {
    const a = game.adventure;
    if (a.room !== this.room) this.enter(a.room);
    if (this.waiting && switchOn(game.battle, this.waiting)) {
      this.waiting = 0;
      this.target = { tint: [...this.light.tint], level: SWITCH_LEVEL };
      this.tintStep = [0, 0, 0];
    }
    this.fade();
    // The Links' lights (the lamp's), easing 1 px a tick.
    game.players.forEach((_, i) => {
      const want = a.gear === "lamp" ? LAMP_LIGHT.radius : 0, r = this.linkRadius[i] ?? 0;
      this.linkRadius[i] = r < want ? r + 1 : r > want ? r - 1 : r;
    });
    // The torches' and candles' lights.
    if (a.area !== 0) return;
    for (const t of currentArea(game, stage).actors) {
      if (t.id !== "TRCH" && t.id !== "LWSW") continue;
      const lit = t.id === "TRCH" ? torchLit(game, t) : switchOn(game.battle, t.params >>> 27);
      const kind = t.params & 0x7f, want = t.id === "LWSW" || kind === 0 || kind === 2 ? CANDLE_RADIUS : 20;
      const r = this.radius.get(t.index) ?? 0;
      this.radius.set(t.index, lit ? Math.min(want, r + RADIUS_STEP) : Math.max(0, r - RADIUS_STEP));
    }
  }

  /** The lights as a while in the room leaves them (a start in the middle of a room: a Dolphin place's replay): the
   *  stage light faded to the room's, the lamps' and torches' radii eased to theirs. */
  settle(game: AdventureGame, stage: AdventureStage): void {
    for (let i = 0; i < SETTLE_TICKS; i++) this.step(game, stage);
  }

  /** The light circles of the current area (area px). */
  sources(game: AdventureGame, stage: AdventureStage): LightSource[] {
    const out: LightSource[] = [];
    const a = game.adventure;
    if (a.area !== 0) return out;
    game.players.forEach((p, i) => {
      const r = this.linkRadius[i] ?? 0, f = game.battle.fighters[i];
      if (r > 0) out.push({ x: Math.floor(p.x / SUBPX), y: Math.floor(p.y / SUBPX) - (f ? fighterHeight(f) : 0), radius: r, alpha: LAMP_LIGHT.alpha });
    });
    for (const t of currentArea(game, stage).actors) {
      const r = this.radius.get(t.index) ?? 0;
      if (r <= 0) continue;
      if (t.id === "LWSW") out.push({ x: t.x + 8, y: t.y + 8, radius: r, alpha: TORCH_ALPHA });
      else if (t.id === "TRCH") {
        const kind = t.params & 0x7f;
        if (kind === 0 || kind === 2) {
          if (torchLit(game, t)) out.push({ x: t.x + 8, y: t.y + 8, radius: r, alpha: TORCH_ALPHA });
        } else if (kind === 1 || kind === 3) out.push({ x: t.x, y: t.y - 4, radius: r, alpha: GLOW_ALPHA });
      }
    }
    for (const e of game.battle.entities) {
      if (e.kind === "arrow" && arrowBurning(e)) out.push({ x: Math.floor(e.x / SUBPX), y: Math.floor((e.y - e.z) / SUBPX), ...ARROW_LIGHT });
    }
    // A fireball trap's shot (FBAL's draw 0x802201D8).
    for (const e of a.enemies) {
      if (e.type === "OKTM" && e.kind === FIRE_TRAP_KIND) out.push({ x: Math.floor(e.x / SUBPX), y: Math.floor((e.y - e.z) / SUBPX), ...FIRE_TRAP_LIGHT });
    }
    // The arena's own (crystals, flames, fire bars): apps/battle's, without its Links' (multiplayer) lights.
    out.push(...lightSources({ ...game, players: [] }));
    return out;
  }

  /** Into a room: its LTEV takes the stage light from where the last room left it. */
  private enter(room: number): void {
    this.room = room;
    this.radius.clear();
    this.waiting = 0;
    let actors: ReturnType<Stage["actors"]>;
    try {
      actors = this.stage.actors(room);
    } catch {
      actors = [];
    }
    const ltev = actors.find((x) => x.id === "LTEV" && x.sublayer === 0);
    const entry = ltev ? LTEV_KINDS[ltev.params & 0xff] : undefined;
    if (!ltev || !entry) {
      // Nothing sets the light: it stays as it is (full at the stage's start), a fade stopped where it was.
      this.kind = -1;
      this.target = null;
      return;
    }
    this.kind = ltev.params & 0xff;
    const [r, g, b, level] = entry;
    const target: Fade = { tint: [r, g, b], level };
    if (this.kind === SWITCH_KIND) {
      this.light = target;
      this.target = null;
      this.waiting = (ltev.params >>> 22) & 31;
    } else if (FADING_KINDS.has(this.kind)) {
      this.target = target;
      this.tintStep = [0, 1, 2].map((c) => Math.trunc((target.tint[c]! - this.light.tint[c]!) / 4)) as [number, number, number];
    } else {
      this.light = target;
      this.target = null;
    }
  }

  private fade(): void {
    const t = this.target;
    if (!t) return;
    const l = this.light;
    l.level = l.level > t.level ? Math.max(t.level, l.level - LEVEL_STEP) : Math.min(t.level, l.level + LEVEL_STEP);
    for (let c = 0; c < 3; c++) l.tint[c] = l.tint[c]! > t.tint[c]! ? l.tint[c]! + this.tintStep[c]! : t.tint[c]!;
    if (l.level === t.level) {
      this.light = { tint: [...t.tint], level: t.level };
      this.target = null;
    }
  }
}
