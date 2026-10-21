// What the game draws behind a battle arena's tile layers (seen through their transparent pixels). In main.dol the
// stage's environment manager (constructor 0x8016F0BC loads every candidate resource; flags at +0x1C4…) draws these
// as full-screen quads (so they can only be under the BG layers), and each room's SWEV actor ("environment switch
// control") turns them on from its params (init 0x802B5360, update 0x802B3AB8); docs/formats/battle-arenas.md "Shadow Battle
// backdrops":
// - Tower of Winds (rooms 2, 7; SWEV bit 9 → flag 0x1CC, drawer 0x8016B4D4): boss500 timg/sky.bti, then wall.bti over
//   it (its windows are transparent), two screen quads whose texture coordinates follow the camera.
// - Above the Clouds (rooms 4, 9; SWEV bit 16 → flag 0x1C9, drawer 0x8016B910): timg/enkei.bti (Hyrule far below),
//   then three layers of data.arc timg/kumo_env.bti clouds (a dark shadow layer and two light ones) drifting at
//   different speeds and parallax. SEV2's bit 17 also turns on the J3D j3d/nagarekumo.bmd (flag 0x1DC).
// - Tower of Flames (rooms 1, 6; SWEV bit 18 → flag 0x1C4): the J3D lava data.arc j3d/yougan.bmd.
// The texture coordinate formulas below are read from the drawers (inputs: camera center in world px, the zoom, the
// room size 64 × 48 in 8-px units, the screen size and a frame counter), turned into world-anchored mappings. The J3D
// models in `J3D_BACKDROPS` are drawn with @fso/render's EnvModelInstance, placed around the camera like the
// manager's model drawer (0x8016A7DC, see ENV_MODELS in @fso/formats).
import { decodeBti, ENV_MODELS, loadJ3dResource, type DecodedTexture, type EnvModel, type RarcArchive } from "@fso/formats";
import { EnvModelInstance, ROOM_H, ROOM_W } from "@fso/render";
import * as THREE from "three";

/** J3D environment models the game draws behind (lava) or over (drifting clouds) an arena. */
export const J3D_BACKDROPS: Record<number, EnvModel[]> = {
  1: [ENV_MODELS.yougan],
  6: [ENV_MODELS.yougan],
  4: [ENV_MODELS.nagarekumo],
  9: [ENV_MODELS.nagarekumo],
};

/** Scene depth of models drawn in front of everything (over the top tile layer at 3, under the debug boxes). */
const FRONT_Z = 3.4;

const VERTEX = /* glsl */ `
  varying vec2 vWorld;
  void main() {
    vec4 scene = modelMatrix * vec4(position, 1.0); // (the quad's own position is about its middle)
    vWorld = vec2(scene.x, -scene.y);
    gl_Position = projectionMatrix * viewMatrix * scene;
  }
`;

// uv = offset + scale * world (world = arena px plus the room's cell origin, y down); color = mix(texture, constant).
const FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec2 uScale;
  uniform vec2 uOffset;
  uniform vec2 uOrigin;
  uniform vec4 uColor;
  uniform float uTint; // 0: texture color, 1: constant color with the texture's intensity as alpha
  varying vec2 vWorld;
  void main() {
    vec4 t = texture2D(uMap, uOffset + uScale * (vWorld + uOrigin));
    vec4 c = mix(t, vec4(uColor.rgb, uColor.a * t.r), uTint);
    if (c.a <= 0.0) discard;
    gl_FragColor = c;
  }
