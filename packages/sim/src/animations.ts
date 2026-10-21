// Link's animations in data.arc/sob/player_sob.bin (981 frames), classified by eye from numbered frame renders
// (see docs/animations.md). Frame indices only; the sword actions' play order and timings below were measured in
// Dolphin (docs/measurements.md).

export type Dir = "right" | "left" | "down" | "up";
export type Confidence = "high" | "medium" | "low";
export type PerDir<T> = Readonly<Record<Dir, T>>;

export interface AnimationEntry {
  /** Frames in play order, per facing, or one direction-independent sequence. */
  readonly frames: Readonly<Partial<Record<Dir, readonly number[]>>> | readonly number[];
  /** How sure we are about what the frames show and how they are split by direction. */
  readonly confidence: Confidence;
  readonly note?: string;
}

const run = (first: number, count: number, step = 1): number[] => Array.from({ length: count }, (_, i) => first + i * step);

/** Consecutive right, left, down, up blocks (the file's usual order) of the given lengths. */
function blocks(first: number, right: number, left = right, down = left, up = down): PerDir<number[]> {
  return { right: run(first, right), left: run(first + right, left), down: run(first + right + left, down), up: run(first + right + left + down, up) };
}

// The spin attack's full turn, clockwise from up-right (143 up-right … 150 up). Each facing winds up with 3 of its own 4
// frames (b + 1, b, b + 1, b + 2), turns once through this cycle starting one step before the facing, and ends on b + 3.
const SPIN_CYCLE = { upRight: 143, right: 144, downRight: 145, down: 146, downLeft: 147, left: 148, upLeft: 149, up: 150 };
const cycleFrom = (first: number, count: number) => run(0, count).map((i) => 143 + ((first - 143 + i) % 8));
const spinOrder = (own: number, cycleStart: number) => [own + 1, own, own + 1, own + 2, ...cycleFrom(cycleStart, 8), own + 3];

