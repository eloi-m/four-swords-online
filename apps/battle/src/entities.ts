// Draws the sim's battle entities (packages/sim entities.ts): carried and thrown bushes, bombs and explosions, arrows,
// seeds and boomerangs, item orbs and pickups, flames, fire bars, bees, soldiers (Hyrule Castle's archers and captain
// from enemy_gc_sob, as the adventure draws them; its ball-and-chain soldier as SLR3's draw does) and cuccos, bombchus, the
// Tower of Winds' giant bomb, plus the arena's changing ground (cut bushes, the open trick floor) and Vaati at
// time-out. Sprites come from the SOB lists the actors use (enemy_both2_sob: frames picked from our own renders, see
// docs/formats/battle-arenas.md "Battle entity sprites"; enemy_gc_sob for magic circles and Vaati); the trick floor's hole and the
// giant bomb are data.arc BTI textures, its countdown main2D's digits. No shadows on side-view screens (the game draws
// none on the Tower of Winds). It only reads the state.
import { decodeBti, loadSob, type DecodedTexture, type RarcArchive, type SpriteFrame } from "@fso/formats";
import { SpriteAtlas, SpriteMesh, type ActorSpriteSources } from "@fso/render";
import {
  ARENA_H,
  ARENA_W,
  BIG_BOMB,
  BIG_BOMB_SQUASH,
  BALL_FRAME,
  BALL_SCALE,
  BALL_SOLDIER,
  BALL_SOLDIER_FRAME,
  BALL_TURN,
  ballHand,
  ballOf,
  ballSoldierFrame,
  BLAST_GIANT,
  BLAST_GIANT_TICKS,
  bombFlashing,
  BOMBCHU_FUSE,
  BOWMAN_FRAME,
  BOWMAN_LOOK,
  BOWMAN_SHOOT,
  BOWMAN_WALK,
  BOWMAN_WALK_TICKS,
  CAPTAIN_FRAME,
  CAPTAIN_LUNGE,
  CAPTAIN_MARCH,
  CAPTAIN_MARCH_TICKS,
  CHAIN_FRAME,
  CHAIN_SCALE,
  CIRCLE_GROW_TICKS,
  EXPLOSION_TICKS,
  fireballs,
  JET_LENGTH,
  JET_SIZE_ONE,
  jetBox,
  jetSize,
  ORB_LIFETIME,
  PICKUP_BLINK_TICKS,
  ROULETTE,
  screenAt,
  SUBPX,
  tileOverrides,
  TRAPDOOR_TILES,
  type BattleState,
  type Entity,
  type GameState,
} from "@fso/sim";
import * as THREE from "three";
import { CHARGE_FULL, chargeCount, glintFrame, SWORD_CHARGE } from "./charge.ts";
import { actorShadowOpacity, growAboutAnchor, heightScale, LINK_SHADOW, linkShadow, NO_SHADOW_GROUND, ShadowSprite } from "./shadows.ts";

/** Arena actor types the sim animates: scene.ts doesn't draw them as static sprites. */
export const DYNAMIC_ACTORS: ReadonlySet<string> = new Set(["HBMB", "BLZ2", "SLR1", "CRGN", "BEEE", "CIRC", "CNON"]);
/**
 * enemy_gc_sob.bin's first magic-circle frame (CIRC's draw call 0x8028AB7C: 297 + its color, params & 7): 298-301 the
 * players' colors, 302 Hyrule Castle's (color 5), the one with "10" on it (its 10 Dark World seconds; Dolphin frames).
 */
export const CIRCLE_FRAME = 297;
const CIRCLE_COLORS = 6;
/**
 * Vaati at time-out (TUGF's draw 0x80353EE0: enemy_gc_sob 1126 + table 0x80472288 [+0x2C8]): 1126 while he flies
 * in, then 1126, 1127, 1126, 1128 every 11 frames (measured from his 62nd frame).
 */
const VAATI_FRAME = 1126;
const VAATI_CYCLE = [0, 1, 0, 2] as const;
const VAATI_STEP = 11, VAATI_FLAP = 62;
/** Hyrule Castle's bow soldier (gc 79 + 0-31), captain (gc 550 + 0-51) and ball-and-chain soldier (gc 127-129, its ball
 *  130, a chain link 131): castlesoldiers.ts. */
const CASTLE_SOLDIER_FRAMES = [
  ...Array.from({ length: 32 }, (_, k) => BOWMAN_FRAME + k),
  ...Array.from({ length: 52 }, (_, k) => CAPTAIN_FRAME + k),
  ...[0, 1, 2].map((k) => BALL_SOLDIER_FRAME + k),
  BALL_FRAME,
  CHAIN_FRAME,
];
const DIR_INDEX: Readonly<Record<string, number>> = { right: 0, left: 1, down: 2, up: 3 };
/** The step of a walk cycle whose steps last `ticks` (the adventure's frame timers), `t` ticks in. */
function walkStep(ticks: readonly number[], t: number): number {
  let r = t % ticks.reduce((a, n) => a + n, 0), k = 0;
  while (r >= ticks[k]!) r -= ticks[k++]!;
  return k;
}
/** A sprite depth (in px of y) that puts it over the top tile layer (scene.ts: depth 3). */
const ARENA_DEPTH_TOP = 1100;
/** In front of every sprite and the top tile layer (3). */
const ARENA_DEPTH_TOP_Z = 3.4;
/** Tiles in a layer (32 × 32): a side room's world tile indices start k × this further on. */
const LAYER_SIZE = 32 * 32;
/** Lake Hylia's liftable stone (adventure stage.ts LIFT_STONES). */
const STONE_TILE = 0x72;
/** The giant bomb's texture (BBMB draw: bomb_big.bti, bomb_big_a.bti in its last 540 ticks) is 96 px, drawn at 0.75 (its
 *  size, Entity.angle / 1000) about 12 px over its spot; red is added (150) while it flashes. */
