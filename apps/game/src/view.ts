// The adventure on screen, in the TV's 608×448 frame (letterboxed in the canvas, as apps/battle does): every room of
// the stage laid out on its grid (tile layers, ground overlay, animated tiles, the actors as static sprites), the
// current area's arena entities (apps/battle's EntityView: bushes, pots, bombs, explosions, shots…) and the Links
// y-sorted between the base and top layers, the camera following the leader within his room and panning on a room
// change (measured). Inside a GBA-screen area (a house, a cave) the area shows in a window over the TV, as the game
// does when playing alone with a controller. The current area's rocks (pushed, sunk, lifted: rocks.ts) are drawn where
// the sim has them instead of as static sprites. The environment as the game draws it: the river bed under the water
// and the cloud shadows (rooms whose SWEV turns them on), the SEV2 J3D effects (waterfalls, rainbows), the particles'
// screen distortions from a copy of the frame. It only reads the state.
import { ACTOR_SOB_FILES, actorPieces, type ActorPiece, decodeBti, fsaParticlePlacement, type EffectPlacement, isHiddenUnsimulated, loadOverlay, parseJpac, loadSob, loadTileset, playerPaletteMap, type ActorSob, type RarcArchive, type SpriteFrame, type SpriteSheet, type Stage } from "@fso/formats";
import {
  actorSpriteMeshes,
  blendLayer,
  collisionQuad,
  DistortionPass,
  disposeChildren,
  JpaEffects,
  overlayTexture,
  hasRiverBed,
  pixelRatio,
  RiverBed,
  riverBedPalettes,
  roomQuad,
  RoomPan,
  SpriteAtlas,
  SpriteMesh,
  stageParticles,
  StageEffects,
  TilemapTextures,
  type ActorSpriteSources,
  type JpaEffectSpec,
  type PlacedPieces,
  opaqueFrame,
} from "@fso/render";
import { fighterFrame, fighterHeight, fighterVisible, HURTBOX, linkDisplayFrame, SUBPX, switchOn, type PixelBox } from "@fso/sim";
import { adventureFrame, arrowBurning, BLADE_TRAP, bladeSparks, barrierUp, FIRE_TRAP_EFFECT, FIRE_TRAP_KIND, colorBlocks, doorLookTiles, drawnRewrites, ENEMY_TYPES, goneDoorwayFigures, launchHidden, linkAttack, minorShadowEffects, pedestalTiles, tingleShown, PICKUP_TYPES, pushFrame, ROCK_TYPES, savedSwitches, TOP_MODE_BLEND, topModeOf, WARP_IN_TICKS, type AdventureGame, type AdventureStage, type Area } from "@fso/sim/adventure";
import * as THREE from "three";
import { CloudShadow, cloudShadowLevel } from "../../battle/src/cloudshadow.ts";
import { EntityView } from "../../battle/src/entities.ts";
import { Lighting } from "../../battle/src/lighting.ts";
import { growAboutAnchor, heightScale, LINK_SHADOW, linkShadow, ShadowSprite } from "../../battle/src/shadows.ts";
import { EnemyView } from "./enemies.ts";
import { GanonView } from "./ganon.ts";
import type { AdventureHud } from "./hud.ts";
import type { DialogueBox } from "./dialogue.ts";
import type { GbaWindow } from "./gbawindow.ts";
import { AdventureLight } from "./light.ts";

/** The TV frame the game renders in (and lays its HUD out in). */
export const TV_W = 608;
export const TV_H = 448;
/** Room px the TV shows vertically: 448 / the adventure camera's zoom 2.1408 (measured in Lake Hylia). */
export const VIEW_H = TV_H / 2.1408;
const ROOM_W = 512, ROOM_H = 384;
// Depths: base layer (1) < floor decals (1.5) < actors and Links (2 + y / 1024) < top layer (3) < debug (3.5+).
const DEPTH_PER_PIXEL = 1 / 1024;
/** Ticks a blade trap's sparks stay listed (one-shot: they play out meanwhile). */
const SPARKS_LISTED = 60;
/** Actor types the view doesn't draw as static sprites: the player starts, and what the sim animates (the escort Zoras
 *  only show where the sim has them: EnemyView). */
const NOT_STATIC = new Set(["PLAS", "HBMB", "BLZ2", "BEEE", "FAZR", "FZRA", ...ENEMY_TYPES, ...PICKUP_TYPES]);
/**
 * The GBA window (gbawindow.ts; single player, a GBA-screen area on the TV): the GBA's 240×160 picture in the J2D
 * frame. It grows open over WINDOW_OPEN_TICKS from WINDOW_OPEN_AT ticks after the area switch, and shrinks over
 * WINDOW_CLOSE_TICKS once the Links are back on the TV (Dolphin frame dumps of Lake Hylia's house: growing from about
 * 24 frames after the switch, closing from about 5 after it). TODO(measure): the curves.
 */
export const GBA_W = 240, GBA_H = 160;
const WINDOW_OPEN_AT = 24, WINDOW_OPEN_TICKS = 16, WINDOW_CLOSE_TICKS = 20;
/** Without the J2D screen: the picture's place measured on a Dolphin frame (TV px). */
const WINDOW_FALLBACK = { x: 142, y: 138, w: 324, h: 216 };

/** A tile layer's texture the view patches (the PNPCs' tiles), with the values it replaced. */
interface Patchable {
  data: Uint16Array;
  texture: THREE.DataTexture;
  original: Map<number, number>;
}

interface RoomMeshes {
  origin: { x: number; y: number };
  base: THREE.Mesh | null;
  top: THREE.Mesh | null;
  statics: THREE.Group;
  hidden: string;
}

