// FSA stage effects in our 2D scenes: J3D models placed the way the game places them (stageEffectPlacements and
// envModelPlacement in @fso/formats) and the cloud shadows. Scene convention (as the tilemap): x = world px,
// y = −world px, z = draw layer. FSA draws a 3D world point (x, y, z) at world pixel (x, y − z) with an orthographic
// camera and sorts by y, so the models are flattened onto the map and their depth becomes a fixed scene z (EFFECT_Z).
// Every `update`/`setTick` takes a 60 Hz tick from the caller; nothing here reads a clock.
import {
  CLOUD_SHADOWS,
  cloudShadowRooms,
  envModelPlacement,
  loadCloudTexture,
  loadJ3dResource,
  stageEffectPlacements,
  type DecodedTexture,
  type EffectPlacement,
  type EnvModel,
  type J3dResource,
  type RarcArchive,
  type Stage,
} from "@fso/formats";
import * as THREE from "three";
import { J3dModel } from "./model.ts";

/**
 * Scene z of the effect layers, against the viewer's tilemap quads (base z = 1, top z = 2; its actor sprites at 1.5).
 * The cloud shadows go over the base layer and every sprite but under the top layer (docs/formats/battle-arenas.md "Cloud shadows").
 */
export const EFFECT_Z = { belowTop: 1.5, aboveTop: 2.5, filter: 2.7, clouds: 1.9 } as const;

/** Maps an FSA world point (x, y, z) to our scene: (x − ox, −(y − z − oy), sceneZ), for a scene origin (ox, oy). */
export function fsaWorldToScene(sceneZ: number, origin: { x: number; y: number } = { x: 0, y: 0 }): THREE.Matrix4 {
  return new THREE.Matrix4().set(1, 0, 0, -origin.x, 0, -1, 1, origin.y, 0, 0, 0, sceneZ, 0, 0, 0, 1);
}

/** Scene matrix of a placed model: FSA base transform (translation · rotation · scale), then fsaWorldToScene. */
export function placementMatrix(p: Pick<EffectPlacement, "translation" | "rotation" | "scale">, sceneZ: number, origin?: { x: number; y: number }): THREE.Matrix4 {
  const [x, y, z] = p.translation;
  const base = p.rotation === "swapYZ" ? new THREE.Matrix4().set(1, 0, 0, x, 0, 0, 1, y, 0, 1, 0, z, 0, 0, 0, 1) : new THREE.Matrix4().makeTranslation(x, y, z);
  base.multiply(new THREE.Matrix4().makeScale(...p.scale));
  return fsaWorldToScene(sceneZ, origin).multiply(base);
}

const CLOUD_VERTEX = /* glsl */ `
  uniform vec2 uOrigin;
  out vec2 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = vec2(world.x, -world.y) + uOrigin;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

// The environment manager's cloud shadow quad: black, alpha = 47/255 × texture intensity (see CLOUD_SHADOWS).
const CLOUD_FRAGMENT = /* glsl */ `
  uniform sampler2D uClouds;
  uniform vec2 uPeriod;
  uniform float uOffset;
  uniform float uAlpha;
  in vec2 vWorld;
  layout(location = 0) out vec4 fragColor;
  void main() {
    float cloud = texture(uClouds, vWorld / uPeriod - uOffset).r;
    fragColor = vec4(0.0, 0.0, 0.0, uAlpha * cloud);
  }
