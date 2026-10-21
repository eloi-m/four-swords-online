// The JPA particle effects the game spawns for what happens in a round (docs/formats/jpa.md "JPA particles"), drawn from
// the sim's state alone: the fire pit's jets, the fire bars' fireballs, the eternal flames, a lit bomb's fuse, the
// explosions, a cut or broken bush, a broken pot or orb, the Tower of Winds' gates, its Shadow Link's coming and his
// giant bomb (its landing, fuse and blast); the Links' dust (knocked back, rolling, landing), a burning Link, the
// marks over a Link whose rank by life changes, and the Tower of Flames' embers; a charging sword's sparkle, burst
// and glow (charge.ts), the hammer's pound and charge, the Fire Rod's fireballs and stream, a Link it set alight.
// Each effect is keyed by its entity
// and the tick it started (derived from the entity's own counters where it keeps them; a few remembered from frame
// to frame here, and dropped again when a rollback undoes them), so the netcode can rewind the state under it
// (packages/render jpa/effects.ts); nothing here writes to the state. Placement is the game's (createEffect, @fso/formats
// fsa/particles.ts): world (x, y, z) in arena pixels, the depth the sprites use (2 + y / 1024, scene.ts), the game's
// layers 1024 px of y in front.
import {
  fsaActorParticles,
  fsaFireballParticles,
  fsaJetParticle,
  fsaParticlePlacement,
  parseJpac,
  type FsaActorParticle,
  type FsaParticlePlacement,
  type RarcArchive,
} from "@fso/formats";
import { DistortionPass, JpaEffects, type DistortionLayer, type JpaEffectSpec } from "@fso/render";
import {
  BIG_BOMB,
  BIG_BOMB_FUSE,
  BIG_BOMB_SQUASH,
  BLAST_GIANT,
  BOMB_FUSE,
  COUNTDOWN_TICKS,
  DEBRIS,
  FALL_JUMP_TICKS,
  DEBRIS_TICKS,
  FACING_STEP,
  fireballs,
  firebarSpeed,
  HAMMER,
  hammerCharged,
  poundBox,
  streaming,
  SHADOW,
  SUBPX,
  type Entity,
  type GameState,
} from "@fso/sim";
import * as THREE from "three";
import { CHARGE_FULL, chargeCount, sparkleAt, SWORD_CHARGE } from "./charge.ts";
import { HUD_H, HUD_W } from "./hud.ts";
import { INTRO, ROUND_END } from "./timeline.ts";

/** The jet's size (1/1000) from which the game shows it out (FLME 0x8015DF7C compares it with 0.1). */
const JET_OUT_SIZE = 100;

