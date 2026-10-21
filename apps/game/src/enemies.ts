// Draws the adventure's enemies and pickups (packages/sim adventure/enemies.ts, pickups.ts) from the SOB lists their draw
// methods use (main.dol draw calls, docs/formats/sprites-and-actors.md "Actor graphics"), and the Fire Rod's flames (gear.ts). It only reads
// the state.
import { BIG_HANDLE_TEXTURES, bigHandleClass, decodeBti, ESCORT_ZORA_FRAME, ESCORT_ZORA_WALK, ESCORT_ZORA_WALK_TICKS, PULL_HANDLE_FRAME, pullHandleClass, type ActorSob, type RarcArchive, type SpriteFrame } from "@fso/formats";
import { SpriteAtlas, SpriteMesh, type ActorSpriteSources } from "@fso/render";
import { PLAYER_ANIMATIONS, SUBPX, SWING, switchOn, WALK_FRAME_TICKS, type Facing } from "@fso/sim";
import { armosStatue, ARROW_KIND, BALL_FRAME, BALL_SCALE, BALL_SOLDIER, BALL_SOLDIER_FRAME, BALL_TURN, BONE_KIND, CHAIN_FRAME, CHAIN_SCALE, ironBallHand, ironBallOf, BOWMAN_LOOK, BOWMAN_SHOOT, BOWMAN_WALK, CAPTAIN_LUNGE, CAPTAIN_MARCH, BUZZ_SHOCK_STEPS, BUZZ_STEPS, enemyShown, MOZO_FRAMES, GEM_FRAMES, GEAR_BY_NUMBER, getFrame, keyHeight, minorShadowFrame, FIREBALL_KIND, hinoxFrame, isCaster, PAME, pameBig, pickupShown, POE_FRAMES, soldierPose, STALFOS_JUMP, STALFOS_WALK, WIZZROBE_BOLTS, ZOL_PALETTES, ZORA_SHOT, actorKey, currentArea, pullOut, shadowShownColor, type AdventureGame, type AdventureStage, type Enemy, type Lever, type Pickup } from "@fso/sim/adventure";
import * as THREE from "three";

const DEPTH_PER_PIXEL = 1 / 1024;
const DIR_INDEX: Readonly<Record<Facing, number>> = { right: 0, left: 1, down: 2, up: 3 };

/** A frame of a SOB list with palette substitutions. */
interface Look {
  sob: ActorSob;
  frame: number;
  palettes?: Readonly<Record<number, number>>;
  /** Drawn this many times its size about its anchor (the draw method's scale), and this opaque. */
  size?: number;
  opacity?: number;
  /** Turned this many radians about its middle. */
  turn?: number;
}

/** Sword soldier kinds' palette, replacing palette 2 (and 8 for kinds 1-3; main.dol 0x8049FA40). */
const SOLDIER_PALETTES = [2, 3, 4, 3, 6, 2, 8, 1];
/** Kinds 1-3 draw Shadow Battle's soldier frames (enemy_both2 500 + pose), the others enemy_both 143 + pose. */
const SOLDIER_BOTH2: Readonly<Record<Facing, readonly number[]>> = { right: [500, 501, 502, 501], left: [506, 507, 508, 507], down: [512, 513, 514, 515], up: [520, 521, 522, 523] };
const SOLDIER_BOTH_POSE: Readonly<Record<Facing, number>> = { right: 0, left: 6, down: 12, up: 18 };

/** A pose of six per facing (sim soldiers.ts soldierPose: standing, walking, looking round); kinds 1-3 have no look poses. */
function soldierLook(kind: number, facing: Facing, pose: number): Look {
  const pal = SOLDIER_PALETTES[kind & 7]!;
  return kind >= 1 && kind <= 3
    ? { sob: "both2", frame: SOLDIER_BOTH2[facing][pose < 4 ? pose : 0]!, palettes: { 2: pal, 8: pal } }
    : { sob: "both", frame: 143 + SOLDIER_BOTH_POSE[facing] + pose, palettes: { 2: pal } };
}

/**
 * The Octorok (OKTA's draw 0x8013FA08): enemy_gc_sob 0 + 4 × direction + step (kind 1: 1094 + …); the step is bit 2 of
 * its walk count while walking (a 4-tick toggle), 2 + the spit's pose while spitting. Palette 3 becomes 4 for kind 1,
 * 5 for kind 2. Its rock (OKTM's draw): enemy_gc_sob 37.
 */
