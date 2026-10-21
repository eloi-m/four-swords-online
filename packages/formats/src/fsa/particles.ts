// How FSA places the JPA particle effects it spawns (data.arc's particle.jpc, parsed by jpa/jpa.ts), read from main.dol
// (G4SE01 rev 0) with tools/dol; docs/formats/jpa.md "JPA particles" has the addresses and which actor spawns what.
// - Actors call createEffect (0x8013CC50: screen, &pos, id, layer, sublayer, emitter callback, particle callback,
//   lift, f1 = scale). Nothing is made for a scale ≤ 0 or on a GBA screen (those spawn sprite actors instead).
// - The layer pushes the effect in front: y and z both grow by 1024 × layer + 128 × sublayer (the TV shows (x, y − z)
//   and sorts by y), and "lift" moves an effect above the ground (z > 0) to the next layer when it's below 1. z also
//   gets the stage's ground height (0x802F5E9C, flat in the arenas).
// - The id picks a draw group (a range switch); groups 0, 1, 3, 7 and 9 get the matrix [[s,0,0],[0,0,ks],[0,ks,0]]
//   (k = 0.707107): the emitter's rotation swaps Y and Z (JPA's up becomes FSA's z, up the screen) and its dynamics are
//   scaled (s, ks, ks) (confirmed in RAM: the fire-pit jets' emitters hold (1, 0.707, 0.707)); groups 2, 4, 5, 8 and
//   10 keep no rotation and scale (s, s, s). Particles are scaled (s, s) either way. Group 255
//   queues the position for a resident emitter (837–860 and 1357, made once with no rotation and scale 1) that creates
//   that frame's particles at every queued spot.
// - A resource whose BEM1 user flags have bit 1 draws in group 1 (after a copy of the frame: the screen-distortion
//   effects 1346–1365).
// - Actors move an effect each frame with 0x8013CB44 (same layer rule, translation only) and some turn it with
//   0x800EF008 (X, Y, Z angles in 1/65536 of a turn, R = Rz·Ry·Rx), replacing the swap.

/** createEffect's draw group of an effect id (255 = queued to a resident emitter). */
export function fsaParticleGroup(id: number): number {
  if (id < 948) {
    if (id === 618) return 7;
    if (id > 618) {
      if (id >= 837) {
        if (id === 901) return 9;
        if (id > 901) return id >= 935 ? 7 : 0;
        return id >= 861 ? 0 : 255;
      }
      if (id === 680) return 3;
      if (id > 680 || id >= 638) return 0;
      return id >= 631 ? 7 : 0;
    }
    if (id >= 398) {
      if (id === 577) return 4;
      if (id > 577 || id >= 509) return 0;
      return id >= 476 ? 10 : 0;
    }
    if (id >= 295) return id >= 392 ? 3 : id >= 300 ? 0 : 3;
    if (id >= 234) return 0;
    return id >= 216 ? 10 : 0;
  }
  if (id >= 1347) {
    if (id >= 1368) {
      if (id >= 1385) return id >= 1394 ? 0 : 2;
      if (id >= 1382) return 8;
      return id >= 1375 ? 0 : 2;
    }
    if (id === 1356) return 0;
    if (id > 1356) return id >= 1358 ? 0 : 255;
    if (id >= 1355) return 5;
    return id >= 1349 ? 0 : 5;
  }
  if (id >= 1174) {
    if (id >= 1248) return id >= 1250 ? 0 : 3;
    if (id >= 1234) return 0;
    return id >= 1231 ? 4 : 0;
  }
  if (id >= 1004) {
    if (id >= 1166) return 2;
    return id >= 1012 ? 0 : 10;
  }
  return id === 989 ? 4 : 0;
}

/** The depth axes' share of the scale in the rotated groups (cos 45°: the TV looks down at 45°). */
const DEPTH_SCALE = 0.707107;
/** Groups whose emitters keep no rotation and an even scale. */
const UNROTATED_GROUPS: ReadonlySet<number> = new Set([2, 4, 5, 8, 10]);