/** Effects confirmed by reading the live emitters in Dolphin (RAM), or only read in main.dol. */
export const BATTLE_PARTICLES = {
  /** FLME jets: fsaJetParticle (RAM: the four idle emitters at a round's start). */
  jet: { idle: 430, on: 428, out: 429 },
  /** FBOB fireballs: 414 flame, 412 sparks (RAM: Above the Clouds). */
  fireball: [414, 412],
  /** BLZ2 eternal flames, queued every frame while lit (main.dol 0x802E57E0; unlit on the TV in battle). */
  flame: [844, 845],
  /** The heat haze over a lit eternal flame (layer 1), a fireball and a jet that's out (layer 1 / 1): queued, distorting (RAM: Tower of Flames). */
  haze: 1357,
  /** HBMB fuse while lit: smoke and sparks at the bomb (RAM: a lifted socket bomb). */
  fuse: [102, 103],
  /** HBMB explosion, layer 1 sublayer 1 (RAM: a chain of socket bombs). */
  explosion: [89, 90, 91],
  /** A cut bush: its grass bits, queued once (RAM: The Field). */
  bush: [855],
  /** TUBO breaking: smoke and pieces, layer 1 (RAM: a pot thrown in the Tower of Flames). */
  pot: [171, 172],
  /** CRTL breaking (main.dol 0x80320374; not yet seen in RAM): 1380 ×0.5 on layer 2, then the smoke 1283 on layer 1. */
  orb: [1380, 1283],
  /** A sword hitting a Link: the hit mark and the slash, at the victim, layer 1 sublayer 1 (RAM: a stab in The Field). */
  swordHit: [586, 587],
  /** A Link in the lava (a damaging pit, type 0x0E): its glow (layer −1) and drops (sublayer 1), 40 ticks into the fall (RAM). */
  lava: { glow: 681, drops: 682, tick: 40 },
  /** The round's intro: the dark portal each Link rises from, at his feet, layer 0 sublayer 1 (RAM; main.dol 0x80254150). */
  portal: [1048, 1049, 1050],
  /** The winner's sword at "P1 WIN!": a sparkle 7 px right of and 27 px over him, layer 1 (RAM; main.dol 0x801E69D0). */
  win: { ids: [203, 204], dx: 7, dy: -27 },
  /** BBSL's coming (state 3, 115 ticks): dark sparkles at his spot (main.dol 0x803410DC). */
  shadowLink: [1048, 1049, 1050],
  /** BBMB: its landing's dust ×2.5, 16 px lower; its fuse's sparks and smoke while it burns; its blast, layer 1 sublayer 1 (main.dol). */
  bigBomb: { dust: 975, fuse: [57, 58], blast: [51, 52, 53, 54, 55, 56] },
  /**
   * A Link's rank by life (the HUD's "1st"…; main.dol 0x802CA7F4: how many playing Links have more life) changing: 933
   * when it drops, 934 when it rises, 28 px over him, ×0.4, following him for 180 ticks (RAM: 933 on a hurt Link).
   */
  rank: { down: 933, up: 934, dy: -28, scale: 0.4, ticks: 180 },
  /**
   * A burning Link (main.dol 0x80279CFC, entering the knockback from a fire hit, types 7 and 9: the eternal flames and
   * the jets; 0x80290FC0, jumping out of the lava): two flames by his facing (right, left, down, up), following him
   * and turned by Y (table 0x8046BC98) until the knockback or the jump ends (RAM: 579 / 583 facing left).
   */
  burn: { flame: [584, 583, 582, 585], body: [580, 579, 578, 581], turn: [0x4000, 0xc000, 0, 0x8000] },
  /**
   * Dust (RAM: thrown, landing): 979 at a Link's feet, sublayer −1, while he's knocked back (from the spot he left the
   * ground; along with him on the ground) or rolls (0x80279824, 0x80281A90; 980 on tile type 0x39); 975 where he
   * lands from any height, 6 px lower (0x80285F44).
   */
  dust: { trail: 979, landing: 975, landingDy: 6 },
  /** The Tower of Flames' embers (the environment manager 0x8016DE30, with the lava): at half the camera's position, layer −1 (RAM). */
  embers: 680,
  /**
   * The Tower of Flames' screen-wide heat haze (the environment manager, with the embers): group 5, made at the origin
   * and drawn in the TV frame's own space (608 × 448 px, y down): its emitter rises from under the frame's bottom.
   */
  screenHaze: 1355,
  /**
   * The hammer (main.dol, state 60 0x8025B3F0): on the pound, at its center (hammer.ts poundBox), 573, 574, 575 and the
   * dust 975 (976 on tile types 0x39 and 0x0D: not told apart here); charged 571, 572, 573 ×5, 574 ×2, 575 ×2, 975 ×2.
   * Fully charged: the sparkle 203, 204 at the raised hammer, (x, y, z) from the Link by facing (table 0x8046B090),
   * until the pose ends. TODO(measure): not checked against a frame dump.
   */
  hammer: {
    pound: [[573, 1], [574, 1], [575, 1], [975, 1]] as readonly (readonly [number, number])[],
    charged: [[571, 1], [572, 1], [573, 5], [574, 2], [575, 2], [975, 2]] as readonly (readonly [number, number])[],
    sparkle: [203, 204],
    sparkleAt: { right: [-16, -2, 16], left: [16, -2, 16], down: [0, -6, 16], up: [0, -4, 16] } as const,
  },
  /**
   * The Fire Rod (FIRE kind 0, 0x802BB468): its flame 411, 412, 8 px ahead of the fireball, turned by Y (table
   * 0x8046D388); bursting on a wall, 413 where it is. Its stream (the Link's state 68, 0x8025A15C): 427 (sublayer 2,
   * turned (0, table 0x8046B170, 0x8000)) and the haze 1354 (layer −1, turned (0, 0, table 0x8046B180)) at the rod,
   * (18, 0), (−18, 0), (4, 12), (−4, −20) from the Link by facing. TODO(measure): not checked against a frame dump.
   */
  rodFire: {
    flame: [411, 412],
    turn: { right: 0x4000, left: 0xc000, down: 0x8000, up: 0 } as const,
    burst: 413,
    stream: 427,
    streamTurn: { right: 0xc000, left: 0x4000, down: 0x8000, up: 0 } as const,
    haze: 1354,
    hazeTurn: { right: 0xc000, left: 0x4000, down: 0, up: 0x8000 } as const,
    rod: { right: [18, 0], left: [-18, 0], down: [4, 12], up: [-4, -20] } as const,
  },
  /**
   * A Link set alight by the Fire Rod (state 80, entry 0x80281760): the flame by his facing at him (sublayer −1 facing
   * down) and the other at him 3 px up facing down, 3 px down facing up, not turned, both following him; started
   * again when he turns.
   */
  burnRun: { flame: [584, 583, 582, 585], body: [580, 579, 578, 581], bodyDy: { right: 0, left: 0, down: -3, up: 3 } as const },
} as const;
/** The tile type of a damaging pit (the Tower of Flames' lava). */
const LAVA = 0x0e;
/** The falling Link's modeTick when he jumps out of the pit (FALL_START_TICKS + the drop: combat.ts stepFall). */
const FALL_JUMP_START = 60;
/** Group 5's view (another camera, identity in battle: jpa.md "The view"). */
const SCREEN_VIEW = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

