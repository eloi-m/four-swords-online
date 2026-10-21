// What each actor type looks like on the TV when it has just spawned: which sprite (SOB file + frame), palette
// substitutions and offsets, or why nothing is drawn. Derived by us from main.dol (G4SE01 rev 0): the spawn-by-ID
// switch gives each type's constructor and vtable, and the draw methods call the sprite draw functions with the SOB
// file name and a frame expression, usually `field + constant`. See docs/formats/sprites-and-actors.md, "Actor graphics".
//
// Every number here comes from our own reading of the game (code immediates, small tables in .data, a savestate) or
// from our own visual matching; `facts` lists the main.dol values an entry depends on, and the real-disc test checks
// each of them against the user's main.dol. Pieces are drawn in order, each anchored at the actor position.
import type { DecodedTexture } from "../gx/bti.ts";
import type { Actor } from "./actors.ts";
import { createImage, type RgbaImage } from "./bg.ts";
import { drawSprite, type SpriteFrame, type SpriteSheet } from "./sprites.ts";

/** Sprite lists an actor can draw from (`data.arc/sob/`). "gc" frames exist on the TV only. */
export const ACTOR_SOB_FILES = {
  both: "enemy_both_sob.bin",
  both2: "enemy_both2_sob.bin",
  gc: "enemy_gc_sob.bin",
  player: "player_sob.bin",
} as const;
export type ActorSob = keyof typeof ACTOR_SOB_FILES;

export interface ActorSpritePiece {
  kind: "sprite";
  sob: ActorSob;
  frame: number;
  /** Offset of the frame's anchor from the actor position, in room pixels. */
  dx: number;
  dy: number;
  /** Palette substitutions (palette used by the SOB part -> palette drawn), like the game's per-draw remap table. */
  palettes?: Readonly<Record<number, number>>;
  /** Drawn this many times its size about its anchor (the draw call's scale matrix); 1 when absent. */
  size?: number;
}

/** A BTI texture from the stage archive's `timg/` (data.arc's with `archive: "data"`), centered on the actor position + (dx, dy). */
export interface ActorBtiPiece {
  kind: "bti";
  file: string;
  dx: number;
  dy: number;
  archive?: "data";
}

export type ActorPiece = ActorSpritePiece | ActorBtiPiece;

/**
 * - sprite: drawn from SOB frames (or a BTI).
 * - tile: the look is part of the room's tile layers (signs, chests, doors…); the actor adds behavior only.
 * - effect: drawn on the TV by a particle/3D effect; `pieces` may give the GBA sprite as a stand-in.
 * - hidden: draws nothing when it spawns (controllers, triggers, generators, things that appear later).
 */
export type ActorDraw = "sprite" | "tile" | "effect" | "hidden";

/**
 * - confirmed: SOB, frame and palette read from the game's code/data (and the anchor from the stage loader).
 * - matched: the code gives the SOB and a base frame; which animation/direction frame is the resting pose, or a
 *   parameter's meaning, was picked by looking at the frames.
 * - guessed: plausible, not established.
 */
export type Confidence = "confirmed" | "matched" | "guessed";

/** A main.dol value an entry relies on: an instruction's signed 16-bit immediate, or a table in .data. */
export type CodeFact =
  | { at: number; imm: number }
  | { at: number; u32: readonly number[] }
  | { at: number; u16: readonly number[] }
  | { at: number; f32: readonly number[] }
  | { at: number; ascii: string };

export interface ActorLook {
  draw: ActorDraw;
  confidence: Confidence;
  note: string;
  facts?: readonly CodeFact[];
  /** The pieces for one actor record (its params select variants). Absent for tile/hidden types. */
  pieces?: (actor: Actor) => ActorPiece[];
}

/** PLSW (pull handle): enemy_both2 327 + its length class (draw 0x8028A39C; the class set at the end of its update
 *  0x8028A460 from how far it's out: under 1, 3, 8 px → 0, 1, 2; 8 and on → 4), drawn at its home. */
export const PULL_HANDLE_FRAME = 327;
export const pullHandleClass = (out: number): number => (out < 1 ? 0 : out < 3 ? 1 : out < 8 ? 2 : 4);
/** PSWB (the four-Link handle): data.arc's TIMG 4hippari_switch_<class>.bti (draw 0x80373434, table 0x804AE560), the
 *  class from how far it's out (its update's end 0x80373844: under 3, 8, 11, 14 px → 0-3; 14 → 4). */