/** The effects drawn by resident emitters from queued positions (createEffect's group 255). */
export const FSA_QUEUED_PARTICLES: readonly number[] = [...Array.from({ length: 24 }, (_, i) => 837 + i), 1357];

/** Euler angles in 1/65536 of a turn, applied X, then Y, then Z. */
export type FsaAngles = [number, number, number];

export interface FsaParticlePlacement {
  id: number;
  group: number;
  /** World position, the layer's depth offset included. */
  translation: [number, number, number];
  /** The emitter's rotation: "swapYZ" (JPA's Y-up into FSA's Z-up), "none", or angles an actor set. */
  rotation: "swapYZ" | "none" | FsaAngles;
  dynamicsScale: [number, number, number];
  particleScale: [number, number];
  /** Made by a resident emitter at a queued position (no rotation, scale 1). */
  queued: boolean;
}

export interface FsaEffectOptions {
  layer?: number;
  sublayer?: number;
  /** Move an effect above the ground (z > 0) to the next layer. */
  lift?: boolean;
  scale?: number;
  /** The stage's ground height under the effect (0 in the arenas). */
  groundHeight?: number;
  /** The resource's BEM1 user flags (bit 1: draw group 1). */
  userFlags?: number;
}

/** The layer offset createEffect and 0x8013CB44 add to y and z. */
export function fsaLayerOffset(z: number, layer = 0, sublayer = 0, lift = true): number {
  if (lift && z > 0 && layer < 1) {
    layer++;
    sublayer--;
  }
  return layer * 1024 + sublayer * 128;
}

/** Where createEffect puts effect `id` spawned at world (x, y, z), or null when it makes nothing (scale ≤ 0). */
export function fsaParticlePlacement(id: number, x: number, y: number, z: number, options: FsaEffectOptions = {}): FsaParticlePlacement | null {
  const s = options.scale ?? 1;
  if (!(s > 0)) return null;
  const offset = fsaLayerOffset(z, options.layer, options.sublayer, options.lift ?? true);
  const translation: [number, number, number] = [x, y + offset, z + (options.groundHeight ?? 0) + offset];
  let group = fsaParticleGroup(id);
  if (group === 255) return { id, group, translation, rotation: "none", dynamicsScale: [1, 1, 1], particleScale: [1, 1], queued: true };
  if ((options.userFlags ?? 0) & 2 && group !== 5) group = 1;
  const flat = UNROTATED_GROUPS.has(group);
  return {
    id,
    group,
    translation,
    rotation: flat ? "none" : "swapYZ",
    dynamicsScale: flat ? [s, s, s] : [s, DEPTH_SCALE * s, DEPTH_SCALE * s],
    particleScale: [s, s],
    queued: false,
  };
}

// #region What actors spawn (main.dol, docs/formats/jpa.md "JPA particles")

/** An effect an actor spawns, relative to the actor: the ids and createEffect's arguments its code passes. */
export interface FsaActorParticle {
  id: number;
  dx: number;
  dy: number;
  layer: number;
  sublayer: number;
  scale: number;
  /** The turn the actor gives the emitter after creating it, if any. */
  rotation?: FsaAngles;
}

/**
 * FLME fire-pit jets (0x8015DF7C): from FLME's spot + 3 px along the direction (table 0x804A0310; none downward),
 * turned along it (0x800EF008 with X 90° when it points down, Y from table 0x80466110, Z 180°), scale 1 + half the
 * size class ((params >> 18) & 3), layer 1 sublayer 1 (confirmed in RAM: the four emitters at a round's start). While out it burns 428 (594 with params bit 20); when it goes out
 * that stops and 429 (595) takes over; before it ever came out, 430 (595).
 */