/** How much further back than layer −1 the embers are drawn (scene.ts depths: the base layer at 1, the backdrop 0.1). */
const EMBERS_DEPTH = 512;
const FACING_INDEX = { right: 0, left: 1, down: 2, up: 3 } as const;

/** Each Link's rank by life, as the game's HUD counts it: how many of the others have more. */
export function lifeRanks(hearts: readonly number[]): number[] {
  return hearts.map((h) => hearts.filter((o) => o > h).length);
}

/**
 * Where the game keeps the Tower of Flames' embers (0x8016DE30): half the camera's world position, wrapped by a room
 * size every two rooms; in and out of arena px (world = arena + (512, 384)).
 */
export function embersAt(cx: number, cy: number): { x: number; y: number } {
  const wx = (cx + 512) / 2, wy = (cy + 384) / 2;
  return { x: 512 * Math.trunc(wx / 512) + wx - 512, y: 384 * Math.trunc(wy / 384) + wy - 384 };
}

/** Does the game show this entity as particles only (no sprite: the stand-in sprites are skipped)? */
export function drawnAsParticles(e: Entity): boolean {
  switch (e.kind) {
    case "jet":
    case "firebar":
    case "fireball":
      return true;
    case "explosion":
      return !(e.param & BLAST_GIANT); // (the giant bomb's flash is drawn too: entities.ts)
    case "flame":
      return e.phase === "active";
    case "debris":
      return e.param === DEBRIS.bush || e.param === DEBRIS.pot || e.param === DEBRIS.orb;
    default:
      return false;
  }
}

/** What BattleParticles remembers of a Link from frame to frame (in arena px). */
interface LinkMemory {
  rank: number;
  mark: { id: number; start: number } | null;
  airborne: boolean;
  landed: { start: number; x: number; y: number } | null;
  knock: { start: number; x: number; y: number } | null;
}

export class BattleParticles {
  private readonly effects: JpaEffects | null;
  /**
   * Each jet's state as last seen and the tick it began (jets keep no counter of their own: this is the only memory,
   * kept per round).
   */
  private readonly jets = new Map<number, { state: "idle" | "on" | "out"; since: number }>();
  private round = -1;
  /** The tick the round's hazards were spawned on (its countdown's first). */
  private roundStart = 0;
  /** Hits seen (the sim lists a tick's hits on that tick only), as "victim:tick" → "sword" or the hit's cause. */
  private readonly hits = new Map<string, string>();
  /**
   * What the state doesn't keep, per Link (remembered frame to frame, kept per round; a rollback drops what lies past
   * its tick): his rank by life and the tick its mark began, whether he was off the ground and where he last landed, and
   * the spot a knockback left the ground from.
   */
  private links: LinkMemory[] = [];
  /** The distortion effects' pass (drawDistortion): the frame's copy. */
  private readonly distortion = new DistortionPass();
  /**
   * Group 5's screen-space effects (the Tower of Flames' haze): identity view, drawn over the TV frame in its px (in
   * front of everything: the arena's depths are 0-3.5).
   */
  private readonly screen: JpaEffects | null;
  private readonly screenCamera = new THREE.OrthographicCamera(0, HUD_W, 0, -HUD_H, -10, 10);
  /** The tick of the last update (a smaller one is a rollback). */
  private lastTick = -1;
  private groundType: (x: number, y: number) => number = () => 0;
  private arena = "";
  /** The arena has the Tower of Flames' lava and its embers. */
  private embers = false;
  /** The actors' resting effects (SVGT), from the round's start. */
  private statics: { key: string; p: FsaActorParticle; x: number; y: number }[] = [];

  constructor(data: RarcArchive) {
    const file = data.files.find((f) => f.path === "particle.jpc");
    const jpac = file ? parseJpac(file.data) : null;
    this.effects = jpac ? new JpaEffects(jpac, { zBase: 2, zScale: 1 / 1024 }) : null;
    this.screen = jpac ? new JpaEffects(jpac, { zBase: 9, zScale: 0 }, SCREEN_VIEW) : null;
    if (this.effects) this.effects.group.name = "particles";
  }