function lookOf(e: Enemy, tick: number): Look | null {
  switch (e.type) {
    case "OKTA": {
      const step = e.state === "spit" ? 2 + (e.tick >= 20 ? 1 : 0) : (e.timer >> 2) & 1;
      const base = e.kind === 1 ? 1094 : 0;
      return { sob: "gc", frame: base + 4 * DIR_INDEX[e.facing] + step, palettes: { 3: e.kind === 1 ? 4 : e.kind === 2 ? 5 : 3 } };
    }
    case "OKTM":
      // A Stalfos's bone: both2 368 + its spin, a step every 3 ticks; an arrow: both2 76 + its facing.
      if (e.kind === ARROW_KIND) return { sob: "both2", frame: 76 + DIR_INDEX[e.facing] };
      // A Zora's fireball: gc 213 + 16-19, 3 ticks each.
      if (e.kind === FIREBALL_KIND) return { sob: "gc", frame: 213 + ZORA_SHOT.frames[Math.floor(e.tick / ZORA_SHOT.stepTicks) % 4]! };
      return e.kind === BONE_KIND ? { sob: "both2", frame: 368 + (Math.floor(e.tick / 3) % 4) } : { sob: "gc", frame: 37 };
    case "SLR2": {
      // gc 79 + its walk's, look's or shot's frame (a bomb thrower gc 276 + …); a bush archer hidden: not drawn.
      if (e.kind === 3 && (e.state === "hide" || e.state === "fly")) return null;
      const d = DIR_INDEX[e.facing], table = e.state === "spit" ? BOWMAN_SHOOT : e.state === "rest" && e.kind !== 2 ? BOWMAN_LOOK : BOWMAN_WALK;
      return { sob: "gc", frame: (e.kind === 2 ? 276 : 79) + table[d]![e.frame & 3]! };
    }
    case "SLR4": {
      // gc 550 + its march's or lunge's frame.
      const d = DIR_INDEX[e.facing];
      return { sob: "gc", frame: 550 + (e.state === "stop" || e.state === "fly" || e.state === "spit" ? CAPTAIN_LUNGE[d]![Math.min(5, e.frame)]! : CAPTAIN_MARCH[d]![e.frame & 3]!) };
    }
    case "SLR3":
      // gc 127 + its walk frame (its chain and ball: EnemyView.ironBall). It blinks while it reels the ball in after a hit.
      if (e.timer > 0 && Math.floor(tick / 2) % 2) return null;
      return { sob: "gc", frame: BALL_SOLDIER_FRAME + e.frame };
    case "KETH":
      // Its wings: enemy_both2 341 + frame (343, folded, at rest).
      return { sob: "both2", frame: 341 + Math.min(2, e.frame) };
    case "SLR1":
      // Its pose: standing, walking (a step every 6 / 8 ticks; chasing every 4: TODO(measure)), looking round.
      return soldierLook(e.kind, e.facing, soldierPose(e) % 6);
    case "TKTA":
      // gc 73 + 3 × big + its legs (0, 1 standing; 2 jumping); a big one 1.2× (+0x54 set at 0x801551B0); hidden under
      // its tile, not drawn.
      if (e.state === "hide") return null;
      return { sob: "gc", frame: 73 + 3 * (e.kind & 1) + Math.min(2, e.frame), ...(e.kind & 1 ? { size: 1.2 } : {}) };
    case "STAL": {
      // A Wizzrobe's raised Stalfos collapsed: its skull, both2 372 + facing, shaking ±2 px (0x801756E4).
      if (e.kind === 5 && e.state === "hide") return { sob: "both2", frame: 372 + DIR_INDEX[e.facing] };
      // both2 344 + its walk's or jump's step (tables 0x804A0C10, 0x804A0C88); a big one 2× (0x801F02BC's mode 1).
      const d = DIR_INDEX[e.facing];
      const index = e.state === "fly" || e.state === "spit" ? STALFOS_JUMP[d]![e.state === "spit" ? 3 : e.frame]! : STALFOS_WALK[d]![e.state === "walk" ? e.frame : 0]!;
      return { sob: "both2", frame: 344 + index, ...(e.turn ? { size: 2 } : {}) };
    }
    case "BZBR":
      // gc 16 + its step, or its shock's.
      return { sob: "gc", frame: 16 + (e.state === "spit" ? BUZZ_SHOCK_STEPS[e.frame]! : BUZZ_STEPS[e.frame & 3]!) };
    case "MOZO":
      // gc 157 + its frame (sinking in lava: TODO its spin and shrink).
      return { sob: "gc", frame: 157 + MOZO_FRAMES[e.frame]! };
    case "NZMI":
      // gc 161 + 4 × facing + 2 when stopped + its step; a big one 1.2× (0x800F3C70).
      return { sob: "gc", frame: 161 + 4 * DIR_INDEX[e.facing] + (e.state === "rest" ? 2 : 0) + (e.frame & 1), ...(e.kind === 1 ? { size: 1.2 } : {}) };
    case "PEAC":
      return { sob: "gc", frame: 26 + (e.frame & 1) };
    case "ZORA":
      // gc 213 + its frame at its scale (1.5 once up); under water or rising, nothing (its ripples are particles).
      if (e.state === "hide" || e.state === "rise" || e.speed === 0) return null;
      return { sob: "gc", frame: 213 + e.frame, size: e.speed / SUBPX };
    case "PUKU":
      // both2 323 + 2 × (facing & 1) + its fins; a big one 2×.
      return { sob: "both2", frame: 323 + 2 * (DIR_INDEX[e.facing] & 1) + (e.frame & 1), ...(e.kind === 1 ? { size: 2 } : {}) };
    case "HINO":
      return { sob: "gc", frame: 43 + hinoxFrame(e) };
    case "WIZR":
      // gc 233 + its frame while it shows, at its alpha (0x801769D8); its bolts are JPA effects in the game: drawn here
      // with the Zora's fireball as a stand-in; its orbs, sparks and beam not drawn.
      if (WIZZROBE_BOLTS.includes(e.kind)) return { sob: "gc", frame: 213 + ZORA_SHOT.frames[Math.floor(e.tick / ZORA_SHOT.stepTicks) % 4]! };
      if (!isCaster(e) || e.state === "hide") return null;
      return { sob: "gc", frame: 233 + e.frame, opacity: Math.min(1, e.speed / 255) };
    case "OIWA":
      return { sob: "gc", frame: 177 };
    case "ROPE":
      // gc 181 + its facing's frame (sim walkers.ts ROPE_FRAMES).
      return { sob: "gc", frame: 181 + e.frame };
    case "ZASL":
      // gc 713 + its frame (sim walkers.ts ZOL_FRAMES), palette 2 drawn as 4.
      return { sob: "gc", frame: 713 + e.frame, palettes: ZOL_PALETTES };
    case "PAME":
      // gc 189 + its frame (upright 0-1, on its back 2-3); a coloured one's shell in its Link's colour; a big one 1.4×.
      return { sob: "gc", frame: 189 + e.frame, ...(e.kind ? { palettes: { 8: 1 + e.kind } } : {}), ...(pameBig(e) ? { size: PAME.bigScale } : {}) };
    case "AMOS":
      // Kinds 3, 4, 5 and 7 the big statue gc 1092 / 1093, the others both2 338 (awake) / 339 (stone), at 2× with
      // params bit 4 (0x80140E84).
      return armosStatue(e) ? { sob: "gc", frame: 1092 + (e.frame & 1) } : { sob: "both2", frame: 338 + (e.frame & 1), ...(e.turn === 1 ? { size: 2 } : {}) };
    case "SLK2":
      return shadowLook(e, tick);
    case "ZSLH": {
      // The minor Shadow Link with a hammer (ZSLH's draw 0x80220F54): player_sob.bin's frame at +0x280 (sim
      // minorShadowFrame), dark (palette 7 as it is); off the TV once he walks away.
      const frame = minorShadowFrame(e);
      return frame < 0 ? null : { sob: "player", frame };
    }
    case "POOH":
      // gc 132 + its step (6 more facing left), its alpha +0x270 (the sim's speed, 0-255: 0x80142684); the ghosts'
      // TIMG textures (data.arc timg/e_obake_*.bti) aren't drawn.
      if (e.state === "hide" || e.speed <= 0 || e.kind === 3 || e.kind === 7) return null;
      return { sob: "gc", frame: 132 + (e.facing === "left" ? 6 : 0) + POE_FRAMES[e.frame]!, opacity: Math.min(1, e.speed / 255) };
    default:
      return null;
  }
}

