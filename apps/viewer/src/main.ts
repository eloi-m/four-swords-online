import {
  ACTOR_SOB_FILES,
  actorLook,
  actorParamBytes,
  actorPixel,
  battleArenaName,
  decodeBti,
  decompressYaz0,
  Dol,
  isYaz0,
  loadActorTypes,
  loadOverlay,
  loadSob,
  loadSpriteSheet,
  loadTileset,
  parseRarc,
  readTileTypes,
  Stage,
  type ActorSob,
  type ActorType,
  type PaletteVariant,
  type DecodedTexture,
  type RarcArchive,
  type SpriteFrame,
  type SpriteSheet,
  type Tileset,
} from "@fso/formats";
import { describeManifest, openServerStore, type AssetStore } from "@fso/web";
import type { PlacedActor } from "./actors.ts";
import { ViewerEffects } from "./effects.ts";
import { ViewerParticles } from "./particles.ts";
import { MapView } from "./scene.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const ui = {
  status: $<HTMLParagraphElement>("data-status"),
  controls: $<HTMLElement>("controls"),
  stage: $<HTMLSelectElement>("stage"),
  base: $<HTMLInputElement>("base"),
  top: $<HTMLInputElement>("top"),
  grid: $<HTMLInputElement>("grid"),
  overlay: $<HTMLInputElement>("overlay"),
  collision: $<HTMLInputElement>("collision"),
  actors: $<HTMLInputElement>("actors"),
  actorSprites: $<HTMLInputElement>("actor-sprites"),
  actorInfo: $<HTMLPreElement>("actor-info"),
  animate: $<HTMLInputElement>("animate"),
  overlayLabel: $<HTMLSpanElement>("overlay-label"),
  sublayer: $<HTMLSelectElement>("sublayer"),
  palette: $<HTMLSelectElement>("palette"),
  stageInfo: $<HTMLParagraphElement>("stage-info"),
  hover: $<HTMLElement>("hover"),
  effects: $<HTMLInputElement>("effects"),
  effectsInfo: $<HTMLParagraphElement>("effects-info"),
  particles: {
    enabled: $<HTMLInputElement>("jpa-on"),
    panel: $<HTMLElement>("jpa"),
    id: $<HTMLInputElement>("jpa-id"),
    list: $<HTMLSelectElement>("jpa-list"),
    play: $<HTMLInputElement>("jpa-play"),
    loop: $<HTMLInputElement>("jpa-loop"),
    fsa: $<HTMLInputElement>("jpa-fsa"),
    info: $<HTMLPreElement>("jpa-info"),
    prev: $<HTMLButtonElement>("jpa-prev"),
    next: $<HTMLButtonElement>("jpa-next"),
    restart: $<HTMLButtonElement>("jpa-restart"),
  },
};

const view = new MapView($<HTMLCanvasElement>("view"));
const effects = new ViewerEffects(view);
const particles = new ViewerParticles(view, ui.particles);
Object.assign(window, { fsoParticles: particles }); // for tests
const showEffects = () => {
  const summary = [effects.show(stage, data, ui.effects.checked), particles.showStage(stage, ui.effects.checked)];
  ui.effectsInfo.textContent = summary.filter(Boolean).join(" · ");
};
const hex = (n: number | null) => (n === null ? "—" : `0x${n.toString(16).padStart(3, "0")}`);
view.onHover = (h) => {
  ui.hover.textContent = h
    ? `room ${h.room} · tile (${h.tileX}, ${h.tileY})\nbase ${hex(h.baseTile)} · top ${hex(h.topTile)} · type ${hex(h.tileType)}` +
      (h.actor ? `\n${describeActor(h.actor)}` : "")
    : " ";
  ui.hover.style.whiteSpace = "pre";
};
view.onClick = (h) => {
  ui.actorInfo.hidden = !h?.actor;
  if (h?.actor) ui.actorInfo.textContent = describeActor(h.actor);
};

function describeActor({ room, actor }: PlacedActor): string {
  const px = actorPixel(actor);
  const bytes = actorParamBytes(actor).map((b) => b.toString(16).padStart(2, "0")).join(" ");
  const type = actorTypes?.get(actor.id);
  const look = actorLook(actor.id);
  return (
    `${actor.id}${type ? ` · ${type.name}` : ""}\n` +
    (look ? `graphics: ${look.draw} (${look.confidence}) · ${look.note}\n` : "graphics: not mapped yet\n") +
    `room ${room} · ${actor.sublayer ? `GBA area ${actor.sublayer}` : "TV"} · (${actor.x}, ${actor.y}) half-tiles = (${px.x}, ${px.y}) px\n` +
    `params 0x${actor.params.toString(16).padStart(8, "0")} = ${bytes}`
  );
}