  /**
   * The screen-distortion effects (heat haze over flames and fireballs): the game draws them after copying the frame
   * (draw group 1; group 5: the Tower of Flames' screen-wide haze). Call right after the arena's render, with its camera and the TV frame's place in the drawing buffer
   * (device px from the bottom left); copies the frame and draws them only while one shows.
   */
  drawDistortion(renderer: THREE.WebGLRenderer, camera: THREE.Camera, x: number, y: number, w: number, h: number): void {
    const layers: DistortionLayer[] = [];
    if (this.effects) layers.push({ jpa: this.effects.renderer, camera });
    // (Sampling the same copy: the screen haze doesn't warp the flames' haze again.)
    if (this.screen) layers.push({ jpa: this.screen.renderer, camera: this.screenCamera });
    this.distortion.draw(renderer, layers, x, y, w, h);
  }

  get group(): THREE.Object3D {
    return this.effects?.group ?? new THREE.Group();
  }

  /** particle.jpc was found. */
  get loaded(): boolean {
    return this.effects !== null;
  }

  /** What was drawn in the last frame (for tests and the perf profile). */
  get stats(): { draws: number; particles: number; emitters: number } {
    return { ...(this.effects?.renderer.stats ?? { draws: 0, particles: 0 }), emitters: this.effects?.emitterCount ?? 0 };
  }

  /** A screen-distortion effect showed in the last frame (drawDistortion has work). */
  get distorting(): boolean {
    return (this.effects?.renderer.distorting ?? false) || (this.screen?.renderer.distorting ?? false);
  }

  /** The effects listed in the last frame (for tests). */
  listed: readonly JpaEffectSpec[] = [];

  /** The effect ids of the live emitters, queued effects aside (for tests). */
  liveIds(): number[] {
    return this.effects?.liveIds() ?? [];
  }

  /**
   * A new arena or map: nothing carries over. `groundType` is the base layer's tile type under a pixel; `actors` the
   * arena's actors that keep effects up while they rest (in world pixels, side rooms included).
   */
  reset(
    arena: string,
    groundType: (x: number, y: number) => number = () => 0,
    actors: readonly { id: string; params: number; x: number; y: number }[] = [],
    options: { embers?: boolean } = {},
  ): void {
    this.arena = arena;
    this.groundType = groundType;
    this.embers = options.embers ?? false;
    this.statics = actors.flatMap((a, k) => fsaActorParticles(a.id, a.params).map((p, n) => ({ key: `static:${k}:${n}`, p, x: a.x, y: a.y })));
    this.round = -1;
    this.forget();
    this.effects?.clear();
    this.screen?.clear();
  }

  private forget(): void {
    this.jets.clear();
    this.hits.clear();
    this.links = [];
    this.lastTick = -1;
  }

  /**
   * Builds this frame's effects from `game` and steps them to its tick (call once per rendered frame). `view`: the
   * camera's center in arena px (the embers follow it).
   */
  update(game: GameState, view?: { x: number; y: number }): void {
    const fx = this.effects;
    if (!fx) return;
    const b = game.battle;
    const round = b ? b.round : -1;
    if (round !== this.round) {
      this.round = round;
      this.forget();
      fx.clear();
      this.screen?.clear();
      this.roundStart = !b ? game.tick : b.phase === "countdown" ? game.tick - b.phaseTick : b.phase === "play" ? game.tick - b.phaseTick - COUNTDOWN_TICKS : game.tick;
    }
    const specs: JpaEffectSpec[] = [];
    if (b) {
      for (const s of this.statics) {
        const placement = place(s.p, s.x + s.p.dx, s.y + s.p.dy, 0);
        if (placement) specs.push({ key: s.key, start: this.roundStart, placement });
      }
      for (const e of b.entities) if (e.hp >= 0) this.entity(game, e, specs);
      this.fighters(game, specs);
      if (this.embers && view) {
        const spot = embersAt(view.x, view.y), placement = place(at(BATTLE_PARTICLES.embers, -1), spot.x, spot.y, 0);
        if (placement) {
          // Under the floor tiles (Dolphin: they only show through the lava), above the lava (depth 0.1): our depths put
          // the tiles at layer −1's top, so half a layer more (y and z alike, the same place on screen).
          placement.translation[1] -= EMBERS_DEPTH;
          placement.translation[2] -= EMBERS_DEPTH;
          specs.push({ key: "embers", start: this.roundStart, placement });
        }
      }
    }
    this.lastTick = game.tick;
    fx.sync(game.tick, specs);
    this.listed = specs;
    const haze = this.embers && b ? fsaParticlePlacement(BATTLE_PARTICLES.screenHaze, 0, 0, 0) : null;
    this.screen?.sync(game.tick, haze ? [{ key: "screen haze", start: this.roundStart, placement: haze }] : []);
  }