export class AdventureView {
  readonly renderer: THREE.WebGLRenderer;
  private readonly canvas: HTMLCanvasElement;
  private readonly data: RarcArchive;
  private readonly stage: Stage;
  private readonly adventure: AdventureStage;
  private readonly tileTypes: Uint16Array;
  private readonly tv = new THREE.Scene();
  private readonly tvCamera = new THREE.OrthographicCamera();
  private readonly gba = new THREE.Scene();
  private readonly gbaCamera = new THREE.OrthographicCamera();
  /** The GBA window's frame (main_gba_window.blo), when the screen was found. */
  gbaFrame: GbaWindow | null = null;
  /** The HUD (main_adv.blo), when the screen was found. */
  hud: AdventureHud | null = null;
  /** The signs' and people's message boxes (main2D's hukidashi screens), when they and the messages were found. */
  dialogue: DialogueBox | null = null;
  private windowRect = { ...WINDOW_FALLBACK };
  /** The Links and the arena's entities, in the current area's coordinates (moved to its room's origin on the TV). */
  private readonly local = new THREE.Group();
  private readonly tiles: TilemapTextures;
  /** The tileset with the river bed's half-transparent water (riverbed.ts), for the rooms whose SWEV turns it on. */
  private readonly waterTiles: TilemapTextures | null;
  /** The river bed under those rooms' water (one quad per room, under the base layer). */
  private readonly riverBed: RiverBed;
  /** The cloud shadows over the rooms whose SWEV turns them on (one quad per room, over the sprites). */
  private readonly clouds: CloudShadow;
  /** The stage's J3D effects (Lake Hylia's waterfalls, rainbows and morning light: SEV2 actors). */
  private readonly effects: StageEffects;
  private readonly gbaTiles: TilemapTextures;
  private readonly filter: THREE.Texture | null;
  // The particle effects the stage's actors keep up (the waterfalls' spray, torches, whirlpools; docs/formats/jpa.md "JPA particles"):
  // those of the leader's room and its neighbours, over the Links (z 2) and under the top layers (z 3).
  readonly particles: JpaEffects | null;
  /** Their screen distortions (a torch's haze, a whirlpool's swirl), drawn from a copy of the frame. */
  private readonly distortion = new DistortionPass();
  private readonly stageEffects: ReturnType<typeof stageParticles>;
  private nearRoom = -1;
  private near: ReturnType<typeof stageParticles> = [];
  /** The burning arrows' flames: entity id → the tick it was first seen burning. */
  private readonly arrowFlames = new Map<number, number>();
  /** The rooms' actor lists (the torches' kinds and switches), parsed once. */
  private readonly roomActors = new Map<number, ReturnType<Stage["actors"]>>();
  /** The rooms' darkness and their lights (light.ts), drawn by apps/battle's light pass. */
  readonly lighting: Lighting;
  readonly light: AdventureLight;
  private lightKey = "";
  private readonly rooms = new Map<number, RoomMeshes>();
  private readonly atlases: SpriteAtlas[] = [];
  private readonly sheet: SpriteSheet;
  private readonly linkFrames: SpriteFrame[];
  readonly actorSources: ActorSpriteSources;
  readonly entities: EntityView;
  readonly enemies: EnemyView;
  /** Phantom Ganon (ganon.ts). */
  readonly ganon: GanonView;
  private links: SpriteMesh[] = [];
  private linkAtlases: SpriteAtlas[] = [];
  private shadows: ShadowSprite[] = [];
  private debugBoxes: THREE.Mesh[] = [];
  private shownArea = "";
  /** The current area's base layer, as the PNPCs rewrite it (patchArea). */
  private patch: Patchable | null = null;
  /** The current area's top layer, as the pedestals taken from show it (patchArea). */
  private topPatch: Patchable | null = null;
  /** A GBA-screen area's top layer, blended over the rest while its VWMD's top mode holds (patchArea). */
  private areaTop: THREE.Mesh | null = null;
  private readonly patchables = new WeakMap<THREE.DataTexture, Patchable>();
  private areaGroup = new THREE.Group();
  /** The current area's rocks, drawn from the state (rebuilt when one moves). */
  private readonly rockGroup = new THREE.Group();
  private rockKey = "";
  /** Tingle (sim tingle.ts) in the area shown, or on the TV behind the GBA window; what he was last drawn as. */
  private readonly tingleGroup = new THREE.Group();
  private readonly tvTingle = new THREE.Group();
  private tingleKey = "";
  private areaBounds = { x0: 0, y0: 0, x1: GBA_W, y1: GBA_H };
  private view = new RoomPan();
  private gbaView = { x: 0, y: 0 };
  private windowOpen = 0;
  private lastArea = 0;
  private closingTick = -1;
  debug = false;
  /** The tunic the green Link wears (#player=): the others follow round. */
  tunic = 0;
  private shownColors = "";
  /** Actor pieces drawn per room as static sprites (for tests): room → count. */
  drawnActors: Record<number, number> = {};

  constructor(canvas: HTMLCanvasElement, data: RarcArchive, stage: Stage, adventure: AdventureStage, tileTypes: Uint16Array, sheet: SpriteSheet, linkFrames: SpriteFrame[], debug = false) {
    this.canvas = canvas;
    this.data = data;
    this.stage = stage;
    this.adventure = adventure;
    this.tileTypes = tileTypes;
    this.sheet = sheet;
    this.linkFrames = linkFrames;
    this.debug = debug;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    this.renderer.setClearColor(0x000000);
    this.renderer.autoClear = false;
    const sobs: ActorSpriteSources["sobs"] = { player: linkFrames };
    for (const [key, file] of Object.entries(ACTOR_SOB_FILES)) {
      if (key === "player") continue;
      try {
        sobs[key as ActorSob] = loadSob(data, file);
      } catch {
        // A missing list only disables the pieces that use it.
      }
    }
    // Actors drawn as a stage texture (RCK3, Lake Hylia's boulder: the stage's timg/yy_1_1_iwa1.bti), or data.arc's (PSWB).
    const texture = (file: string, archive?: "data") => {
      const found = (archive === "data" ? data : stage.archive)?.files.find((f) => f.path === `timg/${file}`);
      return found ? decodeBti(found.data) : null;
    };
    this.actorSources = { sheet, sobs, texture };
    this.entities = new EntityView(this.actorSources, data);
    this.enemies = new EnemyView(this.actorSources, data);
    this.ganon = new GanonView(stage.archive ?? null);
    this.local.add(this.entities.group, this.enemies.group, this.rockGroup, this.tingleGroup, this.ganon.group);
    const tileset = loadTileset(data, stage.layout.tilesetIndex);
    this.tiles = new TilemapTextures(tileset);
    this.riverBed = new RiverBed(data);
    this.clouds = new CloudShadow(data);
    this.waterTiles = this.riverBed.mesh && adventure.rooms.some((r) => hasRiverBed(stage, r)) ? new TilemapTextures({ ...tileset, palettes: riverBedPalettes(tileset.palettes) }) : null;
    this.gbaTiles = new TilemapTextures(loadTileset(data, stage.layout.tilesetIndex, "gba"));
    const overlay = loadOverlay(data, stage.layout.overlayTextureId);
    this.filter = overlay ? overlayTexture(overlay) : null;
    for (const room of adventure.rooms) this.buildRoom(room);
    this.effects = new StageEffects(stage, data, { clouds: false, sceneZ: (p) => this.effectZ(p) });
    this.tv.add(this.effects.group);
    this.tv.add(this.local, this.tvTingle);
    const jpc = data.files.find((file) => file.path === "particle.jpc");
    this.particles = jpc ? new JpaEffects(parseJpac(jpc.data), { zBase: 2.5, zScale: 1 / 16384 }) : null;
    this.stageEffects = this.particles ? stageParticles(stage) : [];
    if (this.particles) this.tv.add(this.particles.group);
    this.gba.add(this.areaGroup);
    this.lighting = new Lighting(data);
    this.light = new AdventureLight(stage);
  }