export function fsaJetParticle(params: number, state: "idle" | "on" | "out"): FsaActorParticle {
  const dir = (params >>> 16) & 3, big = ((params >>> 20) & 1) === 1;
  const id = big ? (state === "on" ? 594 : 595) : state === "on" ? 428 : state === "out" ? 429 : 430;
  const [dx, dy] = ([[3, 0], [-3, 0], [0, 0], [0, -3]] as const)[dir]!;
  const rotation: FsaAngles = [dir === 2 ? 0x4000 : 0, [0xc000, 0x4000, 0x8000, 0][dir]!, 0x8000];
  return { id, dx, dy, layer: 1, sublayer: 1, scale: 1 + 0.5 * ((params >>> 18) & 3), rotation };
}

/**
 * FBOB, a fire bar's fireball (init 0x801BDA40, moved by FBMR 0x801BD8C0): 414 (its flame) and 412 (sparks), layer 0,
 * scale 1; the flame is turned by Y 0x8000 − the arm's heading, so it trails behind. In the game's angles a ball sits
 * at (sin a, cos a) × its ring's radius and heads a ± 0x4000 as the arm turns forward or back (`speed`'s sign).
 */
export function fsaFireballParticles(angle: number, speed: number): FsaActorParticle[] {
  const heading = (angle + (speed < 0 ? -0x4000 : 0x4000)) & 0xffff;
  return [
    { id: 414, dx: 0, dy: 0, layer: 0, sublayer: 0, scale: 1, rotation: [0, (0x8000 - heading) & 0xffff, 0] },
    { id: 412, dx: 0, dy: 0, layer: 0, sublayer: 0, scale: 1 },
  ];
}

/**
 * PRTC's effects by its kind (params & 0xFF; its init 0x802E111C, a jump table at 0x804A9B40): kind 0, a waterfall's
 * foot, makes 392, 393 and 394 (confirmed in RAM: Lake Hylia room 6's, at its spot, layer 1); kind 2 the ripple 1362
 * (a screen distortion). 169 and 136 go on layer −1, the rest on layer 1 (kind 9's on layer 0 when 0x802DEBA0 says so:
 * not read).
 */
const PRTC_EFFECTS: readonly (readonly number[])[] = [[392, 393, 394], [395, 396, 397], [1362], [382], [383], [384], [110], [169, 170], [111], [389, 390, 391], [136, 137]];

/** WARP's style (params & 0x7F) whose init (0x80228B60) makes the whirlpool's effects: 1363 and 1262. */
const WARP_WHIRLPOOL = 0x0e;

/**
 * The effects an actor keeps up while it rests, as the viewer shows a stage (the battle drives the moving ones from
 * its simulation): PRTC's (PRTC_EFFECTS: a waterfall's foot is kind 0's spray 392–394, layer 1), a lit TRCH torch
 * (189) or BLZ2 eternal flame (844 and 845, queued), FLME's resting flames (kinds 4 and 5: 62, 59 under the actor, 60
 * and 61 over it; the jets: fsaJetParticle), FBMR's fireballs where its arm starts (fsaFireballParticles), SVGT's glow
 * at a side-view gate (1095 and 1096, layer -1: its init 0x803524D0, nothing else), a whirlpool (WARP style 0x0E):
 * its swirl 1363 (layer 0, sublayer −1) and sparkles 1262 at its middle. With them the screen-distortion effects
 * (drawn from a copy of the frame: JpaRenderer.distortion): the whirlpool's swirl 1363, PRTC kind 2's ripple 1362, the
 * torch's haze 1354 and the eternal flame's 1357 (queued, layer 1). `pixel` is the actor's spot in its room (WARP's
 * middle depends on it; a multiple of 8 when left out).
 */