/** Every frame of player_sob.bin, grouped into actions. */
export const PLAYER_ANIMATIONS = {
  walk: { frames: blocks(0, 8), confidence: "high", note: "8-frame cycles; frames 0 and 4 of each cycle are the standing pose" },
  swing: { frames: blocks(32, 7), confidence: "high", note: "sword sweeps right: up to down, left: up to down, down: left to right, up: right to left" },
  stand: { frames: { right: [60], left: [61], down: [62], up: [63] }, confidence: "high", note: "identical to walk frames 0/8/16/24; the game shows these while standing" },
  blink: { frames: { right: [64], left: [65], down: [66] }, confidence: "medium", note: "same poses with another head; no up variant (no face)" },
  chargeWalk: {
    frames: { right: run(67, 8), left: run(75, 8), down: run(83, 14), up: run(97, 14) },
    confidence: "high",
    note: "sword held out: pairs of (normal, glowing sword); first pair = standing. The game walks with the normal ones only, forward, backward and sideways alike",
  },
  chargeWalkBack: {
    frames: { right: run(119, 8), left: run(111, 8), down: run(135, 8), up: run(127, 8) },
    confidence: "low",
    note: "sword held out, head turned toward the way Link moves; pairs of (normal, glowing). Not the backward charge walk (the game uses chargeWalk for that)",
  },
  spin: {
    frames: {
      right: spinOrder(151, SPIN_CYCLE.upRight),
      left: spinOrder(155, SPIN_CYCLE.downLeft),
      down: spinOrder(159, SPIN_CYCLE.downRight),
      up: spinOrder(163, SPIN_CYCLE.upLeft),
    },
    confidence: "high",
    note: "play order measured in Dolphin: wind-up on the facing's own frames (151-166), one full clockwise turn (143-150), end pose",
  },
  knockback: { frames: blocks(167, 4), confidence: "high", note: "getting hurt (state 15, measured): k ×4, k+1 ×4, k+2 ×4, k+3 until landing" },
  fallInPit: { frames: run(183, 6), confidence: "medium", note: "shrinks, then a sparkle" },
  death: { frames: run(189, 8), confidence: "medium", note: "turns around, then collapses face down" },
  swordHoldAlt: {
    frames: { right: run(197, 4), left: run(201, 4), down: run(205, 7), up: run(212, 7) },
    confidence: "low",
    note: "sword held out further than chargeWalk, no glow variants; strafing while charging, or a dash?",
  },
  spinFacingDown: { frames: run(219, 11), confidence: "medium", note: "a stand-alone spin laid out in play order (219-222 then cycle frames)" },
  raiseSword: { frames: [230, 231, 232], confidence: "medium", note: "raises the Four Sword overhead (facing down)" },
  emoteFront: { frames: run(233, 8), confidence: "low", note: "facing the camera: surprised, cheering" },
  tumble: { frames: run(241, 16), confidence: "low", note: "spinning in the air: thrown?" },
  topView: { frames: run(257, 16), confidence: "low", note: "seen from above / upside down; 257-264 play for item 7 (Pegasus Boots?, measured)" },
  swordTink: { frames: blocks(273, 4), confidence: "medium", note: "the held sword hitting a wall while charging (state 55 in RAM, 15 frames: 2, 4, 4, 5 ticks)" },
  blank: { frames: [289, 290], confidence: "high", note: "empty: 289 replaces the pose for the invincibility blink (measured)" },
  hammer: { frames: blocks(291, 7), confidence: "medium", note: "Magic Hammer: raise, slam with shockwave ring" },
  bowShoot: { frames: blocks(319, 4), confidence: "medium" },
  bowWalk: { frames: blocks(335, 3), confidence: "low", note: "bow drawn while walking?" },
  boomerang: { frames: blocks(347, 4), confidence: "medium" },
  hammerBig: { frames: blocks(363, 8), confidence: "low", note: "bigger hammer with a golden shockwave (powered up?)" },
  fireRod: { frames: blocks(395, 6), confidence: "medium", note: "red-tipped rod swing" },
  shovel: { frames: blocks(419, 7), confidence: "medium", note: "dig with sparkle" },
  sit: { frames: run(447, 6), confidence: "low" },
  raiseSwordAlt: { frames: [453], confidence: "low", note: "same as 232" },
  downThrust: { frames: blocks(454, 3), confidence: "low", note: "airborne, sword pointing down: Roc's Feather jump attack?" },
  rodWalk: {
    frames: { right: run(466, 4), left: run(470, 4), down: run(474, 7), up: run(481, 7) },
    confidence: "medium",
    note: "rod held out while walking (Fire Rod stream?)",
  },
  swim: { frames: blocks(488, 4), confidence: "medium" },
  dive: { frames: run(504, 4), confidence: "medium", note: "underwater shadow" },
  swimAlt: { frames: blocks(508, 4), confidence: "low", note: "swimming with a shadow below: surfacing?" },
  swimStroke: { frames: run(524, 24), confidence: "low", note: "body stretched out: swimming strokes or flying" },
  emoteFrontAlt: { frames: run(548, 14), confidence: "low", note: "cutscene poses facing the camera" },
  swingReverse: { frames: blocks(562, 8), confidence: "medium", note: "a swing in the other rotation (right: down to up); use unknown" },
  stab: { frames: blocks(594, 4), confidence: "high", note: "Sword press with the stick neutral: thrust forward; ends on the charge pose (597 = 67)" },
  lunge: { frames: blocks(610, 6), confidence: "high", note: "Sword press from standing with the stick pushed: wide swoosh while dashing forward" },
  swordThrust: { frames: blocks(634, 4), confidence: "medium", note: "stab: pull back, lunge, retract" },
  shock: { frames: blocks(650, 3), confidence: "medium", note: "normal, then 2 skeleton flashes; direction order unsure" },
  emoteShrug: { frames: run(662, 4), confidence: "low" },
  push: { frames: { right: run(666, 4), left: run(670, 4), down: run(674, 7), up: run(681, 7) }, confidence: "medium" },
  lift: { frames: blocks(688, 4), confidence: "high", note: "measured: b ×7, b+1 ×8, b+2 ×8, b+3 ×1 (state 17); the empty lift plays b ×8, b+1 ×13" },
  carry: { frames: { right: run(704, 4), left: run(708, 4), down: run(712, 7), up: run(719, 7) }, confidence: "high", note: "walking with arms up (state 18), 3 ticks per frame, measured" },
  grab: { frames: blocks(726, 4), confidence: "medium", note: "R against a wall (state 26): 730 seen facing left" },
  slingshot: { frames: blocks(742, 4), confidence: "low", note: "blue item stretched forward" },
  slingshotWalk: { frames: blocks(758, 3), confidence: "low" },
  roll: { frames: blocks(770, 6), confidence: "high", note: "measured (state 79): r ×4, r+1 ×4, r+2 ×3, r+3 ×3, r+4 ×3, r+5 ×4" },
  raiseSwordShield: { frames: [794, 795, 796], confidence: "low", note: "794 = 953" },
  swordPedestal: { frames: [797], confidence: "low" },
  ghost: { frames: run(798, 4), confidence: "low", note: "translucent blue Link" },
  throw: { frames: blocks(802, 5), confidence: "high", note: "measured (states 22, 23): t ×7, t+1 ×2, t+2 ×1, t+2, t+3 ×8, t+4 ×4, t+2; the slam (B while carrying, state 21) uses the same frames" },
  misc: { frames: run(822, 4), confidence: "low", note: "front poses, half sunk" },
  eponaSwing: { frames: blocks(826, 3), confidence: "medium", note: "riding Epona, swinging the sword" },
  eponaGallop: { frames: blocks(838, 4), confidence: "medium" },
  eponaMisc: { frames: [854, 855], confidence: "low" },
  inHole: { frames: run(856, 7), confidence: "low", note: "peeking out of a hole" },
  miscAlt: { frames: run(863, 22), confidence: "low", note: "866-873 = 2 frames per facing (Roc's Feather jump?)" },
  panicRun: { frames: blocks(885, 8), confidence: "low", note: "walk cycle with the mouth open (909-916 = walk up)" },
  burningRun: { frames: blocks(917, 8), confidence: "low", note: "same with flames (933-940 = 901-908)" },
  hurt: { frames: run(949, 4), confidence: "low", note: "one pose per facing: right, down, left, up" },
  swordGlow: { frames: run(953, 9), confidence: "low", note: "sword raised, glowing and flaming" },
  drown: { frames: run(962, 11), confidence: "medium" },
  standFront: { frames: [973, 974, 975], confidence: "low" },
  tiny: { frames: [976, 977], confidence: "low" },
  head: { frames: [978, 979, 980], confidence: "low", note: "head only" },
} as const satisfies Record<string, AnimationEntry>;