const ROOT = "GC4Sword_usa";
let store: AssetStore | null = null;
let data: RarcArchive | null = null;
let stage: Stage | null = null;
let tileTypes: Uint16Array | null = null;
let actorTypes: Map<string, ActorType> | null = null;
const tilesets = new Map<string, Tileset>();
// Actor sprites: SOB lists are loaded once, sprite sheets per object sheet (the stage's npcSheetId).
let actorSobs: Partial<Record<ActorSob, SpriteFrame[]>> = {};
const spriteSheets = new Map<number, SpriteSheet>();
const overlays = new Map<number, DecodedTexture | null>();

async function loadArchive(path: string): Promise<RarcArchive> {
  const bytes = await store!.read(`${ROOT}/${path}`);
  return parseRarc(isYaz0(bytes) ? decompressYaz0(bytes) : bytes);
}

function setStatus(text: string, error = false): void {
  ui.status.textContent = text;
  ui.status.classList.toggle("error", error);
}

async function useStore(next: AssetStore): Promise<void> {
  store = next;
  data = await loadArchive("data.arc");
  const browsed = particles.load(data);
  tileTypes = next.manifest.files.includes("sys/main.dol") ? readTileTypes(new Dol(await next.read("sys/main.dol"))) : null;
  ui.collision.disabled = !tileTypes;
  actorTypes = loadActorTypes(data);
  actorSobs = {};
  for (const [key, file] of Object.entries(ACTOR_SOB_FILES)) {
    try {
      actorSobs[key as ActorSob] = loadSob(data, file);
    } catch {
      // A missing list only disables the pieces that use it.
    }
  }
  spriteSheets.clear();
  tilesets.clear();
  overlays.clear();
  setStatus(describeManifest(next.manifest));
  ui.controls.hidden = false;

  const stages = next.manifest.files
    .map((f) => f.match(/\/Boss\/(boss\d{3})\.arc$/)?.[1])
    .filter((s): s is string => !!s)
    .sort();
  ui.stage.replaceChildren(...stages.map((s) => new Option(stageLabel(s), s)));
  // Deep link: #stage=boss010&room=1&zoom=2&actors
  const link = new URLSearchParams(location.hash.slice(1));
  const wanted = link.get("stage") ?? "boss010";
  if (link.has("actors")) ui.actors.checked = true;
  if (link.has("markers")) ui.actorSprites.checked = false;
  if (link.has("effects")) ui.effects.checked = true;
  ui.stage.value = stages.includes(wanted) ? wanted : stages[0]!;
  await selectStage();
  if (link.has("room")) view.focusRoom(Number(link.get("room")), link.has("zoom") ? Number(link.get("zoom")) : undefined);
  // #x=…&y=…&scale=… centers on a stage pixel at a given CSS-pixel zoom (e.g. to match a Dolphin frame).
  if (link.has("x") && link.has("y")) view.lookAt(Number(link.get("x")), Number(link.get("y")), link.has("scale") ? Number(link.get("scale")) : undefined);
  // #jpa=<id>: the particle effect browser, at the view's center.
  if (browsed !== null) particles.showBrowser(browsed);
}

function stageLabel(id: string): string {
  const [w, s] = [Number(id[5]), Number(id[6])];
  const special: Record<string, string> = { boss500: "Shadow Battle", boss990: "intro", boss991: "ending" };
  if (special[id]) return `${id} · ${special[id]}`;
  return id[4] === "0" && w >= 1 && w <= 8 && s <= 3 ? `${id} · ${w}-${s + 1}` : id;
}

