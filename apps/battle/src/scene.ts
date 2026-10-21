// The arena on screen, in the TV's 608×448 frame (letterboxed in the canvas): the backdrop some arenas show through
// their transparent tiles, the room's tile layers (each arena has its own tileset and ground overlay), the arena's
// static actors and the Links y-sorted between the base and top layers, the J2D HUD over everything, and the game's
// battle camera (camera.ts: a box around the Links still in the round and the arena's focus points, in the arena).
// The arena's side rooms (the GBA screens: siderooms.ts) are in the same scene below it, in the GBA palettes: a Link
// in one isn't on the TV (the camera leaves him out), and shows in a GBA-sized inset over the frame instead. On the
// side-view screens (the Tower of Winds) nobody has a shadow. The Tower of Winds' giant-bomb Shadow Link is a Link
// sprite in the dark palette.
// Or free play's map (showMap): another stage's rooms side by side, just their tiles and the Links, the same camera
// in the whole map.
import {
  ACTOR_SOB_FILES,
  actorPieces,
  actorPixel,
  ENV_MODELS,
  loadOverlay,
  loadSob,
  loadTileset,
  playerPaletteMap,
  type ActorSob,
  type RarcArchive,
  type SpriteFrame,
  type SpriteSheet,
  type Stage,
} from "@fso/formats";
import {
  actorSpriteMeshes,
  collisionQuad,
  disposeChildren,
  hasRiverBed,
  overlayTexture,
  pixelRatio,
  ROOM_H,
  ROOM_W,
  RiverBed,
  riverBedPalettes,
  roomQuad,
  screenCamera,
  SpriteAtlas,
  SpriteMesh,
  TilemapTextures,
  type ActorSpriteSources,
  type PlacedPieces,
  opaqueFrame,
} from "@fso/render";
import {
  ARENA_H,
  ARENA_W,
  DEAD_FRAME,
  fighterFrame,
  fighterHeight,
  fighterVisible,
  HURTBOX,
  linkFrame as linkActionFrame,
  screenAt,
  SHADOW,
  shadowShown,
  sideRoomsOf,
  sideRoomY,
  sideViewAt,
  SUBPX,
  swordAttack,
  type GameState,
  type PixelBox,
} from "@fso/sim";
import * as THREE from "three";
import { Backdrop, J3D_BACKDROPS } from "./backdrop.ts";
import { BattleCamera, cameraView, type Point } from "./camera.ts";
import { quakeOffset } from "./quake.ts";
import { DYNAMIC_ACTORS, EntityView } from "./entities.ts";
import { HUD_H, HUD_W, type BattleHud } from "./hud.ts";
import { CloudShadow } from "./cloudshadow.ts";
import { Lighting } from "./lighting.ts";
import { lightSources, roomLight } from "./lights.ts";
import { BattleParticles, drawnAsParticles } from "./particles.ts";
import { growAboutAnchor, heightScale, LINK_SHADOW, linkShadow, ShadowSprite } from "./shadows.ts";
import { exitMarks, GBA_H, GBA_W, gbaView, insetRect, type SideRoomArea } from "./siderooms.ts";
import { afterimageRect, afterimages, endCamera, linkShown, winnerPose, type Afterimage } from "./timeline.ts";

/** The TV frame: the game renders (and lays its HUD out) in 608×448. */
export const FRAME_ASPECT = HUD_W / HUD_H;

// Depths: backdrop (0.1+) < base layer (1) < floor decals (1.5) < actors and Links (2 + y / 1024) < top layer (3) < debug.
/** BBSL's rise: the ends (ticks into it) of frames 257-262; 263 after (its table 0x804AC4C4: 3, 6, 6, 3, 3, 3, 6). */
const RISE_STEPS = [3, 9, 15, 18, 21, 24] as const;
const DEPTH_PER_PIXEL = 1 / 1024;
/** Added to a tileset index: its textures with the river bed's water palette (riverBedPalettes). */
const RIVER_BED_TILES = 1000;
const HEAD_HEIGHT = 16; // room px from a Link's anchor to just over his cap (the hurtbox's top is at -14)
/** Actor types drawn flat on the floor, under every Link, rather than y-sorted with them. */
const FLOOR_ACTORS = new Set(["CIRC"]);
/** Actor types not drawn: the player starts (the Links stand there). */
const SKIPPED_ACTORS = new Set(["PLAS"]);

export type CameraMode = "fit" | "full";