/**
 * Shadow Link (SLK2's draws 0x801D3CBC, 0x801D3DAC): player_sob.bin's frame his own animation has (+0x348; 60 + his
 * facing in states 24-26), not drawn in states 0-3 and 13; in a Link's colors palette 7 drawn as 12 + his color
 * (+0x560 + 12), dark (his color 4) palette 7 as it is; while he changes, the color his roulette shows (+0x549 copied
 * to +0x560 every tick of state 44). His animation isn't decoded: the sim's states are shown with a Link's frames
 * (assumed): walking his rail or at a Link, the sword swing over SWING's ticks (twice: his swing's sword is out
 * twice, 2-7 and 10-15), standing after it, while he springs back (the knockback's first frame), lands, crouches and
 * changes, jumping (raised by his height: the walk's stride), knocked back, down (the death's last frame, face
 * down), spinning once beaten (the spin's turn, 2 ticks a step). Not drawn: his shield apart from the Link's own,
 * his fades (states 8, 9).
 */
function shadowLook(e: Enemy, tick: number): Look {
  const color = shadowShownColor(e);
  const palettes = color >= 0 ? { 7: 12 + color } : undefined;
  return { sob: "player", frame: shadowFrame(e, tick), ...(palettes ? { palettes } : {}) };
}

const WALK = PLAYER_ANIMATIONS.walk.frames, STAND = PLAYER_ANIMATIONS.stand.frames, KNOCK = PLAYER_ANIMATIONS.knockback.frames;
const SPIN_TURN = [143, 144, 145, 146, 147, 148, 149, 150];
const DOWN_FRAME = 196;
const SWING_LENGTH = SWING.ticks.reduce((a, b) => a + b, 0);

function shadowFrame(e: Enemy, tick: number): number {
  switch (e.state) {
    case "chase":
    case "patrol":
      return e.speed > 0 ? WALK[e.facing][Math.floor(tick / WALK_FRAME_TICKS) % 8]! : STAND[e.facing][0]!;
    case "turn": {
      let t = e.tick % SWING_LENGTH, k = 0;
      while (k < SWING.ticks.length - 1 && t >= SWING.ticks[k]!) t -= SWING.ticks[k++]!;
      return SWING.frames[e.facing][k]!;
    }
    case "dive":
      return KNOCK[e.facing][0]!;
    case "fly":
      return WALK[e.facing][2]!;
    case "knock":
      return KNOCK[e.facing][Math.min(3, Math.floor(e.tick / 4))]!;
    case "rest":
      return DOWN_FRAME;
    case "die":
      return SPIN_TURN[Math.floor(e.tick / 2) % 8]!;
    default:
      return STAND[e.facing][0]!;
  }
}