export const BIG_HANDLE_TEXTURES = [0, 1, 2, 3, 4].map((k) => `4hippari_switch_${k}.bti`);
export const bigHandleClass = (out: number): number => (out < 3 ? 0 : out < 8 ? 1 : out < 11 ? 2 : out < 14 ? 3 : 4);
/** The escort Zoras (FAZR, FZRA): enemy_both2 578 + their animation's frame. */
export const ESCORT_ZORA_FRAME = 578;
/**
 * Their animations (FZRA's table 0x8049E400, pairs of frame and ticks): walking right, left, down, up (frames 2, 1, 3, 1
 * … for 10, 7, 10, 7 ticks); standing is the walk's middle frame (1 right, 4 left, 7 down, 10 up: FZRA's animation 6 is
 * frame 7 alone).
 */
export const ESCORT_ZORA_WALK: readonly (readonly number[])[] = [[2, 1, 3, 1], [6, 4, 5, 4], [8, 7, 9, 7], [11, 10, 12, 10]];
export const ESCORT_ZORA_WALK_TICKS: readonly number[] = [10, 7, 10, 7];
/** The throne (STBL, kind (p >> 12) & 15 = 3 of class 0x804AC2D8): enemy_both2 449 at 2× (draw 0x8033CD44), at its live
 *  position, its placement + 16 px (init 0x8033E188). */
export const THRONE_FRAME = 449;

const sprite = (sob: ActorSob, frame: number, dx = 0, dy = 0, palettes?: Record<number, number>): ActorSpritePiece =>
  palettes ? { kind: "sprite", sob, frame, dx, dy, palettes } : { kind: "sprite", sob, frame, dx, dy };
const one = (sob: ActorSob, frame: number) => () => [sprite(sob, frame)];

// Game directions: 0 right, 1 left, 2 down, 3 up (the order of Link's walk blocks in player_sob). Idle looks face down.

/** JIJI ("old man", the generic villager NPC): variant = params byte 2. [base frame, SOB index, animation set]. */
export const JIJI_VARIANTS: readonly (readonly [number, number, number])[] = [
  [902, 2, 0], [427, 2, 0], [155, 2, 6], [932, 2, 4], [904, 2, 3], [916, 2, 4], [948, 2, 5], [213, 0, 0], [562, 2, 0],
  [564, 2, 0], [566, 2, 3], [601, 2, 7], [607, 2, 3], [591, 2, 8], [195, 1, 6], [536, 2, 3], [619, 2, 0], [689, 0, 1],
  [694, 0, 0], [692, 0, 0], [696, 0, 0], [0, 3, 0], [127, 1, 4], [77, 1, 3], [111, 1, 4], [89, 1, 5], [783, 2, 0],
  [701, 2, 0], [704, 2, 2], [236, 1, 2], [244, 1, 2], [252, 1, 2], [722, 0, 2], [742, 0, 2], [894, 2, 2], [192, 2, 9],
  [383, 0, 10], [409, 0, 10], [435, 0, 10], [461, 0, 10], [487, 0, 10], [513, 0, 10], [789, 2, 0], [328, 1, 0],
  [332, 1, 0], [330, 1, 0], [338, 1, 0], [340, 1, 0], [326, 1, 0], [312, 1, 0], [1250, 0, 2], [1264, 0, 2],
  [1278, 0, 2], [1290, 0, 2],
];
/** JIJI per-animation-set frame offset when facing down: column 2 of the game's 11 × 4 u32 table at JIJI_DIRECTIONS. */
export const JIJI_DIRECTIONS = 0x80475498;
export const JIJI_DOWN = [0, 1, 4, 6, 8, 12, 16, 4, 4, 21, 8];
const JIJI_SOB: readonly ActorSob[] = ["gc", "both", "both2", "both2"];