  private entity(game: GameState, e: Entity, out: JpaEffectSpec[]): void {
    const b = game.battle!, tick = game.tick;
    const x = e.x / SUBPX, y = e.y / SUBPX, z = e.z / SUBPX;
    const add = (key: string, start: number, p: FsaActorParticle, at = { x, y, z }, extra: Partial<JpaEffectSpec> = {}) => {
      const placement = place(p, at.x + p.dx, at.y + p.dy, at.z);
      if (placement) out.push({ key, start, placement, ...extra });
    };
    switch (e.kind) {
      case "jet": {
        // Out from when its size passes 0.1 until it drops back under (FLME 0x8015DF7C); idle before it ever came out.
        const params = b.props.actors[e.home]?.params ?? 0;
        const on = e.phase === "active" || e.timer >= JET_OUT_SIZE;
        let m = this.jets.get(e.id);
        if (!m) this.jets.set(e.id, (m = { state: on ? "on" : "idle", since: on ? tick : this.roundStart }));
        else if (on && m.state !== "on") m = { state: "on", since: tick };
        else if (!on && m.state === "on") m = { state: "out", since: tick };
        this.jets.set(e.id, m);
        add(`jet:${e.id}:${m.state}`, m.since, fsaJetParticle(params, m.state), { x, y, z: 0 });
        if (m.state === "on") add(`jet:${e.id}:haze`, m.since, at(BATTLE_PARTICLES.haze, 1, 1), { x, y, z: 0 });
        return;
      }
      case "firebar": {
        // The game's arm angle a puts a ball at (sin a, cos a); the sim's θ at (cos θ, sin θ), turning the other way.
        const angle = (0x4000 - e.angle) & 0xffff, speed = -firebarSpeed(b, e), start = this.roundStart;
        fireballs(b, e).forEach((ball, k) => {
          const spot = { x: ball.x / SUBPX, y: ball.y / SUBPX, z: 0 };
          fsaFireballParticles(angle, speed).forEach((p) => add(`ball:${e.id}:${k}:${p.id}`, start, p, spot));
          add(`ball:${e.id}:${k}:haze`, start, at(BATTLE_PARTICLES.haze, 1, 1), spot);
        });
        return;
      }
      case "fireball": {
        // Flying: its flame 8 px ahead; burst (resting), the burst where it met the wall.
        const fire = BATTLE_PARTICLES.rodFire, [sx, sy] = FACING_STEP[e.facing];
        if (e.phase === "rest") {
          add(`rodfire:${e.id}:burst`, tick - e.tick, at(fire.burst));
          return;
        }
        const ahead = { x: x + 8 * sx, y: y + 8 * sy, z };
        for (const id of fire.flame) add(`rodfire:${e.id}:${id}`, tick - e.tick, { ...at(id), rotation: [0, fire.turn[e.facing], 0] }, ahead);
        return;
      }
      case "flame":
        if (e.phase === "active") {
          for (const id of BATTLE_PARTICLES.flame) add(`flame:${e.id}:${id}`, this.roundStart, at(id));
          add(`flame:${e.id}:haze`, this.roundStart, at(BATTLE_PARTICLES.haze, 1));
        }
        return;
      case "bomb":
        // Lit: the fuse's smoke and sparks follow the bomb, raw (no layer); the blast deletes them.
        if (e.timer > 0)
          for (const id of BATTLE_PARTICLES.fuse) add(`fuse:${e.id}:${id}`, tick - (BOMB_FUSE - e.timer), at(id, 0, 0, false), undefined, { vanish: true });
        return;
      case "explosion": {
        const start = tick - (e.tick - 1); // explosions count their ticks from 1 on the tick they appear
        const ids = e.param & BLAST_GIANT ? BATTLE_PARTICLES.bigBomb.blast : BATTLE_PARTICLES.explosion;
        for (const id of ids) add(`boom:${e.id}:${id}`, start, at(id, 1, 1));
        return;
      }
      case "shadowLink":
        if (e.param === SHADOW.sparkles) for (const id of BATTLE_PARTICLES.shadowLink) add(`bbsl:${e.id}:${id}`, tick - e.tick, at(id), { x, y, z: 0 });
        return;
      case "bigBomb": {
        // States count their ticks from 1 on the tick after they begin (giantbomb.ts become).
        const fx = BATTLE_PARTICLES.bigBomb;
        const landed = e.param === BIG_BOMB.squashing ? tick - e.tick : e.param === BIG_BOMB.burning ? tick - e.tick - BIG_BOMB_SQUASH : -1;
        if (landed >= 0 && tick - landed < 120) add(`bbmb:${e.id}:dust`, landed, { ...at(fx.dust), scale: 2.5 }, { x, y: y + 16, z: 0 });
        // The fuse burns down its top: (x + 4, y − 6 − 8 t / 600), t the ticks left. TODO(measure) against a frame dump.
        if (e.param === BIG_BOMB.burning) {
          const fuse = { x: x + 4, y: y - 6 - (8 * e.timer) / BIG_BOMB_FUSE, z: 0 };
          for (const id of fx.fuse) add(`bbmb:${e.id}:${id}`, tick - e.tick, at(id, 0, 0, false), fuse, { vanish: true });
        }
        return;
      }
      case "debris": {
        const start = tick - (DEBRIS_TICKS - e.timer);
        const ids = e.param === DEBRIS.bush ? BATTLE_PARTICLES.bush : e.param === DEBRIS.pot ? BATTLE_PARTICLES.pot : e.param === DEBRIS.orb ? BATTLE_PARTICLES.orb : [];
        // (CRTL's first effect, 1380, at half size on layer 2.)
        for (const id of ids) add(`debris:${e.id}:${id}`, start, id === 1380 ? { ...at(id, 2), scale: 0.5 } : at(id, e.param === DEBRIS.bush ? 0 : 1));
        return;
      }
      default:
        return;
    }
  }

