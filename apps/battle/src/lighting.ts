// Draws an arena's lighting (lights.ts) the way main.dol's light pass does. The GameCube gathers light in the frame
// buffer's alpha, which starts at 0 and which only the Links' sprites write (255): light circles are added to it
// (0x80158B5C: blend ONE + ONE, alpha writes only, circle.bti's red channel through a swap table times the source's
// strength), then 0x80158F70 adds the ambient level, multiplies the frame by the tint (adding the tint times its
// alpha: blend src·srcA + dst·src), then by that alpha. So the Links are tinted but never darkened, and neither is
// anything drawn over them afterwards. Here the light goes into a buffer of the viewport's size: the circles, then the
// Links' silhouettes at full strength; then one full-screen pass turns the frame into
// (frame + tint alpha) × tint × min(1, light + ambient / 255).
import { decodeBti, type RarcArchive } from "@fso/formats";
import * as THREE from "three";
import type { LightSource, RoomLight } from "./lights.ts";

const CIRCLE_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv * 2.0 - 1.0; // the game's texture coordinates run -1 … 1 over the quad, the texture mirrored around its corner
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const CIRCLE_FRAGMENT = /* glsl */ `
  uniform sampler2D uCircle;
  uniform float uAlpha;
  varying vec2 vUv;
  void main() {
    float a = texture2D(uCircle, vUv).r * uAlpha;
    gl_FragColor = vec4(a, a, a, 1.0);
  }
`;

const SILHOUETTE_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Where the sprite is drawn (the same alpha test as packages/render sprites.ts), full light.
const SILHOUETTE_FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  varying vec2 vUv;
  void main() {
    if (texture2D(uMap, vUv).a < 0.5) discard;
    gl_FragColor = vec4(1.0);
  }
`;

const SHADE_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const SHADE_FRAGMENT = /* glsl */ `
  uniform sampler2D uLight;
  uniform vec3 uTint;
  uniform float uTintAlpha;
  uniform float uAmbient;
  varying vec2 vUv;
  void main() {
    float light = min(texture2D(uLight, vUv).r + uAmbient, 1.0);
    gl_FragColor = vec4(uTint * light, uTintAlpha);
  }