/** Force Gem frames by params low byte (0-7: small/large in green, blue, red, purple; 8-11: huge, in enemy_gc). */
const RUPY_FRAMES = [1, 5, 9, 13, 17, 21, 25, 29, 1114, 1110, 1122, 1118];
const HNRY_FRAMES = [17, 21, 25, 29, 17, 9, 13, 5];
/** Sword soldier kinds (params & 7): life and the palette that replaces palette 2 (and 8 for kinds 1-3). */
const SLR1_KINDS = [[12, 2], [12, 3], [1, 4], [12, 3], [16, 6], [8, 2], [20, 8], [0, 1]] as const;
/** GOL2 pad layouts (params & 0x1f): x offsets, then y offsets of the 4 pads. */
const GOL2_LAYOUTS: readonly (readonly number[])[] = [
  [0, 64, 0, 64, 0, 0, 64, 64],
  [0, -48, 48, 0, 0, 48, 48, 96],
  [0, 32, 64, 96, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 32, 64, 96],
  [0, 48, 112, 160, 0, 48, 48, 0],
  [0, 160, 0, 160, 0, 0, 96, 96],
];
/** Special talk NPC (SNPC) variants (params >> 16 & 15): [SOB, frame]; variant 0 draws nothing. */
const SNPC_VARIANTS: readonly (readonly [ActorSob, number] | null)[] = [
  null, ["both2", 47], ["both", 195], ["both", 302], ["both", 304], ["gc", 1328], ["both", 306], ["both", 294],
];
/** PLAS params bits 4-5 -> game direction. */
const PLAS_DIRECTIONS = [2, 3, 0, 1];

const hidden = (note: string): ActorLook => ({ draw: "hidden", confidence: "matched", note });
const tile = (note: string): ActorLook => ({ draw: "tile", confidence: "matched", note });
const NO_DRAW = "no sprite or texture draw is reachable from its methods";