  /** A room's layers and static actors at its place on the grid. */
  private buildRoom(room: number): void {
    const cell = this.adventure.cellOf(room);
    if (!cell) return;
    const origin = { x: cell.cx * ROOM_W, y: cell.cy * ROOM_H };
    const baseLayer = this.stage.layer(room, 1), topLayer = this.stage.layer(room, 2);
    // (Lake Hylia: every room but 4 and 10.)
    const water = !!this.waterTiles && hasRiverBed(this.stage, room);
    const tiles = water ? this.waterTiles! : this.tiles;
    const bed = water ? this.riverBed.quad(origin.x, origin.y, ROOM_W, ROOM_H, 0.5) : null;
    if (bed) this.tv.add(bed);
    // Over the Links and the actors (2 + y / 1024) and the particles (2.5), under the top layer (3), as in apps/battle.
    const clouds = this.clouds.quad(origin.x, origin.y, 2.9, cloudShadowLevel(this.stage, room));
    if (clouds) this.tv.add(clouds);
    const base = baseLayer ? roomQuad(baseLayer, tiles, this.filter, origin, 1) : null;
    const top = topLayer ? roomQuad(topLayer, tiles, this.filter, origin, 3) : null;
    if (base) this.tv.add(base);
    if (top) this.tv.add(top);
    if (this.debug && baseLayer) this.tv.add(collisionQuad(baseLayer, this.tileTypes, origin, 3.5));
    const statics = new THREE.Group();
    this.tv.add(statics);
    const meshes = { origin, base, top, statics, hidden: "-" };
    this.rooms.set(room, meshes);
    this.fillStatics(meshes, this.adventure.area(room, 0), new Set(), origin);
  }

  /**
   * A J3D effect's depth: FSA sorts by world y, 1024 a layer. A model on the ground (a waterfall's column) sorts with
   * the sprites by its y in its room; one raised a layer or more draws over every sprite (under the top layer); the
   * rainbows and the room filters over the top layer too.
   */
  private effectZ(p: EffectPlacement): number {
    if (p.layer === "filter") return 3.3;
    if (p.layer === "aboveTop") return 3.2;
    if (p.translation[2] > 0) return 2.45;
    const cell = this.adventure.cellOf(p.room);
    return 2 + (p.translation[1] - (cell ? cell.cy * ROOM_H : 0)) * DEPTH_PER_PIXEL;
  }

  /** (Re)builds an area's static actor sprites, leaving out the actors in `hidden` (by list index). */
  private fillStatics(meshes: { statics: THREE.Group; hidden: string }, area: Area, hidden: ReadonlySet<number>, origin: { x: number; y: number }): void {
    const key = [...hidden].sort((a, b) => a - b).join(",");
    if (meshes.hidden === key) return;
    meshes.hidden = key;
    disposeChildren(meshes.statics);
    const placed: PlacedPieces[] = [], flat: PlacedPieces[] = [];
    let count = 0;
    for (const a of area.actors) {
      if (NOT_STATIC.has(a.id) || isHiddenUnsimulated(this.adventure.index, a.id) || hidden.has(a.index)) continue;
      const pieces = actorPieces({ id: a.id, sublayer: area.sublayer, x: a.x / 8, y: a.y / 8, params: a.params });
      if (!pieces.length) continue;
      (FLAT_ACTORS.has(a.id) ? flat : placed).push({ x: origin.x + a.x, y: origin.y + a.y, pieces });
      count += pieces.length;
    }
    if (area.sublayer === 0) this.drawnActors[area.room] = count;
    // Sorted by their y in the room, as the Links and the entities are (2 + y / 1024): the pieces are placed at world y.
    for (const mesh of actorSpriteMeshes(this.actorSources, placed, staticsZ(origin), { depthPerPixel: DEPTH_PER_PIXEL })) meshes.statics.add(mesh);
    for (const mesh of actorSpriteMeshes(this.actorSources, flat, 1.5)) meshes.statics.add(mesh);
  }

  /** Player i's tunic: green, red, blue, purple (#player= picks the leader's). */
  private atlas(color: number): SpriteAtlas {
    while (this.atlases.length <= color) {
      const atlas = new SpriteAtlas(this.sheet, this.linkFrames, playerPaletteMap(this.atlases.length));
      atlas.texture.userData.shared = true;
      this.atlases.push(atlas);
    }
    return this.atlases[color]!;
  }