export const PLAYER_FRAME_COUNT = 981;

// Gameplay tables, measured in Dolphin (docs/measurements.md). `ticks` = how long each frame shows, in 60 Hz ticks.

/** Sword swing (a Sword press while walking): 7 frames per facing over 8 ticks, movement and facing locked. */
export const SWING = {
  frames: PLAYER_ANIMATIONS.swing.frames,
  ticks: [1, 1, 1, 2, 1, 1, 1] as readonly number[],
};

/** Stab (a Sword press with the stick neutral): 4 frames per facing over 8 ticks, movement locked. */
export const STAB = {
  frames: PLAYER_ANIMATIONS.stab.frames,
  ticks: [1, 4, 1, 2] as readonly number[],
};

/** Lunge (a Sword press from standing with the stick pushed): 6 frames over 31 ticks, dashing for the first 10. */
export const LUNGE = {
  frames: PLAYER_ANIMATIONS.lunge.frames,
  ticks: [6, 1, 1, 1, 2, 20] as readonly number[],
  speed: 1024, // 4 px/tick, in 1/256 px, along the facing
  moveTicks: 10,
};

/**
 * Charging: the sword held out, walking at 3/4 speed with the facing locked (forward, backward and sideways use the
 * same frames). The walk cycle is 28 ticks; standing shows the first frame. Frame f + 1 is f with a glowing sword,
 * which the game never shows here (its full-charge flash must be a palette effect; TODO(measure)).
 */