const BIG_BOMB_TEXELS = 96;
const BIG_BOMB_LIFT = 12;
const BIG_BOMB_LATE = 540;
/** A bombchu's surface in side view as its sprite's turn (BMTY +0x27C: 0 a floor, π a ceiling, 3π/2 a wall on its
 *  right, π/2 on its left; the screen's y is down, three.js's up). */
const SURFACE_TURN: Readonly<Record<string, number>> = { down: 0, up: Math.PI, right: Math.PI / 2, left: -Math.PI / 2 };
/** A base layer's tiles as drawn (its mesh's data texture), and the tiles a round changed with their own values. */
type BaseLayer = { data: Uint16Array; texture: THREE.DataTexture; original: Map<number, number> };


const DEPTH_PER_PIXEL = 1 / 1024;

/**
 * The boomerang's afterimages (main.dol: its draw 0x80168E78 passes afterimage kind 17 in its sprite parameters
 * (+0x30); the sprite drawer 0x802F86CC then stamps a copy (0x802F6800) into one of 256 slots when the frame counter
 * matches modulo the kind's period, and 0x802FEE68 draws the live ones, fading). Kind 17's tables (0x80471060…):
 * every 4 frames, 20 frames' life, its own size, color × (255, 255, 255, 191) + (127, 127, 127, 0), the alpha (and the
 * added alpha) times life left / 20. A stamp keeps the frame and the spot it was made with (Dolphin frame dumps, The
 * Field: pale boomerangs every ~19 px of flight, fading, left behind on the ground).
 */
export const AFTERIMAGE = { every: 4, life: 20, alpha: 191 / 255, add: 127 / 255 } as const;
type Afterimage = { id: number; tick: number; frame: number; x: number; y: number; depth: number; scale: number };

// enemy_both2_sob frames (by eye from numbered renders; the actors' base frames are the code's, docs/formats.md).
export const B2 = {
  bomb: 232, // HBMB's frame; 233 is the red (flashing) bomb
  bombFlash: 233,
  explosion: [234, 235, 236, 237, 238, 239, 240],
  flame: [265, 266, 267, 268], // BLZ2's GBA flame (265) and the next ones
  smallFlame: 273,
  fireball: [456, 457],
  arrow: { right: 76, left: 77, down: 78, up: 79 },
  seed: 231,
  boomerang: [105, 106, 107, 108], // one 16×16 graphic and its flips (104 is the last of the creature frames before it)
  // CRTL crystal balls (144 + the content, remapped): idle, a "?" blinking green / red; lifted, the roulette's icons.
  orb: [144, 145],
  orbWith: { heart: 151, carrot: 152, cucco: 147 } as Record<string, number>,
  /** The roulette's entries (orbs.ts ROULETTE: 2 carrot, 3 cucco, 5 bombchus) as icons. */
  roulette: { 2: 152, 3: 147, 5: 149 } as Record<number, number>,
  // LSTI draws 64 + the game's item number (orbs.ts GAME_ITEMS); hearts are HART's; what an orb released, its icon.
  item: { boots: 65, boomerang: 67, bow: 68, hammer: 69, fireRod: 70, bomb: 72, slingshot: 74, fourSword: 75, heart: 49, carrot: 152, cucco: 147 } as Record<string, number>,
  bush: 41,
  pot: 34,
  // Lake Hylia's lifted stone (tile 0x72): the game's own pick. Lifting 0x72 or 0x73 (main.dol 0x802A1050) leaves
  // tile 0x7C and spawns STON, whose draw (0x802D0E28) is enemy_both2 41 with the palettes as they are.
  stone: 41,
  smoke: [133, 134, 135, 136],
  bee: [460, 461, 462, 463],
  cucco: [687, 688, 689, 690],
  soldier: { right: [500, 501, 502, 501], left: [506, 507, 508, 507], down: [512, 513, 514, 515], up: [520, 521, 522, 523] },
  cannon: 332, // CNON (+ its aim: 0 here)
  // BMTY (draw 0x80325754): 140 + its step, toggling every 4 ticks of its fuse; under 100 left, 143, 142, 141, 140.
  bombchu: [140, 141, 142, 143],
  /** A full sword charge's glint (PEFF kind 2: charge.ts). */
  chargeGlint: [683, 684, 685, 686],
} as const;
/** SLR1 kind 2 (Hyrule Castle's soldiers) draws palette 2 (and 8) as palette 4. */
const SOLDIER_PALETTES: Readonly<Record<number, number>> = { 2: 4, 8: 4 };
const SOLDIER_FRAMES: ReadonlySet<number> = new Set(Object.values(B2.soldier).flat());