export class ArenaView {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly arena = new THREE.Group();
  private readonly statics = new THREE.Group();
  private readonly actors = new THREE.Group();
  private readonly backdrop: Backdrop;
  private readonly camera = new THREE.OrthographicCamera();
  private readonly canvas: HTMLCanvasElement;
  private readonly data: RarcArchive;
  private readonly stage: Stage;
  private readonly tileTypes: Uint16Array;
  /** The rooms' tilesets by index (+ RIVER_BED_TILES: with the river bed's half-transparent water). */
  private readonly tiles = new Map<number, TilemapTextures>();
  /** The side rooms' tilesets, in the GBA palettes (`_gb_`). */
  private readonly gbaTiles = new Map<number, TilemapTextures>();
  /** The arena's side rooms: where each one's tiles are (world px), what its GBA view stays inside. */
  private sideRooms: SideRoomArea[] = [];
  private readonly insetCamera = new THREE.OrthographicCamera();
  /** Which players get a GBA inset while in a side room (online: this browser's own); null = every player. */
  insetPlayers: readonly number[] | null = null;
  /** Per tunic color (playerPaletteMap): made when a match first has that many Links. */
  private readonly atlases: SpriteAtlas[] = [];
  private readonly sheet: SpriteSheet;
  private readonly linkFrames: SpriteFrame[];
  /** The sprite sheet and frame lists the actors are drawn from (also the HUD's carrot icon, hud-icons.ts). */
  readonly actorSources: ActorSpriteSources;
  /** The sim's battle entities (entities.ts): bombs, shots, orbs, hazards, lifted things. */
  readonly entities: EntityView;
  /** The room's light: the Dark World's darkness, the Tower of Flames' warm light (lights.ts). */
  readonly lighting: Lighting;
  /** The Field's and Hyrule Castle's drifting cloud shadows (cloudshadow.ts). */
  readonly clouds: CloudShadow;
  /** The Field's river bed under its lake's water (@fso/render riverbed.ts). */
  readonly riverBed: RiverBed;
  /** The game's particle effects (particles.ts): jets, fireballs, flames, fuses, explosions, debris. */
  readonly particles: BattleParticles;
  private shownTiles: TilemapTextures[] = [];
  private links: SpriteMesh[] = [];
  private linkShadows: ShadowSprite[] = [];
  /** BBSL (giantbomb.ts): player_sob in its own palette 7 (no tunic), see-through as he fades; made when he's first seen. */
  private shadowLink: ShadowSprite | null = null;
  private darkAtlas: SpriteAtlas | null = null;
  /** The Shadow Link's frame drawn in the last frame, -1 if none (for tests). */
  shadowLinkFrame = -1;
  private debugBoxes: THREE.Mesh[] = [];
  /** What the camera may show (px from the origin): the arena room, or the whole free-play map. */
  private bounds = { w: ARENA_W, h: ARENA_H };
  /** The map showMap last built (its meshes stay up while it's shown again). */
  private map: { stage: Stage; rooms: readonly (readonly number[])[] } | null = null;
  private view = { x: ARENA_W / 2, y: ARENA_H / 2, h: ARENA_H };
  private snap = true;
  private battleCamera: BattleCamera | null = null;
  private cameraRound = -1;
  /** The arena's FOCS actors: points the camera keeps in view during play (Hyrule Castle, Above the Clouds). */
  private focus: Point[] = [];
  /** The intro's afterimages: the frame's copy and its quads, drawn in the TV's 608×448 (timeline.ts afterimages). */
  private frameCopy: THREE.FramebufferTexture | null = null;
  private readonly afterimageQuads: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[] = [];
  private readonly afterimageScene = new THREE.Scene();
  private readonly afterimageCamera = screenCamera(HUD_W, HUD_H);
  /** Actor pieces drawn in the current arena (for tests). */
  drawnActors: { id: string; x: number; y: number; pieces: number }[] = [];
  cameraMode: CameraMode = "fit";
  debug = false;
  hud: BattleHud | null = null;

  constructor(canvas: HTMLCanvasElement, data: RarcArchive, stage: Stage, tileTypes: Uint16Array, sheet: SpriteSheet, linkFrames: SpriteFrame[]) {
    this.canvas = canvas;
    this.data = data;
    this.stage = stage;
    this.tileTypes = tileTypes;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    this.renderer.setClearColor(0x000000);
    this.renderer.autoClear = false;
    this.backdrop = new Backdrop(stage.archive, data);
    this.scene.add(this.backdrop.group, this.arena, this.statics, this.actors);
    this.sheet = sheet;
    this.linkFrames = linkFrames;
    const sobs: ActorSpriteSources["sobs"] = { player: linkFrames };
    for (const [key, file] of Object.entries(ACTOR_SOB_FILES)) {
      if (key === "player") continue;
      try {
        sobs[key as ActorSob] = loadSob(data, file);
      } catch {
        // A missing list only disables the pieces that use it.
      }
    }
    this.actorSources = { sheet, sobs };
    this.entities = new EntityView(this.actorSources, data);
    this.scene.add(this.entities.group);
    this.lighting = new Lighting(data);
    this.clouds = new CloudShadow(data);
    if (this.clouds.mesh) this.scene.add(this.clouds.mesh);
    this.riverBed = new RiverBed(data);
    if (this.riverBed.mesh) this.scene.add(this.riverBed.mesh);
    this.particles = new BattleParticles(data);
    this.scene.add(this.particles.group);
    if (this.particles.loaded) this.entities.asParticles = drawnAsParticles;
  }

  /** main2D.arc (the giant bomb's countdown digits: entities.ts). */
  setDigits(main2D: RarcArchive): void {
    this.entities.setDigits(main2D);
  }