  /** The Links' sprites and shadows for `colors` (one tunic per Link). */
  showLinks(colors: readonly number[]): void {
    for (const m of [...this.links, ...this.shadows, ...this.debugBoxes]) {
      this.local.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.linkAtlases = colors.map((c) => this.atlas(c));
    this.links = this.linkAtlases.map((atlas) => new SpriteMesh(atlas));
    this.shadows = colors.map((c) => new ShadowSprite(this.atlas(c), LINK_SHADOW.color));
    this.debugBoxes = this.debug ? colors.flatMap(() => [boxMesh(0xffff00), boxMesh(0xff4040), boxMesh(0xff4040)]) : [];
    this.local.add(...this.shadows, ...this.links, ...this.debugBoxes);
  }

  /** The area the Links are in, shown: the TV room, or a GBA-screen area in the window. */
  private showArea(game: AdventureGame): void {
    const a = game.adventure, key = `${a.room}/${a.area}`;
    if (key === this.shownArea) return;
    this.shownArea = key;
    const room = this.rooms.get(a.room);
    this.rockKey = "";
    if (a.area === 0) {
      this.tv.add(this.local);
      this.local.position.set(room?.origin.x ?? 0, -(room?.origin.y ?? 0), 0);
      const area = this.adventure.area(a.room, 0);
      this.fillRoomStatics(game);
      this.entities.show(baseMap(room?.base ?? null), (x, y) => this.adventure.tileTypeAt(area, x, y));
      this.patch = this.patchable(room?.base ?? null);
      this.topPatch = this.patchable(room?.top ?? null);
      this.areaTop = null;
      return;
    }
    disposeChildren(this.areaGroup);
    const area = this.adventure.area(a.room, a.area);
    const baseLayer = this.stage.layer(a.room, 1, a.area), topLayer = this.stage.layer(a.room, 2, a.area);
    const origin = { x: 0, y: 0 };
    const base = baseLayer ? roomQuad(baseLayer, this.gbaTiles, null, origin, 1, 32) : null;
    if (base) this.areaGroup.add(base);
    const top = topLayer ? roomQuad(topLayer, this.gbaTiles, null, origin, 3, 32) : null;
    if (top) this.areaGroup.add(top);
    this.areaTop = top;
    const statics = new THREE.Group();
    this.areaGroup.add(statics);
    this.fillStatics({ statics, hidden: "-" }, area, rockIndices(area), origin);
    this.gba.add(this.local);
    this.local.position.set(0, 0, 0);
    this.entities.show(baseMap(base), (x, y) => this.adventure.tileTypeAt(area, x, y));
    this.patch = this.patchable(base);
    this.topPatch = this.patchable(top);
    this.areaBounds = contentBounds(baseLayer);
  }

  // The TV rooms' static actors: the current room's rocks are drawn from the state, the other rooms' where they were
  // placed; a doorway's figure is gone once its door opened (goneDoorwayFigures). Every frame for the current room
  // (only it can open a door): cheap when nothing changed.
  private fillRoomStatics(game: AdventureGame, only?: number): void {
    const a = game.adventure;
    for (const [n, meshes] of this.rooms) {
      if (only !== undefined && n !== only) continue;
      const area = this.adventure.area(n, 0), hidden = goneDoorwayFigures(a.opened, n, area.actors);
      if (n === a.room) for (const i of rockIndices(area)) hidden.add(i);
      this.fillStatics(meshes, area, hidden, meshes.origin);
    }
  }

  private patchable(mesh: THREE.Mesh | null): Patchable | null {
    const texture = (mesh?.material as THREE.ShaderMaterial | undefined)?.uniforms?.uLayer?.value as THREE.DataTexture | undefined;
    if (!texture) return null;
    let p = this.patchables.get(texture);
    if (!p) this.patchables.set(texture, (p = { data: texture.image.data as unknown as Uint16Array, texture, original: new Map() }));
    return p;
  }

  // The base layer shows the tiles the area's PNPCs rewrite (the sim's rewrittenTiles, the lit crystals' own over them:
  // drawnRewrites), then the open doors' own tiles (doorlook.ts: the game's, over the sim's stand-ins), and gets its
  // own back where they no longer do. A room keeps its rewritten tiles on screen once the Links leave it (its switches
  // are kept).
  // The top layer shows the open doors' rows one tile out from the wall (a bombed wall's lintel: doorlook.ts) and the
  // items put on the pedestals taken from (the sim's pedestalTiles). A GBA-screen area's is blended over the rest as
  // the GBA does while its VWMD's top mode holds (the sim's topModeOf, TOP_MODE_BLEND: Lake Hylia room 5's area 2's
  // filler only shades what is under the bridge, the underwater passages' water is seen through).
  private patchArea(game: AdventureGame): void {
    if (this.areaTop) blendLayer(this.areaTop, TOP_MODE_BLEND[topModeOf(game, this.adventure.area(game.adventure.room, game.adventure.area))]!);
    const tiles = drawnRewrites(game, this.adventure), top = new Map<number, number>();
    doorLookTiles(game, this.adventure, tiles, top);
    pedestalTiles(game, top);
    if (this.patch) applyPatch(this.patch, tiles);
    if (this.topPatch) applyPatch(this.topPatch, top);
  }

  /** Moves the cameras (call once per simulation tick). */
  follow(game: AdventureGame): void {
    this.light.step(game, this.adventure);
    const a = game.adventure, p = game.players[0]!;
    if (a.area !== 0) {
      // The GBA screen follows the leader within the area's drawn tiles.
      const b = this.areaBounds;
      this.gbaView.x = clamp(p.x / SUBPX, b.x0 + GBA_W / 2, b.x1 - GBA_W / 2);
      this.gbaView.y = clamp(p.y / SUBPX, b.y0 + GBA_H / 2, b.y1 - GBA_H / 2);
      return;
    }
    const room = this.rooms.get(a.room);
    if (!room) return;
    const halfH = VIEW_H / 2, halfW = (VIEW_H * TV_W) / TV_H / 2;
    const x = room.origin.x + p.x / SUBPX, y = room.origin.y + p.y / SUBPX;
    const tx = clamp(x, room.origin.x + halfW, room.origin.x + ROOM_W - halfW);
    const ty = clamp(y, room.origin.y + halfH, room.origin.y + ROOM_H - halfH);
    // A room change pans (an edge walk); coming out of a GBA area, or the first frame, snaps.
    this.view.step(a.room, tx, ty, !!a.edge);
  }

  private syncParticles(game: AdventureGame): void {
    if (!this.particles) return;
    const room = game.adventure.room;
    if (room !== this.nearRoom) {
      this.nearRoom = room;
      const rooms = neighbours(this.stage, room);
      this.near = this.stageEffects.filter((e) => rooms.has(e.room));
    }
    const specs = this.near.filter((e) => e.actor !== "TRCH" || this.torchFlame(game, e)).map((e) => e.spec);
    this.drawnWhirlpools = this.near.filter((e) => e.room === room && e.actor === "WARP" && e.spec.placement.id === 1363).length;
    this.particles.sync(game.tick, [...specs, ...this.burningArrows(game), ...this.barriers(game), ...this.minorShadows(game), ...this.traps(game)]);
  }

  /**
   * The minor Shadow Link's effects (sim minorshadow.ts minorShadowEffects): the hammer's glint, the blow's, the smoke he
   * goes in, each while its step lasts (one-shot emitters: they stop on their own). 975 or 976 by the ground under the
   * blow (0x802258D4, not read): 975 drawn.
   */
  private minorShadows(game: AdventureGame): JpaEffectSpec[] {
    const out: JpaEffectSpec[] = [];
    const room = this.rooms.get(game.adventure.room);
    if (!room || game.adventure.area !== 0) return out;
    for (const e of game.adventure.enemies) {
      if (e.type !== "ZSLH") continue;
      for (const fx of minorShadowEffects(game, e)) {
        const placement = fsaParticlePlacement(fx.id, room.origin.x + fx.x, room.origin.y + fx.y, fx.z, { scale: fx.scale, sublayer: fx.id === 203 || fx.id === 204 ? 1 : 0 });
        if (placement) out.push({ key: `zslh:${e.id}:${fx.id}:${fx.start}`, start: fx.start, placement });
      }
    }
    this.drawnMinorShadowEffects = out.length;
    return out;
  }

  /**
   * The traps' effects (sim traps.ts): a fireball trap's shot is JPA 656 (FBAL's init 0x80220274 makes it at its spot,
   * layer 0, its update moves it along), stopping as the shot goes (assumed: its particles play out); a blade trap
   * stopped dead throws sparks (1185, 8 px ahead of it: one-shot, listed a second). TV areas only (on a GBA screen the
   * game makes sprite actors instead).
   */
  private traps(game: AdventureGame): JpaEffectSpec[] {
    const out: JpaEffectSpec[] = [];
    const room = this.rooms.get(game.adventure.room);
    if (!room || game.adventure.area !== 0) return out;
    for (const e of game.adventure.enemies) {
      if (e.type === "OKTM" && e.kind === FIRE_TRAP_KIND) {
        const placement = fsaParticlePlacement(FIRE_TRAP_EFFECT, room.origin.x + e.x / SUBPX, room.origin.y + e.y / SUBPX, e.z / SUBPX, { layer: 0, sublayer: 0 });
        if (placement) out.push({ key: `fbal:${e.id}`, start: game.tick - e.tick, placement });
      }
      const sparks = e.type === "TRAP" ? bladeSparks(e) : null;
      if (sparks && game.tick - sparks.start < SPARKS_LISTED) {
        const placement = fsaParticlePlacement(BLADE_TRAP.sparks, room.origin.x + sparks.x, room.origin.y + sparks.y, 0);
        if (placement) out.push({ key: `trap:${e.id}:${sparks.start}`, start: sparks.start, placement });
      }
    }
    this.drawnTrapEffects = out.length;
    return out;
  }

  /** The traps' effects synced in the last frame (for tests). */
  drawnTrapEffects = 0;

  /** The whirlpools (WARP style 0x0E: their swirl 1363) of the leader's room synced in the last frame (for tests). */
  drawnWhirlpools = 0;

  /** The minor Shadow Link's effects synced in the last frame (for tests). */
  drawnMinorShadowEffects = 0;

  /**
   * Room 57's barrier (BARI: no draw of its own; its init 0x8011F314 makes the effects): JPA effect 200 at its spot and
   * 16 px above and below, 201 (the posts) 32 px left and right, while the sim's barrier stands; once it's down they
   * stop emitting and play out (its state 3). Not done: the turned kind ((p >> 4) & 15 = 1: 200s side by side, turned
   * π/2), unused in World 1.
   */
  private barriers(game: AdventureGame): JpaEffectSpec[] {
    const out: JpaEffectSpec[] = [];
    const a = game.adventure, room = this.rooms.get(a.room);
    this.drawnBarrierEffects = 0;
    if (!room || a.area !== 0) {
      this.barrierSeen.clear();
      return out;
    }
    for (const actor of this.adventure.area(a.room, 0).actors) {
      const key = `bari:${a.room}:${actor.index}`;
      if (!barrierUp(game, actor)) {
        this.barrierSeen.delete(key);
        continue;
      }
      if (!this.barrierSeen.has(key)) this.barrierSeen.set(key, game.tick);
      const spots: [number, number, number][] = [[200, 0, -16], [200, 0, 0], [200, 0, 16], [201, -32, 0], [201, 32, 0]];
      spots.forEach(([id, dx, dy], n) => {
        const placement = fsaParticlePlacement(id, room.origin.x + actor.x + dx, room.origin.y + actor.y + dy, 0);
        if (placement) out.push({ key: `${key}:${n}`, start: this.barrierSeen.get(key)!, placement });
      });
    }
    this.drawnBarrierEffects = out.length;
    return out;
  }

  /** The barriers' effects synced in the last frame (for tests). */
  drawnBarrierEffects = 0;
  /** A standing barrier's key → the tick it was first seen standing. */
  private readonly barrierSeen = new Map<string, number>();

  /**
   * Whether a torch's effect shows: TRCH's flame (189) for kinds 0, 2 and 4, its haze (1354) for 0 and 2, only while
   * it's lit (without a switch, or while it's on: TRCH's update 0x802B0F9C).
   */
  private torchFlame(game: AdventureGame, e: ReturnType<typeof stageParticles>[number]): boolean {
    const [, , k, n] = e.spec.key.split(":").map(Number);
    let actors = this.roomActors.get(e.room);
    if (!actors) this.roomActors.set(e.room, (actors = this.stage.actors(e.room)));
    const actor = actors[k!];
    if (!actor) return true;
    const kind = actor.params & 0x7f, own = actor.params >>> 27;
    if (!(n === 0 ? [0, 2, 4] : [0, 2]).includes(kind)) return false;
    if (!own) return true;
    return e.room === game.adventure.room ? switchOn(game.battle, own) : ((savedSwitches(game, e.room) >>> own) & 1) === 1;
  }

  /**
   * A burning arrow's flame (ARRW's update 0x80165730): effect 189, the torches' own, made once it burns and moved each
   * tick 12 px ahead of it (table 0x804A0530: right, left, down, up), layer 0 sublayer 2, turned along it (0x800EF008:
   * X -1, Y 0x8000 pointing down, Z by facing 0x4000, 0xC000, 0x8000, 0).
   */
  private burningArrows(game: AdventureGame): JpaEffectSpec[] {
    const out: JpaEffectSpec[] = [];
    const room = this.rooms.get(game.adventure.room);
    if (!room || game.adventure.area !== 0) {
      this.arrowFlames.clear();
      return out;
    }
    const seen = new Set<number>();
    for (const e of game.battle.entities) {
      if (e.kind !== "arrow" || !arrowBurning(e)) continue;
      seen.add(e.id);
      if (!this.arrowFlames.has(e.id)) this.arrowFlames.set(e.id, game.tick);
      const d = DIR_INDEX[e.facing], [dx, dy] = ARROW_FLAME_AHEAD[d]!;
      const placement = fsaParticlePlacement(189, room.origin.x + e.x / SUBPX + dx, room.origin.y + e.y / SUBPX + dy, e.z / SUBPX, { layer: 0, sublayer: 2 });
      if (!placement) continue;
      placement.rotation = [0xffff, d === 2 ? 0x8000 : 0, [0x4000, 0xc000, 0x8000, 0][d]!];
      out.push({ key: `arrow:${e.id}`, start: this.arrowFlames.get(e.id)!, placement });
    }
    for (const id of this.arrowFlames.keys()) if (!seen.has(id)) this.arrowFlames.delete(id);
    this.drawnArrowFlames = out.length;
    return out;
  }

  /** Burning arrows' flames synced in the last frame (for tests). */
  drawnArrowFlames = 0;

  /** The TV frame inside the canvas, in CSS px (the largest 608:448 rectangle, centered). */
  frame(): { x: number; y: number; w: number; h: number } {
    const cw = this.canvas.clientWidth, ch = this.canvas.clientHeight;
    const w = Math.min(cw, (ch * TV_W) / TV_H), h = (w * TV_H) / TV_W;
    return { x: (cw - w) / 2, y: (ch - h) / 2, w, h };
  }

  render(game: AdventureGame): void {
    this.showArea(game);
    if (game.adventure.area === 0) this.fillRoomStatics(game, game.adventure.room);
    this.renderLinks(game);
    this.renderRocks(game);
    this.renderTingle(game);
    this.entities.update(game);
    this.patchArea(game);
    this.enemies.update(game, this.adventure);
    this.ganon.update(game);
    this.tiles.setTick(game.tick);
    this.waterTiles?.setTick(game.tick);
    this.gbaTiles.setTick(game.tick);
    this.syncParticles(game);
    const dpr = pixelRatio(), cw = this.canvas.clientWidth, ch = this.canvas.clientHeight;
    if (this.canvas.width !== Math.round(cw * dpr) || this.canvas.height !== Math.round(ch * dpr)) {
      this.renderer.setPixelRatio(dpr);
      this.renderer.setSize(cw, ch, false);
    }
    const tv = this.frame();
    const scale = (tv.h * dpr) / VIEW_H; // device px per room px; the center snapped to the device-pixel grid
    const halfW = (tv.w * dpr) / scale / 2, halfH = VIEW_H / 2;
    const cx = Math.round(this.view.x * scale) / scale, cy = Math.round(this.view.y * scale) / scale;
    Object.assign(this.tvCamera, { left: cx - halfW, right: cx + halfW, top: -cy + halfH, bottom: -cy - halfH, near: -10, far: 10 });
    this.tvCamera.updateProjectionMatrix();
    // TODO(measure): the cloud level's rise in the adventure (the battle's: one a frame from the round's start).
    this.clouds.update(game.tick);
    this.effects.showRoom(game.adventure.room);
    this.effects.update(game.tick);
    this.riverBed.update({ x: cx, y: cy }, game.tick, this.clouds.levelAt(game.tick));
    const r = this.renderer;
    r.setScissorTest(false);
    r.setViewport(0, 0, cw, ch);
    r.clear();
    r.setViewport(tv.x, ch - tv.y - tv.h, tv.w, tv.h);
    r.setScissor(tv.x, ch - tv.y - tv.h, tv.w, tv.h);
    r.setScissorTest(true);
    r.render(this.tv, this.tvCamera);
    if (this.particles) this.distortion.draw(r, [{ jpa: this.particles.renderer, camera: this.tvCamera }], tv.x * dpr, (ch - tv.y - tv.h) * dpr, tv.w * dpr, tv.h * dpr);
    this.renderLight(game, tv, dpr);
    this.renderWindow(game, tv, ch);
    if (this.hud) {
      this.hud.update(game);
      r.clearDepth();
      r.render(this.hud.scene, this.hud.camera);
    }
    const box = this.dialogue?.update(game, this.adventure);
    if (box) {
      r.clearDepth();
      r.render(box.scene, box.camera);
    }
    r.setScissorTest(false);
    opaqueFrame(r); // WebKit composites the canvas by its alpha (@fso/render opaque.ts)
  }

  // The room's darkness (light.ts): the frame tinted and darkened away from the lights and the Links.
  private renderLight(game: AdventureGame, tv: { w: number; h: number }, dpr: number): void {
    const light = this.light.current(), key = JSON.stringify(light);
    if (key !== this.lightKey) {
      this.lightKey = key;
      this.lighting.show(light);
    }
    if (!this.lighting.active) return;
    const room = this.rooms.get(game.adventure.room), ox = room?.origin.x ?? 0, oy = room?.origin.y ?? 0;
    const sources = this.light.sources(game, this.adventure).map((s) => ({ ...s, x: s.x + ox, y: s.y + oy }));
    this.lighting.render(this.renderer, this.tvCamera, sources, game.adventure.area === 0 ? this.links : [], tv.w * dpr, tv.h * dpr);
  }

  // The GBA window over the TV while the Links are in a GBA-screen area (and while it opens and closes).
  private renderWindow(game: AdventureGame, tv: { x: number; y: number; w: number; h: number }, ch: number): void {
    const a = game.adventure, w = a.warp;
    let open: number;
    if (a.area !== 0) {
      const since = w ? w.tick - WARP_IN_TICKS - 1 : Infinity;
      open = clamp((since - WINDOW_OPEN_AT) / WINDOW_OPEN_TICKS, 0, 1);
      this.closingTick = -1;
      this.lastArea = a.area;
    } else if (this.lastArea && w && w.tick > WARP_IN_TICKS) {
      open = clamp(1 - (w.tick - WARP_IN_TICKS - 1) / WINDOW_CLOSE_TICKS, 0, 1);
      if (open === 0) this.lastArea = 0;
    } else {
      this.lastArea = 0;
      open = 0;
    }
    this.windowOpen = open;
    if (open <= 0 || !this.lastArea) return;
    const k = tv.w / TV_W; // CSS px per TV px
    const r = this.renderer;
    let pic: { x: number; y: number; w: number; h: number };
    if (this.gbaFrame) {
      pic = this.gbaFrame.open(open);
      this.windowRect = { ...this.gbaFrame.screen };
      r.clearDepth();
      r.render(this.gbaFrame.scene, this.gbaFrame.camera);
    } else {
      const f = WINDOW_FALLBACK;
      pic = { x: f.x + (f.w * (1 - open)) / 2, y: f.y + (f.h * (1 - open)) / 2, w: f.w * open, h: f.h * open };
    }
    const vx = tv.x + pic.x * k, vy = tv.y + pic.y * k, vw = pic.w * k, vh = pic.h * k;
    r.setViewport(vx, ch - vy - vh, vw, vh);
    r.setScissor(vx, ch - vy - vh, vw, vh);
    if (a.area !== 0) {
      const gx = Math.round(this.gbaView.x), gy = Math.round(this.gbaView.y);
      Object.assign(this.gbaCamera, { left: gx - GBA_W / 2, right: gx + GBA_W / 2, top: -gy + GBA_H / 2, bottom: -gy - GBA_H / 2, near: -10, far: 10 });
      this.gbaCamera.updateProjectionMatrix();
      r.clearDepth();
      r.render(this.gba, this.gbaCamera);
    }
    r.setViewport(tv.x, ch - tv.y - tv.h, tv.w, tv.h);
    r.setScissor(tv.x, ch - tv.y - tv.h, tv.w, tv.h);
  }

  private renderLinks(game: AdventureGame): void {
    // Each slot shows its Link's tunic (the one in control is slot 0: AdventureState.colors).
    const colors = game.adventure.colors.map((c) => (c + this.tunic) & 3), key = colors.join(",");
    if (this.links.length !== game.players.length || key !== this.shownColors) {
      this.shownColors = key;
      this.showLinks(colors);
    }
    const fighters = game.battle.fighters;
    this.links.forEach((link, i) => {
      const p = game.players[i], f = fighters[i];
      const shadow = this.shadows[i]!;
      if (!p || !f) return;
      // The leader leaning on a wall shows his push frames (push.ts), the others too on a pushed rock; else they walk his trail (formation.ts); in deep
      // water, off a ledge, lifting a big rock or with the Fire Rod their adventure motion's (motion.ts). No shadows in
      // the water or in an area seen from the side.
      const push = pushFrame(game, i), motion = game.adventure.links[i];
      const swimming = motion?.mode === "swim" || motion?.mode === "ashore" || !!game.adventure.warp?.whirl;
      // A Link held overhead or thrown (sidecarry.ts) shows the battle's held frames (moveframes.ts HELD), not his
      // waiting pose apart.
      const carried = f.move === "held" || f.move === "thrown";
      const moving = carried ? -1 : push >= 0 ? push : adventureFrame(game, i);
      const frame = moving >= 0 ? moving : fighterFrame(p, f, (q) => linkDisplayFrame(q, game.tick));
      link.visible = frame >= 0 && fighterVisible(f) && !launchHidden(game);
      shadow.visible = link.visible && !swimming && !this.adventure.area(game.adventure.room, game.adventure.area).sideView;
      if (frame < 0) return;
      const x = Math.floor(p.x / SUBPX), y = Math.floor(p.y / SUBPX), h = fighterHeight(f);
      link.setFrame(frame);
      // (On the same spot, after a door, the leader is drawn over the others.)
      link.place(x, y - h, 2 + (y + (f.z > 0 ? 1 : 0) - i / 16) * DEPTH_PER_PIXEL);
      growAboutAnchor(link, this.linkAtlases[i]!, frame, x, y - h, heightScale(h));
      if (shadow.visible) {
        const s = linkShadow(x, y, h);
        shadow.setFrame(frame);
        shadow.place(s.x, s.y, 2 + (y - 0.5) * DEPTH_PER_PIXEL, s.sx, s.sy, s.opacity);
      }
      if (this.debug) {
        placeBox(this.debugBoxes[i * 3]!, { left: x + HURTBOX.left, top: y + HURTBOX.top, right: x + HURTBOX.right, bottom: y + HURTBOX.bottom });
        const attack = f.mode === "active" ? linkAttack(game, i) : null;
        const px = (b: PixelBox) => ({ left: Math.floor(b.left / SUBPX), top: Math.floor(b.top / SUBPX), right: Math.floor(b.right / SUBPX), bottom: Math.floor(b.bottom / SUBPX) });
        placeBox(this.debugBoxes[i * 3 + 1]!, attack ? px(attack.boxes[0]) : null);
        placeBox(this.debugBoxes[i * 3 + 2]!, attack ? px(attack.boxes[1]) : null);
      }
    });
  }

  // The rocks where the sim has them: lifted ones up in the air, a sunk boulder flat under the Links (a crossing).
  private renderRocks(game: AdventureGame): void {
    const a = game.adventure;
    const colored = colorBlocks(game, this.adventure);
    const key = a.rocks.map((r) => `${r.actor}:${r.state}:${r.x >> 8}:${r.y >> 8}:${r.z >> 8}`).join(",") + "|" + colored.map((b) => `${b.x},${b.y},${+b.done}`).join(",");
    if (key === this.rockKey) return;
    this.rockKey = key;
    disposeChildren(this.rockGroup);
    const area = this.adventure.area(a.room, a.area);
    for (const r of a.rocks) {
      const actor = area.actors.find((x) => x.index === r.actor);
      if (!actor || r.state === "gone") continue;
      const x = Math.floor(r.x / SUBPX), y = Math.floor(r.y / SUBPX), z = Math.floor(r.z / SUBPX);
      const pieces = actorPieces({ id: actor.id, sublayer: area.sublayer, x: x / 8, y: y / 8, params: actor.params });
      if (!pieces.length) continue;
      for (const mesh of actorSpriteMeshes(this.actorSources, [{ x, y: y - z, pieces }], 2, { depthPerPixel: DEPTH_PER_PIXEL })) {
        if (r.state === "sunk") mesh.position.z = 1.5;
        else if (z > 0) mesh.position.z += (z + 1) * DEPTH_PER_PIXEL;
        this.rockGroup.add(mesh);
      }
    }
    // The color blocks (colorblocks.ts): grey once moved.
    for (const b of colored) {
      const pieces = actorPieces({ id: "BCK2", sublayer: area.sublayer, x: (b.x + 8) / 8, y: (b.y + 8) / 8, params: b.done ? 0 : b.actor.params });
      for (const mesh of actorSpriteMeshes(this.actorSources, [{ x: b.x + 8, y: b.y + 8, pieces }], 2, { depthPerPixel: DEPTH_PER_PIXEL })) this.rockGroup.add(mesh);
    }
  }

  // Tingle's first appearance (sim tingle.ts tingleShown): both2 192 + his frame, at his height; in the area the
  // Links are in, or on the room's TV while they're in a GBA-screen area (his flight off from under the bridge).
  private renderTingle(game: AdventureGame): void {
    const t = tingleShown(game), a = game.adventure;
    const key = t ? `${a.room}/${a.area}:${t.area}:${t.frame}:${Math.floor(t.x)}:${Math.floor(t.y)}:${Math.floor(t.z)}` : "";
    if (key === this.tingleKey) return;
    this.tingleKey = key;
    disposeChildren(this.tingleGroup);
    disposeChildren(this.tvTingle);
    if (!t || (t.area !== a.area && t.area !== 0)) return;
    const x = Math.floor(t.x), y = Math.floor(t.y), z = Math.floor(t.z);
    const pieces: ActorPiece[] = [{ kind: "sprite", sob: "both2", frame: t.frame, dx: 0, dy: 0 }];
    const into = t.area === a.area ? this.tingleGroup : this.tvTingle;
    const room = this.rooms.get(a.room);
    if (into === this.tvTingle) this.tvTingle.position.set(room?.origin.x ?? 0, -(room?.origin.y ?? 0), 0);
    for (const mesh of actorSpriteMeshes(this.actorSources, [{ x, y: y - z, pieces }], 2, { depthPerPixel: DEPTH_PER_PIXEL })) {
      if (z > 0) mesh.position.z += (z + 1) * DEPTH_PER_PIXEL;
      into.add(mesh);
    }
  }

  /** How open the GBA window is (0-1), as last rendered (for tests). */
  get gbaWindow(): number {
    return this.windowOpen;
  }

  /** Where an area pixel of the current area lands on the page (CSS px), for tests. */
  toScreen(game: AdventureGame, x: number, y: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect(), tv = this.frame();
    const a = game.adventure;
    if (a.area !== 0) {
      const k = tv.w / TV_W, w = this.windowRect;
      return { x: rect.left + tv.x + (w.x + ((x - this.gbaView.x + GBA_W / 2) * w.w) / GBA_W) * k, y: rect.top + tv.y + (w.y + ((y - this.gbaView.y + GBA_H / 2) * w.h) / GBA_H) * k };
    }
    const room = this.rooms.get(a.room)!, cam = this.tvCamera;
    const wx = room.origin.x + x, wy = room.origin.y + y;
    return { x: rect.left + tv.x + ((wx - cam.left) / (cam.right - cam.left)) * tv.w, y: rect.top + tv.y + ((-wy - cam.top) / (cam.bottom - cam.top)) * tv.h };
  }
}

const FILLER_TILE = 0x00b;
const DIR_INDEX = { right: 0, left: 1, down: 2, up: 3 } as const;
/** A burning arrow's flame, ahead of it by facing (ARRW, table 0x804A0530). */
const ARROW_FLAME_AHEAD: readonly (readonly [number, number])[] = [[12, 0], [-12, 0], [0.5, 12], [0.5, -12]];
/**
 * The static actors' base depth in a room whose origin is `origin`: their pieces are placed at world y (origin + y),
 * so the room's origin comes off, leaving 2 + (y in the room) / 1024 like the Links' (not over every Link below them).
 */
export const staticsZ = (origin: { y: number }): number => 2 - origin.y * DEPTH_PER_PIXEL;
const clamp = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.min(Math.max(v, lo), hi));