// The roulette (CRTL 0x80322F44; measured in Dolphin, docs/measurements/battle-arenas.md "Battle measurements: arenas, orbs and
// camera"). Idle, an orb blinks a green / red "?" every 10 frames from its spawn. Lifted, it keeps blinking for 20
// frames (+0x260), then shows N + 1 entries of the roulette table in turn (+0x24C counts N = 40 + rand(7) down to 0),
// 5 frames each until 5 are left, which take 10, 15, 20, 25 and 30 frames (0x80471760), and the last one, its content
// (entry +0x2B4: the first one shown is the content's entry − N), stays up. The sim keeps neither N nor which of the
// table's equal entries was drawn: both come from the orb's id here.
export const ROULETTE_QUESTION = 20;
export const ROULETTE_STEP = 5;
export const ROULETTE_STEPS = 40; // + rand(7)
export const ROULETTE_SLOW = [10, 15, 20, 25, 30] as const;
export const ORB_BLINK = 10;
const ROULETTE_ICONS: readonly number[] = ROULETTE.map((n) => B2.roulette[n] ?? B2.orb[0]);

/** The roulette an orb runs: its step count N and the table entry it stops on (-1: its content isn't in the table). */
export function orbRoulette(id: number, content: number | undefined): { steps: number; entry: number } {
  const h = Math.imul(id, 0x9e3779b1) >>> 0;
  const entries = ROULETTE_ICONS.flatMap((icon, k) => (icon === content ? [k] : []));
  return { steps: ROULETTE_STEPS + ((h >>> 8) % 7), entry: entries.length ? entries[(h >>> 16) % entries.length]! : -1 };
}

/** The "?" an orb shows `age` frames after it appeared: green, then red, every 10 frames. */
export const orbQuestion = (age: number): number => B2.orb[Math.floor(age / ORB_BLINK) % 2]!;

/**
 * The icon an orb shows `t` frames into its roulette (`age` frames after it appeared), running `steps` steps and
 * stopping on table entry `entry`, then on `content`'s icon.
 */
export function rouletteIcon(content: number | undefined, t: number, age = t, steps = ROULETTE_STEPS, entry = -1): number {
  if (t < ROULETTE_QUESTION) return orbQuestion(age);
  let left = t - ROULETTE_QUESTION, k: number; // the entries still to come (+0x24C)
  const fast = (steps - ROULETTE_SLOW.length) * ROULETTE_STEP;
  if (left < fast) k = steps - Math.floor(left / ROULETTE_STEP);
  else {
    left -= fast;
    k = ROULETTE_SLOW.length;
    for (const d of ROULETTE_SLOW) {
      if (left < d) break;
      left -= d;
      k--;
    }
  }
  if (k <= 0) return content ?? B2.orb[0];
  const n = ROULETTE_ICONS.length;
  return ROULETTE_ICONS[((((entry < 0 ? 0 : entry) - k) % n) + n) % n]!;
}

const allFrames = (): number[] => {
  const out = new Set<number>();
  const add = (v: unknown): void => {
    if (typeof v === "number") out.add(v);
    else if (Array.isArray(v)) v.forEach(add);
    else if (v && typeof v === "object") Object.values(v).forEach(add);
  };
  add(B2);
  return [...out].sort((a, b) => a - b);
};

function textureOf(tex: DecodedTexture): THREE.DataTexture {
  const row = tex.width * 4, flipped = new Uint8Array(tex.data.length);
  for (let y = 0; y < tex.height; y++) flipped.set(tex.data.subarray(y * row, (y + 1) * row), (tex.height - 1 - y) * row);
  const t = new THREE.DataTexture(flipped, tex.width, tex.height, THREE.RGBAFormat);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}

function textureQuad(file: string, data: RarcArchive): THREE.Mesh | null {
  const bytes = data.files.find((f) => f.path === file)?.data;
  if (!bytes) return null;
  const tex = decodeBti(bytes);
  const material = new THREE.MeshBasicMaterial({ map: textureOf(tex), transparent: true, alphaTest: 0.5 });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(tex.width, tex.height), material);
  mesh.visible = false;
  return mesh;
}

/** A BTI as a unit quad whose color gets `uAdd` added (the giant bomb's red flash), see-through where it is. */
function tintedQuad(file: string, archive: RarcArchive | null): THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> | null {
  const bytes = archive?.files.find((f) => f.path === file)?.data;
  if (!bytes) return null;
  const material = new THREE.ShaderMaterial({
    vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader:
      "uniform sampler2D uMap; uniform vec3 uAdd; varying vec2 vUv; void main() { vec4 t = texture2D(uMap, vUv); if (t.a < 0.5) discard; gl_FragColor = vec4(min(t.rgb + uAdd, 1.0), 1.0); }",
    uniforms: { uMap: { value: textureOf(decodeBti(bytes)) }, uAdd: { value: new THREE.Vector3() } },
  });
  material.uniforms.uMap!.value.userData.shared = true;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  mesh.visible = false;
  return mesh;
}