  /** Builds the scene for one arena room and `players` Links. */
  show(room: number, players: number): void {
    this.map = null;
    disposeChildren(this.arena);
    disposeChildren(this.statics);
    const water = hasRiverBed(this.stage, room) && !!this.riverBed.mesh;
    const tiles = this.tilesOf(this.stage, room, water);
    const filter = this.filterOf(this.stage, room);
    const origin = { x: 0, y: 0 };
    const top = this.stage.layer(room, 2), collision = this.stage.layer(room, 1);
    const base = withTrickFloors(collision, this.stage, this.data, room);
    this.backdrop.show(room, 0.1);
    // (Room r of boss500 sits at grid cell (r mod 5, r div 5), as backdrop.ts.)
    if (water) this.riverBed.show({ x: (room % 5) * ROOM_W, y: Math.floor(room / 5) * ROOM_H }, 0.5);
    else this.riverBed.hide();
    const baseMesh = base ? roomQuad(base, tiles, filter, origin, 1) : null;
    if (baseMesh) this.arena.add(baseMesh);
    const types = this.tileTypes;
    const bases = new Map<number, THREE.Mesh>(baseMesh ? [[0, baseMesh]] : []);
    const layers = new Map<number, Uint16Array>(collision ? [[0, collision]] : []);
    if (top) this.arena.add(roomQuad(top, tiles, filter, origin, 3));
    this.clouds.show(this.stage, room, 2.9); // over every sprite (below 2.5), under the top layer (3)
    if (this.debug && collision) this.arena.add(collisionQuad(collision, this.tileTypes, origin, 3.5));
    // The side rooms, below the arena (the sim's places for them), drawn as the GBA draws them.
    this.sideRooms = [];
    this.shownTiles = [tiles];
    const { rooms } = sideRoomsOf(this.stage, types, room);
    for (let k = 1; k < 8; k++) {
      const sideBase = rooms & (1 << k) ? this.stage.layer(room, 1, k) : null;
      if (!sideBase) continue;
      const gba = this.gbaTilesOf(room), at = { x: 0, y: sideRoomY(k) };
      const mesh = roomQuad(sideBase, gba, null, at, 1);
      this.arena.add(mesh);
      bases.set(k, mesh);
      layers.set(k, sideBase);
      const sideTop = this.stage.layer(room, 2, k);
      if (sideTop) this.arena.add(roomQuad(sideTop, gba, null, at, 3));
      if (this.debug) this.arena.add(collisionQuad(sideBase, types, at, 3.5));
      if (!this.shownTiles.includes(gba)) this.shownTiles.push(gba);
      this.sideRooms.push({ screen: k, ...tileExtent(sideBase, at.y) });
    }
    this.entities.show(bases, (x, y) => {
      const k = screenAt(y * SUBPX), layer = layers.get(k), ly = y - sideRoomY(k);
      return layer && x >= 0 && ly >= 0 && x < ARENA_W && ly < ARENA_H ? types[layer[(ly >> 4) * 32 + (x >> 4)]! & 0x3ff]! : 0;
    });
    this.showActors(room);
    this.showLinks(players);
    // (The side-view gates' glow: SVGT, on the TV and in the side rooms shown.)
    const gates = this.stage
      .actors(room)
      .filter((a) => a.id === "SVGT" && (a.sublayer === 0 || bases.has(a.sublayer)))
      .map((a) => ({ id: a.id, params: a.params, x: actorPixel(a).x, y: actorPixel(a).y + sideRoomY(a.sublayer) }));
    // (The Tower of Flames' embers come with its lava, SWEV bit 18.)
    const embers = (J3D_BACKDROPS[room] ?? []).includes(ENV_MODELS.yougan);
    this.particles.reset(`arena ${room}`, (x, y) => (collision && x >= 0 && y >= 0 && x < ARENA_W && y < ARENA_H ? types[collision[(y >> 4) * 32 + (x >> 4)]! & 0x3ff]! : 0), gates, { embers });
    this.lighting.show(roomLight(this.stage, room));
    this.bounds = { w: ARENA_W, h: ARENA_H };
    this.focus = this.stage.actors(room).filter((a) => a.id === "FOCS" && a.sublayer === 0).map((a) => actorPixel(a));
    this.snap = true;
  }

  /**
   * Builds the scene for free play: `stage`'s `rooms` (rows of room numbers) side by side from the origin, their base
   * and top layers, and `players` Links. Shown again (free play restarting for someone who joined or left), the map
   * stays up and the camera goes on from where it was.
   */
  showMap(stage: Stage, rooms: readonly (readonly number[])[], players: number): void {
    const again = this.map?.stage === stage && this.map.rooms === rooms;
    this.map = { stage, rooms };
    if (!again) {
      disposeChildren(this.arena);
      disposeChildren(this.statics);
      this.drawnActors = [];
      this.backdrop.clear();
      this.clouds.hide();
      this.riverBed.hide();
      this.lighting.show(null);
      this.shownTiles = [];
      this.sideRooms = [];
      const layers: { collision: Uint16Array | null; x: number; y: number }[] = [];
      const filters = new Map<number, THREE.Texture | null>();
      rooms.forEach((row, cy) =>
        row.forEach((room, cx) => {
          const id = stage.overlayTextureIdOf(room);
          if (!filters.has(id)) filters.set(id, this.filterOf(stage, room));
          const tiles = this.tilesOf(stage, room), filter = filters.get(id)!;
          const origin = { x: cx * ROOM_W, y: cy * ROOM_H };
          const base = stage.layer(room, 1), top = stage.layer(room, 2);
          if (base) this.arena.add(roomQuad(base, tiles, filter, origin, 1));
          if (top) this.arena.add(roomQuad(top, tiles, filter, origin, 3));
          if (this.debug && base) this.arena.add(collisionQuad(base, this.tileTypes, origin, 3.5));
          if (!this.shownTiles.includes(tiles)) this.shownTiles.push(tiles);
          layers.push({ collision: base, ...origin });
        }),
      );
      const types = this.tileTypes;
      const groundType = (x: number, y: number) => {
        const l = layers.find((r) => x >= r.x && y >= r.y && x < r.x + ROOM_W && y < r.y + ROOM_H);
        return l?.collision ? types[l.collision[((y - l.y) >> 4) * 32 + ((x - l.x) >> 4)]! & 0x3ff]! : 0;
      };
      this.entities.show(new Map(), groundType);
      this.bounds = { w: (rooms[0]?.length ?? 1) * ROOM_W, h: rooms.length * ROOM_H };
      this.focus = [];
      this.particles.reset("map", groundType);
    }
    this.showLinks(players);
    this.snap ||= !again;
  }