/** A Shadow Link look of every frame shadowFrame gives, dark and in each color (EnemyView's atlas). */
function shadowLooks(): Look[] {
  const frames = new Set<number>([...SPIN_TURN, DOWN_FRAME]);
  for (const facing of ["right", "left", "down", "up"] as const) for (const table of [WALK, STAND, KNOCK, SWING.frames]) for (const f of table[facing]) frames.add(f);
  const out: Look[] = [];
  for (const frame of frames) for (const color of [-1, 0, 1, 2, 3]) out.push({ sob: "player", frame, ...(color >= 0 ? { palettes: { 7: 12 + color } } : {}) });
  return out;
}

/**
 * A chain lever (PSWK's draw 0x80373EC8; its update 0x80374074 keeps the actor at its home + the pull, +0x244): enemy_gc
 * 1129 + a length class (+0x23c: 0 under 10 px pulled, then 4, 5, 6 and 7 from 10, 20, 30 and 40: 1133-1136 the handle
 * on a longer chain) drawn at its home + 0, 2, 4 or 8 px by the pull within its 10 px (under 1, 3, 6, else), and past
 * the first of those a link coming out of the wall, 1129 + that step (1130-1132), at its home.
 */
function leverLooks(lever: Lever, x: number, y: number): { look: Look; x: number; y: number }[] {
  const pull = lever.pull / 100, within = pull - 10 * Math.trunc(pull / 10);
  const step = within < 1 ? 0 : within < 3 ? 1 : within < 6 ? 2 : 3;
  const length = pull < 10 ? 0 : pull < 20 ? 4 : pull < 30 ? 5 : pull < 40 ? 6 : 7;
  const out = [{ look: { sob: "gc" as const, frame: LEVER_FRAME + length }, x, y: y + [0, 2, 4, 8][step]! }];
  if (step) out.push({ look: { sob: "gc", frame: LEVER_FRAME + step }, x, y });
  return out;
}
const LEVER_FRAME = 1129;

/**
 * An escort Zora (FAZR's draw 0x80123F9C, FZRA's 0x80126F1C): enemy_both2 578 + its animation's frame, walking (10, 7, 10,
 * 7 ticks a step) or standing (the walk's middle frame) as it faces (formats ESCORT_ZORA_WALK).
 */
function zoraLook(facing: Facing, walking: boolean, tick: number): Look {
  const walk = ESCORT_ZORA_WALK[DIR_INDEX[facing]]!;
  if (!walking) return { sob: "both2", frame: ESCORT_ZORA_FRAME + walk[1]! };
  let t = tick % ESCORT_ZORA_WALK_TICKS.reduce((x, y) => x + y), k = 0;
  while (t >= ESCORT_ZORA_WALK_TICKS[k]!) t -= ESCORT_ZORA_WALK_TICKS[k++]!;
  return { sob: "both2", frame: ESCORT_ZORA_FRAME + walk[k]! };
}

/** The way from (dx, dy) faces (the larger axis), or null when it didn't move. */
function facingOf(dx: number, dy: number): Facing | null {
  if (!dx && !dy) return null;
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
}

/**
 * Pickups: a Force Gem its type's frame (enemy_both2, the huge ones enemy_gc; the sparkle steps aren't drawn), a small
 * heart HART's enemy_both2 44, a key KEY0's 45 + its kind.
 */
function pickupLook(p: Pickup): Look | null {
  switch (p.type) {
    case "gem":
      return { sob: p.kind >= 8 ? "gc" : "both2", frame: GEM_FRAMES[p.kind]! };
    case "heart":
      return { sob: "both2", frame: 44 };
    case "key":
      return { sob: "both2", frame: 45 + p.kind };
    case "item":
      return null; // TODO: LSTI's look (the item's own sprite)
  }
}

/**
 * The Fire Rod's bolts and the stumps burning: BLZ2's GBA flame, enemy_both2 265-268, 6 ticks a step (a stand-in:
 * TODO(measure) what the game draws, JPA particles likely).
 */
const FLAME_FRAMES = [265, 266, 267, 268];
const flameLook = (tick: number): Look => ({ sob: "both2", frame: FLAME_FRAMES[Math.floor(tick / 6) % 4]! });

/**
 * The item the Links hold up while an item got from a pedestal shows its pose (dialogue.ts GET_FRAMES "item"): LSTI's
 * look, enemy_both2 64 + the item's number (the bow 68 matches the frame dumps: room 8, all four Links holding it up
 * from the press until the message closed, over the raised right hand; its place eyed from them). Assumed: drawn the
 * whole pose (233-235 too).
 */
export const HELD_UP = { dx: 7, z: 16 } as const;
/** Over the top layer (3): the pedestal's own item, drawn there, doesn't hide it (the frame dumps: the bow held up over
 *  the pedestal behind). */
