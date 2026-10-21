// Where FSA places its J3D stage effects (waterfalls, rainbows, room light filters) and its cloud shadows.
// Observed in Dolphin (G4SE01 rev 0, Lake Hylia) by reading the J3DModel base transforms from RAM; see docs/formats/j3d.md
// "J3D models". World units are stage pixels. FSA's TV camera shows a 3D world point (x, y, z) at stage pixel
// (x, y − z) and sorts by y (view matrix [1 0 0 −cx | 0 1 −1 −cy | 0 1 0 −cy−3072], orthographic).
import type { RarcArchive } from "../rarc.ts";
import { decompressYaz0, isYaz0 } from "../yaz0.ts";
import { decodeBti, type DecodedTexture } from "../gx/bti.ts";
import { parseBck, parseBpk, parseBrk, parseBtk, parseBtp, type Bck, type Btk, type Btp, type ColorAnimation } from "../j3d/anim.ts";
import { parseBmd, type Bmd } from "../j3d/bmd.ts";
import { actorPixel } from "./actors.ts";
import type { Stage } from "./stage.ts";

export const ROOM_PX_W = 512;
export const ROOM_PX_H = 384;

/** A J3D model with the animations stored next to it (same stem). */
export interface J3dResource {
  name: string;
  bmd: Bmd;
  btk: Btk[];
  brk: ColorAnimation[];
  bpk: ColorAnimation[];
  bck?: Bck;
  btp?: Btp;
}

function unwrap(data: Uint8Array): Uint8Array {
  return isYaz0(data) ? decompressYaz0(data) : data;
}

/** Loads `j3d/<stem>.bmd` and its `.btk/.brk/.bpk/.bck/.btp` from an archive (file names are case-insensitive). */
export function loadJ3dResource(archive: RarcArchive, stem: string): J3dResource | null {
  const find = (ext: string) => archive.files.find((f) => f.path.toLowerCase() === `j3d/${stem.toLowerCase()}.${ext}`);
  const bmd = find("bmd");
  if (!bmd) return null;
  const read = <T>(ext: string, parse: (b: Uint8Array) => T): T | undefined => {
    const f = find(ext);
    return f ? parse(unwrap(f.data)) : undefined;
  };
  const list = <T>(v: T | undefined) => (v ? [v] : []);
  return {
    name: stem,
    bmd: parseBmd(unwrap(bmd.data)),
    btk: list(read("btk", parseBtk)),
    brk: list(read("brk", parseBrk)),
    bpk: list(read("bpk", parseBpk)),
    bck: read("bck", parseBck),
    btp: read("btp", parseBtp),
  };
}

/** A model placed the way the game places it (J3DModel base scale, rotation and translation). */
export interface EffectPlacement {
  /** Model stem in the stage archive's `j3d/` folder. */
  model: string;
  /** Room of the actor that spawns it. */
  room: number;
  translation: [number, number, number];
  /** "identity", or "swapYZ": model X/Z/Y → world X/Y/Z (the room filters lay the model's XZ plane on the map). */
  rotation: "identity" | "swapYZ";
  scale: [number, number, number];
  /** How the game orders it against the tile layers (FSA sorts by world y; this is our 2D approximation). */
  layer: "belowTop" | "aboveTop" | "filter";
  status: "confirmed" | "hypothesis";
  /**
   * Other rooms whose SEV2 makes the same model at the same spot (Lake Hylia room 6's makes room 7's waterfall, one room
   * up): the game draws a room's effects from its own actors, so a room shows the effects whose `room` or `also` it is.
   */
  also?: number[];
}

/** J3D models of waterfalls are authored at 1/10.24 scale; the game mirrors Z so the model's +Z points down the map. */
const WATERFALL_SCALE: [number, number, number] = [10.24, 10.24, -10.24];

/**
 * Effect placements of a stage, from its `SEV2` ("environment control 2") actors. Parameter bits (high byte and
 * bit 18) pick the effect; bit 0 set means the effect's origin is one room above the actor.
 *   0x04xxxxxx: taki_a (waterfall) at the origin, niji_a (rainbow) at the same stage pixel, 2048 higher.
 *   0x02xxxxxx: taki_b (waterfall with its own rainbow), 1024 higher.
 *   0x00040000: morninglight00 (light shafts), a room filter centred on the actor's 512×512 room.
 * Confirmed for Lake Hylia (boss010 rooms 0, 6, 7, 58) from RAM; other stages use the same actor, so the same rules
 * are applied to them as a hypothesis.
 */
