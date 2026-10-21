// three.js view of a stage map: each room is a 512×384 quad per tile layer group, laid out on the stage grid.
// World units are room pixels; x grows right and y grows down (negated when placed into three.js space).
import { actorLook, actorPieces, battleArenaName, LAYER_TILES, TILE_SIZE, type ActorType, type DecodedTexture, type Stage, type Tileset } from "@fso/formats";
import {
  actorSpriteMeshes,
  collisionQuad,
  disposeChildren,
  overlayTexture,
  pixelRatio,
  ROOM_H,
  ROOM_W,
  roomQuad,
  TilemapTextures,
  type ActorSpriteSources,
  opaqueFrame,
} from "@fso/render";
import * as THREE from "three";
import { actorAt, actorMarkers, placeActors, type PlacedActor } from "./actors.ts";

export interface ViewOptions {
  base: boolean;
  top: boolean;
  grid: boolean;
  overlay: boolean;
  collision: boolean;
  actors: boolean;
  animate: boolean; // animated tiles (water…)
  sublayer: number; // 0 = TV, 1-7 = GBA-screen areas
}

/** Per-room graphics: Shadow Battle rooms each have their own tileset and ground overlay. */
export interface RoomAssets {
  tileset(room: number): Tileset;
  overlay(room: number): DecodedTexture | null;
  actorTypes: Map<string, ActorType> | null;
  /** When set, actors with known graphics are drawn as sprites (between the layers) instead of markers. */
  actorSprites: ActorSpriteSources | null;
}

export interface Hover {
  room: number;
  tileX: number;
  tileY: number;
  baseTile: number | null;
  topTile: number | null;
  tileType: number | null;
  actor: PlacedActor | null;
}