export class EntityView {
  readonly group = new THREE.Group();
  private readonly atlas: SpriteAtlas | null;
  private readonly slots = new Map<string, number>();
  private readonly pool: SpriteMesh[] = [];
  private used = 0;
  private readonly hole: THREE.Mesh | null;
  /** The giant bomb (bomb_big, bomb_big_a), its countdown digits 1-9 (main2D's kk_rupynum_0N: setDigits), the blast's flash. */
  private readonly bigBomb: (THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> | null)[];
  private digits: (THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> | null)[] = [];
  private readonly flash: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  /** The side-view screens (bit k: screen k) of the battle being drawn: no shadows there. */
  private sideViews = 0;
  /** Per screen (0 the TV, k a side room: packages/sim siderooms.ts), the base layer's tiles as drawn. */
  private bases = new Map<number, BaseLayer>();
  /** Each layer texture's tiles as they were before patchTiles changed them, kept with the texture: apps/game shows a
   *  room's cached layer again on coming back, still holding the tiles patched there (cut bushes the sim regrew). */
  private readonly originals = new WeakMap<THREE.DataTexture, Map<number, number>>();
  /** kage_sob.bin frames 0 (12×6) and 1 (6×4): the actors' shadows (shadows.ts). */
  private readonly kage: SpriteAtlas | null;
  private readonly shadowPool: ShadowSprite[] = [];
  private shadowsUsed = 0;
  /** Shadow spec 7 (BMTY): the actor's own frame as a flat silhouette, as a Link's (shadows.ts). */
  private readonly silhouettePool: ShadowSprite[] = [];
  private silhouettesUsed = 0;
  private groundType: (x: number, y: number) => number = () => 0;
  /** The boomerangs' afterimages still showing (AFTERIMAGE), oldest first, and their sprites. */
  private afterimages: Afterimage[] = [];
  private readonly afterimagePool: SpriteMesh[] = [];
  /** The tick each lifted or thrown orb's roulette started, by entity id. */
  private readonly roulettes = new Map<number, number>();
  /** Entities drawn in the last frame, by kind (for tests); `shadows` = shadows drawn. */
  drawn: Record<string, number> = {};
  /** The enemy_both2 frame each orb showed in the last frame, by entity id (for tests). */
  orbIcons: Record<number, number> = {};
  /** The enemy_gc frame each magic circle showed in the last frame, by entity id (for tests). */
  circleFrames: Record<number, number> = {};
  /**
   * Entities the game shows as particles (particles.ts draws them): their sprite stand-ins are skipped (they still
   * count in `drawn`). Null while the particle effects aren't loaded.
   */
  asParticles: ((e: Entity) => boolean) | null = null;