/** Shows `tiles` (tile index → tile) in a layer, and gets its own tiles back where they no longer show. */
function applyPatch(p: Patchable, tiles: Map<number, number>): void {
  let changed = false;
  for (const [index, tile] of tiles) {
    if (!p.original.has(index)) p.original.set(index, p.data[index]!);
    if (p.data[index] === tile) continue;
    p.data[index] = tile;
    changed = true;
  }
  for (const [index, value] of p.original) {
    if (tiles.has(index)) continue;
    p.data[index] = value;
    p.original.delete(index);
    changed = true;
  }
  if (changed) p.texture.needsUpdate = true;
}

/**
 * The box (px) of a GBA area's drawn tiles, leaving out tile 0 (empty) and 0x00B (the black filler around the areas):
 * the GBA camera stays inside it. TODO(measure) the game's bounds (Lake Hylia's house fits the screen at x 0).
 */
function contentBounds(layer: Uint16Array | null): { x0: number; y0: number; x1: number; y1: number } {
  if (!layer) return { x0: 0, y0: 0, x1: GBA_W, y1: GBA_H };
  let x0 = 32, y0 = 32, x1 = 0, y1 = 0;
  for (let ty = 0; ty < 32; ty++) {
    for (let tx = 0; tx < 32; tx++) {
      const tile = layer[ty * 32 + tx]! & 0x3ff;
      if (tile === 0 || tile === FILLER_TILE) continue;
      x0 = Math.min(x0, tx);
      y0 = Math.min(y0, ty);
      x1 = Math.max(x1, tx + 1);
      y1 = Math.max(y1, ty + 1);
    }
  }
  return x1 > x0 ? { x0: x0 * 16, y0: y0 * 16, x1: x1 * 16, y1: y1 * 16 } : { x0: 0, y0: 0, x1: GBA_W, y1: GBA_H };
}

