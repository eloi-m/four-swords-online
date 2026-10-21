// Draws Phantom Ganon (packages/sim adventure/phantomganon.ts) from the BTIs his draw (main.dol 0x8017C078) picks in the
// stage archive's fganon/ by his animation group and frame (name tables 0x804A1290, 0x804A12D0): dawn, kenhuri (the
// swing, its last three frames shifted 21 px), wait, yarare; scaled and faded as the sim has him, his shadow under him.
// His energy ball and its shards are JPA effects in the game; here plain glowing discs. It only reads the state.
import { decodeBti, type RarcArchive } from "@fso/formats";
import { SUBPX } from "@fso/sim";
import type { AdventureGame } from "@fso/sim/adventure";
import * as THREE from "three";

const DEPTH_PER_PIXEL = 1 / 1024;
const FRAMES: readonly (readonly string[])[] = [
  ["dawn_00", "dawn_04", "dawn_08", "dawn_12", "dawn_16", "dawn_18"],
  ["kenhuri_05", "kenhuri_07", "kenhuri_09_l", "kenhuri_11_r", "kenhuri_13_r"],
  ["wait_00_u", "wait_04_u", "wait_08_u", "wait_12_u", "wait_16_u", "wait_20_u", "wait_24_u", "wait_28_u"],
  ["yarare_02", "yarare_06", "yarare_10", "yarare_14", "yarare_22"],
];
/** The swing's frames' x offsets (0x804A12A8). */
const SWING_DX = [0, 0, -21, 21, 21];

export class GanonView {
  readonly group = new THREE.Group();
  private readonly textures = new Map<string, THREE.DataTexture | null>();
  private readonly body: THREE.Mesh;
  private readonly shadow: THREE.Mesh;
  private readonly ball: THREE.Mesh;
  private readonly shards: THREE.Mesh[] = [];
  private readonly archive: RarcArchive | null;

  constructor(archive: RarcArchive | null) {
    this.archive = archive;
    // His BTIs are grey; tinted with his aura's colour (159, 127, 255: the JPA 896 he keeps, assumed for the body).
    this.body = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xc8b4ff, transparent: true, alphaTest: 0.02, depthWrite: false }));
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(12, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 100 / 255, depthWrite: false }));
    this.shadow.scale.y = 0.4;
    const glow = new THREE.MeshBasicMaterial({ color: 0xd8a0ff, transparent: true, opacity: 0.9, depthWrite: false });
    this.ball = new THREE.Mesh(new THREE.CircleGeometry(7, 16), glow);
    for (let i = 0; i < 7; i++) this.shards.push(new THREE.Mesh(new THREE.CircleGeometry(2.5, 8), glow));
    this.group.add(this.shadow, this.body, this.ball, ...this.shards);
    this.group.visible = false;
  }

  private texture(name: string): THREE.DataTexture | null {
    if (!this.textures.has(name)) {
      const file = this.archive?.files.find((f) => f.path.endsWith(`fganon/${name}.bti`));
      let tex: THREE.DataTexture | null = null;
      if (file) {
        const img = decodeBti(file.data);
        const row = img.width * 4, flipped = new Uint8Array(img.data.length);
        for (let y = 0; y < img.height; y++) flipped.set(img.data.subarray(y * row, (y + 1) * row), (img.height - 1 - y) * row);
        tex = new THREE.DataTexture(flipped, img.width, img.height, THREE.RGBAFormat);
        tex.magFilter = tex.minFilter = THREE.NearestFilter;
        tex.needsUpdate = true;
      }
      this.textures.set(name, tex);
    }
    return this.textures.get(name)!;
  }

  /** Places him in the room's local group's coordinates (area px, y up negated). */
  update(game: AdventureGame): void {
    const g = game.adventure.ganon;
    this.group.visible = !!g && !g.gone && game.adventure.area === 0;
    if (!g || !this.group.visible) return;
    const x = g.x / SUBPX, y = g.y / SUBPX, z = g.z / SUBPX;
    const name = FRAMES[g.group]?.[Math.max(0, Math.min(g.frame, FRAMES[g.group]!.length - 1))];
    const tex = name ? this.texture(name) : null;
    const m = this.body.material as THREE.MeshBasicMaterial;
    this.body.visible = !!tex && g.alpha > 0;
    if (tex) {
      if (m.map !== tex) (m.map = tex), (m.needsUpdate = true);
      const w = tex.image.width, h = tex.image.height;
      const dx = g.group === 1 ? SWING_DX[g.frame] ?? 0 : 0;
      this.body.scale.set((w * g.scaleX) / 256, (h * g.scaleY) / 256, 1);
      // Centered on his anchor lifted by his height (TODO(measure) the game's placement).
      this.body.position.set(x + dx, -(y - z), 2 + y * DEPTH_PER_PIXEL + 0.001);
      m.opacity = g.alpha / 255;
    }
    this.shadow.position.set(x, -y, 1.9);
    this.shadow.scale.set((0.8 * g.scaleY) / 256, (0.32 * g.scaleY) / 256, 1);
    this.ball.visible = !!g.ball;
    if (g.ball) this.ball.position.set(g.ball.x / SUBPX, -g.ball.y / SUBPX, 3);
    this.shards.forEach((s, i) => {
      const sh = g.shards[i];
      s.visible = !!sh;
      if (sh) s.position.set(sh.x / SUBPX, -sh.y / SUBPX, 3);
    });
  }
}