  constructor(sources: ActorSpriteSources, data: RarcArchive) {
    let kage: SpriteFrame[] = [];
    try {
      kage = loadSob(data, "kage_sob.bin").slice(0, 2);
    } catch {
      // no shadows
    }
    this.kage = kage.length === 2 ? new SpriteAtlas(sources.sheet, kage) : null;
    if (this.kage) this.kage.texture.userData.shared = true;
    const both2 = sources.sobs.both2;
    const frames: SpriteFrame[] = [];
    if (both2) {
      for (const f of allFrames()) {
        const frame = both2[f];
        if (!frame) continue;
        this.slots.set(`${f}`, frames.length);
        frames.push(frame);
        if (SOLDIER_FRAMES.has(f)) {
          this.slots.set(`${f}/soldier`, frames.length);
          frames.push(frame.map((part) => ({ ...part, palette: SOLDIER_PALETTES[part.palette] ?? part.palette })));
        }
      }
    }
    // Magic circles (CIRC: enemy_gc_sob 297 + color), drawn as they open and close.
    const gc = sources.sobs.gc;
    for (const f of [...Array.from({ length: CIRCLE_COLORS }, (_, k) => CIRCLE_FRAME + k), VAATI_FRAME, VAATI_FRAME + 1, VAATI_FRAME + 2, ...CASTLE_SOLDIER_FRAMES]) {
      if (!gc?.[f]) continue;
      this.slots.set(`${f}/gc`, frames.length);
      frames.push(gc[f]!);
    }
    this.atlas = frames.length ? new SpriteAtlas(sources.sheet, frames) : null;
    if (this.atlas) this.atlas.texture.userData.shared = true;
    this.hole = textureQuad("timg/otosiana_bg_s.bti", data);
    if (this.hole) (this.hole.material as THREE.MeshBasicMaterial).map!.userData.shared = true;
    this.bigBomb = [tintedQuad("timg/bomb_big.bti", data), tintedQuad("timg/bomb_big_a.bti", data)];
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false }));
    this.flash.visible = false;
  }

  /**
   * A new arena: `baseLayers` are the base tile layers' meshes by screen (the arena's, 0, then its side rooms'; their
   * tiles get patched as the round changes them), `groundType` the tile type under a room pixel (no actor shadows on
   * some ground).
   */
  show(baseLayers: ReadonlyMap<number, THREE.Mesh>, groundType: (x: number, y: number) => number = () => 0): void {
    for (const mesh of [...this.pool, ...this.shadowPool, ...this.silhouettePool, ...this.afterimagePool]) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this.group.clear();
    this.pool.length = 0;
    this.shadowPool.length = 0;
    this.silhouettePool.length = 0;
    this.afterimagePool.length = 0;
    this.afterimages = [];
    this.groundType = groundType;
    this.bases = new Map();
    for (const [screen, mesh] of baseLayers) {
      const uniform = (mesh.material as THREE.ShaderMaterial | undefined)?.uniforms?.uLayer?.value as THREE.DataTexture | undefined;
      if (!uniform) continue;
      let original = this.originals.get(uniform);
      if (!original) this.originals.set(uniform, (original = new Map()));
      this.bases.set(screen, { data: uniform.image.data as unknown as Uint16Array, texture: uniform, original });
    }
    if (this.hole) this.group.add(this.hole);
    for (const q of [...this.bigBomb, ...this.digits, this.flash]) if (q) this.group.add(q);
  }

  /** main2D.arc's digits for the giant bomb's countdown (loaded after the arena view). */
  setDigits(main2D: RarcArchive): void {
    for (const q of this.digits) q?.removeFromParent();
    this.digits = Array.from({ length: 10 }, (_, n) => tintedQuad(`timg/kk_rupynum_0${n}.bti`, main2D));
    for (const q of this.digits) if (q) this.group.add(q);
  }

  /** A sprite with its anchor at (x, y), grown by `scale` about it (things above the ground: shadows.ts). */
  private sprite(frame: number, x: number, y: number, depthY: number, variant = "", scale = 1, turn = 0): void {
    const slot = this.slots.get(variant ? `${frame}/${variant}` : `${frame}`);
    if (slot === undefined || !this.atlas) return;
    let mesh = this.pool[this.used];
    if (!mesh) {
      mesh = new SpriteMesh(this.atlas);
      this.pool.push(mesh);
      this.group.add(mesh);
    }
    this.used++;
    mesh.setFrame(slot);
    mesh.visible = true;
    const ax = Math.floor(x), ay = Math.floor(y);
    mesh.place(ax, ay, 2 + depthY * DEPTH_PER_PIXEL);
    growAboutAnchor(mesh, this.atlas, slot, ax, ay, scale);
    mesh.rotation.z = turn; // (about its middle: a bombchu's is its anchor's)
  }

  /** Does the ground at (x, y) show an actor's shadow (not types 0x02, 0x03, 0x0E, nor a side-view screen)? */
  private shadowed(x: number, y: number): boolean {
    return !NO_SHADOW_GROUND.has(this.groundType(Math.floor(x), Math.floor(y))) && !((this.sideViews >>> screenAt(Math.floor(y) * SUBPX)) & 1);
  }

  /** An actor's shadow (kage frame 0 or 1) on the ground at (x, y), for an actor `z` px up, just under its sprite. */
  private shadow(kage: 0 | 1, x: number, y: number, z: number, depthY: number): void {
    if (!this.kage || !this.shadowed(x, y)) return;
    let mesh = this.shadowPool[this.shadowsUsed];
    if (!mesh) {
      mesh = new ShadowSprite(this.kage, null);
      this.shadowPool.push(mesh);
      this.group.add(mesh);
    }
    this.shadowsUsed++;
    mesh.setFrame(kage);
    mesh.place(Math.floor(x), Math.floor(y), 2 + (depthY - 0.5) * DEPTH_PER_PIXEL, 1, 1, actorShadowOpacity(z));
    this.drawn.shadows = (this.drawn.shadows ?? 0) + 1;
  }

  /** Shadow spec 7: the actor's own `frame` squashed 0.9 × 0.5 at height -5, flat (40, 40, 40), an actor's opacity. */
  private silhouette(frame: number, x: number, y: number, z: number, depthY: number): void {
    const slot = this.slots.get(`${frame}`);
    if (slot === undefined || !this.atlas || !this.shadowed(x, y)) return;
    let mesh = this.silhouettePool[this.silhouettesUsed];
    if (!mesh) {
      mesh = new ShadowSprite(this.atlas, LINK_SHADOW.color);
      this.silhouettePool.push(mesh);
      this.group.add(mesh);
    }
    this.silhouettesUsed++;
    const s = linkShadow(Math.floor(x), Math.floor(y), 0);
    mesh.setFrame(slot);
    mesh.place(s.x, s.y, 2 + (depthY - 0.5) * DEPTH_PER_PIXEL, s.sx, s.sy, actorShadowOpacity(z));
    this.drawn.shadows = (this.drawn.shadows ?? 0) + 1;
  }

  /** Draws the entities of `game` (call once per rendered frame). */
  update(game: GameState): void {
    this.used = 0;
    this.shadowsUsed = 0;
    this.silhouettesUsed = 0;
    this.drawn = {};
    this.orbIcons = {};
    this.circleFrames = {};
    const b = game.battle;
    // Stamps from ticks not reached any more (a rollback, a new round) go.
    this.afterimages = b ? this.afterimages.filter((a) => a.tick <= game.tick && game.tick - a.tick < AFTERIMAGE.life) : [];
    if (this.hole) this.hole.visible = false;
    for (const q of [...this.bigBomb, ...this.digits, this.flash]) if (q) q.visible = false;
    this.sideViews = b?.props.sideViews ?? 0;

    if (b) {
      for (const e of b.entities) {
        if (e.hp < 0) continue;
        if (this.asParticles?.(e)) {
          this.drawn[e.kind] = (this.drawn[e.kind] ?? 0) + 1;
          continue;
        }
        const before = this.used, quads = this.quadsShown();
        this.draw(e, game.tick, b);
        if (this.used > before || this.quadsShown() > quads) this.drawn[e.kind] = (this.drawn[e.kind] ?? 0) + 1;
      }
      this.patchTiles(b);
      this.drawGlints(game);
      for (const id of this.roulettes.keys()) if (!b.entities.some((e) => e.id === id && e.hp >= 0 && e.phase !== "rest")) this.roulettes.delete(id);
    } else this.roulettes.clear();
    this.drawAfterimages(game.tick);
    for (let i = this.used; i < this.pool.length; i++) this.pool[i]!.visible = false;
    for (let i = this.shadowsUsed; i < this.shadowPool.length; i++) this.shadowPool[i]!.visible = false;
    for (let i = this.silhouettesUsed; i < this.silhouettePool.length; i++) this.silhouettePool[i]!.visible = false;
  }

  /** The glint at the tip of a sword whose charge just filled (charge.ts), following the Link. */
  private drawGlints(game: GameState): void {
    game.battle!.fighters.forEach((f, i) => {
      const p = game.players[i], c = p ? chargeCount(p, f) : 0;
      const frame = c >= CHARGE_FULL ? glintFrame(c - CHARGE_FULL) : -1;
      if (!p || frame < 0) return;
      const [dx, dy, dz] = SWORD_CHARGE.tip[p.facing], x = p.x / SUBPX + dx, y = p.y / SUBPX + dy;
      this.sprite(frame, x, y - f.z / SUBPX - dz, y);
      this.drawn.glint = (this.drawn.glint ?? 0) + 1;
    });
  }

  /**
   * Stamps a boomerang's afterimage on the ticks the game does (every 4th), once each; a frame drawn a tick late (a
   * display slower than 60 Hz) stamps it for the tick it missed.
   */
  private stamp(e: Entity, tick: number, frame: number, x: number, y: number, depth: number, scale: number): void {
    const at = tick - (tick % AFTERIMAGE.every);
    if (tick - at > 1 || this.afterimages.some((a) => a.id === e.id && a.tick === at)) return;
    this.afterimages.push({ id: e.id, tick: at, frame, x, y, depth, scale });
  }

  /** The live afterimages: pale, fading over their 20 ticks, just under what made them. */
  private drawAfterimages(tick: number): void {
    let n = 0;
    for (const a of this.afterimages) {
      const slot = this.slots.get(`${a.frame}`);
      if (slot === undefined || !this.atlas) continue;
      let mesh = this.afterimagePool[n];
      if (!mesh) {
        mesh = new SpriteMesh(this.atlas);
        mesh.setAdd(AFTERIMAGE.add, AFTERIMAGE.add, AFTERIMAGE.add);
        this.afterimagePool.push(mesh);
        this.group.add(mesh);
      }
      n++;
      mesh.setFrame(slot);
      mesh.visible = true;
      mesh.setOpacity((AFTERIMAGE.alpha * (AFTERIMAGE.life - (tick - a.tick))) / AFTERIMAGE.life);
      const ax = Math.floor(a.x), ay = Math.floor(a.y);
      mesh.place(ax, ay, 2 + (a.depth - 0.5) * DEPTH_PER_PIXEL);
      growAboutAnchor(mesh, this.atlas, slot, ax, ay, a.scale);
    }
    for (let i = n; i < this.afterimagePool.length; i++) this.afterimagePool[i]!.visible = false;
    if (n) this.drawn.afterimages = n;
  }

  private quadsShown(): number {
    return [this.hole, ...this.bigBomb, ...this.digits, this.flash].filter((q) => q?.visible).length;
  }

  /**
   * BBMB (draw 0x80342368): its texture at its size about 12 px over its spot (its height up), squashed as it lands
   * (x ×(1 + 0.2k/5), y ×(1 - 0.2k/5) over 5 ticks and back over 10), red added (150) every other 8 ticks under 300
   * left, every other 4 under 120; its last 540 ticks bomb_big_a with the seconds left (9…1) at half size, TV only.
   */
  private drawBigBomb(e: Entity, tick: number): void {
    const late = e.param === BIG_BOMB.burning && e.timer < BIG_BOMB_LATE;
    const quad = this.bigBomb[late ? 1 : 0] ?? this.bigBomb[0];
    if (!quad) return;
    const size = (BIG_BOMB_TEXELS * e.angle) / 1000, x = e.x / SUBPX, y = e.y / SUBPX - e.z / SUBPX - (BIG_BOMB_LIFT * e.angle) / 750;
    let sx = 1, sy = 1;
    if (e.param === BIG_BOMB.squashing) {
      const k = e.tick <= 5 ? e.tick / 5 : Math.max(0, (BIG_BOMB_SQUASH - e.tick) / 10);
      [sx, sy] = [1 + 0.2 * k, 1 - 0.2 * k];
    }
    quad.scale.set(size * sx, size * sy, 1);
    quad.position.set(x, -(y + (size * (1 - sy)) / 2), 2 + (e.y / SUBPX + 2) * DEPTH_PER_PIXEL);
    const flashing = e.param === BIG_BOMB.burning && e.timer < 300 && Math.floor(tick / (e.timer < 120 ? 4 : 8)) % 2 === 0;
    quad.material.uniforms.uAdd!.value.set(flashing ? 150 / 255 : 0, 0, 0);
    quad.visible = size > 0;
    const digit = late && screenAt(e.y) === 0 ? this.digits[Math.floor(e.timer / 60) + 1] : null;
    if (digit) {
      const tex = digit.material.uniforms.uMap!.value as THREE.DataTexture;
      digit.scale.set(tex.image.width / 2, tex.image.height / 2, 1);
      digit.position.set(x, -y, 2 + (e.y / SUBPX + 3) * DEPTH_PER_PIXEL);
      digit.visible = true;
    }
  }

  /** The giant bomb's blast: the TV goes white, fading over the blast's ticks (frame dumps); not the side rooms' insets. */
  private drawFlash(e: Entity): void {
    this.flash.scale.set(4 * ARENA_W, ARENA_H + 128, 1);
    this.flash.position.set(ARENA_W / 2, -ARENA_H / 2, ARENA_DEPTH_TOP_Z); // (64 px past the arena, short of the side rooms at 512)
    this.flash.material.opacity = Math.max(0, 1 - e.tick / BLAST_GIANT_TICKS);
    this.flash.visible = true;
  }

  private draw(e: Entity, tick: number, b: BattleState): void {
    const x = e.x / SUBPX, y = e.y / SUBPX, z = e.z / SUBPX, top = y - z;
    // Things in the air or overhead go just in front of what's under them.
    const depth = y + (z > 0 ? 1 : 0);
    const grow = heightScale(z);
    const cycle = (frames: readonly number[], every: number) => frames[Math.floor(tick / every) % frames.length]!;
    switch (e.kind) {
      case "bomb":
        this.shadow(0, x, y, z, depth);
        return this.sprite(bombFlashing(e.timer) ? B2.bombFlash : B2.bomb, x, top, depth, "", grow);
      case "explosion": {
        if (e.param & BLAST_GIANT) return this.drawFlash(e);
        const i = Math.min(B2.explosion.length - 1, Math.floor((e.tick * B2.explosion.length) / EXPLOSION_TICKS));
        return this.sprite(B2.explosion[i]!, x, top, depth + 1);
      }
      case "bombchu": {
        // Its two blue steps every 4 ticks of its fuse, then (100 left) red and blue, flashing.
        const step = Math.floor((BOMBCHU_FUSE - e.timer) / 4);
        const frame = e.timer > 100 ? B2.bombchu[step % 2]! : B2.bombchu[3 - (step % 4)]!;
        this.silhouette(frame, x, y, z, depth); // (shadow spec 7)
        return this.sprite(frame, x, top, depth, "", grow, e.param & 32 ? SURFACE_TURN[e.facing] : 0);
      }
      case "bigBomb":
        return this.drawBigBomb(e, tick);
      case "flame":
        if (e.phase !== "active") return; // out until its switch lights it
        return this.sprite(cycle(B2.flame, 6), x, y + 4, depth);
      case "jet": {
        // The game draws JPA particles; flame sprites along the part that's out (its size eases in and out).
        const length = Math.round((JET_LENGTH * jetSize(e)) / JET_SIZE_ONE);
        if (length < 4) return;
        const box = jetBox(e, length);
        const horizontal = e.facing === "left" || e.facing === "right";
        const from = horizontal ? box.left : box.top, to = horizontal ? box.right : box.bottom;
        for (let p = from; p <= to; p += 10) this.sprite(cycle(B2.flame, 4), horizontal ? p : x, horizontal ? y + 4 : p + 4, horizontal ? y : p);
        return;
      }
      case "firebar":
        for (const ball of fireballs(b, e)) this.sprite(cycle(B2.fireball, 4), ball.x / SUBPX, ball.y / SUBPX - 4, ball.y / SUBPX + 2);
        return;
      case "trapdoor":
        if (e.timer > 0 && this.hole) {
          const half = (TRAPDOOR_TILES * 16) / 2;
          this.hole.position.set(x + half, -(y + half), 1.2);
          this.hole.visible = true;
        }
        return;
      case "giantBomb": {
        // Vaati at time-out, high over the arena (over everything: his y is the ground under him).
        const step = e.tick < VAATI_FLAP ? 0 : VAATI_CYCLE[Math.floor((e.tick - VAATI_FLAP) / VAATI_STEP) % VAATI_CYCLE.length]!;
        this.shadow(0, x, y, z, depth);
        return this.sprite(VAATI_FRAME + step, x, top, ARENA_DEPTH_TOP, "gc");
      }
      case "circle": {
        // A floor decal (under every sprite), as big as it's open.
        if (e.timer <= 0) return;
        const color = (b.props.actors[e.home]?.params ?? 0) & 7;
        const frame = CIRCLE_FRAME + (color < CIRCLE_COLORS ? color : 0);
        this.circleFrames[e.id] = frame;
        return this.sprite(frame, x, y, -512, "gc", e.timer / CIRCLE_GROW_TICKS);
      }
      case "bee":
        this.shadow(1, x, y, z, depth);
        return this.sprite(cycle(B2.bee, 2), x, top, depth, "", grow);
      case "cucco":
      case "hen":
      case "angryCucco":
        return this.sprite(cycle(B2.cucco, 4), x, top, depth, "", grow);
      case "soldier": {
        if (e.phase === "stun" && Math.floor(tick / 2) % 2) return;
        const frames = B2.soldier[e.facing];
        return this.sprite(e.phase === "chase" || (e.phase === "rest" && (e.vx || e.vy)) ? cycle(frames, 8) : frames[0]!, x, y, depth, "soldier");
      }
      case "bowSoldier": {
        // gc 79 + its walk's, look's or shot's frame (the adventure's SLR2 draw).
        if (e.phase === "stun" && Math.floor(tick / 2) % 2) return;
        const d = DIR_INDEX[e.facing]!;
        const step = e.phase === "shoot" ? BOWMAN_SHOOT[d]![Math.min(3, Math.floor(e.tick / 8))]! : e.phase === "look" ? BOWMAN_LOOK[d]![Math.floor(e.tick / 15) & 3]! : BOWMAN_WALK[d]![e.vx || e.vy ? walkStep(BOWMAN_WALK_TICKS, tick) : 0]!;
        return this.sprite(BOWMAN_FRAME + step, x, y, depth, "gc");
      }
      case "captain": {
        // gc 550 + his march's or lunge's frame (the adventure's SLR4 draw).
        if (e.phase === "stun" && Math.floor(tick / 2) % 2) return;
        const d = DIR_INDEX[e.facing]!;
        const lunge = e.phase === "active" ? Math.min(1, Math.floor(e.tick / 24)) : e.phase === "lunge" ? Math.min(5, 2 + Math.floor(e.tick / 4)) : e.phase === "hold" ? 5 : -1;
        const step = lunge >= 0 ? CAPTAIN_LUNGE[d]![lunge]! : CAPTAIN_MARCH[d]![walkStep(CAPTAIN_MARCH_TICKS, tick)]!;
        return this.sprite(CAPTAIN_FRAME + step, x, y, depth, "gc");
      }
      case "ballSoldier": {
        // gc 127 + its walk frame; its chain's ten links from its hand to the ball (0.7), the ball (1.5, turning), all
        // 16 px up (SLR3's draw 0x80170008). It blinks while it reels the ball in after a hit.
        if (e.timer > 0 && Math.floor(tick / 2) % 2) return;
        this.sprite(BALL_SOLDIER_FRAME + ballSoldierFrame(e), x, y, depth, "gc");
        const [hx, hy] = ballHand(e), [bx, by] = ballOf(e), up = BALL_SOLDIER.ballHeight;
        for (let k = 0; k < BALL_SOLDIER.links; k++) {
          const cx = (hx + ((bx - hx) * k) / BALL_SOLDIER.links) / SUBPX, cy = (hy + ((by - hy) * k) / BALL_SOLDIER.links) / SUBPX;
          this.sprite(CHAIN_FRAME, cx, cy - up, cy + 1, "gc", CHAIN_SCALE);
        }
        return this.sprite(BALL_FRAME, bx / SUBPX, by / SUBPX - up, by / SUBPX + 1, "gc", BALL_SCALE, BALL_TURN * tick);
      }
      case "soldierArrow":
        return this.sprite(B2.arrow[e.facing], x, top, depth);
      case "orb": {
        // Idle it blinks a green and a red "?" every 10 frames; lifted, the roulette runs to its content.
        // Its lifetime only counts while it lies there (CRTL +0x278): how long it lay there.
        const age = ORB_LIFETIME - e.timer;
        let icon: number;
        if (e.phase === "rest") icon = orbQuestion(age);
        else {
          let start = this.roulettes.get(e.id);
          if (start === undefined) this.roulettes.set(e.id, (start = tick - (e.phase === "held" ? e.tick : 0)));
          const content = B2.orbWith[e.item], { steps, entry } = orbRoulette(e.id, content);
          icon = rouletteIcon(content, tick - start, age + tick - start, steps, entry);
        }
        this.orbIcons[e.id] = icon;
        return this.sprite(icon, x, top, depth, "", grow);
      }
      case "pickup":
        if (e.timer <= PICKUP_BLINK_TICKS && Math.floor(tick / 4) % 2) return;
        this.shadow(e.item === "heart" ? 1 : 0, x, y, z, depth); // LSTI items: frame 0; HART hearts: frame 1
        return this.sprite(B2.item[e.item] ?? B2.orb[0], x, top, depth); // (popping up: orbs.ts)
      case "arrow":
        return this.sprite(B2.arrow[e.facing], x, top, depth, "", grow);
      case "seed":
        return this.sprite(B2.seed, x, top, depth, "", grow);
      case "boomerang": {
        // An item it fetched rides along under it until it's caught (projectiles.ts; its exact spot not measured).
        if (e.item) this.sprite(B2.item[e.item] ?? B2.orb[0], x, top, depth - 1);
        const frame = cycle(B2.boomerang, 2);
        this.stamp(e, tick, frame, x, top, depth, grow);
        return this.sprite(frame, x, top, depth, "", grow);
      }
      // Their frames are 16 px squares about the anchor, drawn at the load's spot (x, y − z): carried (z 18), the
      // load's bottom meets the carrier's eyes (Dolphin, a Lake Hylia stone carried facing right), not his belt.
      case "bush":
        return this.sprite(B2.bush, x, top, depth, "", grow);
      case "pot":
        return this.sprite(this.liftedTile(e.param) === STONE_TILE ? B2.stone : B2.pot, x, top, depth, "", grow);
      case "debris":
        return this.sprite(B2.smoke[Math.min(3, Math.floor((16 - e.timer) / 4))]!, x, y, depth);
      case "cannon":
        return this.sprite(B2.cannon, x, y, depth + 2); // (over its rider, who sits in it)
      default:
        return;
    }
  }

  /** The tile a lifted pot or stone was (its entity's param: the world tile index), as the layer had it at first. */
  private liftedTile(index: number): number {
    const base = this.bases.get(Math.floor(index / LAYER_SIZE)), local = index % LAYER_SIZE;
    return base ? (base.original.get(local) ?? base.data[local]!) & 0x3ff : -1;
  }

  // The base layers show the round's changed tiles (the sim's tileOverrides: cut bushes, lifted pots, pressed
  // switches, the colored panels, lit crystals); tiles no longer changed (a new round) get theirs back. A world tile
  // index (ty * 32 + tx) is screen k's local index - k * 1024 (side rooms are 32 rows apart: siderooms.ts).
  private patchTiles(b: BattleState): void {
    if (!this.bases.size) return;
    const at = (index: number) => ({ base: this.bases.get(Math.floor(index / LAYER_SIZE)), local: index % LAYER_SIZE });
    const overrides = tileOverrides(b, (index) => {
      const { base, local } = at(index);
      return base ? (base.original.get(local) ?? base.data[local]!) & 0x3ff : 0;
    });
    const changed = new Set<BaseLayer>();
    for (const [index, tile] of overrides) {
      const { base, local } = at(index);
      if (!base) continue;
      if (!base.original.has(local)) base.original.set(local, base.data[local]!);
      if (base.data[local] === tile) continue;
      base.data[local] = tile;
      changed.add(base);
    }
    for (const [screen, base] of this.bases) {
      for (const [local, value] of base.original) {
        if (overrides.has(screen * LAYER_SIZE + local)) continue;
        base.data[local] = value;
        base.original.delete(local);
        changed.add(base);
      }
    }
    for (const base of changed) base.texture.needsUpdate = true;
  }
}