export const ACTOR_LOOKS: Readonly<Record<string, ActorLook>> = {
  // --- Lake Hylia (boss010) ---
  FGAL: {
    draw: "sprite",
    confidence: "confirmed",
    note:
      "four girls, one both2 frame each: base = table[direction] (913 up, 907 left, 904 right, 910 down) + walk step " +
      "(0,1,0,2). At spawn they stand in a column at the actor, 16 px apart, all facing down (savestate RAM, Dolphin " +
      "frame 1); they then walk into their formation.",
    facts: [{ at: 0x80474ee0, u32: [913, 907, 904, 910] }, { at: 0x80474ed0, u32: [0, 1, 0, 2] }, { at: 0x80474f6c, ascii: "enemy_both2_sob.bin" }],
    pieces: () => [0, 1, 2, 3].map((i) => sprite("both2", 910, 0, 16 * i)),
  },
  JIJI: {
    draw: "sprite",
    confidence: "confirmed",
    note:
      "variant = params byte 2 (0-53); frame = base + animation set's down offset, SOB from the variant table " +
      "(0 gc, 1 both, 2 both2). Variant 0 (old man) checked in the savestate: 902/903. Variant 21 draws nothing.",
    facts: [
      { at: 0x804753c0, u16: JIJI_VARIANTS.flatMap(([base, sob]) => [base, sob]) },
    ],
    pieces: (a) => {
      let v = (a.params >>> 16) & 0xff;
      if (v >= JIJI_VARIANTS.length) v = 0;
      if (v === 21) return [];
      const [base, sob, set] = JIJI_VARIANTS[v]!;
      return [sprite(JIJI_SOB[sob]!, base + JIJI_DOWN[set]!)];
    },
  },
  RUPY: {
    draw: "sprite",
    confidence: "confirmed",
    note: "Force Gem: frame = table[params & 0xff] + sparkle step; types 0-7 in both2, 8-11 (huge gems) in gc",
    facts: [{ at: 0x80471948, u32: RUPY_FRAMES }],
    pieces: (a) => {
      const t = a.params & 0xff;
      const frame = RUPY_FRAMES[t];
      return frame === undefined ? [] : [sprite(t < 8 ? "both2" : "gc", frame)];
    },
  },
  HNRY: {
    draw: "sprite",
    confidence: "confirmed",
    note: "hovering Force Gem: both2 gem frame = table[params & 7] (the sparkles, both2 125-128, are not drawn here)",
    facts: [{ at: 0x804ab038, u32: HNRY_FRAMES }],
    pieces: (a) => [sprite("both2", HNRY_FRAMES[a.params & 7]!)],
  },
  SLR1: {
    draw: "sprite",
    confidence: "confirmed",
    note:
      "sword soldier: kind = params & 7; kinds 1-3 draw both2 500 + pose, the others both 143 + pose; the pose offset " +
      "for facing down is 12. The kind's palette replaces palette 2 (and 8 for kinds 1-3).",
    facts: [
      { at: 0x80150204, imm: 143 },
      { at: 0x80150230, imm: 500 },
      { at: 0x8049fab8, u32: [12] },
      { at: 0x8049fa40, u32: SLR1_KINDS.flatMap((k) => [...k]) },
    ],
    pieces: (a) => {
      const kind = a.params & 7;
      const pal = SLR1_KINDS[kind]![1];
      return kind >= 1 && kind <= 3 ? [sprite("both2", 512, 0, 0, { 2: pal, 8: pal })] : [sprite("both", 155, 0, 0, { 2: pal })];
    },
  },
  OKTA: {
    draw: "sprite",
    confidence: "confirmed",
    note:
      "Octorok: kind = params & 0xff; kind 1 draws gc 1094 + 4 × direction, the others gc 0 + 4 × direction (facing " +
      "down: +8). Palette 3 is replaced by 4 for kind 1, 5 for kind 2. The spawn direction is random; drawn facing down.",
    facts: [{ at: 0x8013fcf4, imm: 1094 }, { at: 0x8014094c, imm: 3 }, { at: 0x80140aec, imm: 4 }, { at: 0x80140b50, imm: 5 }],
    pieces: (a) => {
      const kind = a.params & 0xff;
      return [sprite("gc", kind === 1 ? 1102 : 8, 0, 0, { 3: kind === 1 ? 4 : kind === 2 ? 5 : 3 })];
    },
  },
  PUKU: {
    draw: "sprite",
    confidence: "confirmed",
    note: "Cheep-Cheep-like fish: both2 323 + animation step",
    facts: [{ at: 0x8017b308, imm: 323 }],
    pieces: one("both2", 323),
  },
  RCK2: {
    draw: "sprite",
    confidence: "confirmed",
    note: "two-person rock: both2 43, drawn 8 px below the actor position (its draw method adds 8.0 to y around the call)",
    facts: [{ at: 0x8034ce80, imm: 43 }, { at: 0x80542578, f32: [8] }],
    pieces: () => [sprite("both2", 43, 0, 8)],
  },
  RCK3: {
    draw: "sprite",
    confidence: "matched",
    note: "1-1 rock pushed into the river: the stage texture timg/yy_1_1_iwa1.bti (iwa2 when broken); placement guessed (centered)",
    pieces: () => [{ kind: "bti", file: "yy_1_1_iwa1.bti", dx: 0, dy: 0 }],
  },
  CNON: {
    draw: "sprite",
    confidence: "confirmed",
    note: "cannon: both2 332 + aim direction (0 at spawn)",
    facts: [{ at: 0x801075bc, imm: 332 }],
    pieces: one("both2", 332),
  },
  FTGL: {
    draw: "sprite",
    confidence: "confirmed",
    note: "Tingle's first appearance, hanging from his balloon: both2 192 + animation step",
    facts: [{ at: 0x80317354, imm: 192 }],
    pieces: one("both2", 192),
  },
  GOL2: {
    draw: "sprite",
    confidence: "confirmed",
    note: "goal: 4 pads (gc 603, 602 while a Link stands on one) laid out by params & 0x1f",
    facts: [{ at: 0x802e2a44, imm: 603 }, { at: 0x802e2a1c, imm: 602 }, { at: 0x8046ea10, f32: GOL2_LAYOUTS.flatMap((l) => l.slice(0, 4)) },
      { at: 0x8046ea70, f32: GOL2_LAYOUTS.flatMap((l) => l.slice(4)) },
    ],
    pieces: (a) => {
      const l = GOL2_LAYOUTS[a.params & 0x1f] ?? GOL2_LAYOUTS[0]!;
      return [0, 1, 2, 3].map((i) => sprite("gc", 603, l[i]!, l[4 + i]!));
    },
  },
  KEY0: {
    draw: "sprite",
    confidence: "matched",
    note: "key: both2 45 + item kind (45 small key, 46 boss key…); the kind's source field is assumed to be params & 0xf",
    facts: [{ at: 0x802c211c, imm: 45 }],
    pieces: (a) => [sprite("both2", 45 + (a.params & 0xf))],
  },
  LSTI: {
    draw: "sprite",
    confidence: "matched",
    note: "dropped item: both2 64 + item (params & 0x7f assumed); with params bit 7 set it is hidden under a rock",
    facts: [{ at: 0x802c03c0, imm: 64 }],
    pieces: (a) => (a.params & 0x80 ? [] : [sprite("both2", 64 + (a.params & 0x7f))]),
  },
  OBLF: {
    draw: "sprite",
    confidence: "guessed",
    note: "object lift (stone slabs): both 20 + a params-selected shape; the mapping from params is a guess",
    facts: [{ at: 0x8034f3c0, imm: 20 }],
    pieces: (a) => [sprite("both", 20 + Math.min(a.params & 0xf, 13))],
  },
  YAJI: {
    draw: "sprite",
    confidence: "confirmed",
    note: "arrow sign on the ground: both 16 + params & 0xf (16 right, 17 left, 18 up, 19 down)",
    facts: [{ at: 0x802afbbc, imm: 16 }],
    pieces: (a) => [sprite("both", 16 + (a.params & 0xf))],
  },
  YNSW: {
    draw: "sprite",
    confidence: "confirmed",
    note: "four-person floor switch: both 13 + state (0 at spawn)",
    facts: [{ at: 0x8034e40c, imm: 13 }],
    pieces: one("both", 13),
  },
  BLCK: {
    draw: "sprite",
    confidence: "confirmed",
    note: "block: size = params & 3 -> both 4 + size; size 0 -> both 69 (grey), or 72 + color for color = params >> 4 & 7",
    facts: [{ at: 0x8028c2c4, imm: 4 }, { at: 0x8028c310, imm: 69 }],
    pieces: (a) => {
      const size = a.params & 3, color = (a.params >>> 4) & 7;
      return [sprite("both", size ? 4 + size : color ? 72 + color : 69)];
    },
  },
  BCK2: {
    draw: "sprite",
    confidence: "confirmed",
    note: "color block: both 69 (grey, once moved) or 72 + color, color = params >> 2 & 7 (1-4; 5 = a random one)",
    facts: [{ at: 0x8037491c, imm: 69 }, { at: 0x803748fc, imm: 3 }],
    pieces: (a) => {
      const color = (a.params >>> 2) & 7;
      return [sprite("both", color >= 1 && color <= 4 ? 72 + color : 69)];
    },
  },
  ZASL: {
    draw: "sprite",
    confidence: "matched",
    note: "Zol slime: gc 713 + growth/animation step; 721 (a full-grown slime) picked as the resting look",
    facts: [{ at: 0x8020c254, imm: 713 }],
    pieces: one("gc", 721),
  },
  ZORA: {
    draw: "sprite",
    confidence: "confirmed",
    note: "river Zora surfacing: gc 213 + animation step",
    facts: [{ at: 0x801ba838, imm: 213 }],
    pieces: one("gc", 213),
  },
  SLR4: {
    draw: "sprite",
    confidence: "matched",
    note: "chief soldier: gc 550 + pose; 556 is the pose facing down. Per-kind palettes not read yet",
    facts: [{ at: 0x80172b98, imm: 550 }],
    pieces: one("gc", 556),
  },
  KEPO: {
    draw: "sprite",
    confidence: "guessed",
    note: "Kaepora Gaebora: gc 604 + pose while flying, 633/634 in other states; 618 (perched, facing the camera) picked",
    facts: [{ at: 0x8021b140, imm: 604 }],
    pieces: one("gc", 618),
  },
  ZSLH: {
    draw: "sprite",
    confidence: "matched",
    note:
      "minor Shadow Link with a hammer: player_sob frame from a field, drawn with the placeholder palettes 7/15 left as is (dark); " +
      "standing down (16) as Dolphin shows Lake Hylia room 4's before it acts (the adventure simulates him: sim minorshadow.ts, frames traced)",
    pieces: one("player", 16),
  },
  ZSLJ: {
    draw: "sprite",
    confidence: "matched",
    note: "minor Shadow Link (jumping): player_sob with the dark placeholder palettes; standing down (16) picked",
    pieces: one("player", 16),
  },
  SNPC: {
    draw: "sprite",
    confidence: "confirmed",
    note: "special talk NPC: variant = params >> 16 & 15 sets SOB and frame; variant 0 (the one in Lake Hylia) draws nothing",
    facts: [{ at: 0x80319bd8, imm: 47 }, { at: 0x80319bf0, imm: 195 }, { at: 0x80319c0c, imm: 302 }, { at: 0x80319c48, imm: 304 }],
    pieces: (a) => {
      const v = SNPC_VARIANTS[(a.params >>> 16) & 0xf];
      return v ? [sprite(v[0], v[1])] : [];
    },
  },
  PLAS: {
    draw: "sprite",
    confidence: "confirmed",
    note:
      "player start: Link standing (player_sob 8 × direction) in the player's colors; player = params & 3, direction = " +
      "[down, up, right, left][params >> 4 & 3]",
    facts: [{ at: 0x8046c890, u32: PLAS_DIRECTIONS }],
    pieces: (a) => {
      const player = 12 + (a.params & 3);
      return [sprite("player", 8 * PLAS_DIRECTIONS[(a.params >>> 4) & 3]!, 0, 0, { 7: player, 15: player })];
    },
  },

  // --- Shadow Battle (boss500) ---
  HBMB: {
    draw: "sprite",
    confidence: "confirmed",
    note: "bomb: both2 232 + fuse step",
    facts: [{ at: 0x8014b1f4, imm: 232 }],
    pieces: one("both2", 232),
  },
  BEEE: {
    draw: "sprite",
    confidence: "confirmed",
    note: "bee: both2 460 + wing step",
    facts: [{ at: 0x80343d18, imm: 460 }],
    pieces: one("both2", 460),
  },
  NIWA: {
    draw: "sprite",
    confidence: "matched",
    note: "Cucco: both2 687 + pose (small) or 711 + pose (large); the small one picked",
    facts: [{ at: 0x8032f90c, imm: 687 }, { at: 0x8032f8ac, imm: 711 }],
    pieces: one("both2", 687),
  },
  CIRC: {
    draw: "sprite",
    confidence: "matched",
    note: "magic circle floor panel: gc 297 + color (params & 7; 5 seems to pick a random color at spawn, drawn grey)",
    facts: [{ at: 0x8028ade0, imm: 297 }],
    pieces: (a) => [sprite("gc", 297 + ((a.params & 7) <= 4 ? a.params & 7 : 0))],
  },
  CRGN: {
    draw: "sprite",
    confidence: "guessed",
    note: "crystal ball generator: spawns CRTL crystal balls whose content is chosen at run time; drawn as the '?' ball (both2 144)",
    pieces: one("both2", 144),
  },
  BLZ2: {
    draw: "effect",
    confidence: "matched",
    note: "eternal flame: spawns BLZE; the TV flame is an effect, the GBA draws both2 265 + step, used here as a stand-in",
    facts: [{ at: 0x802bc988, imm: 265 }],
    pieces: one("both2", 265),
  },
  BBSL: hidden("giant-bomb Shadow Link: player_sob, only appears when the battle times out"),
  // --- the Cave of No Return (boss011) ---
  PSWK: {
    draw: "sprite",
    confidence: "confirmed",
    note:
      "four-Link chain lever: at rest enemy_gc 1129 (the handle) at the actor; pulled, 1129 + a length class (1133-1136, " +
      "the handle on a longer chain) and a link coming out of the wall (1130-1132): apps/game enemies.ts leverLooks",
    facts: [{ at: 0x80373fb0, imm: 1129 }],
    pieces: one("gc", 1129),
  },
  // --- Hyrule Castle (boss013) ---
  PLSW: {
    draw: "sprite",
    confidence: "confirmed",
    note:
      "pull handle: enemy_both2 327 + a length class (0 under 1 px out, 1 under 3, 2 under 8, 4 out for good: 327-329, " +
      "331), at its home; apps/game enemies.ts draws it from the sim's pull (pullswitch.ts pullOut)",
    facts: [{ at: 0x8028a3c0, imm: 327 }, { at: 0x8028a440, imm: 327 }],
    pieces: one("both2", PULL_HANDLE_FRAME),
  },
  PSWB: {
    draw: "sprite",
    confidence: "matched",
    note:
      "four-Link handle: data.arc timg/4hippari_switch_0-4.bti by how far it's out (under 3, 8, 11, 14 px, then 4), on " +
      "the TV only (no GBA draw); centered on the actor (assumed: the TIMG draw 0x802F745C's anchor isn't read)",
    facts: [{ at: 0x804ae560, u32: [0x80474fac, 0x80474fc4, 0x80474fdc, 0x80474ff4, 0x8047500c] }, { at: 0x80474fac, ascii: "4hippari_switch_0.bti" }],
    pieces: () => [{ kind: "bti", file: BIG_HANDLE_TEXTURES[0]!, dx: 0, dy: 0, archive: "data" }],
  },
  STBL: {
    draw: "sprite",
    confidence: "confirmed",
    note:
      "the throne (kind 3 of a shared object class; kind = params >> 12 & 15): enemy_both2 449 drawn at 2×, at its " +
      "position, 16 px below its placement (its init adds 16 to y; box -31..31 × -47..15 round that)",
    facts: [{ at: 0x8033d18c, imm: 449 }, { at: 0x805421fc, f32: [16] }],
    pieces: () => [{ ...sprite("both2", THRONE_FRAME, 0, 16), size: 2 }],
  },
  BARI: {
    draw: "effect",
    confidence: "confirmed",
    note:
      "barrier: no draw method; its init (0x8011F314) makes JPA effects 200 ×3 (at y -16, 0, +16) and 201 ×2 (posts at " +
      "x ±32), turned π/2 with (p >> 4) & 15 = 1; gone (state 3) they stop emitting and play out. apps/game view.ts " +
      "keeps them while the sim's barrier stands",
  },
  FAZR: {
    draw: "sprite",
    confidence: "matched",
    note:
      "escort Zora to fetch: the base NPC's draw 0x80123F9C, enemy_both2 578 (its ctor 0x80121164) + its animation's " +
      "frame; at rest standing facing down (585, assumed its first animation); apps/game draws it from zoras.ts",
    facts: [{ at: 0x80121170, imm: 578 }],
    pieces: () => [sprite("both2", ESCORT_ZORA_FRAME + 7)],
  },
  FZRA: {
    draw: "sprite",
    confidence: "matched",
    note:
      "escort Zora's arrival point: enemy_both2 578 + its animation's frame (draw 0x80126F1C), standing facing down " +
      "(animation 6: frame 7) once its Zora has come (its switch on; not seen before in Dolphin's room 57); apps/game " +
      "draws it then",
    facts: [{ at: 0x8012705c, imm: 578 }, { at: 0x8053ca98, u32: [0x00070007] }],
    pieces: () => [sprite("both2", ESCORT_ZORA_FRAME + 7)],
  },
  FLME: { draw: "effect", confidence: "guessed", note: `flame: ${NO_DRAW} (probably a particle effect)` },
  FBMR: { draw: "effect", confidence: "guessed", note: `firebar manager: ${NO_DRAW} (spawns the fireballs)` },
  BLDF: { draw: "effect", confidence: "matched", note: "blindfold: covers areas with timg black.bti (a TIMG resource)" },

  // --- drawn by the tile layers ---
  KNBN: tile("talking sign: the sign is in the tile layer"),
  TKRA: tile("treasure chest: tile object"),
  SWTH: tile("switch: tile object"),
  DOOR: tile("door: tile object"),
  TRCH: tile("torch: tile object; a lit flame is an effect"),
  PNPC: tile("rewrites a tile of the layer"),
  RBPN: tile("colored floor panel: switches tiles"),
  TFLR: tile("trapdoor floor: draws tile stamps (smp) and otosiana_bg_s.bti"),
  TMI2: tile(`2-3 person block: ${NO_DRAW}`),
  DOSN: tile(`Thwomp switch: ${NO_DRAW}`),
  SVGT: tile(`side-view gate: ${NO_DRAW}`),

  // --- invisible controllers, triggers and generators ---
  RAIL: hidden("a rail's point: actors walk a rail's points in their index order ((params >> 16) & 0xFF, the rail (params >> 8) & 0xFF: 0x800FE3EC); draws nothing"),
  ...Object.fromEntries(
    [
      "BGMN", "FOCS", "GENE", "GFBS", "TINB", "OFFS", "ONOF", "PONT", "PRTC", "PTMI", "RYRN", "SENP", "SEV2", "SIBT",
      "SKIL", "SWEV", "SWNP", "SWT4", "VWMD", "WARP", "WPWL", "WTSW", "ZNSW", "ZOOM", "BFIN", "LTEV", "GEN3", "RNSW",
      "SWOR", "TOMI", "CKSW", "CHSW", "GLWP",
    ].map((id) => [id, hidden(NO_DRAW)]),
  ),
};