  /** The Links' sprites, shadows and debug boxes for `players` Links. */
  private showLinks(players: number): void {
    disposeChildren(this.actors);
    this.shadowLink = null;
    this.links = Array.from({ length: players }, (_, i) => new SpriteMesh(this.atlas(i)));
    for (const shadow of this.linkShadows) shadow.material.dispose();
    this.linkShadows = Array.from({ length: players }, (_, i) => new ShadowSprite(this.atlas(i), LINK_SHADOW.color));
    this.actors.add(...this.linkShadows);
    // Per Link: his body (yellow) and his sword's two attack boxes on other Links (red, attacks.ts).
    this.debugBoxes = this.debug ? Array.from({ length: players * 3 }, (_, i) => boxMesh(i % 3 ? 0xff4040 : 0xffff00)) : [];
    this.actors.add(...this.links, ...this.debugBoxes);
  }

  /** Player i's tunic: green, red, blue, purple, then free play's yellow, cyan, white, black. */
  private atlas(i: number): SpriteAtlas {
    while (this.atlases.length <= i) {
      const atlas = new SpriteAtlas(this.sheet, this.linkFrames, playerPaletteMap(this.atlases.length));
      atlas.texture.userData.shared = true;
      this.atlases.push(atlas);
    }
    return this.atlases[i]!;
  }

  private tilesOf(stage: Stage, room: number, water = false): TilemapTextures {
    const index = stage.tilesetIndexOf(room), key = index + (water ? RIVER_BED_TILES : 0);
    let tiles = this.tiles.get(key);
    if (!tiles) {
      const tileset = loadTileset(this.data, index);
      this.tiles.set(key, (tiles = new TilemapTextures(water ? { ...tileset, palettes: riverBedPalettes(tileset.palettes) } : tileset)));
    }
    return tiles;
  }

  /** The room's tileset as a GBA screen draws it (its `_gb_` palettes, and the GBA's character sheet where it has one). */
  private gbaTilesOf(room: number): TilemapTextures {
    const index = this.stage.tilesetIndexOf(room);
    let tiles = this.gbaTiles.get(index);
    if (!tiles) this.gbaTiles.set(index, (tiles = new TilemapTextures(loadTileset(this.data, index, "gba"))));
    return tiles;
  }

  private filterOf(stage: Stage, room: number): THREE.Texture | null {
    const overlay = loadOverlay(this.data, stage.overlayTextureIdOf(room));
    return overlay ? overlayTexture(overlay) : null;
  }

  // The room's TV actors as static sprites (docs/formats/sprites-and-actors.md "Actor graphics"), except the ones the sim animates
  // (bombs, flames, soldiers, orb generators, bees: entities.ts draws those); y-sorted with the Links, except floor decals.
  private showActors(room: number): void {
    const screens = new Set([0, ...this.sideRooms.map((s) => s.screen)]);
    const placed = this.stage.actors(room).filter((a) => screens.has(a.sublayer) && !SKIPPED_ACTORS.has(a.id) && !DYNAMIC_ACTORS.has(a.id));
    const drawn = placed
      .map((a) => {
        const at = actorPixel(a);
        return { actor: a, x: at.x, y: at.y + sideRoomY(a.sublayer), pieces: actorPieces(a) };
      })
      .filter((p) => p.pieces.length);
    this.drawnActors = drawn.filter((p) => p.actor.sublayer === 0).map((p) => ({ id: p.actor.id, x: p.x, y: p.y, pieces: p.pieces.length }));
    const floor: PlacedPieces[] = drawn.filter((p) => FLOOR_ACTORS.has(p.actor.id));
    const standing: PlacedPieces[] = drawn.filter((p) => !FLOOR_ACTORS.has(p.actor.id));
    for (const mesh of actorSpriteMeshes(this.actorSources, floor, 1.5)) this.statics.add(mesh);
    for (const mesh of actorSpriteMeshes(this.actorSources, standing, 2, { depthPerPixel: DEPTH_PER_PIXEL })) this.statics.add(mesh);
  }

  /** Moves the camera (camera.ts, the game's law); call once per simulation tick. */
  follow(game: GameState): void {
    const b = game.battle, round = b ? b.round : 0;
    const end = b ? endCamera(b) : null;
    if (this.snap || !this.battleCamera || round !== this.cameraRound) {
      // A round's start: the box is around the Links (the focus points join once play starts).
      this.battleCamera = new BattleCamera(this.followed(game, false));
      this.cameraRound = round;
      this.snap = false;
    } else if (end) this.battleCamera.step(this.ending(game, end), true);
    else this.battleCamera.step(this.followed(game, b?.phase !== "countdown"));
    const { w, h } = this.bounds;
    const v = cameraView(this.battleCamera.box, w, h, FRAME_ASPECT);
    this.view = this.cameraMode === "full" ? { x: w / 2, y: h / 2, h: Math.max(h, w / FRAME_ASPECT) } : { x: v.x, y: v.y, h: v.h };
  }

