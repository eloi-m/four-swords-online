// The canvas resolution of the full-window renderers: the device's pixel ratio, capped at 2. Phones are at 3 (and
// some at 3.5); drawing pixel art at 2× already looks sharp, and 3× would cost 2.25 times the fill rate.
export const MAX_PIXEL_RATIO = 2;

export function pixelRatio(): number {
  return Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
}