  private fighters(game: GameState, out: JpaEffectSpec[]): void {
    const b = game.battle!, tick = game.tick;
    for (const h of b.hits) if (!h.blocked) this.hits.set(`${h.victim}:${tick}`, h.cause ?? (h.attacker >= 0 ? "sword" : ""));
    const push = (key: string, start: number, p: FsaActorParticle & { lift?: boolean }, x: number, y: number, z: number) => {
      const placement = place(p, x, y, z);
      if (placement) out.push({ key, start, placement });
    };
    this.remember(game);
    b.fighters.forEach((f, i) => {
      const p = game.players[i], m = this.links[i];
      if (!p || !m) return;
      const x = p.x / SUBPX, y = p.y / SUBPX, z = f.z / SUBPX, start = tick - f.modeTick;
      const hit = f.mode === "hurt" ? this.hits.get(`${i}:${start}`) : undefined;
      if (hit === "sword") for (const id of BATTLE_PARTICLES.swordHit) push(`hit:${i}:${start}:${id}`, start, at(id, 1, 1), x, y, 0);
      const lava = BATTLE_PARTICLES.lava;
      // The pit he fell into: where he was before the jump out of it (stepFall moves him by pushX/pushY a tick).
      const jump = f.mode === "falling" ? Math.min(Math.max(f.modeTick - FALL_JUMP_START + 1, 0), FALL_JUMP_TICKS) : 0;
      const pit = { x: (p.x - f.pushX * jump) / SUBPX, y: (p.y - f.pushY * jump) / SUBPX };
      const inLava = f.mode === "falling" && this.groundType(Math.floor(pit.x), Math.floor(pit.y)) === LAVA;
      if (inLava && f.modeTick >= lava.tick) {
        push(`lava:${i}:${start}:glow`, start + lava.tick, at(lava.glow, -1, 0), pit.x, pit.y, 0);
        push(`lava:${i}:${start}:drops`, start + lava.tick, at(lava.drops, 0, 1), pit.x, pit.y, 0);
      }
      // Burning: knocked back by fire, or jumping out of the lava. The flame follows him; the other stays where it began
      // (RAM: only its particle callback is given his place).
      const burning = hit === "flame" ? start : inLava && f.modeTick >= FALL_JUMP_START ? start + FALL_JUMP_START : -1;
      if (burning >= 0) {
        const burn = BATTLE_PARTICLES.burn, k = FACING_INDEX[p.facing], sub = p.facing === "down" ? -1 : 0;
        const rotation: [number, number, number] = [0, burn.turn[k]!, 0];
        const from = hit === "flame" ? (m.knock ?? { x, y }) : pit;
        push(`burn:${i}:${burning}:flame`, burning, { ...at(burn.flame[k]!, 0, sub), rotation }, x, y, z);
        push(`burn:${i}:${burning}:body`, burning, { ...at(burn.body[k]!, 0, sub), rotation }, from.x, from.y, 0);
      }
      this.items(game, i, out);
      this.swordCharge(game, i, out);
      // Dust: trailing him knocked back (from the spot he left the ground) or rolling; where he lands.
      const dust = BATTLE_PARTICLES.dust;
      if (f.mode === "hurt" && m.knock && m.knock.start === start) {
        const s = f.z > 0 ? m.knock : { x, y };
        push(`dust:${i}:${start}`, start, at(dust.trail, 0, -1), s.x, s.y, 0);
      }
      if (f.move === "roll") push(`roll:${i}:${tick - f.moveTick}`, tick - f.moveTick, at(dust.trail, 0, -1), x, y, 0);
      if (m.landed && tick - m.landed.start < 64) push(`land:${i}:${m.landed.start}`, m.landed.start, at(dust.landing), m.landed.x, m.landed.y + dust.landingDy, 0);
      // His rank by life changed: its mark over him, following him (the game sets its place and scale every frame).
      const rank = BATTLE_PARTICLES.rank;
      if (m.mark && tick - m.mark.start < rank.ticks) {
        const placement = place(at(m.mark.id, 0, 0, false), x, y + rank.dy, z);
        if (placement) {
          placement.dynamicsScale = [rank.scale, rank.scale, rank.scale];
          placement.particleScale = [rank.scale, rank.scale];
          out.push({ key: `rank:${i}:${m.mark.start}`, start: m.mark.start, placement });
        }
      }
      // The intro's portal, listed through the countdown (it plays out by itself), and the winner's sparkle.
      const portal = this.roundStart + INTRO.portal;
      if (b.phase === "countdown" && tick >= portal) for (const id of BATTLE_PARTICLES.portal) push(`portal:${b.round}:${i}:${id}`, portal, at(id, 0, 1), x, y, 0);
      const win = BATTLE_PARTICLES.win;
      if (b.phase === "roundOver" && i === b.roundWinner && b.phaseTick >= ROUND_END.result) {
        const from = tick - (b.phaseTick - ROUND_END.result);
        for (const id of win.ids) push(`win:${b.round}:${id}`, from, at(id, 1, 0), x + win.dx, y + win.dy, 0);
      }
    });
  }