`;

const additive = { blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation } as const;

export class Lighting {
  private readonly circle: THREE.DataTexture | null;
  private readonly lights = new THREE.Scene();
  private readonly pool: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>[] = [];
  private readonly silhouettes = new Map<THREE.Mesh, THREE.Mesh>();
  private readonly shadeScene = new THREE.Scene();
  private readonly shade: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly flat = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
  private target: THREE.WebGLRenderTarget | null = null;
  private light: RoomLight | null = null;
  /** Light sources drawn in the last frame (for tests). */
  drawn = 0;

  constructor(data: RarcArchive) {
    const file = data.files.find((f) => f.path.toLowerCase() === "timg/circle.bti");
    if (file) {
      const image = decodeBti(file.data);
      this.circle = new THREE.DataTexture(image.data, image.width, image.height, THREE.RGBAFormat);
      this.circle.wrapS = this.circle.wrapT = THREE.MirroredRepeatWrapping; // the BTI's wrap mode 2
      this.circle.magFilter = this.circle.minFilter = THREE.LinearFilter;
      this.circle.needsUpdate = true;
    } else this.circle = null;
    this.shade = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        vertexShader: SHADE_VERTEX,
        fragmentShader: SHADE_FRAGMENT,
        uniforms: { uLight: { value: null }, uTint: { value: new THREE.Vector3(1, 1, 1) }, uTintAlpha: { value: 0 }, uAmbient: { value: 1 } },
        // src × srcA + dst × src: the frame times tint × light, plus tint × light × the tint's alpha; the frame's alpha stays.
        blending: THREE.CustomBlending,
        blendSrc: THREE.SrcAlphaFactor,
        blendDst: THREE.SrcColorFactor,
        blendEquation: THREE.AddEquation,
        blendSrcAlpha: THREE.ZeroFactor,
        blendDstAlpha: THREE.OneFactor,
        blendEquationAlpha: THREE.AddEquation,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.shade.frustumCulled = false;
    this.shadeScene.add(this.shade);
  }

  /** The room's light (null: full light, nothing is drawn). */
  show(light: RoomLight | null): void {
    this.light = light;
    const u = this.shade.material.uniforms;
    if (light) {
      (u.uTint!.value as THREE.Vector3).set(light.tint[0] / 255, light.tint[1] / 255, light.tint[2] / 255);
      u.uTintAlpha!.value = light.tintAlpha / 255;
      u.uAmbient!.value = light.ambient / 255;
    }
    for (const mesh of this.silhouettes.values()) {
      this.lights.remove(mesh);
      (mesh.material as THREE.Material).dispose();
    }
    this.silhouettes.clear();
  }

  /** False draws every room fully lit (#nolight, tests). */
  enabled = true;

  get active(): boolean {
    // (0x80158F70 runs while the level is below 255 or the tint isn't white.)
    const l = this.light;
    return this.enabled && !!l && !!this.circle && (l.ambient < 255 || l.tint.some((c) => c < 255) || l.tintAlpha > 0);
  }

  /**
   * Lights what's in the current viewport (`width` × `height` device px, drawn with `camera`): renders the light
   * circles and the silhouettes of `unlit` (the Links' sprite meshes, as they were drawn) into a buffer of that size,
   * then multiplies the frame. The renderer's viewport and scissor are restored.
   */
  render(renderer: THREE.WebGLRenderer, camera: THREE.Camera, sources: readonly LightSource[], unlit: readonly THREE.Mesh[], width: number, height: number): void {
    this.drawn = 0;
    if (!this.active) return;
    const w = Math.max(1, Math.round(width)), h = Math.max(1, Math.round(height));
    if (!this.target || this.target.width !== w || this.target.height !== h) {
      this.target?.dispose();
      this.target = new THREE.WebGLRenderTarget(w, h, { depthBuffer: false, stencilBuffer: false });
      this.shade.material.uniforms.uLight!.value = this.target.texture;
    }
    sources.forEach((s, i) => {
      let mesh = this.pool[i];
      if (!mesh) {
        mesh = new THREE.Mesh(
          new THREE.PlaneGeometry(1, 1),
          new THREE.ShaderMaterial({
            vertexShader: CIRCLE_VERTEX,
            fragmentShader: CIRCLE_FRAGMENT,
            uniforms: { uCircle: { value: this.circle }, uAlpha: { value: 1 } },
            ...additive,
            transparent: true,
            depthTest: false,
            depthWrite: false,
          }),
        );
        mesh.frustumCulled = false;
        this.pool.push(mesh);
        this.lights.add(mesh);
      }
      mesh.visible = true;
      mesh.scale.set(2 * s.radius, 2 * s.radius, 1);
      mesh.position.set(s.x, -s.y, 0);
      mesh.material.uniforms.uAlpha!.value = s.alpha / 255;
    });
    for (let i = sources.length; i < this.pool.length; i++) this.pool[i]!.visible = false;
    this.drawn = sources.length;
    // The Links' pixels hold full light (they write 255 into the GameCube's frame buffer alpha).
    for (const sprite of unlit) {
      let mesh = this.silhouettes.get(sprite);
      if (!mesh) {
        const map = ((sprite.material as THREE.ShaderMaterial).uniforms?.uMap?.value ?? null) as THREE.Texture | null;
        mesh = new THREE.Mesh(
          sprite.geometry, // shared: it carries the frame's texture coordinates
          new THREE.ShaderMaterial({ vertexShader: SILHOUETTE_VERTEX, fragmentShader: SILHOUETTE_FRAGMENT, uniforms: { uMap: { value: map } }, ...additive, transparent: true, depthTest: false, depthWrite: false }),
        );
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        this.silhouettes.set(sprite, mesh);
        this.lights.add(mesh);
      }
      sprite.updateWorldMatrix(true, false);
      mesh.matrix.copy(sprite.matrixWorld);
      mesh.visible = sprite.visible;
    }

    const viewport = renderer.getViewport(new THREE.Vector4()), scissor = renderer.getScissor(new THREE.Vector4());
    const scissorTest = renderer.getScissorTest(), clear = renderer.getClearColor(new THREE.Color()), clearAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(this.target);
    renderer.setScissorTest(false);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, false, false);
    renderer.render(this.lights, camera);
    renderer.setRenderTarget(null);
    renderer.setClearColor(clear, clearAlpha);
    renderer.setViewport(viewport);
    renderer.setScissor(scissor);
    renderer.setScissorTest(scissorTest);
    renderer.render(this.shadeScene, this.flat);
  }
}
