// Animated background tiles. The game's BG animator runs once per frame and, when its timers expire, copies a
// frame of `sch/bg_anim_b_sch.bin` (water, every tileset) and of `sch/bg_anim_sch.bin` (a few tilesets) over parts
// of the char sheet. Frame slices, destinations and timings were observed in Dolphin (texture and frame dumps of
// boss010, tileset m) and read from the animator in main.dol; see docs/formats/stages-and-tiles.md "Animated tiles".
import type { RarcArchive } from "../rarc.ts";
import { decompressYaz0, isYaz0 } from "../yaz0.ts";
import { tilesetId } from "./bg.ts";

export interface CharAnimation {
  dest: number; // byte offset in the char sheet
  frames: Uint8Array[]; // 4bpp data copied to `dest`, all the same size
  first: number; // tick of the first copy, which shows frame 1
  period: number; // ticks between copies
}

interface Slice {
  file: string;
  offset: number; // frame f is at offset + f * size in the file
  size: number;
  count: number;
  dest: number;
  period: number;
}

const WATER = "sch/bg_anim_b_sch.bin";
const EXTRA = "sch/bg_anim_sch.bin";
const FIRST_COPY = 10; // every timer starts at 10 frames

function slices(index: number): Slice[] {
  // Water: 8 frames of 64 parts (0x1C0-0x1FF), 10 ticks each; tileset q uses the second half of the file.
  const list: Slice[] = [{ file: WATER, offset: index === 16 ? 0x4000 : 0, size: 0x800, count: 8, dest: 0x3800, period: 10 }];
  const id = tilesetId(index);
  if (id === "l") list.push({ file: EXTRA, offset: 0x2000, size: 0x400, count: 8, dest: 0x5800, period: 20 });
  else if (id === "s" || id === "w") list.push({ file: EXTRA, offset: 0x6000, size: 0x400, count: 8, dest: 0x1c00, period: 10 });
  else if (id === "k" || id === "v") list.push({ file: EXTRA, offset: 0x1000, size: 0x400, count: 4, dest: 0x5c00, period: 10 });
  else if (id === "y" || id === "1b") list.push({ file: EXTRA, offset: 0x4000, size: 0x800, count: 4, dest: 0x5800, period: 10 });
  return list;
}

/** The char sheet animations of a tileset (index 0-27), with their frames read from data.arc. */
export function loadCharAnimations(data: RarcArchive, tilesetIndex: number): CharAnimation[] {
  return slices(tilesetIndex).flatMap((s) => {
    const found = data.files.find((f) => f.path === s.file);
    if (!found) return [];
    const bytes = isYaz0(found.data) ? decompressYaz0(found.data) : found.data;
    const frames = Array.from({ length: s.count }, (_, f) => bytes.subarray(s.offset + f * s.size, s.offset + (f + 1) * s.size));
    return [{ dest: s.dest, frames, first: FIRST_COPY, period: s.period }];
  });
}

/** Frame shown at a tick (60 Hz frames since the stage started), or -1 before the first copy (the tileset's own data). */
export function charAnimationFrame(animation: CharAnimation, tick: number): number {
  if (tick < animation.first) return -1;
  return (1 + Math.floor((tick - animation.first) / animation.period)) % animation.frames.length;
}

/** The char sheet as it is at `tick`: a copy of `chars` with the current animation frames applied. */
export function animateChars(chars: Uint8Array, animations: CharAnimation[], tick: number): Uint8Array {
  const out = new Uint8Array(chars);
  for (const animation of animations) {
    const frame = charAnimationFrame(animation, tick);
    if (frame >= 0) out.set(animation.frames[frame]!, animation.dest);
  }
  return out;
}