  /** The hammer's and the Fire Rod's effects on Link i (packages/sim hammer.ts, firerod.ts). */
  private items(game: GameState, i: number, out: JpaEffectSpec[]): void {
    const p = game.players[i]!, f = game.battle!.fighters[i]!, tick = game.tick;
    const x = p.x / SUBPX, y = p.y / SUBPX, z = f.z / SUBPX;
    const push = (key: string, start: number, e: FsaActorParticle & { lift?: boolean }, px: number, py: number, pz: number) => {
      const placement = place(e, px, py, pz);
      if (placement) out.push({ key, start, placement });
    };
    if (f.mode !== "active") return;
    if (f.move === "hammer" && f.moveTick >= 0) {
      const fx = BATTLE_PARTICLES.hammer, charged = hammerCharged(f);
      if (charged) {
        // (Charging only runs while held from the press: it was full on the pose's 48th tick.)
        const from = tick - (f.moveTick - (HAMMER.charge - 1)), [dx, dy, dz] = fx.sparkleAt[p.facing];
        for (const id of fx.sparkle) push(`hammer:${i}:${from}:${id}`, from, at(id), x + dx, y + dy, z + dz);
      }
      if (f.shot >= HAMMER.pound) {
        const from = tick - (f.shot - HAMMER.pound), box = poundBox(p, f);
        const cx = (box.left + box.right) / 2 / SUBPX, cy = (box.top + box.bottom) / 2 / SUBPX;
        for (const [id, scale] of charged ? fx.charged : fx.pound) push(`pound:${i}:${from}:${id}`, from, { ...at(id), scale }, cx, cy, 0);
      }
    }
    if (streaming(f)) {
      const fire = BATTLE_PARTICLES.rodFire, from = tick - (f.charge - 1), [dx, dy] = fire.rod[p.facing];
      push(`stream:${i}:${from}:${p.facing}`, from, { ...at(fire.stream, 0, 2), rotation: [0, fire.streamTurn[p.facing], 0x8000] }, x + dx, y + dy, z);
      push(`stream:${i}:${from}:${p.facing}:haze`, from, { ...at(fire.haze, -1, 0), rotation: [0, 0, fire.hazeTurn[p.facing]] }, x + dx, y + dy, z);
    }
    if (f.move === "burning") {
      const burn = BATTLE_PARTICLES.burnRun, k = FACING_INDEX[p.facing], from = tick - f.moveTick - 1;
      push(`burnrun:${i}:${from}:${p.facing}:flame`, from, at(burn.flame[k]!, 0, p.facing === "down" ? -1 : 0), x, y, z);
      push(`burnrun:${i}:${from}:${p.facing}:body`, from, at(burn.body[k]!, 0, p.facing === "down" ? -1 : 0), x, y + burn.bodyDy[p.facing], z);
    }
  }