/** Actors lying on the floor, drawn under the Links (floor decals) rather than sorted by y: the four-Link switch. */
const FLAT_ACTORS: ReadonlySet<string> = new Set(["YNSW"]);

/** An area's rocks, chain levers, pull handles and Tingle (by actor list index), drawn from the state (EnemyView,
 *  renderRocks, renderTingle) rather than as static sprites. */
const FROM_STATE = new Set(["BCK2", "PSWK", "PLSW", "PSWB", "FTGL"]);
const rockIndices = (area: Area): Set<number> => new Set(area.actors.filter((a) => (ROCK_TYPES as readonly string[]).includes(a.id) || FROM_STATE.has(a.id)).map((a) => a.index));

/** The area's base layer as EntityView takes it (by screen; the adventure runs its area as screen 0). */
const baseMap = (mesh: THREE.Mesh | null): ReadonlyMap<number, THREE.Mesh> => new Map(mesh ? [[0, mesh]] : []);

/** A room and the rooms around it on the stage grid. */
function neighbours(stage: Stage, room: number): Set<number> {
  const out = new Set<number>([room]);
  const cy = stage.layout.rooms.findIndex((row) => row.includes(room));
  if (cy < 0) return out;
  const cx = stage.layout.rooms[cy]!.indexOf(room);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const r = stage.layout.rooms[cy + dy]?.[cx + dx];
    if (r !== null && r !== undefined) out.add(r);
  }
  return out;
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