`;

/** A camera-dependent mapping: uv = offset + scale × world px, updated per frame. */
interface Layer {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  update(cam: { x: number; y: number }, frame: number): void;
}

const MARGIN = 1024; // the quads cover the arena and far around it

export class Backdrop {
  readonly group = new THREE.Group();
  private layers: Layer[] = [];
  /** J3D models this arena shows that couldn't be loaded. */
  missing: string[] = [];
  private models: EnvModelInstance[] = [];
  private origin = new THREE.Vector2();
  private readonly stage: RarcArchive;
  private readonly data: RarcArchive;
  private readonly textures = new Map<string, THREE.DataTexture | null>();

  constructor(stage: RarcArchive, data: RarcArchive) {
    this.stage = stage;
    this.data = data;
  }

  /** No backdrop (free play's map). */
  clear(): void {
    for (const l of this.layers) {
      l.mesh.material.dispose();
      l.mesh.geometry.dispose();
    }
    for (const m of this.models) m.dispose();
    this.models = [];
    this.missing = [];
    this.group.clear();
    this.layers = [];
  }

  /** Builds the backdrop for an arena room (nothing for arenas without one). `z` is the depth of the first layer. */
  show(room: number, z: number): void {
    this.clear();
    // In a battle the game puts the arena room at world cell (1, 1), whichever boss500 room it is (Dolphin: a Link at
    // room (152, 184) is at world (664, 568)): the world origin the texture mappings and models see.
    this.origin.set(ROOM_W, ROOM_H);
    this.showModels(room, z);
    const arena = room % 5;
    const add = (texture: THREE.Texture | null, update: Layer["update"], color?: [number, number, number, number]) => {
      if (!texture) return;
      const material = new THREE.ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        uniforms: {
          uMap: { value: texture },
          uScale: { value: new THREE.Vector2() },
          uOffset: { value: new THREE.Vector2() },
          uOrigin: { value: this.origin },
          uColor: { value: new THREE.Vector4(...(color ?? [255, 255, 255, 255]).map((c) => c / 255)) },
          uTint: { value: color ? 1 : 0 },
        },
        transparent: true,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W + 2 * MARGIN, ROOM_H + 2 * MARGIN), material);
      mesh.position.set(ROOM_W / 2, -ROOM_H / 2, z + this.layers.length * 0.01);
      mesh.renderOrder = -10 + this.layers.length;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.layers.push({ mesh, update });
    };
    const set = (l: THREE.ShaderMaterial, sx: number, sy: number, ox: number, oy: number) => {
      (l.uniforms.uScale!.value as THREE.Vector2).set(sx, sy);
      (l.uniforms.uOffset!.value as THREE.Vector2).set(ox, oy);
    };
    const W = ROOM_W, H = ROOM_H; // the drawers' 0.125 / (64, 48) per world px
    // One screen quad of the drawer: at screen point p (world wx = camX + p), s = a·camX/W + k·p/W + c, i.e.
    // s = k·wx/W + ((a − k)·camX/W + c).
    const parallax = (m: THREE.ShaderMaterial, ax: number, kx: number, cx: number, ay: number, ky: number, cy: number, cam: { x: number; y: number }) =>
      set(m, kx / W, ky / H, ((ax - kx) * cam.x) / W + cx, ((ay - ky) * cam.y) / H + cy);
    if (arena === 2) {
      // Sky: s = camX/W − frame/4096 ± half, t = 3 (camY/H ± half): world-anchored, 1 texel per px, drifting right.
      add(this.stageTexture("sky.bti"), (cam, f) => {
        const layer = this.layers[0]!.mesh.material;
        parallax(layer, 1, 1, -(f & 0xfff) / 4096, 3, 3, 0, cam);
      });
      // Wall: s = camX/W ± half, t = 0.75 camY/H ± 1.5 half: rows scroll at half the camera speed.
      add(this.stageTexture("wall.bti"), (cam) => parallax(this.layers[1]!.mesh.material, 1, 1, 0, 0.75, 1.5, 0, cam));
    } else if (arena === 4) {
      // enkei (Hyrule from above): s = 0.1 camX/W + 0.2 ± 0.7 half, t = 0.1 camY/H + 0.2 ± 0.525 half.
      add(this.stageTexture("enkei.bti"), (cam) => parallax(this.layers[0]!.mesh.material, 0.1, 0.7, 0.2, 0.1, 0.525, 0.2, cam));
      // Cloud layers (kumo_env, I4): TEV color = constant C0 (RGBA below), alpha from the texture; they drift by 1/4096
      // of a repeat per frame, the last two with the frame counter offset by 1300 / 3100.
      const kumo = this.dataTexture("kumo_env.bti");
      const drift = (f: number, d: number) => ((f + d) & 0xfff) / 4096;
      add(kumo, (cam, f) => parallax(this.layers[1]!.mesh.material, 0.1, 3, -drift(f, 0), 0.1, 2.25, -drift(f, 0), cam), [0, 0, 0, 0x2f]);
      add(kumo, (cam, f) => parallax(this.layers[2]!.mesh.material, 0.2, 2.5, -drift(f, 0), 0.2, 1.875, -drift(f, 1300), cam), [0xaf, 0xcf, 0xcf, 0xff]);
      add(kumo, (cam, f) => parallax(this.layers[3]!.mesh.material, 0.3, 2, -drift(f, 3100), 0.3, 1.5, -drift(f, 1300), cam), [0xcf, 0xe7, 0xe7, 0xff]);
    }
  }

  /** Per frame: the camera center (arena px) and the environment's frame counter. */
  update(camera: { x: number; y: number }, frame: number): void {
    const cam = { x: camera.x + this.origin.x, y: camera.y + this.origin.y };
    for (const l of this.layers) l.update(cam, frame);
    for (const m of this.models) m.update(frame, cam.x, cam.y);
  }

  get empty(): boolean {
    return this.layers.length === 0 && this.models.length === 0;
  }

  /** The arena's J3D environment models: the lava behind the tiles, the drifting clouds over everything. */
  private showModels(room: number, z: number): void {
    for (const m of this.models) m.dispose();
    this.models = [];
    this.missing = [];
    const origin = { x: this.origin.x, y: this.origin.y };
    for (const env of J3D_BACKDROPS[room] ?? []) {
      const resource = loadJ3dResource(env.source === "data" ? this.data : this.stage, env.model);
      if (!resource) {
        this.missing.push(`${env.source === "data" ? "data.arc" : this.stage.rootName} j3d/${env.model}.bmd`);
        continue;
      }
      const instance = new EnvModelInstance(env, resource, env.depth < 0 ? z - 0.05 : FRONT_Z, origin);
      instance.model.setRenderOrder(env.depth < 0 ? -20 : 900);
      this.models.push(instance);
      this.group.add(instance.model.object);
    }
  }

  private stageTexture(name: string): THREE.DataTexture | null {
    return this.texture(this.stage, `timg/${name}`);
  }

  private dataTexture(name: string): THREE.DataTexture | null {
    return this.texture(this.data, `timg/${name}`);
  }

  private texture(archive: RarcArchive, path: string): THREE.DataTexture | null {
    const key = `${archive.rootName}/${path}`;
    if (!this.textures.has(key)) {
      const file = archive.files.find((f) => f.path.toLowerCase() === path.toLowerCase());
      this.textures.set(key, file ? repeatTexture(decodeBti(file.data)) : null);
    }
    return this.textures.get(key)!;
  }
}

function repeatTexture(image: DecodedTexture): THREE.DataTexture {
  // Rows top-down with flipY off: texture row n is sampled at v = n / height, as GX's t grows downwards.
  const t = new THREE.DataTexture(image.data, image.width, image.height, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = t.minFilter = THREE.LinearFilter; // the BTIs ask for linear filtering
  t.needsUpdate = true;
  return t;
}