export const CHARGE = {
  stand: { right: 67, left: 75, down: 83, up: 97 } as PerDir<number>,
  walk: {
    right: [67, 69, 71, 73, 67, 69, 71, 73],
    left: [75, 77, 79, 81, 75, 77, 79, 81],
    down: [83, 85, 87, 89, 83, 91, 93, 95],
    up: [97, 99, 101, 103, 97, 105, 107, 109],
  } as PerDir<readonly number[]>,
  walkTicks: [4, 2, 4, 4, 4, 2, 4, 4] as readonly number[],
  glowOffset: 1,
  // A release spins once the button was held for 56 ticks counting the press: 8 attack ticks, then this many
  // charging ticks with the button still held. (After a lunge the count is TODO(measure).)
  fullTicks: 47,
  speed: 288, // 1.125 px/tick, in 1/256 px
  speedDiagonal: 204, // 1.125/√2 = 0.7955 px per axis
};

/** Spin attack on releasing a full charge: 13 frames per facing over 26 ticks, movement locked. */
export const SPIN = {
  frames: PLAYER_ANIMATIONS.spin.frames,
  ticks: [2, 4, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 3] as readonly number[],
};

export type Box = readonly [left: number, top: number, right: number, bottom: number];

/**
 * Sword bounds per frame (inclusive px relative to the sprite anchor): the opaque pixels of the palette-10 parts
 * (blade, hilt, swoosh trail). Generated by tools/render/src/swordboxes.ts (frames 32-59 67-166 594-633); checked by animations.test.ts.
 */
