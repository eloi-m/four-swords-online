// Ground overlay ("filter"): a 128×128 I4 texture from data.arc `timg/filter<N>.bti`, where N is the map layout's
// overlayTextureId (0 = none). It is world-anchored with 1 texel per room pixel, and it multiplies the tile colors by
// its intensity (BASE + GAIN × intensity with BASE 0, GAIN 1): the BG drawer's TEV multiplies by the texture (main.dol
// 0x802F745C family), and in Dolphin a filter poked to all 0 turns the tiles black while all 0xF gives the exact palette
// colors. Sprites don't get it. (An earlier fit against a Dolphin frame, 0.318 + 0.542 × intensity, was absorbing the
// cloud shadows that the environment manager draws over the ground: see docs/formats.md.)
import type { RarcArchive } from "../rarc.ts";
import { decompressYaz0, isYaz0 } from "../yaz0.ts";
import { decodeBti, type DecodedTexture } from "../gx/bti.ts";
import type { RgbaImage } from "./bg.ts";

export const OVERLAY_SIZE = 128;
export const OVERLAY_BASE = 0;
export const OVERLAY_GAIN = 1;

export function loadOverlay(data: RarcArchive, overlayTextureId: number): DecodedTexture | null {
  if (overlayTextureId <= 0) return null;
  const file = data.files.find((f) => f.path === `timg/filter${overlayTextureId}.bti`);
  if (!file) return null;
  return decodeBti(isYaz0(file.data) ? decompressYaz0(file.data) : file.data);
}

/** Applies the overlay to a room image drawn with its top-left at room pixel (0, 0). */
export function applyOverlay(image: RgbaImage, overlay: DecodedTexture): void {
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const i = (y * image.width + x) * 4;
      const f = overlay.data[((y % OVERLAY_SIZE) * overlay.width + (x % OVERLAY_SIZE)) * 4]! / 255;
      const k = OVERLAY_BASE + OVERLAY_GAIN * f;
      image.data[i] = Math.round(image.data[i]! * k);
      image.data[i + 1] = Math.round(image.data[i + 1]! * k);
      image.data[i + 2] = Math.round(image.data[i + 2]! * k);
    }
  }
}
