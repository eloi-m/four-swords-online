// Making a drawn frame opaque. The frame buffer's alpha is only the frame's own (as on the GameCube, where the TV shows
// the colors alone): J3D models such as the Tower of Flames' lava write 0 there and the JPA particles keep what's under
// them (GX blends color only), but the browser composites the canvas with the page by that alpha. Chrome happens to
// show such pixels; WebKit shows the page behind them instead (the fire pit's flame vanished over its hole in Safari).
import type * as THREE from "three";

/** Rewrites the canvas's alpha channel to 1, leaving three.js's cached state as it was (color mask on, clear color black). */
export function opaqueFrame(r: THREE.WebGLRenderer): void {
  const gl = r.getContext();
  gl.colorMask(false, false, false, true);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.colorMask(true, true, true, true);
}