`;

export function cloudTexture(clouds: DecodedTexture): THREE.DataTexture {
  const t = new THREE.DataTexture(clouds.data, clouds.width, clouds.height, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/**
 * Cloud shadows over world-pixel rectangles (one per room that has them). `origin` is the world position of the
 * scene's (0, 0) (arena-local scenes); `setTick` moves them with the 60 Hz tick.
 */
export class CloudShadows {
  readonly group = new THREE.Group();
  private readonly texture: THREE.DataTexture;
  private readonly material: THREE.ShaderMaterial;

  constructor(clouds: DecodedTexture, rects: { x: number; y: number; width: number; height: number }[], sceneZ: number = EFFECT_Z.clouds, origin = { x: 0, y: 0 }) {
    this.texture = cloudTexture(clouds);
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: CLOUD_VERTEX,
      fragmentShader: CLOUD_FRAGMENT,
      uniforms: {
        uClouds: { value: this.texture },
        uPeriod: { value: new THREE.Vector2(...CLOUD_SHADOWS.period) },
        uOffset: { value: 0 },
        uAlpha: { value: CLOUD_SHADOWS.alpha },
        uOrigin: { value: new THREE.Vector2(origin.x, origin.y) },
      },
      transparent: true,
      depthWrite: false,
    });
    this.group.name = "cloud shadows";
    for (const r of rects) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(r.width, r.height), this.material);
      mesh.position.set(r.x - origin.x + r.width / 2, -(r.y - origin.y + r.height / 2), sceneZ);
      mesh.renderOrder = 1000;
      this.group.add(mesh);
    }
  }

  /** `tick` frames after the room started: the level rises by 1/255 per frame to 47/255 (SWEV), the clouds drift. */
  setTick(tick: number): void {
    this.material.uniforms.uOffset!.value = (tick % CLOUD_SHADOWS.wrap) * CLOUD_SHADOWS.drift;
    this.material.uniforms.uAlpha!.value = Math.min(CLOUD_SHADOWS.alpha, tick / 255);
  }

  dispose(): void {
    for (const m of this.group.children) (m as THREE.Mesh).geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
    this.group.clear();
  }
}

/**
 * An environment model (lava, drifting clouds…) that follows the camera like the game's environment manager draws
 * it. Call `update(tick, cameraX, cameraY)` each frame with the camera center in world pixels.
 */
export class EnvModelInstance {
  readonly model: J3dModel;
  private readonly env: EnvModel;
  private readonly sceneZ: number;
  private readonly origin: { x: number; y: number };

  constructor(env: EnvModel, resource: J3dResource, sceneZ: number, origin = { x: 0, y: 0 }) {
    this.env = env;
    this.sceneZ = sceneZ;
    this.origin = origin;
    this.model = new J3dModel(resource.bmd, { btk: resource.btk, brk: resource.brk, bpk: resource.bpk, bck: resource.bck, btp: resource.btp });
    this.model.object.name = env.model;
  }

  update(tick: number, cameraX: number, cameraY: number): void {
    this.model.object.matrix.copy(placementMatrix(envModelPlacement(this.env, cameraX, cameraY), this.sceneZ, this.origin));
    this.model.object.matrixWorldNeedsUpdate = true;
    this.model.update(tick);
  }

  dispose(): void {
    this.model.dispose();
  }
}

export interface StageEffectsOptions {
  clouds?: boolean;
  /** Only effects of these rooms (default: all). */
  rooms?: number[];
  /** Each model's scene z (default: EFFECT_Z by its layer, the viewer's depths). */
  sceneZ?: (p: EffectPlacement) => number;
}

/**
 * Every effect of a stage as one group: add `group` to the scene and call `update(tick)` each 60 Hz tick (tick 0 =
 * when the effects started; one-shot animations such as the morning light's fade play from there).
 */
export class StageEffects {
  readonly group = new THREE.Group();
  readonly placements: EffectPlacement[];
  readonly clouds: CloudShadows | null = null;
  private readonly models: J3dModel[] = [];
  /** Each model's placement (models[i] is placed by shown[i]). */
  private readonly shown: EffectPlacement[] = [];
  private readonly resources = new Map<string, J3dResource | null>();

  constructor(stage: Stage, data: RarcArchive, options: StageEffectsOptions = {}) {
    this.group.name = "stage effects";
    this.placements = stageEffectPlacements(stage).filter((p) => !options.rooms || options.rooms.includes(p.room));
    this.placements.forEach((p, i) => {
      if (!this.resources.has(p.model)) this.resources.set(p.model, loadJ3dResource(stage.archive, p.model));
      const res = this.resources.get(p.model);
      if (!res) return;
      const model = new J3dModel(res.bmd, { btk: res.btk, brk: res.brk, bpk: res.bpk, bck: res.bck, btp: res.btp });
      model.object.matrix.copy(placementMatrix(p, options.sceneZ?.(p) ?? EFFECT_Z[p.layer]));
      model.object.matrixWorldNeedsUpdate = true;
      model.object.name = `${p.model} (room ${p.room})`;
      model.setRenderOrder(100 + i * 16);
      this.models.push(model);
      this.shown.push(p);
      this.group.add(model.object);
    });
    const rooms = options.clouds === false ? [] : cloudShadowRooms(stage).filter((r) => !options.rooms || options.rooms.includes(r));
    const texture = rooms.length ? loadCloudTexture(data) : null;
    if (texture) {
      const rects = rooms.flatMap((room) => {
        const y = stage.layout.rooms.findIndex((row) => row.includes(room));
        const x = y < 0 ? -1 : stage.layout.rooms[y]!.indexOf(room);
        return x < 0 ? [] : [{ x: x * 512, y: y * 384, width: 512, height: 384 }];
      });
      this.clouds = new CloudShadows(texture, rects);
      this.group.add(this.clouds.group);
    }
  }

  /**
   * Shows only the effects a room's own actors make (EffectPlacement `room` and `also`), as the game draws them: from
   * a room, a neighbour's effect that reaches into it stays hidden (Lake Hylia room 0's morning light over room 1's
   * east half). The cloud shadows are left as they are.
   */
  showRoom(room: number): void {
    this.shown.forEach((p, i) => (this.models[i]!.object.visible = p.room === room || !!p.also?.includes(room)));
  }

  update(tick: number): void {
    for (const m of this.models) m.update(tick);
    this.clouds?.setTick(tick);
  }

  dispose(): void {
    for (const m of this.models) m.dispose();
    this.clouds?.dispose();
    this.group.clear();
  }
}