export const SWORD_BOXES: Readonly<Record<number, Box>> = {
  32: [4, -19, 11, -5],
  33: [7, -16, 19, -4],
  34: [8, -15, 25, -3],
  35: [13, -4, 27, 1],
  36: [10, 0, 24, 7],
  37: [2, 1, 14, 13],
  38: [-3, 0, 4, 14],
  39: [-12, -19, -5, -5],
  40: [-20, -16, -8, -4],
  41: [-26, -15, -9, -3],
  42: [-28, -4, -14, 1],
  43: [-25, 0, -11, 7],
  44: [-15, 1, -3, 13],
  45: [-5, 0, 2, 14],
  46: [-18, -3, -4, 4],
  47: [-14, 3, -2, 15],
  48: [-11, 3, 1, 20],
  49: [0, 8, 5, 22],
  50: [5, 6, 12, 20],
  51: [6, 2, 18, 14],
  52: [7, -4, 21, 3],
  53: [2, -11, 16, -4],
  54: [2, -18, 14, -6],
  55: [1, -26, 13, -9],
  56: [-5, -30, 0, -16],
  57: [-12, -26, -5, -12],
  58: [-19, -19, -7, -7],
  59: [-23, -10, -9, -3],
  67: [4, -3, 18, 2],
  68: [4, -4, 19, 3],
  69: [4, -2, 18, 3],
  70: [4, -3, 19, 4],
  71: [4, -2, 18, 3],
  72: [4, -3, 19, 4],
  73: [4, -4, 18, 1],
  74: [4, -5, 19, 2],
  75: [-19, -3, -5, 2],
  76: [-20, -4, -5, 3],
  77: [-19, -2, -5, 3],
  78: [-20, -3, -5, 4],
  79: [-19, -2, -5, 3],
  80: [-20, -3, -5, 4],
  81: [-19, -4, -5, 1],
  82: [-20, -5, -5, 2],
  83: [1, 1, 6, 15],
  84: [0, 1, 7, 16],
  85: [1, 2, 6, 16],
  86: [0, 2, 7, 17],
  87: [1, 3, 6, 17],
  88: [0, 3, 7, 18],
  89: [1, 2, 6, 16],
  90: [0, 2, 7, 17],
  91: [1, 2, 6, 16],
  92: [0, 2, 7, 17],
  93: [1, 3, 6, 17],
  94: [0, 3, 7, 18],
  95: [1, 2, 6, 16],
  96: [0, 2, 7, 17],
  97: [-7, -21, -2, -7],
  98: [-8, -22, -1, -7],
  99: [-7, -22, -2, -8],
  100: [-8, -23, -1, -8],
  101: [-7, -23, -2, -9],
  102: [-8, -24, -1, -9],
  103: [-7, -22, -2, -8],
  104: [-8, -23, -1, -8],
  105: [-7, -22, -2, -8],
  106: [-8, -23, -1, -8],
  107: [-7, -23, -2, -9],
  108: [-8, -24, -1, -9],
  109: [-7, -22, -2, -8],
  110: [-8, -23, -1, -8],
  111: [-23, -3, -9, 2],
  112: [-24, -4, -9, 3],
  113: [-23, -4, -9, 1],
  114: [-24, -5, -9, 2],
  115: [-23, -3, -9, 2],
  116: [-24, -4, -9, 3],
  117: [-23, -2, -9, 3],
  118: [-24, -3, -9, 4],
  119: [8, -3, 22, 2],
  120: [8, -4, 23, 3],
  121: [8, -4, 22, 1],
  122: [8, -5, 23, 2],
  123: [8, -3, 22, 2],
  124: [8, -4, 23, 3],
  125: [8, -2, 22, 3],
  126: [8, -3, 23, 4],
  127: [-1, -26, 4, -12],
  128: [-2, -27, 5, -12],
  129: [-1, -27, 4, -13],
  130: [-2, -28, 5, -13],
  131: [-1, -26, 4, -12],
  132: [-2, -27, 5, -12],
  133: [-1, -25, 4, -11],
  134: [-2, -26, 5, -11],
  135: [-8, 3, -3, 17],
  136: [-9, 3, -2, 18],
  137: [-8, 2, -3, 16],
  138: [-9, 2, -2, 17],
  139: [-8, 3, -3, 17],
  140: [-9, 3, -2, 18],
  141: [-8, 4, -3, 18],
  142: [-9, 4, -2, 19],
  143: [0, -20, 22, -3],
  144: [1, -19, 24, 6],
  145: [0, -4, 19, 19],
  146: [-8, -3, 16, 21],
  147: [-23, -4, -1, 15],
  148: [-25, -11, -2, 12],
  149: [-20, -24, -1, -3],
  150: [-17, -26, 7, -4],
  151: [-22, -3, -8, 4],
  152: [-22, -13, -8, -6],
  153: [-17, -25, 7, -4],
  154: [0, -18, 21, -1],
  155: [9, -9, 23, -2],
  156: [8, -3, 22, 4],
  157: [-8, -3, 16, 19],
  158: [-21, -4, -1, 14],
  159: [-8, -24, -1, -10],
  160: [3, -24, 10, -10],
  161: [1, -19, 24, 6],
  162: [0, -4, 18, 16],
  163: [-4, 3, 3, 17],
  164: [-10, 3, -3, 17],
  165: [-23, -11, -2, 12],
  166: [-19, -22, -1, -3],
  594: [8, -3, 22, 2],
  595: [14, -2, 28, 3],
  596: [5, -3, 19, 2],
  597: [4, -3, 18, 2],
  598: [-23, -3, -9, 2],
  599: [-29, -2, -15, 3],
  600: [-20, -3, -6, 2],
  601: [-19, -3, -5, 2],
  602: [1, 3, 6, 17],
  603: [0, 9, 5, 23],
  604: [1, 2, 6, 16],
  605: [1, 1, 6, 15],
  606: [-7, -22, -2, -8],
  607: [-6, -31, -1, -17],
  608: [-7, -23, -2, -9],
  609: [-7, -21, -2, -7],
  610: [-18, -18, -6, -6],
  611: [-15, -22, 0, -8],
  612: [4, -22, 14, -7],
  613: [14, -16, 28, -1],
  614: [9, -15, 31, 8],
  615: [1, -1, 15, 6],
  616: [5, -18, 17, -6],
  617: [-1, -22, 14, -8],
  618: [-15, -22, -5, -7],
  619: [-29, -16, -15, -1],
  620: [-32, -15, -10, 8],
  621: [-16, -1, -2, 6],
  622: [-8, -25, -1, -11],
  623: [-1, -22, 9, -7],
  624: [3, -16, 17, -1],
  625: [-2, 9, 13, 23],
  626: [-10, 1, 10, 26],
  627: [-6, 5, 1, 19],
  628: [0, 0, 7, 14],
  629: [-10, -5, 0, 10],
  630: [-18, -10, -4, 5],
  631: [-14, -31, 1, -17],
  632: [-11, -33, 9, -12],
  633: [0, -24, 7, -10],
};
