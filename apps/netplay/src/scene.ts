// Lake Hylia with up to four Links: the minimal rendering bits of apps/game (tile layers, sprites, room camera).
import { loadOverlay, loadSob, loadSpriteSheet, loadTileset, playerPaletteMap, type RarcArchive, type Stage } from "@fso/formats";
import { opaqueFrame, overlayTexture, pixelRatio, ROOM_H, ROOM_W, roomQuad, RoomPan, SpriteAtlas, SpriteMesh, TilemapTextures } from "@fso/render";
import { linkDisplayFrame, roomAt, SUBPX, type GameState, type World } from "@fso/sim";
import * as THREE from "three";

const VIEW_HEIGHT = 212; // room px visible vertically, as measured in Dolphin

interface Viewport {
  scale: number;
  halfW: number;
  halfH: number;
}

export class Scene {
  private readonly scene = new THREE.Scene();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly camera = new THREE.OrthographicCamera();
  private readonly tiles: TilemapTextures;
  private readonly links: SpriteMesh[] = [];
  private readonly origins = new Map<number, { x: number; y: number }>();
  private readonly world: World;
  private readonly canvas: HTMLCanvasElement;
  private readonly view = new RoomPan();
  private lastTick = -1; // the pan steps once per sim tick, not per drawn frame

  constructor(canvas: HTMLCanvasElement, data: RarcArchive, stage: Stage, world: World) {
    this.canvas = canvas;
    this.world = world;
    const tileset = loadTileset(data, stage.layout.tilesetIndex);
    const overlay = loadOverlay(data, stage.layout.overlayTextureId);
    const filter = overlay ? overlayTexture(overlay) : null;
    this.tiles = new TilemapTextures(tileset);
    stage.layout.rooms.forEach((row, cy) =>
      row.forEach((room, cx) => {
        if (room === null) return;
        const origin = { x: cx * ROOM_W, y: cy * ROOM_H };
        this.origins.set(room, origin);
        const base = stage.layer(room, 1), top = stage.layer(room, 2);
        if (base) this.scene.add(roomQuad(base, this.tiles, filter, origin, 1));
        if (top) this.scene.add(roomQuad(top, this.tiles, filter, origin, 3));
      }),
    );
    const sheet = loadSpriteSheet(data, stage.layout.npcSheetId);
    const frames = loadSob(data, "player_sob.bin");
    for (let p = 0; p < 4; p++) {
      const mesh = new SpriteMesh(new SpriteAtlas(sheet, frames, playerPaletteMap(p)));
      mesh.visible = false;
      this.links.push(mesh);
      this.scene.add(mesh);
    }
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    this.renderer.setClearColor(0x000000);
  }

  origin(room: number): { x: number; y: number } {
    return this.origins.get(room) ?? { x: 0, y: 0 };
  }

  /** Draws the state, the camera on player `follow` (clamped to its room, easing on room changes). */
  render(state: GameState, follow: number): void {
    const vp = this.viewport();
    this.tiles.setTick(state.tick);
    state.players.forEach((p, i) => {
      const link = this.links[i]!;
      link.setFrame(linkDisplayFrame(p, state.tick));
      link.place(Math.floor(p.x / SUBPX), Math.floor(p.y / SUBPX), 2 + i * 0.01);
      link.visible = true;
    });
    const p = state.players[follow] ?? state.players[0]!;
    const px = p.x / SUBPX, py = p.y / SUBPX;
    const room = roomAt(this.world, Math.floor(px), Math.floor(py));
    const origin = this.origins.get(room);
    if (origin) {
      const clamp = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.min(Math.max(v, lo), hi));
      const tx = clamp(px, origin.x + vp.halfW, origin.x + ROOM_W - vp.halfW);
      const ty = clamp(py, origin.y + vp.halfH, origin.y + ROOM_H - vp.halfH);
      if (state.tick !== this.lastTick) this.view.step(room, tx, ty);
      this.lastTick = state.tick;
    }
    const dpr = pixelRatio(), w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) this.renderer.setSize(w, h, false);
    this.renderer.setPixelRatio(dpr);
    const cx = Math.round(this.view.x * vp.scale) / vp.scale, cy = Math.round(this.view.y * vp.scale) / vp.scale;
    Object.assign(this.camera, { left: cx - vp.halfW, right: cx + vp.halfW, top: -cy + vp.halfH, bottom: -cy - vp.halfH, near: -10, far: 10 });
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
    opaqueFrame(this.renderer); // WebKit composites the canvas by its alpha (@fso/render opaque.ts)
  }

  private viewport(): Viewport {
    const dpr = pixelRatio(), w = this.canvas.clientWidth * dpr, h = this.canvas.clientHeight * dpr;
    const scale = Math.max(1, Math.round(h / VIEW_HEIGHT));
    return { scale, halfW: w / scale / 2, halfH: h / scale / 2 };
  }
}