  /**
   * What the camera follows: the Links still in the round (all of them when nobody is), the arena's FOCS, and Vaati
   * at time-out (measured: the camera shows the whole arena's width from when he comes in).
   */
  private followed(game: GameState, focus: boolean): Point[] {
    const fighters = game.battle?.fighters ?? [];
    // Not the Links in side rooms (traced: with every Link in The Field's house the camera held still).
    const onTv = game.players.filter((p) => screenAt(p.y) === 0);
    let shown = onTv.filter((p) => (fighters[game.players.indexOf(p)]?.hearts ?? 1) > 0);
    if (!fighters.some((f) => f.hearts > 0)) shown = onTv;
    const links = shown.map((p) => ({ x: p.x / SUBPX, y: p.y / SUBPX }));
    const vaati = (game.battle?.entities ?? []).filter((e) => e.kind === "giantBomb" && e.hp >= 0).map((e) => ({ x: e.x / SUBPX, y: e.y / SUBPX }));
    // BBSL puts himself among the camera's points (0x8030C210) while he's about (states 2-8, 11). TODO(measure)
    const shadow = (game.battle?.entities ?? [])
      .filter((e) => e.kind === "shadowLink" && ((e.param >= SHADOW.unseen && e.param <= SHADOW.fading) || e.param === SHADOW.back))
      .map((e) => ({ x: e.x / SUBPX, y: (e.y - e.z) / SUBPX }));
    return focus ? [...links, ...this.focus, ...vaati, ...shadow] : links;
  }

  /**
   * BBSL (draw 0x80340EC8, state table 0x804AC524): rising on the Roc's Feather jump's frames 257-263 (3, 6, 6, 3, 3, 3,
   * 6 ticks), hovering on 816, holding the bomb on 258, throwing on 813 ×9, 814, 815 ×8, then 816; fading out 0.1 a
   * tick; back, fading in over 60 ticks turning (806, 811, 816, 821 every 4 ticks), tinted as he fades.
   */
  private drawShadowLink(game: GameState): void {
    const e = game.battle?.entities.find((x) => x.kind === "shadowLink" && x.hp >= 0);
    this.shadowLinkFrame = -1;
    if (!e || !shadowShown(e)) {
      if (this.shadowLink) this.shadowLink.visible = false;
      return;
    }
    if (!this.darkAtlas) {
      this.darkAtlas = new SpriteAtlas(this.sheet, this.linkFrames);
      this.darkAtlas.texture.userData.shared = true;
    }
    if (!this.shadowLink) this.actors.add((this.shadowLink = new ShadowSprite(this.darkAtlas, null)));
    const mesh = this.shadowLink;
    const t = e.tick;
    let frame = 816, alpha = 255;
    if (e.param === SHADOW.rising) frame = 257 + RISE_STEPS.filter((end) => t >= end).length;
    else if (e.param === SHADOW.holding) frame = 258;
    else if (e.param === SHADOW.throwing) frame = t < 9 ? 813 : t < 10 ? 814 : t < 18 ? 815 : 816;
    else if (e.param === SHADOW.fading) alpha = Math.max(0, 255 - 25.5 * t);
    else if (e.param === SHADOW.back) [frame, alpha] = [[806, 811, 816, 821][Math.floor(t / 4) % 4]!, Math.min(255, (255 * t) / 60)];
    // His color matrix (draw 0x80340EC8, with his fade +0x250 = a): red × a, green and blue × (2 − a), or × (3 − 2a)
    // while he fades out: a cyan glow as he goes and comes back (1, 1, 1 at full strength).
    const a = alpha / 255, glow = e.param === SHADOW.fading ? 3 - 2 * a : 2 - a;
    mesh.setTint(a, glow, glow);
    const x = Math.floor(e.x / SUBPX), y = Math.floor(e.y / SUBPX), z = Math.floor(e.z / SUBPX);
    mesh.setFrame(frame);
    mesh.place(x, y - z, 2 + y * DEPTH_PER_PIXEL, 1, 1, alpha);
    if (mesh.visible) this.shadowLinkFrame = frame;
  }

  /**
   * What the camera follows at a round's end (timeline.ts endCamera): every Link on the TV, the knocked-out ones where
   * they lie, then the winner alone (traced; not the players gone from an online match).
   */
  private ending(game: GameState, end: "all" | "winner"): Point[] {
    const b = game.battle!;
    const at = (i: number) => ({ x: game.players[i]!.x / SUBPX, y: game.players[i]!.y / SUBPX });
    const winner = b.roundWinner;
    if (end === "winner" && game.players[winner] && screenAt(game.players[winner].y) === 0) return [at(winner)];
    return game.players.flatMap((p, i) => (screenAt(p.y) === 0 && !(b.fighters[i]?.mode === "dead" && (b.downs[i] ?? -1) < 0) ? [at(i)] : []));
  }

  /** The TV frame inside the canvas, in CSS px (the largest 608:448 rectangle, centered). */
  frame(): { x: number; y: number; w: number; h: number } {
    const cw = this.canvas.clientWidth, ch = this.canvas.clientHeight;
    const w = Math.min(cw, ch * FRAME_ASPECT), h = w / FRAME_ASPECT;
    return { x: (cw - w) / 2, y: (ch - h) / 2, w, h };
  }

  /**
   * Draws `game`: the arena, then the HUD's scene over it. `covered`: the game's screens hide the arena entirely (the
   * Total screen), so only the HUD's scene is drawn (and nothing of the arena is updated).
   */
  render(game: GameState, covered = false): void {
    this.covered = covered;
    if (!covered) this.updateArena(game);
    this.draw(game, covered);
  }

  /** Whether the last frame skipped the arena (tests, the perf profile). */
  covered = false;

  /** Link i's player_sob frame as drawn now, -1 for none. */
  linkFrame(game: GameState, i: number): number {
    const b = game.battle, p = game.players[i], f = b?.fighters[i];
    if (!p || !f) return -1;
    // (The TV keeps the normal blade through a full charge: its glow is the charge effects, charge.ts.)
    let frame = fighterFrame(p, f, linkActionFrame);
    if (b) {
      // As the game shows them (timeline.ts): a knocked-out Link lies where he fell for the rest of the round, the
      // winner raises his sword, and nobody shows in the intro until his portal bursts.
      if (f.mode === "dead" && (b.downs[i] ?? -1) >= 0) frame = DEAD_FRAME;
      frame = winnerPose(b, i) ?? frame;
      if (!linkShown(b)) frame = -1;
    }
    return frame;
  }