  /** The sword's charge on Link i (charge.ts): the sparkle along the blade, then the burst and the glow at its tip. */
  private swordCharge(game: GameState, i: number, out: JpaEffectSpec[]): void {
    const p = game.players[i]!, f = game.battle!.fighters[i]!, c = chargeCount(p, f), tick = game.tick;
    if (c <= 0) return;
    const x = p.x / SUBPX, y = p.y / SUBPX, z = f.z / SUBPX, fx = SWORD_CHARGE;
    const push = (key: string, start: number, e: FsaActorParticle & { lift?: boolean }, px: number, py: number, pz: number) => {
      const placement = place(e, px, py, pz);
      if (placement) out.push({ key, start, placement });
    };
    const start = tick - (c - 1);
    if (c < CHARGE_FULL) {
      const [dx, dy] = sparkleAt(p.facing, c);
      push(`charge:${i}:${start}`, start, at(fx.sparkle, 0, 1), x + dx, y + dy, z);
      return;
    }
    // (The exit stops them all: unlisted, their particles play out.)
    const full = tick - (c - CHARGE_FULL), [tx, ty, tz] = fx.tip[p.facing], [gx, gy] = fx.glowAt[p.facing];
    for (const id of fx.burst) push(`charged:${i}:${full}:${id}`, full, at(id, 0, -1), x + tx, y + ty, z + tz);
    const glow = fx.glow[f.swordLevel >= 2 ? 2 : 1][p.facing === "right" || p.facing === "left" ? "side" : "upright"];
    push(`charged:${i}:${full}:glow`, full, at(glow, 0, -1, false), x + gx, y + gy, z);
  }

  /** Updates what's remembered per Link (see `links`) from this frame's state. */
  private remember(game: GameState): void {
    const b = game.battle!, tick = game.tick, rollback = tick < this.lastTick;
    if (rollback)
      for (const m of this.links) {
        // Forget what the rollback undid (the next frames see it again if it still happens).
        if (m.mark && m.mark.start > tick) m.mark = null;
        if (m.landed && m.landed.start > tick) m.landed = null;
        if (m.knock && m.knock.start > tick) m.knock = null;
      }
    const ranks = lifeRanks(b.fighters.map((f) => f.hearts));
    b.fighters.forEach((f, i) => {
      const p = game.players[i];
      if (!p) return;
      const m = (this.links[i] ??= { rank: ranks[i]!, mark: null, airborne: false, landed: null, knock: null });
      const x = p.x / SUBPX, y = p.y / SUBPX;
      if (rollback) m.rank = ranks[i]!;
      else if (ranks[i] !== m.rank) {
        const rank = BATTLE_PARTICLES.rank;
        m.mark = { id: ranks[i]! > m.rank ? rank.down : rank.up, start: tick };
        m.rank = ranks[i]!;
      }
      const airborne = f.z > 0;
      if (m.airborne && !airborne && !rollback) m.landed = { start: tick, x, y };
      m.airborne = airborne;
      if (f.mode === "hurt" && m.knock?.start !== tick - f.modeTick) {
        // First seen in the air: back along his slide to where he left the ground.
        const back = f.z > 0 ? f.modeTick : 0;
        m.knock = { start: tick - f.modeTick, x: (p.x - f.pushX * back) / SUBPX, y: (p.y - f.pushY * back) / SUBPX };
      }
    });
  }

  dispose(): void {
    this.effects?.dispose();
    this.screen?.dispose();
    this.distortion.dispose();
  }
}

/** Effect `id` at the entity with createEffect's arguments (layer, sublayer, lift). */
function at(id: number, layer = 0, sublayer = 0, lift = true): FsaActorParticle & { lift: boolean } {
  return { id, dx: 0, dy: 0, layer, sublayer, scale: 1, lift };
}

/**
 * createEffect's placement, the actor's turn applied. A queued effect shown once (a cut bush) gets its own emitter,
 * placed as the resident one is (no rotation, scale 1): its first frame emits what the resident one would there.
 */
function place(p: FsaActorParticle & { lift?: boolean }, x: number, y: number, z: number): FsaParticlePlacement | null {
  const placement = fsaParticlePlacement(p.id, x, y, z, { layer: p.layer, sublayer: p.sublayer, scale: p.scale, lift: p.lift ?? true });
  if (!placement) return null;
  if (p.rotation) placement.rotation = p.rotation;
  if (placement.queued && BATTLE_PARTICLES.bush.includes(p.id as 855)) placement.queued = false;
  return placement;
}