export function fsaActorParticles(actor: string, params: number, pixel?: { x: number; y: number }): FsaActorParticle[] {
  const at = (id: number, layer = 0, sublayer = 0, scale = 1): FsaActorParticle => ({ id, dx: 0, dy: 0, layer, sublayer, scale });
  switch (actor) {
    case "PRTC": {
      // Params bits 20-23 set: none at init (its update 0x802E0AB8 makes the same later: not modelled). Bits 11 / 10 /
      // 9 / 8 move them a room right / left / down / up (+0x244, +0x248).
      if ((params >>> 20) & 0xf) return [];
      const dx = (params & 0x800 ? 512 : 0) - (params & 0x400 ? 512 : 0), dy = (params & 0x200 ? 384 : 0) - (params & 0x100 ? 384 : 0);
      return (PRTC_EFFECTS[params & 0xff] ?? []).map((id) => ({ ...at(id, id === 169 || id === 136 ? -1 : 1), dx, dy }));
    }
    case "WARP": {
      // The init moves a WARP to the next multiple of 8 on each axis (x + 8 − x mod 8: its box's middle; not for
      // params bit 7 or styles 11, 30-32), then for style 0x0E makes 1363 (layer 0, sublayer −1, lift) and 1262 (layer
      // 0, lift), scale 1, at that spot (confirmed in RAM: Lake Hylia room 6's (416, 224) has them at (424, 232), 1363
      // 128 px up and back; a Dolphin frame shows the blue swirl and the sparkles there). Style 37 makes them too, 1363
      // on layer −1 (no WARP has it in World 1). Only the destructor deletes them: they stay while the room is loaded.
      const style = params & 0x7f;
      if (style !== WARP_WHIRLPOOL && style !== 37) return [];
      const middle = (v: number) => 8 - (Math.trunc(v) % 8);
      const dx = middle(pixel?.x ?? 0), dy = middle(pixel?.y ?? 0);
      return [
        { ...at(1363, style === 37 ? -1 : 0, -1), dx, dy },
        { ...at(1262), dx, dy },
      ];
    }
    case "TRCH":
      // (1354: the heat haze over the flame, a screen distortion; its layer read as the flame's.)
      return [at(189), at(1354)];
    case "BLZ2":
      return [at(844), at(845), at(1357, 1)];
    case "SVGT":
      return [at(1095, -1), at(1096, -1)];
    case "FLME": {
      const kind = params & 0xff;
      if (kind === 4 || kind === 5) {
        const s = kind === 5 ? 1 : 0.33;
        return [at(62, 0, -1, s), at(59, 0, -1, s), at(60, 1, 1, s), at(61, 1, 1, s)];
      }
      return [fsaJetParticle(params, "idle")];
    }
    case "FBMR": {
      // Arms start right, left, down, up (0x8053F800); balls (params & 0xFF) 16 px apart from ring ((params >> 20) & 15) + 1.
      const arm = Math.min(3, (params >>> 8) & 0xff), a = [0x4000, 0xc000, 0, 0x8000][arm]!;
      const count = Math.max(1, Math.min(16, params & 0xff)), first = ((params >>> 20) & 15) + 1;
      // The game turns it backward (negative speed) unless bit 16 is set (hazards.ts firebarSpeed has the sim's side).
      const speed = (params >>> 16) & 1 ? 1 : -1;
      return Array.from({ length: count }, (_, k) => {
        const r = (first + k) * 16;
        const dx = Math.round(Math.sin((a * Math.PI) / 0x8000) * r), dy = Math.round(Math.cos((a * Math.PI) / 0x8000) * r);
        return fsaFireballParticles(a, speed).map((p) => ({ ...p, dx, dy }));
      }).flat();
    }
    default:
      return [];
  }
}
// #endregion

/** 0x8013CB44: an effect moved to world (x, y, z) (the translation only, with the layer rule). */
export function fsaMoveParticle(p: FsaParticlePlacement, x: number, y: number, z: number, layer = 0, sublayer = 0, lift = true, groundHeight = 0): FsaParticlePlacement {
  const offset = fsaLayerOffset(z, layer, sublayer, lift);
  return { ...p, translation: [x, y + offset, z + groundHeight + offset] };
}