export function stageEffectPlacements(stage: Stage): EffectPlacement[] {
  const confirmed = stage.index === 10;
  const status = confirmed ? "confirmed" : "hypothesis";
  const models = new Set(stage.archive.files.filter((f) => f.path.startsWith("j3d/") && f.path.endsWith(".bmd")).map((f) => f.path.slice(4, -4).toLowerCase()));
  const out: EffectPlacement[] = [];
  const seen = new Map<string, EffectPlacement>();
  const add = (p: EffectPlacement) => {
    const key = `${p.model}@${p.translation.join(",")}`;
    if (!models.has(p.model)) return;
    const kept = seen.get(key);
    if (kept) {
      if (kept.room !== p.room && !kept.also?.includes(p.room)) (kept.also ??= []).push(p.room);
      return;
    }
    seen.set(key, p);
    out.push(p);
  };
  stage.layout.rooms.forEach((row, cy) =>
    row.forEach((room, cx) => {
      if (room === null) return;
      for (const actor of stage.actors(room)) {
        if (actor.id !== "SEV2" || actor.sublayer !== 0) continue;
        const px = actorPixel(actor);
        const x = cx * ROOM_PX_W + px.x, y = cy * ROOM_PX_H + px.y - (actor.params & 1 ? ROOM_PX_H : 0);
        const kind = actor.params >>> 24;
        if (kind & 0x04) {
          add({ model: "taki_a", room, translation: [x, y, 0], rotation: "identity", scale: WATERFALL_SCALE, layer: "belowTop", status });
          add({ model: "niji_a", room, translation: [x, y + 2048, 2048], rotation: "identity", scale: WATERFALL_SCALE, layer: "aboveTop", status });
        }
        if (kind & 0x02)
          add({ model: "taki_b", room, translation: [x, y + 1024, 1024], rotation: "identity", scale: WATERFALL_SCALE, layer: "belowTop", status });
        if (actor.params & 0x40000) {
          const rx = cx * ROOM_PX_W + 256, ry = cy * ROOM_PX_H + 256;
          add({ model: "morninglight00", room, translation: [rx, ry + 1536, 1536], rotation: "swapYZ", scale: [10, 1, 10], layer: "filter", status });
        }
      }
    }),
  );
  return out;
}

/**
 * Cloud shadows: `data.arc` `timg/kumo_env.bti` (128×128 I4 cloud shapes) drawn by the environment manager as a
 * full-screen quad over the tile layers (main.dol 0x8016AE24, G4SE01 rev 0): TEV color black with alpha = the manager's
 * byte +0x1EC times the texture intensity, texture coordinates s = x / 512 − f / 2048, t = y / 384 − f / 2048 at world
 * pixel (x, y) (f = the manager's frame counter & 0x7FF, +1 per frame): one repeat per room, drifting down-right. A
 * room's `SWEV` with param bit 21 fades +0x1EC to 47 (× a brightness byte, 255 in Lake Hylia; SWEV init 0x802B5518).
 * The strength fitted on Dolphin frames is 0.185 ≈ 47 / 255.
 */
export const CLOUD_SHADOWS = {
  /** World pixels per texture repeat, x and y. */
  period: [512, 384] as [number, number],
  /** Texture repeats per frame (subtracted from s and t); the counter wraps every `wrap` frames. */
  drift: 1 / 2048,
  wrap: 2048,
  alpha: 47 / 255,
} as const;

/** SWEV param bit 21: the room shows cloud shadows (main.dol; seen in Lake Hylia). */
export const SWEV_CLOUD_SHADOWS = 1 << 21;

export function loadCloudTexture(data: RarcArchive): DecodedTexture | null {
  const file = data.files.find((f) => f.path === "timg/kumo_env.bti");
  return file ? decodeBti(unwrap(file.data)) : null;
}

/** Rooms of a stage whose `SWEV` turns cloud shadows on. */
export function cloudShadowRooms(stage: Stage): number[] {
  return stage.roomNumbers.filter((room) => stage.actors(room).some((a) => a.id === "SWEV" && (a.params & SWEV_CLOUD_SHADOWS) !== 0));
}

/** Whether any room of the stage shows cloud shadows. */
export function hasCloudShadows(stage: Stage): boolean {
  return cloudShadowRooms(stage).length > 0;
}

/**
 * Environment models the environment manager draws around the camera (main.dol 0x8016A7DC): the model's XZ plane is
 * laid on the map (rotation swapYZ), scaled (s, 1, s), and follows the camera with a parallax p: on each axis the
 * origin is c·(1 − p) + 512·trunc(c·p / 512) + 256 for camera center c (snapped in 512-px steps so the 1024-px model
 * always covers the screen), 1536 higher (depth +1: in front of everything) or lower (depth −1: behind the tiles).
 */
export interface EnvModel {
  /** Model stem, and the archive whose j3d/ folder holds it. */
  model: string;
  source: "stage" | "data";
  parallax: number;
  depth: 1 | -1;
  scale: number;
}

/** The environment models of the Shadow Battle arenas (manager flags set by SWEV bit 18 and SEV2 bit 17). */
export const ENV_MODELS = {
  /** Tower of Flames lava (manager +0x04, flag +0x1C4): behind the tiles, at half the camera speed. */
  yougan: { model: "yougan", source: "data", parallax: 0.5, depth: -1, scale: 10.24 },
  /** Above the Clouds drifting clouds (+0xCC, flag +0x1DC): in front of everything, at 1.5× the camera speed. */
  nagarekumo: { model: "nagarekumo", source: "stage", parallax: 1.5, depth: 1, scale: 1 },
} as const satisfies Record<string, EnvModel>;

/** J3D base transform of an environment model for the camera center (cx, cy) in world pixels. */
export function envModelPlacement(env: EnvModel, cx: number, cy: number): Pick<EffectPlacement, "translation" | "rotation" | "scale"> {
  const follow = (c: number) => c * (1 - env.parallax) + 512 * Math.trunc((c * env.parallax) / 512) + 256;
  const z = 1536 * env.depth;
  return { translation: [follow(cx), follow(cy) + z, z], rotation: "swapYZ", scale: [env.scale, 1, env.scale] };
}