  /** Link i's sprite as drawn now (his tunic's atlas and frame), for the HUD's side-room disc; null for none. */
  linkSprite(game: GameState, i: number): { atlas: SpriteAtlas; frame: number } | null {
    const frame = this.linkFrame(game, i);
    return frame >= 0 && i < this.links.length ? { atlas: this.atlas(i), frame } : null;
  }

  private updateArena(game: GameState): void {
    const b = game.battle, fighters = b?.fighters;
    this.links.forEach((link, i) => {
      const p = game.players[i], f = fighters?.[i];
      if (!p || !f) return;
      const frame = this.linkFrame(game, i);
      const shadow = this.linkShadows[i]!;
      link.visible = frame >= 0 && (fighterVisible(f) || frame === DEAD_FRAME);
      shadow.visible = link.visible && !(game.battle && sideViewAt(game.battle, p.y)); // (none in side view: frame dumps)
      if (frame < 0) return;
      const x = Math.floor(p.x / SUBPX), y = Math.floor(p.y / SUBPX), h = fighterHeight(f);
      link.setFrame(frame);
      // Held and thrown Links are drawn up in the air, over their carrier, a little bigger (shadows.ts).
      link.place(x, y - h, 2 + (y + (f.heldBy >= 0 || f.z > 0 ? 1 : 0)) * DEPTH_PER_PIXEL);
      growAboutAnchor(link, this.atlas(i), frame, x, y - h, heightScale(h));
      if (f.squash < 100) {
        // Flattened by a hammer (Link +0xC8C, packages/sim hammer.ts): his height scaled about his feet.
        const k = f.squash / 100, feet = -(y - h);
        link.scale.y *= k;
        link.position.y = feet + (link.position.y - feet) * k;
      }
      // His shadow stays on the ground under him (a held Link's ground position is under him too).
      if (shadow.visible) {
        const s = linkShadow(x, y, h);
        shadow.setFrame(frame);
        shadow.place(s.x, s.y, 2 + (y - 0.5) * DEPTH_PER_PIXEL, s.sx, s.sy, s.opacity);
      }
      if (this.debug) {
        placeBox(this.debugBoxes[i * 3]!, { left: x + HURTBOX.left, top: y + HURTBOX.top, right: x + HURTBOX.right, bottom: y + HURTBOX.bottom });
        const attack = f.mode === "active" ? swordAttack(p) : null;
        const px = (b: { left: number; top: number; right: number; bottom: number }) => ({ left: Math.floor(b.left / SUBPX), top: Math.floor(b.top / SUBPX), right: Math.floor(b.right / SUBPX), bottom: Math.floor(b.bottom / SUBPX) });
        placeBox(this.debugBoxes[i * 3 + 1]!, attack ? px(attack.boxes[0]) : null);
        placeBox(this.debugBoxes[i * 3 + 2]!, attack ? px(attack.boxes[1]) : null);
      }
    });
    this.drawShadowLink(game);
    this.entities.update(game);
    this.particles.update(game, this.view);
    for (const tiles of this.shownTiles) tiles.setTick(game.tick);
  }

  private draw(game: GameState, covered: boolean): void {
    const b = game.battle;
    const dpr = pixelRatio(), cw = this.canvas.clientWidth, ch = this.canvas.clientHeight;
    if (this.canvas.width !== Math.round(cw * dpr) || this.canvas.height !== Math.round(ch * dpr)) {
      this.renderer.setPixelRatio(dpr);
      this.renderer.setSize(cw, ch, false);
    }
    const tv = this.frame();
    // Device pixels per room pixel; the center is snapped to the device-pixel grid so tiles don't shimmer.
    const scale = (tv.h * dpr) / this.view.h;
    const halfW = (tv.w * dpr) / scale / 2, halfH = this.view.h / 2;
    // (The screen quakes, quake.ts: the view shaken up and down.)
    const cx = Math.round(this.view.x * scale) / scale, cy = Math.round((this.view.y + quakeOffset(game)) * scale) / scale;
    Object.assign(this.camera, { left: cx - halfW, right: cx + halfW, top: -cy + halfH, bottom: -cy - halfH, near: -10, far: 10 });
    this.camera.updateProjectionMatrix();
    this.backdrop.update({ x: cx, y: cy }, game.tick);
    this.clouds.update(game.tick);
    this.riverBed.update({ x: cx, y: cy }, game.tick, this.clouds.levelAt(game.tick));

    const r = this.renderer;
    r.setScissorTest(false);
    r.setViewport(0, 0, cw, ch);
    r.clear();
    r.setViewport(tv.x, ch - tv.y - tv.h, tv.w, tv.h);
    r.setScissor(tv.x, ch - tv.y - tv.h, tv.w, tv.h);
    r.setScissorTest(true);
    if (!covered) {
      r.render(this.scene, this.camera);
      // The heat haze over flames and fireballs: a copy of the frame so far, shifted (only while one shows).
      this.particles.drawDistortion(r, this.camera, tv.x * dpr, (ch - tv.y - tv.h) * dpr, tv.w * dpr, tv.h * dpr);
      // The room's light (the Dark World's darkness): tints the frame and darkens it away from the lights and the Links.
      if (this.lighting.active) this.lighting.render(r, this.camera, lightSources(game), this.links, tv.w * dpr, tv.h * dpr);
      // The intro's afterimages: a copy of this frame closing in on each player in turn (timeline.ts afterimages).
      if (b?.phase === "countdown") this.renderAfterimages(game, afterimages(b.phaseTick, Math.min(b.fighters.length, 4)), tv, ch, dpr);
    }
    if (this.hud) {
      r.clearDepth();
      r.render(this.hud.scene, this.hud.camera);
    }
    if (!covered) this.renderInsets(game, tv, ch);
    r.setScissorTest(false);
    opaqueFrame(r);
  }