async function selectStage(): Promise<void> {
  try {
    stage = new Stage(await loadArchive(`Boss/${ui.stage.value}.arc`));
    const { layout, battleRooms } = stage;
    const actorCount = stage.roomNumbers.reduce((n, room) => n + stage!.actors(room).length, 0);
    if (battleRooms) {
      const ids = [...new Set(battleRooms.map((r) => r.overlayTextureId))];
      ui.overlay.disabled = ids.every((id) => !overlayFor(id));
      ui.overlayLabel.textContent = `Ground overlay (per room: filter${ids.join("/")})`;
      ui.stageInfo.textContent =
        `Shadow Battle: ${battleRooms.length} rooms, the arenas (top row) and their Dark World variants (bottom row) · ` +
        battleRooms.filter((r) => r.room < 5).map((r) => `${battleArenaName(r.room)}: tileset ${r.tilesetIndex}`).join(" · ") +
        ` · ${actorCount} actors`;
    } else {
      const overlay = overlayFor(layout.overlayTextureId);
      ui.overlay.disabled = !overlay;
      ui.overlayLabel.textContent = overlay ? `Ground overlay (filter${layout.overlayTextureId})` : "Ground overlay (none)";
      ui.stageInfo.textContent =
        `${stage.roomNumbers.length} rooms · tileset ${layout.tilesetIndex} · start cell (${layout.startX}, ${layout.startY}) · ` +
        `BGM ${layout.bgmId} · overlay ${layout.overlayTextureId} · ${actorCount} actors`;
    }
    ui.actorInfo.hidden = true;
    render();
    showEffects();
  } catch (error) {
    stage = null;
    ui.stageInfo.textContent = `Can't show this stage yet: ${(error as Error).message}`;
  }
}

function overlayFor(id: number): DecodedTexture | null {
  if (!overlays.has(id)) overlays.set(id, loadOverlay(data!, id));
  return overlays.get(id)!;
}

function tilesetFor(index: number, variant: PaletteVariant): Tileset {
  const key = `${index}/${variant}`;
  let tileset = tilesets.get(key);
  if (!tileset) tilesets.set(key, (tileset = loadTileset(data!, index, variant)));
  return tileset;
}

function spriteSheetFor(objectSheet: number): SpriteSheet | null {
  if (!spriteSheets.has(objectSheet)) {
    try {
      spriteSheets.set(objectSheet, loadSpriteSheet(data!, objectSheet));
    } catch {
      return null;
    }
  }
  return spriteSheets.get(objectSheet)!;
}

/** Sprite sheet (the stage's object sheet), SOB lists and stage textures for actor sprites. */
function actorSpriteSources(current: Stage) {
  const sheet = spriteSheetFor(current.layout.npcSheetId);
  if (!sheet) return null;
  const textures = new Map<string, DecodedTexture | null>();
  const texture = (file: string) => {
    if (!textures.has(file)) {
      const found = current.archive.files.find((f) => f.path === `timg/${file}`);
      textures.set(file, found ? decodeBti(found.data) : null);
    }
    return textures.get(file)!;
  };
  return { sheet, sobs: actorSobs, texture };
}

function render(): void {
  if (!stage || !data) return;
  const current = stage;
  const variant = ui.palette.value as PaletteVariant;
  try {
    const assets = {
      tileset: (room: number) => tilesetFor(current.tilesetIndexOf(room), variant),
      overlay: (room: number) => overlayFor(current.overlayTextureIdOf(room)),
      actorTypes,
      actorSprites: ui.actorSprites.checked ? actorSpriteSources(current) : null,
    };
    view.show(stage, assets, tileTypes, {
      base: ui.base.checked,
      top: ui.top.checked,
      grid: ui.grid.checked,
      overlay: ui.overlay.checked && Number(ui.sublayer.value) === 0,
      collision: ui.collision.checked,
      actors: ui.actors.checked,
      animate: ui.animate.checked,
      sublayer: Number(ui.sublayer.value),
    });
  } catch (error) {
    ui.stageInfo.textContent = `Can't render with this palette: ${(error as Error).message}`;
  }
}

ui.stage.addEventListener("change", () => void selectStage());
ui.effects.addEventListener("change", showEffects);
for (const input of [ui.base, ui.top, ui.grid, ui.overlay, ui.animate, ui.collision, ui.actors, ui.actorSprites, ui.palette]) {
  input.addEventListener("change", render);
}
ui.sublayer.addEventListener("change", () => {
  ui.palette.value = ui.sublayer.value === "0" ? "tv" : "gba";
  render();
});
document.querySelectorAll<HTMLButtonElement>("[data-zoom]").forEach((button) =>
  button.addEventListener("click", () => {
    if (button.dataset.zoom === "fit") view.fit();
    else view.setPixelZoom(Number(button.dataset.zoom));
  }),
);

await openServerStore()
  .then(useStore)
  .catch((error: Error) => setStatus(error.message, true));