export class MapView {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera();
  private readonly content = new THREE.Group();
  private readonly canvas: HTMLCanvasElement;
  private center = new THREE.Vector2(0, 0); // world px
  private zoom = 1; // screen px per world px
  private dirty = true;
  private stage: Stage | null = null;
  private layers = new Map<string, Uint16Array | null>();
  private tileTypes: Uint16Array | null = null;
  private placed: PlacedActor[] = [];
  /** GPU tile textures per tileset (Shadow Battle rooms each have their own tileset). */
  private tiles = new Map<Tileset, TilemapTextures>();
  private animate = false;
  /** Content drawn with the map that show() doesn't rebuild (the 3D effects layer, effects.ts). */
  readonly overlay = new THREE.Group();
  /** Called every animation frame with the 60 Hz tick since page load; each returns true to redraw. */
  private readonly tickListeners: ((tick: number) => boolean)[] = [];
  onHover: (hover: Hover | null) => void = () => {};
  onClick: (hover: Hover | null) => void = () => {};

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    this.renderer.setPixelRatio(pixelRatio());
    this.renderer.setClearColor(0x14161a);
    this.scene.add(this.content, this.overlay);
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.bindInput();
    // Animated tiles follow a 60 Hz tick counted from page load.
    const start = performance.now();
    const loop = (now: number) => {
      const tick = Math.floor(((now - start) * 60) / 1000);
      if (this.animate) {
        for (const tiles of this.tiles.values()) if (tiles.setTick(tick)) this.dirty = true;
      }
      for (const listener of this.tickListeners) if (listener(tick)) this.dirty = true;
      if (this.dirty) this.draw();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  /** Calls `listener` every animation frame with the 60 Hz tick since page load (return true to redraw). */
  addTickListener(listener: (tick: number) => boolean): void {
    this.tickListeners.push(listener);
  }

  /** The stage pixel at the view's center. */
  get centerPixel(): { x: number; y: number } {
    return { x: this.center.x, y: this.center.y };
  }

  show(stage: Stage, assets: RoomAssets, tileTypes: Uint16Array | null, options: ViewOptions): void {
    const stageChanged = stage !== this.stage;
    this.stage = stage;
    this.tileTypes = tileTypes;
    this.layers.clear();
    disposeChildren(this.content);
    const filters = new Map<DecodedTexture, THREE.Texture>();
    const filterFor = (room: number) => {
      const overlay = options.overlay ? assets.overlay(room) : null;
      if (!overlay) return null;
      if (!filters.has(overlay)) filters.set(overlay, overlayTexture(overlay));
      return filters.get(overlay)!;
    };
    const used = new Set<Tileset>();
    const tilesFor = (tileset: Tileset) => {
      used.add(tileset);
      let tiles = this.tiles.get(tileset);
      if (!tiles) this.tiles.set(tileset, (tiles = new TilemapTextures(tileset)));
      return tiles;
    };
    this.animate = options.animate;

    const cells = stage.layout.rooms.flatMap((row, y) => row.map((room, x) => ({ room, x, y })));
    const withActors: Parameters<typeof placeActors>[0] = [];
    for (const { room, x, y } of cells) {
      if (room === null) continue;
      const origin = { x: x * ROOM_W, y: y * ROOM_H };
      const tiles = tilesFor(assets.tileset(room)), filter = filterFor(room);
      for (const group of [1, 2] as const) {
        const layer = stage.layer(room, group, options.sublayer);
        this.layers.set(`${room}/${group}`, layer);
        if (!layer || !(group === 1 ? options.base : options.top)) continue;
        this.content.add(roomQuad(layer, tiles, filter, origin, group));
      }
      const base = this.layers.get(`${room}/1`);
      if (options.collision && tileTypes && base) this.content.add(collisionQuad(base, tileTypes, origin, 2.5));
      const arena = stage.battleRooms ? battleArenaName(room) : null;
      if (options.grid) this.content.add(roomFrame(origin), roomLabel(room, arena ? `${room} · ${arena}` : String(room), origin));
      if (options.actors) withActors.push({ room, origin, actors: stage.actors(room) });
    }
    this.placed = placeActors(withActors, options.sublayer);
    let marked = this.placed;
    if (assets.actorSprites) {
      const drawn = this.placed.map((p) => ({ x: p.x, y: p.y, pieces: actorPieces(p.actor) }));
      for (const mesh of actorSpriteMeshes(assets.actorSprites, drawn, 1.5)) this.content.add(mesh);
      // Keep markers only for actors whose look isn't known: tile objects and invisible controllers stay unmarked
      // (they can still be hovered), unmapped types and effects without a stand-in keep their marker.
      marked = this.placed.filter((p, i) => {
        const draw = actorLook(p.actor.id)?.draw;
        return drawn[i]!.pieces.length === 0 && draw !== "tile" && draw !== "hidden";
      });
    }
    for (const mesh of actorMarkers(marked, assets.actorTypes, 5)) this.content.add(mesh);
    for (const [tileset, tiles] of this.tiles) {
      if (!used.has(tileset)) {
        tiles.dispose();
        this.tiles.delete(tileset);
      } else if (!this.animate) tiles.setTick(0);
    }

    if (stageChanged) this.fit();
    this.dirty = true;
  }

  /** Frames every room of the current stage. */
  fit(): void {
    if (!this.stage) return;
    const cells = this.stage.layout.rooms.flatMap((row, y) => row.flatMap((room, x) => (room === null ? [] : [{ x, y }])));
    if (cells.length === 0) return;
    const xs = cells.map((c) => c.x), ys = cells.map((c) => c.y);
    const minX = Math.min(...xs) * ROOM_W, maxX = (Math.max(...xs) + 1) * ROOM_W;
    const minY = Math.min(...ys) * ROOM_H, maxY = (Math.max(...ys) + 1) * ROOM_H;
    this.center.set((minX + maxX) / 2, (minY + maxY) / 2);
    const { clientWidth: w, clientHeight: h } = this.canvas;
    this.zoom = Math.min(w / (maxX - minX), h / (maxY - minY)) * 0.95;
    this.dirty = true;
  }

  private resize(): void {
    const { clientWidth: w, clientHeight: h } = this.canvas;
    this.renderer.setSize(w, h, false);
    this.dirty = true;
  }

  private draw(): void {
    const { clientWidth: w, clientHeight: h } = this.canvas;
    const halfW = w / 2 / this.zoom, halfH = h / 2 / this.zoom;
    Object.assign(this.camera, {
      left: this.center.x - halfW,
      right: this.center.x + halfW,
      top: -this.center.y + halfH,
      bottom: -this.center.y - halfH,
      near: -10,
      far: 10,
    });
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
    opaqueFrame(this.renderer); // WebKit composites the canvas by its alpha (@fso/render opaque.ts)
    this.dirty = false;
  }

  private screenToWorld(clientX: number, clientY: number): THREE.Vector2 {
    const rect = this.canvas.getBoundingClientRect();
    return new THREE.Vector2(
      this.center.x + (clientX - rect.left - rect.width / 2) / this.zoom,
      this.center.y + (clientY - rect.top - rect.height / 2) / this.zoom,
    );
  }

  private bindInput(): void {
    let drag: { x: number; y: number } | null = null;
    let press: { x: number; y: number } | null = null;
    this.canvas.addEventListener("pointerdown", (e) => {
      drag = press = { x: e.clientX, y: e.clientY };
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener("pointerup", (e) => {
      drag = null;
      if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) < 4) this.onClick(this.hoverAt(this.screenToWorld(e.clientX, e.clientY)));
      press = null;
    });
    this.canvas.addEventListener("pointermove", (e) => {
      if (drag) {
        this.center.x -= (e.clientX - drag.x) / this.zoom;
        this.center.y -= (e.clientY - drag.y) / this.zoom;
        drag = { x: e.clientX, y: e.clientY };
        this.dirty = true;
      }
      this.onHover(this.hoverAt(this.screenToWorld(e.clientX, e.clientY)));
    });
    this.canvas.addEventListener("pointerleave", () => this.onHover(null));
    this.canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const before = this.screenToWorld(e.clientX, e.clientY);
        this.zoom = THREE.MathUtils.clamp(this.zoom * Math.exp(-e.deltaY * 0.0015), 0.05, 16);
        const after = this.screenToWorld(e.clientX, e.clientY);
        this.center.add(before.sub(after));
        this.dirty = true;
      },
      { passive: false },
    );
  }

  /** Centers on a room of the current stage. */
  focusRoom(room: number, pixelZoom?: number): void {
    const y = this.stage?.layout.rooms.findIndex((row) => row.includes(room)) ?? -1;
    if (y < 0) return;
    const x = this.stage!.layout.rooms[y]!.indexOf(room);
    this.center.set((x + 0.5) * ROOM_W, (y + 0.5) * ROOM_H);
    if (pixelZoom) this.setPixelZoom(pixelZoom);
    this.dirty = true;
  }

  /** Centers on stage pixel (x, y) at `zoom` CSS pixels per stage pixel. */
  lookAt(x: number, y: number, zoom?: number): void {
    this.center.set(x, y);
    if (zoom) this.zoom = zoom;
    this.dirty = true;
  }

  /** Snaps to an integer zoom level (1 = one screen pixel per room pixel). */
  setPixelZoom(level: number): void {
    this.zoom = level / pixelRatio();
    this.dirty = true;
  }

  private hoverAt(world: THREE.Vector2): Hover | null {
    if (!this.stage) return null;
    const cx = Math.floor(world.x / ROOM_W), cy = Math.floor(world.y / ROOM_H);
    const room = this.stage.layout.rooms[cy]?.[cx];
    if (room === null || room === undefined) return null;
    const tileX = Math.floor((world.x - cx * ROOM_W) / TILE_SIZE);
    const tileY = Math.floor((world.y - cy * ROOM_H) / TILE_SIZE);
    const at = (group: number) => this.layers.get(`${room}/${group}`)?.[tileY * LAYER_TILES + tileX] ?? null;
    const base = at(1);
    const actor = actorAt(this.placed, world.x, world.y, Math.max(3, 6 / this.zoom));
    return { room, tileX, tileY, baseTile: base, topTile: at(2), tileType: base === null || !this.tileTypes ? null : this.tileTypes[base & 0x3ff]!, actor };
  }
}

function roomFrame(origin: { x: number; y: number }): THREE.LineLoop {
  const points = [
    [0, 0],
    [ROOM_W, 0],
    [ROOM_W, ROOM_H],
    [0, ROOM_H],
  ].map(([x, y]) => new THREE.Vector3(origin.x + x!, -(origin.y + y!), 3));
  const material = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 });
  return new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), material);
}

function roomLabel(room: number, text: string, origin: { x: number; y: number }): THREE.Sprite {
  const canvas = document.createElement("canvas");
  const font = "bold 40px ui-monospace, monospace";
  const measure = canvas.getContext("2d")!;
  measure.font = font;
  canvas.width = Math.max(128, Math.ceil(measure.measureText(text).width) + 32);
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
  ctx.fillRect(0, 0, canvas.width, 64);
  ctx.fillStyle = "#fff";
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, canvas.width / 2, 34);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture }));
  const width = (canvas.width / 64) * 24;
  sprite.scale.set(width, 24, 1);
  sprite.position.set(origin.x + 4 + width / 2, -(origin.y + 16), 4);
  sprite.name = `room ${room}`;
  return sprite;
}