  /**
   * The players in side rooms who get a GBA inset (insetPlayers), with each one's side room and the inset's rectangle
   * in the TV frame (CSS px from its top left).
   */
  insets(game: GameState): { player: number; area: SideRoomArea; x: number; y: number; w: number; h: number }[] {
    const tv = this.frame(), k = tv.w / HUD_W;
    return game.players.flatMap((p, i) => {
      const area = this.sideRooms.find((s) => s.screen === screenAt(p.y));
      const f = game.battle?.fighters[i];
      if (!area || !f || f.mode === "dead" || (this.insetPlayers && !this.insetPlayers.includes(i))) return [];
      const r = insetRect(i);
      return [{ player: i, area, x: r.x * k, y: r.y * k, w: r.w * k, h: r.h * k }];
    });
  }

  /** The Links coming out of a door onto the TV (siderooms.ts exitMarks), on the TV frame (CSS px from its top left). */
  exitPoints(game: GameState): { player: number; x: number; y: number; down?: boolean }[] {
    const tv = this.frame(), cam = this.camera;
    return exitMarks(game).map((m) => ({ player: m.player, down: m.down, x: ((m.x - cam.left) / (cam.right - cam.left)) * tv.w, y: ((-m.y - cam.top) / (cam.bottom - cam.top)) * tv.h }));
  }

  // Each inset: the scene again, through a camera over the GBA's 240 × 160 px of the player's side room (no backdrop,
  // river bed, cloud shadows or room light: those are the TV's).
  private renderInsets(game: GameState, tv: { x: number; y: number; w: number; h: number }, ch: number): void {
    const insets = this.insets(game);
    if (!insets.length) return;
    const r = this.renderer;
    const hidden = ([this.backdrop.group, this.riverBed.mesh, this.clouds.mesh] as (THREE.Object3D | null)[]).filter((o): o is THREE.Object3D => !!o && o.visible);
    for (const o of hidden) o.visible = false;
    for (const inset of insets) {
      const p = game.players[inset.player]!;
      const at = gbaView(inset.area, p.x / SUBPX, p.y / SUBPX);
      Object.assign(this.insetCamera, { left: at.x, right: at.x + GBA_W, top: -at.y, bottom: -(at.y + GBA_H), near: -10, far: 10 });
      this.insetCamera.updateProjectionMatrix();
      const x = tv.x + inset.x, y = ch - (tv.y + inset.y + inset.h);
      r.setViewport(x, y, inset.w, inset.h);
      r.setScissor(x, y, inset.w, inset.h);
      r.setClearColor(0x000000);
      r.clear(true, true);
      r.render(this.scene, this.insetCamera);
    }
    for (const o of hidden) o.visible = true;
  }

