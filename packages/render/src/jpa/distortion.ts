// The screen-distortion effects' pass (heat haze, ripples: JpaRenderer.distortion, docs/formats/jpa.md "JPA particles"):
// the game draws them after copying the frame (draw group 1, and group 5's screen-space ones); so does this, right after
// the scene they distort, only while one shows.
import * as THREE from "three";
import type { JpaRenderer } from "./draw.ts";

/** A JpaRenderer's distortion meshes and the camera they're drawn through (the scene's, or a screen one for group 5). */
export interface DistortionLayer {
  jpa: JpaRenderer;
  camera: THREE.Camera;
}

export class DistortionPass {
  private copy: THREE.FramebufferTexture | null = null;

  /**
   * Copies the frame (at `x`, `y` from the drawing buffer's bottom left, `w` × `h` device px) and draws each layer's
   * distortion meshes over it, all sampling that one copy. Nothing when none shows.
   */
  draw(renderer: THREE.WebGLRenderer, layers: readonly DistortionLayer[], x: number, y: number, w: number, h: number): void {
    const shown = layers.filter((l) => l.jpa.distorting);
    if (!shown.length) return;
    x = Math.round(x);
    y = Math.round(y);
    w = Math.max(1, Math.round(w));
    h = Math.max(1, Math.round(h));
    if (!this.copy || this.copy.image.width !== w || this.copy.image.height !== h) {
      this.copy?.dispose();
      this.copy = new THREE.FramebufferTexture(w, h);
    }
    renderer.copyFramebufferToTexture(this.copy, new THREE.Vector2(x, y));
    for (const { jpa, camera } of shown) {
      jpa.frame.uFrame.value = this.copy;
      jpa.frame.uViewport.value.set(x, y, w, h);
      renderer.render(jpa.distortion, camera);
    }
  }

  dispose(): void {
    this.copy?.dispose();
    this.copy = null;
  }
}