export function actorLook(id: string): ActorLook | null {
  return ACTOR_LOOKS[id] ?? null;
}

/** The pieces to draw for an actor (empty when it draws nothing or isn't mapped yet). */
export function actorPieces(actor: Actor): ActorPiece[] {
  return ACTOR_LOOKS[actor.id]?.pieces?.(actor) ?? [];
}

/** SOB lists needed to draw some pieces. */
export function piecesSobs(pieces: Iterable<ActorPiece>): Set<ActorSob> {
  const out = new Set<ActorSob>();
  for (const p of pieces) if (p.kind === "sprite") out.add(p.sob);
  return out;
}

/** Palette remap function for a sprite piece. */
export function piecePaletteMap(piece: ActorSpritePiece): ((palette: number) => number) | undefined {
  const map = piece.palettes;
  return map ? (palette) => map[palette] ?? palette : undefined;
}

/**
 * Software rendering of pieces anchored at (x, y) (tools, tests). `sobs` holds the loaded SOB lists; `texture` returns
 * a decoded BTI by file name (the stage's, or data.arc's for a piece with `archive: "data"`). Missing lists, frames or
 * textures are skipped.
 */
export function drawActorPieces(
  target: RgbaImage,
  sheet: SpriteSheet,
  sobs: Partial<Record<ActorSob, SpriteFrame[]>>,
  pieces: readonly ActorPiece[],
  x: number,
  y: number,
  texture?: (file: string, archive?: "data") => DecodedTexture | null,
): void {
  for (const p of pieces) {
    if (p.kind === "sprite") {
      const frame = sobs[p.sob]?.[p.frame];
      if (frame && (p.size ?? 1) !== 1) drawScaled(target, sheet, frame, x + p.dx, y + p.dy, p.size!, piecePaletteMap(p));
      else if (frame) drawSprite(target, sheet, frame, x + p.dx, y + p.dy, piecePaletteMap(p));
      continue;
    }
    const tex = texture?.(p.file, p.archive);
    if (!tex) continue;
    const left = Math.round(x + p.dx - tex.width / 2), top = Math.round(y + p.dy - tex.height / 2);
    for (let ty = 0; ty < tex.height; ty++) {
      for (let tx = 0; tx < tex.width; tx++) {
        const px = left + tx, py = top + ty;
        if (px < 0 || py < 0 || px >= target.width || py >= target.height) continue;
        const s = (ty * tex.width + tx) * 4, a = tex.data[s + 3]! / 255;
        if (a === 0) continue;
        const d = (py * target.width + px) * 4;
        for (let c = 0; c < 3; c++) target.data[d + c] = Math.round(tex.data[s + c]! * a + target.data[d + c]! * (1 - a));
        target.data[d + 3] = 255;
      }
    }
  }
}

/** A frame drawn `size` times its size about its anchor (nearest pixel), through a scratch image. */
function drawScaled(target: RgbaImage, sheet: SpriteSheet, frame: SpriteFrame, x: number, y: number, size: number, palette?: (p: number) => number): void {
  const R = 128, scratch = createImage(2 * R, 2 * R);
  drawSprite(scratch, sheet, frame, R, R, palette);
  const reach = Math.ceil(R * size);
  for (let ty = -reach; ty < reach; ty++) {
    for (let tx = -reach; tx < reach; tx++) {
      const px = Math.round(x) + tx, py = Math.round(y) + ty;
      if (px < 0 || py < 0 || px >= target.width || py >= target.height) continue;
      const sx = R + Math.floor(tx / size), sy = R + Math.floor(ty / size);
      if (sx < 0 || sy < 0 || sx >= 2 * R || sy >= 2 * R) continue;
      const s = (sy * 2 * R + sx) * 4;
      if (scratch.data[s + 3] === 0) continue;
      target.data.set(scratch.data.subarray(s, s + 4), (py * target.width + px) * 4);
    }
  }
}