  // The game copies the frame (its EFB) and draws the copy again over the whole screen, faded, its part shown closing in
  // from the whole frame onto a 40×30 box round the Link: a zoom onto him (main.dol 0x8015F9C0; a TV viewport copy here).
  private renderAfterimages(game: GameState, images: Afterimage[], tv: { x: number; y: number; w: number; h: number }, ch: number, dpr: number): void {
    if (!images.length) return;
    const w = Math.round(tv.w * dpr), h = Math.round(tv.h * dpr);
    if (!this.frameCopy || this.frameCopy.image.width !== w || this.frameCopy.image.height !== h) {
      this.frameCopy?.dispose();
      this.frameCopy = new THREE.FramebufferTexture(w, h);
      for (const quad of this.afterimageQuads) quad.material.map = this.frameCopy;
    }
    this.renderer.copyFramebufferToTexture(this.frameCopy, new THREE.Vector2(Math.round(tv.x * dpr), Math.round((ch - tv.y - tv.h) * dpr)));
    const cam = this.camera;
    images.forEach((a, k) => {
      let quad = this.afterimageQuads[k];
      if (!quad) {
        quad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: this.frameCopy, transparent: true, depthTest: false, depthWrite: false }));
        quad.frustumCulled = false;
        this.afterimageQuads.push(quad);
        this.afterimageScene.add(quad);
      }
      const p = game.players[a.player]!;
      const sx = ((p.x / SUBPX - cam.left) / (cam.right - cam.left)) * HUD_W, sy = ((-p.y / SUBPX - cam.top) / (cam.bottom - cam.top)) * HUD_H;
      // The whole screen, showing the copy's part `r` of it (a zoom onto the Link: Dolphin's frames are magnified).
      const r = afterimageRect(a, sx, sy), uv = quad.geometry.getAttribute("uv") as THREE.BufferAttribute;
      const [u0, u1, v0, v1] = [r.x0 / HUD_W, r.x1 / HUD_W, 1 - r.y0 / HUD_H, 1 - r.y1 / HUD_H];
      uv.setXY(0, u0, v0).setXY(1, u1, v0).setXY(2, u0, v1).setXY(3, u1, v1);
      uv.needsUpdate = true;
      quad.scale.set(HUD_W, HUD_H, 1);
      quad.position.set(HUD_W / 2, -HUD_H / 2, 0);
      quad.material.opacity = a.alpha;
      quad.visible = true;
    });
    for (let k = images.length; k < this.afterimageQuads.length; k++) this.afterimageQuads[k]!.visible = false;
    this.renderer.render(this.afterimageScene, this.afterimageCamera);
  }

  /**
   * Where each Link's head is on the TV frame (CSS px from its top left) as last rendered, or null while he isn't
   * drawn: out of the round, falling into a pit, dying. (The name tags, nametags.ts.)
   */
  heads(game: GameState): ({ x: number; y: number } | null)[] {
    const tv = this.frame(), cam = this.camera;
    const fighters = game.battle?.fighters;
    return game.players.map((p, i) => {
      const f = fighters?.[i];
      if (!f || f.mode === "dead" || f.mode === "dying" || f.mode === "falling" || screenAt(p.y) !== 0) return null;
      const x = p.x / SUBPX, y = p.y / SUBPX - fighterHeight(f) - HEAD_HEIGHT;
      return { x: ((x - cam.left) / (cam.right - cam.left)) * tv.w, y: ((-y - cam.top) / (cam.bottom - cam.top)) * tv.h };
    });
  }

  /**
   * Where each Link stands on the 608×448 screen as last rendered (his anchor; null off the TV or gone from an online
   * match), and how many screen px 16 room px make (what the HUD's corners test, hud.ts).
   */
  screenLinks(game: GameState): { points: ({ x: number; y: number } | null)[]; px16: number } {
    const cam = this.camera, w = cam.right - cam.left, h = cam.bottom - cam.top;
    const b = game.battle;
    const points = game.players.map((p, i) => {
      if (screenAt(p.y) !== 0 || !w || (b?.fighters[i]?.mode === "dead" && (b.downs[i] ?? -1) < 0)) return null;
      return { x: ((p.x / SUBPX - cam.left) / w) * HUD_W, y: ((-p.y / SUBPX - cam.top) / h) * HUD_H };
    });
    return { points, px16: w ? (16 * HUD_W) / w : 0 };
  }

  /** Where a room pixel lands on the page (CSS px), for tests and effects. */
  toScreen(x: number, y: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const tv = this.frame();
    const cam = this.camera;
    return {
      x: rect.left + tv.x + ((x - cam.left) / (cam.right - cam.left)) * tv.w,
      y: rect.top + tv.y + ((-y - cam.top) / (cam.bottom - cam.top)) * tv.h,
    };
  }

  /** J3D models this arena would also show (not rendered yet). */
  get missingModels(): string[] {
    return this.backdrop.missing;
  }
}

/**
 * A TFLR "trick floor" (The Field's 4×4 square, whose own tiles are transparent) draws its closed floor from a data.arc
 * smp/ stamp of tiles (its draw method 0x802ACF04 lists field_smp.bin among others; the kind in its params isn't
 * decoded, so The Field's field_smp is used, the two 2×4 halves side by side). Returns a copy of the layer for drawing
 * only: the sim keeps the room's own tiles. TODO: the floor opening onto otosiana_bg_s.bti when the sim animates it.
 */
export function withTrickFloors(layer: Uint16Array | null, stage: Stage, data: RarcArchive, room: number): Uint16Array | null {
  const floors = stage.actors(room).filter((a) => a.id === "TFLR" && a.sublayer === 0);
  const stamp = data.files.find((f) => f.path === "smp/field_smp.bin");
  if (!layer || !floors.length || !stamp) return layer;
  const v = new DataView(stamp.data.buffer, stamp.data.byteOffset, stamp.data.byteLength);
  const out = new Uint16Array(layer);
  for (const a of floors) {
    const p = actorPixel(a);
    const x0 = Math.floor(p.x / 16), y0 = Math.floor(p.y / 16);
    for (let dy = 0; dy < 4; dy++) {
      for (let dx = 0; dx < 4; dx++) {
        const tile = v.getUint16((dy * 16 + (dx % 2)) * 2, true);
        const tx = x0 + dx, ty = y0 + dy;
        if (tile && tx < 32 && ty < 32) out[ty * 32 + tx] = tile;
      }
    }
  }
  return out;
}

/**
 * Where a side room's tiles are (the box of its base layer's tiles but the empty 0 and the black filler 0x00F that
 * pads the rooms' layers; world px; the layer starts at y0).
 */
function tileExtent(layer: Uint16Array, y0: number): { left: number; top: number; right: number; bottom: number } {
  let left = 32, top = 32, right = 0, bottom = 0;
  for (let ty = 0; ty < 32; ty++) {
    for (let tx = 0; tx < 32; tx++) {
      const tile = layer[ty * 32 + tx]! & 0x3ff;
      if (tile === 0 || tile === 0x00f) continue;
      [left, top, right, bottom] = [Math.min(left, tx), Math.min(top, ty), Math.max(right, tx + 1), Math.max(bottom, ty + 1)];
    }
  }
  if (right === 0) [left, top] = [0, 0];
  return { left: left * 16, top: y0 + top * 16, right: right * 16, bottom: y0 + Math.min(bottom, ARENA_H / 16) * 16 };
}

function boxMesh(color: number): THREE.Mesh {
  return new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.4 }));
}

/** Shows an inclusive world-pixel box, or hides the mesh for null. */
function placeBox(mesh: THREE.Mesh, box: PixelBox | null): void {
  mesh.visible = box !== null;
  if (!box) return;
  mesh.scale.set(box.right - box.left + 1, box.bottom - box.top + 1, 1);
  mesh.position.set((box.left + box.right + 1) / 2, -(box.top + box.bottom + 1) / 2, 4);
}