const HELD_UP_DEPTH = 3.2;
export function heldUpLook(game: AdventureGame): Look | null {
  const g = game.adventure.get;
  if (!g || g.pose !== "item" || getFrame(game) < 0) return null;
  const n = GEAR_BY_NUMBER.indexOf(game.adventure.gear);
  return n > 0 ? { sob: "both2", frame: 64 + n } : null;
}

/** A chest's content as IMUP draws it: Force Gems by type, 16-25 enemy_both2 45-54 (keys, a heart…). */
function contentLook(content: number): Look | null {
  if (content < GEM_FRAMES.length) return { sob: content >= 8 ? "gc" : "both2", frame: GEM_FRAMES[content]! };
  if (content >= 16 && content <= 25) return { sob: "both2", frame: 29 + content };
  return null;
}

/** A BTI as a texture (rows bottom-up for WebGL). */
function ghostTexture(bytes: Uint8Array): THREE.DataTexture {
  const t = decodeBti(bytes), row = t.width * 4, flipped = new Uint8Array(t.data.length);
  for (let y = 0; y < t.height; y++) flipped.set(t.data.subarray(y * row, (y + 1) * row), (t.height - 1 - y) * row);
  const tex = new THREE.DataTexture(flipped, t.width, t.height, THREE.RGBAFormat);
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

export class EnemyView {
  readonly group = new THREE.Group();
  private readonly sources: ActorSpriteSources;
  private readonly frames: SpriteFrame[] = [];
  private readonly slots = new Map<string, number>();
  private atlas: SpriteAtlas | null = null;
  private readonly pool: SpriteMesh[] = [];
  /** The ghost Poes' textures (data.arc timg/e_obake_0-5.bti) and their quads. */
  private readonly ghostTextures: (THREE.DataTexture | null)[] = [];
  private readonly ghosts: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[] = [];
  /** The four-Link handle's textures (data.arc timg/4hippari_switch_0-4.bti) and their quads. */
  private readonly handleTextures: (THREE.DataTexture | null)[] = [];
  private readonly handles: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[] = [];
  /** The escort Zora's last spot and facing (the sim keeps neither facing nor step: they're read off its moves). */
  private escortSeen: { key: number; x: number; y: number; facing: Facing; walked: number } | null = null;
  /** Enemies drawn in the last frame, by type (for tests). */
  drawn: Record<string, number> = {};

  constructor(sources: ActorSpriteSources, data?: RarcArchive) {
    this.sources = sources;
    for (let k = 0; k < 6; k++) {
      const file = data?.files.find((f) => f.path === `timg/e_obake_${k}.bti`);
      this.ghostTextures.push(file ? ghostTexture(file.data) : null);
    }
    for (const name of BIG_HANDLE_TEXTURES) {
      const file = data?.files.find((f) => f.path === `timg/${name}`);
      this.handleTextures.push(file ? ghostTexture(file.data) : null);
    }
    // Every frame the looks above can ask for, in one atlas.
    const wanted: Look[] = [];
    for (const kind of [0, 1, 2]) for (let f = 0; f < 16; f++) wanted.push({ sob: "gc", frame: (kind === 1 ? 1094 : 0) + f, palettes: { 3: kind === 1 ? 4 : kind === 2 ? 5 : 3 } });
    wanted.push({ sob: "gc", frame: 37 });
    GEM_FRAMES.forEach((frame, kind) => wanted.push({ sob: kind >= 8 ? "gc" : "both2", frame }));
    for (let f = 44; f < 62; f++) wanted.push({ sob: "both2", frame: f });
    for (let n = 1; n < GEAR_BY_NUMBER.length; n++) wanted.push({ sob: "both2", frame: 64 + n });
    for (let f = 341; f <= 343; f++) wanted.push({ sob: "both2", frame: f });
    for (const frame of FLAME_FRAMES) wanted.push({ sob: "both2", frame });
    for (let kind = 0; kind < 8; kind++) for (const facing of ["right", "left", "down", "up"] as const) for (let pose = 0; pose < 6; pose++) wanted.push(soldierLook(kind, facing, pose));
    // Tektites, Buzz Blobs and Poes (gc), Stalfos and their bones (both2).
    for (let f = 73; f <= 78; f++) wanted.push({ sob: "gc", frame: f });
    for (let f = 16; f <= 25; f++) wanted.push({ sob: "gc", frame: f });
    for (let f = 132; f <= 143; f++) wanted.push({ sob: "gc", frame: f });
    for (let f = 344; f <= 371; f++) wanted.push({ sob: "both2", frame: f });
    // Mozos, rats, sand crabs (gc), Armos (both2, the big ones gc).
    for (let f = 157; f <= 176; f++) wanted.push({ sob: "gc", frame: f });
    for (const f of [26, 27, 1092, 1093]) wanted.push({ sob: "gc", frame: f });
    for (const f of [338, 339]) wanted.push({ sob: "both2", frame: f });
    // Wizzrobes (gc), the skull of a raised Stalfos (both2).
    for (let f = 233; f <= 253; f++) wanted.push({ sob: "gc", frame: f });
    for (let f = 372; f <= 375; f++) wanted.push({ sob: "both2", frame: f });
    // Zoras and their fireballs, Hinoxes and their rocks (gc), fish (both2).
    for (let f = 213; f <= 232; f++) wanted.push({ sob: "gc", frame: f });
    for (let f = 43; f <= 72; f++) wanted.push({ sob: "gc", frame: f });
    wanted.push({ sob: "gc", frame: 177 });
    for (let f = 323; f <= 326; f++) wanted.push({ sob: "both2", frame: f });
    // Snakes, Zols, PAMEs (gc).
    for (let f = 181; f <= 188; f++) wanted.push({ sob: "gc", frame: f });
    for (const f of [717, 720, 721]) wanted.push({ sob: "gc", frame: f, palettes: ZOL_PALETTES });
    for (let f = 189; f <= 192; f++) for (let k = 0; k <= 4; k++) wanted.push({ sob: "gc", frame: f, ...(k ? { palettes: { 8: 1 + k } } : {}) });
    // Bow soldiers, bomb throwers, captains (gc), arrows (both2).
    for (let f = 79; f <= 110; f++) wanted.push({ sob: "gc", frame: f });
    for (let f = 276; f <= 307; f++) wanted.push({ sob: "gc", frame: f });
    for (let f = 550; f <= 601; f++) wanted.push({ sob: "gc", frame: f });
    for (let f = 76; f <= 79; f++) wanted.push({ sob: "both2", frame: f });
    // The ball-and-chain soldier, its ball and its chain's links (gc).
    for (let f = BALL_SOLDIER_FRAME; f <= BALL_SOLDIER_FRAME + 2; f++) wanted.push({ sob: "gc", frame: f });
    for (const f of [BALL_FRAME, CHAIN_FRAME]) wanted.push({ sob: "gc", frame: f });
    // Shadow Link (player), the chain levers (gc).
    wanted.push(...shadowLooks());
    // The minor Shadow Link with a hammer (player): standing, raising, holding and bringing down the hammer.
    for (const f of [60, 61, 62, 63, 305, 306, 307, 379, 380, 381, 384, 385, 386]) wanted.push({ sob: "player", frame: f });
    for (let f = LEVER_FRAME; f <= LEVER_FRAME + 7; f++) wanted.push({ sob: "gc", frame: f });
    // Hyrule Castle's pull handles and escort Zoras (both2).
    for (let f = PULL_HANDLE_FRAME; f <= PULL_HANDLE_FRAME + 4; f++) wanted.push({ sob: "both2", frame: f });
    for (let f = ESCORT_ZORA_FRAME; f <= ESCORT_ZORA_FRAME + 12; f++) wanted.push({ sob: "both2", frame: f });
    for (const look of wanted) this.slot(look);
    this.atlas = this.frames.length ? new SpriteAtlas(sources.sheet, this.frames) : null;
  }

  private key = (l: Look) => `${l.sob}/${l.frame}/${JSON.stringify(l.palettes ?? {})}`;

  private slot(look: Look): number | undefined {
    const key = this.key(look);
    if (this.slots.has(key)) return this.slots.get(key);
    const frame = this.sources.sobs[look.sob]?.[look.frame];
    if (!frame || this.atlas) return undefined;
    const remap = look.palettes;
    this.slots.set(key, this.frames.length);
    this.frames.push(remap ? frame.map((part) => ({ ...part, palette: remap[part.palette] ?? part.palette })) : frame);
    return this.slots.get(key);
  }

  update(game: AdventureGame, stage?: AdventureStage): void {
    let used = 0;
    this.drawn = {};
    const things: { look: Look | null; x: number; y: number; z: number; type: string; hidden: boolean; depth?: number }[] = [];
    for (const e of game.adventure.enemies) {
      // Knocked back it flashes; dying it blinks out (TODO(measure): the game's hit flash and death look).
      const blink = (e.state === "knock" || e.state === "die") && Math.floor(game.tick / 2) % 2 === 1;
      const look = lookOf(e, game.tick), hidden = blink || !enemyShown(game, e);
      things.push({ look, x: e.x, y: e.y, z: e.z, type: e.type, hidden });
      if (e.type === "SLR3" && look) this.ironBall(e, game.tick, hidden, things);
    }
    if (stage && game.adventure.levers.length) {
      const actors = currentArea(game, stage).actors;
      for (const lever of game.adventure.levers) {
        const actor = actors.find((x) => x.index === lever.actor);
        if (!actor) continue;
        for (const l of leverLooks(lever, actor.x * SUBPX, actor.y * SUBPX)) things.push({ ...l, z: 0, type: "PSWK", hidden: false });
      }
    }
    if (stage) {
      this.pullHandles(game, stage, things);
      this.escortZoras(game, stage, things);
    }
    for (const p of game.adventure.pickups) things.push({ look: pickupLook(p), x: p.x, y: p.y, z: p.z, type: p.from, hidden: !pickupShown(game, p) });
    const a = game.adventure;
    // A key carried overhead (sim doors.ts), rising while he lifts it.
    if (a.keys > 0) {
      const l = game.players[0]!;
      things.push({ look: { sob: "both2", frame: 45 }, x: l.x, y: l.y + 1, z: keyHeight(game) * SUBPX, type: "KEY0", hidden: false });
    }
    // An item got from a pedestal, held up by each Link over his raised hand (frame dumps, room 8's bow).
    const held = heldUpLook(game);
    if (held) for (const p of game.players) things.push({ look: held, x: p.x + HELD_UP.dx * SUBPX, y: p.y + 1, z: HELD_UP.z * SUBPX, type: "IMUP", hidden: false, depth: HELD_UP_DEPTH });
    for (const b of a.bolts) things.push({ look: flameLook(b.tick), x: b.x, y: b.y, z: 4 * SUBPX, type: "fire", hidden: false });
    for (let k = 0; k < a.fires.length; k += 2) {
      const key = a.fires[k]!, tile = key & 1023;
      if (key >> 13 !== a.room || ((key >> 10) & 7) !== a.area) continue;
      things.push({ look: flameLook(a.fires[k + 1]!), x: ((tile & 31) * 16 + 8) * SUBPX, y: ((tile >> 5) * 16 + 12) * SUBPX, z: 0, type: "fire", hidden: false });
    }
    // An opened chest's content rising out of it (IMUP: TODO(measure) its rise).
    const r = game.adventure.reveal;
    if (r) things.push({ look: contentLook(r.content), x: r.x * SUBPX, y: r.y * SUBPX, z: Math.min(16, 8 + r.tick) * SUBPX, type: "IMUP", hidden: false });
    for (const e of things) {
      const look = e.look;
      const slot = look ? this.slots.get(this.key(look)) : undefined;
      if (slot === undefined || !this.atlas || e.hidden) continue;
      let mesh = this.pool[used];
      if (!mesh) {
        mesh = new SpriteMesh(this.atlas);
        this.pool.push(mesh);
        this.group.add(mesh);
      }
      used++;
      mesh.visible = true;
      mesh.setFrame(slot);
      mesh.setSize(look!.size ?? 1);
      mesh.setOpacity(look!.opacity ?? 1);
      mesh.rotation.z = look!.turn ?? 0;
      const x = Math.floor(e.x / SUBPX), y = Math.floor(e.y / SUBPX);
      mesh.place(x, y - Math.floor(e.z / SUBPX), e.depth ?? 2 + y * DEPTH_PER_PIXEL);
      this.drawn[e.type] = (this.drawn[e.type] ?? 0) + 1;
    }
    for (let i = used; i < this.pool.length; i++) this.pool[i]!.visible = false;
    this.drawGhosts(game);
    this.drawBigHandles(game, stage);
  }

  /**
   * The pull handles of the area (sim pullswitch.ts): PLSW's enemy_both2 327 + its length class at its home (formats
   * pullHandleClass). (The four-Link PSWB's are textures: drawBigHandles.)
   */
  private pullHandles(game: AdventureGame, stage: AdventureStage, things: { look: Look | null; x: number; y: number; z: number; type: string; hidden: boolean }[]): void {
    const a = game.adventure;
    if (!a.pulls.length) return;
    const actors = currentArea(game, stage).actors;
    for (let k = 0; k < a.pulls.length; k += 3) {
      const actor = actors.find((x) => x.index === a.pulls[k]);
      if (actor?.id !== "PLSW") continue;
      const frame = PULL_HANDLE_FRAME + pullHandleClass(pullOut(game, actor.index));
      things.push({ look: { sob: "both2", frame }, x: actor.x * SUBPX, y: actor.y * SUBPX, z: 0, type: "PLSW", hidden: false });
    }
  }

  /**
   * The escort Zoras (sim zoras.ts): a FAZR not met yet standing at its spot facing down; the one following the Links
   * walking where the sim has it, facing the way it moved (standing, it faces the leader: assumed); an arrival point
   * (FZRA) standing facing down once its Zora has come (its switch on; FZRA's animation 6) until the great fairy's
   * switch sends it away (assumed: gone at once; the game fades it over its state 13, 120 ticks).
   */
  private escortZoras(game: AdventureGame, stage: AdventureStage, things: { look: Look | null; x: number; y: number; z: number; type: string; hidden: boolean }[]): void {
    const a = game.adventure, b = game.battle, down = zoraLook("down", false, 0);
    for (const z of currentArea(game, stage).actors) {
      if (z.id === "FAZR" && !a.taken.includes(actorKey(a.room, z.index))) things.push({ look: down, x: z.x * SUBPX, y: z.y * SUBPX, z: 0, type: "FAZR", hidden: false });
      if (z.id === "FZRA" && switchOn(b, (z.params >>> 22) & 31) && !switchOn(b, z.params >>> 27)) things.push({ look: down, x: z.x * SUBPX, y: z.y * SUBPX, z: 0, type: "FZRA", hidden: false });
    }
    const e = a.escort;
    if (!e || e.room !== a.room || e.area !== a.area) {
      if (!e) this.escortSeen = null;
      return;
    }
    const leader = game.players[0]!;
    let seen = this.escortSeen;
    if (!seen || seen.key !== e.key) seen = this.escortSeen = { key: e.key, x: e.x, y: e.y, facing: "down", walked: -1 };
    const moved = facingOf(e.x - seen.x, e.y - seen.y);
    if (moved) Object.assign(seen, { facing: moved, walked: game.tick });
    // (A tick without a step in the middle of a walk, rounding, keeps the walk going.)
    const walking = seen.walked >= 0 && game.tick - seen.walked <= 2;
    if (!walking) seen.facing = facingOf(leader.x - e.x, leader.y - e.y) ?? seen.facing;
    seen.x = e.x;
    seen.y = e.y;
    things.push({ look: zoraLook(seen.facing, walking, game.tick), x: e.x, y: e.y, z: 0, type: "FAZR", hidden: false });
  }

  /**
   * The four-Link handle (PSWB's draw 0x80373434): data.arc's 64 × 40 TIMG 4hippari_switch_ + its class (formats
   * bigHandleClass: the handle further out on its stem), at its spot, centred (assumed), on the TV only.
   */
  private drawBigHandles(game: AdventureGame, stage?: AdventureStage): void {
    let n = 0;
    const a = game.adventure;
    if (stage && a.pulls.length) {
      const actors = currentArea(game, stage).actors;
      for (let k = 0; k < a.pulls.length; k += 3) {
        const actor = actors.find((x) => x.index === a.pulls[k]);
        if (actor?.id !== "PSWB") continue;
        const tex = this.handleTextures[bigHandleClass(pullOut(game, actor.index))];
        if (!tex) continue;
        let mesh = this.handles[n];
        if (!mesh) {
          mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ transparent: true, alphaTest: 0.5, depthWrite: false }));
          this.handles.push(mesh);
          this.group.add(mesh);
        }
        n++;
        if (mesh.material.map !== tex) {
          mesh.material.map = tex;
          mesh.material.needsUpdate = true;
        }
        mesh.visible = true;
        mesh.scale.set(tex.image.width, tex.image.height, 1);
        mesh.position.set(actor.x, -actor.y, 2 + actor.y * DEPTH_PER_PIXEL);
        this.drawn.PSWB = (this.drawn.PSWB ?? 0) + 1;
      }
    }
    for (let i = n; i < this.handles.length; i++) this.handles[i]!.visible = false;
  }

  /**
   * A ball-and-chain soldier's chain, ten links at 0.7 a tenth apart from its hand, and its ball at 1.5, turning 0.2 rad
   * a tick, all BALL_SOLDIER.ballHeight px up (SLR3's draw 0x80170008, as apps/battle draws it), in front of the
   * ground below them by a pixel.
   */
  private ironBall(e: Enemy, tick: number, hidden: boolean, things: { look: Look | null; x: number; y: number; z: number; type: string; hidden: boolean }[]): void {
    const [hx, hy] = ironBallHand(e), [bx, by] = ironBallOf(e), z = BALL_SOLDIER.ballHeight * SUBPX, n = BALL_SOLDIER.links;
    for (let k = 0; k < n; k++) {
      const x = hx + Math.trunc(((bx - hx) * k) / n), y = hy + Math.trunc(((by - hy) * k) / n);
      things.push({ look: { sob: "gc", frame: CHAIN_FRAME, size: CHAIN_SCALE }, x, y: y + SUBPX, z: z + SUBPX, type: "SLR3 chain", hidden });
    }
    things.push({ look: { sob: "gc", frame: BALL_FRAME, size: BALL_SCALE, turn: BALL_TURN * tick }, x: bx, y: by + SUBPX, z: z + SUBPX, type: "SLR3 ball", hidden });
  }

  /**
   * The ghost Poes (kinds 3, 7): a 48 × 32 TIMG texture, e_obake_ + its frame (0-1 hiding its face, 2-3 peeking, 4-5
   * laughing: table 0x8049F318), centred 8 px above it, mirrored facing right, at its alpha (POOH's draw 0x80142684).
   */
  private drawGhosts(game: AdventureGame): void {
    let n = 0;
    for (const e of game.adventure.enemies) {
      if (e.type !== "POOH" || (e.kind !== 3 && e.kind !== 7) || e.state === "hide" || e.speed <= 0 || !enemyShown(game, e)) continue;
      const tex = this.ghostTextures[POE_FRAMES[e.frame] ?? 0];
      if (!tex) continue;
      let mesh = this.ghosts[n];
      if (!mesh) {
        mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ transparent: true, alphaTest: 0.5, depthWrite: false }));
        this.ghosts.push(mesh);
        this.group.add(mesh);
      }
      n++;
      if (mesh.material.map !== tex) {
        mesh.material.map = tex;
        mesh.material.needsUpdate = true;
      }
      mesh.material.opacity = Math.min(1, e.speed / 255);
      mesh.visible = true;
      const x = Math.floor(e.x / SUBPX), y = Math.floor(e.y / SUBPX);
      mesh.scale.set(e.facing === "left" ? 48 : -48, 32, 1);
      mesh.position.set(x, -(y - 8 - Math.floor(e.z / SUBPX)), 2 + y * DEPTH_PER_PIXEL);
      this.drawn.POOH = (this.drawn.POOH ?? 0) + 1;
    }
    for (let i = n; i < this.ghosts.length; i++) this.ghosts[i]!.visible = false;
  }
}
