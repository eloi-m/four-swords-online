// J2D screen viewer: pick an archive and one of its scrn/*.blo screens, render it and toggle panes.
// Deep link: #arc=game2D.arc&scrn=main_bat.blo; &all=1 shows every pane, &hide=<regex> then &show=<regex> toggle panes
// by tag (hiding a pane hides its subtree), &tex=<tag>:<file.bti>,… swaps textures, &move=<tag>:<x>,<y>;… moves
// panes (like the game does at runtime), &pane=<tag> selects one, &bg=checker|screen|black|gray|none; #msg=<id> shows a
// message (messages.ts: &bmg=, &page=, &box=). window.fsoScreens exposes state, capture() and setText().
// Animations (anim.ts): &anim=title.btk,… or &anim=auto (the screen's own), &frame=<n>, &play=1.
import {
  decodeBfnSheets,
  decodeBti,
  decompressYaz0,
  isYaz0,
  parseBfn,
  parseBlo,
  parseBtiHeader,
  parseRarc,
  walkPanes,
  type BloPane,
  type BloScreen,
  type RarcArchive,
} from "@fso/formats";
import type { ScreenAssets, ScreenFont, ScreenTexture, ScreenView } from "@fso/render";
import { describeManifest, openServerStore, type AssetStore } from "@fso/web";
import { MESSAGE_ARCHIVE, MessageBrowser, type ShownMessage } from "./messages.ts";
import { AnimationPanel, type AnimationState } from "./anim.ts";
import { ScreenCanvas, type Background } from "./view.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const ui = {
  status: $<HTMLParagraphElement>("data-status"),
  controls: $<HTMLElement>("controls"),
  archive: $<HTMLSelectElement>("archive"),
  screen: $<HTMLSelectElement>("screen"),
  background: $<HTMLSelectElement>("background"),
  info: $<HTMLParagraphElement>("screen-info"),
  tree: $<HTMLUListElement>("tree"),
  details: $<HTMLElement>("details"),
  showAll: $<HTMLButtonElement>("show-all"),
  defaults: $<HTMLButtonElement>("defaults"),
  hideAll: $<HTMLButtonElement>("hide-all"),
  expand: $<HTMLButtonElement>("expand"),
};

const ROOT = "GC4Sword_usa";
// Archives holding scrn/ folders (top-level UI archives, staff roll, and the stage archives with mini-game HUDs).
const SCREEN_ARCHIVES = [
  "game2D.arc", "main2D.arc", "entry.arc", "gamemode.arc", "file.arc", "map1.arc", "map2.arc", "result.arc",
  "result1.arc", "result2.arc", "title.arc", "logo.arc",
  ...Array.from({ length: 8 }, (_, i) => `staff/staff${i + 1}.arc`),
  ...["boss021", "boss051", "boss100", "boss200", "boss201", "boss202", "boss204", "boss205", "boss990", "boss991", "ending"].map((b) => `Boss/${b}.arc`),
];
// Textures a screen names but its own archive lacks are looked up here (e.g. boss100's copy of the fishing HUD).
const SHARED_TEXTURE_ARCHIVES = ["game2D.arc", "main2D.arc"];

const canvas = new ScreenCanvas($<HTMLCanvasElement>("view"));
// The animation panel keeps its own parameters (&anim, &frame, &play) in the deep link.
const animations = new AnimationPanel(
  () => canvas.invalidate(),
  (params) => {
    const link = new URLSearchParams(location.hash.slice(1));
    for (const key of ["anim", "frame", "play"]) link.delete(key);
    for (const [key, value] of params) link.set(key, value);
    history.replaceState(null, "", `#${link.toString()}`);
  },
);
let store: AssetStore | null = null;
const archives = new Map<string, Promise<RarcArchive>>();
let fontCache: Promise<[RarcArchive | null, RarcArchive | null]> | null = null;
const decodedFonts = new Map<string, ScreenFont | null>();
let current: { screen: BloScreen; view: ScreenView; rows: Map<BloPane, HTMLLIElement> } | null = null;
let selected: BloPane | null = null;

declare global {
  interface Window {
    fsoScreens?: {
      archive: string;
      screen: string;
      panes: number;
      drawn: number;
      notes: [string, string][];
      ready: boolean;
      capture(): string; // PNG data URL of the screen at 1:1
      /** The message shown by the message browser, if any. */
      message: ShownMessage | null;
      /** Sets a text box's text (plain text, "\n" between lines); false if there is no such text box. */
      setText(tag: string, text: string): boolean;
      /** The checked animations and the frame shown (anim.ts); seek() shows another frame of all of them. */
      animation?(): AnimationState;
      seek?(frame: number): void;
    };
  }
}

function setStatus(text: string, error = false): void {
  ui.status.textContent = text;
  ui.status.classList.toggle("error", error);
}

function loadArchive(path: string): Promise<RarcArchive> {
  let archive = archives.get(path);
  if (!archive) {
    archive = store!.read(`${ROOT}/${path}`).then((bytes) => parseRarc(isYaz0(bytes) ? decompressYaz0(bytes) : bytes));
    archives.set(path, archive);
  }
  return archive;
}

const fileData = (archive: RarcArchive, path: string) => {
  const file = archive.files.find((f) => f.path.toLowerCase() === path.toLowerCase());
  return file ? (isYaz0(file.data) ? decompressYaz0(file.data) : file.data) : null;
};

const messages = new MessageBrowser(loadArchive);
messages.onShowBox = (screen) => {
  if (ui.archive.value !== MESSAGE_ARCHIVE) ui.archive.value = MESSAGE_ARCHIVE;
  void selectArchive(screen);
};

async function useStore(next: AssetStore): Promise<void> {
  store = next;
  archives.clear();
  fontCache = null;
  decodedFonts.clear();
  setStatus(describeManifest(next.manifest));
  ui.controls.hidden = false;
  const present = SCREEN_ARCHIVES.filter((a) => next.manifest.files.includes(`${ROOT}/${a}`));
  ui.archive.replaceChildren(...present.map((a) => new Option(a, a)));
  const link = new URLSearchParams(location.hash.slice(1));
  const message = await messages.fromLink(link).catch((error: Error) => (console.error(error), false));
  const wanted = link.get("arc") ?? (message ? MESSAGE_ARCHIVE : "game2D.arc");
  ui.archive.value = present.includes(wanted) ? wanted : present[0]!;
  await selectArchive(link.get("scrn") ?? (message ? messages.box : "main_bat.blo"));
}

async function selectArchive(wantedScreen?: string): Promise<void> {
  const archive = await loadArchive(ui.archive.value);
  const screens = archive.files.filter((f) => /(^|\/)scrn\/[^/]+\.blo$/i.test(f.path)).map((f) => f.path);
  ui.screen.replaceChildren(...screens.map((p) => new Option(p.split("/").pop()!, p)));
  const wanted = wantedScreen && screens.find((p) => p.endsWith(`/${wantedScreen}`) || p.endsWith(`/${wantedScreen}.blo`));
  if (wanted) ui.screen.value = wanted;
  if (!screens.length) ui.info.textContent = "No screens in this archive.";
  else await selectScreen();
}

async function assetsFor(archivePath: string): Promise<ScreenAssets> {
  const own = await loadArchive(archivePath);
  const shared = await Promise.all(
    SHARED_TEXTURE_ARCHIVES.filter((a) => a !== archivePath && store!.manifest.files.includes(`${ROOT}/${a}`)).map(loadArchive),
  );
  const has = (a: string) => store!.manifest.files.includes(`${ROOT}/${a}`);
  fontCache ??= Promise.all([has("msgus.arc") ? loadArchive("msgus.arc") : null, has("msgjp.arc") ? loadArchive("msgjp.arc") : null]);
  const [fonts, japaneseFonts] = await fontCache;
  return {
    texture(name): ScreenTexture | null {
      for (const a of [own, ...shared]) {
        const bytes = fileData(a, `timg/${name}`) ?? fileData(a, `${a.rootName}/timg/${name}`);
        if (bytes) return { image: decodeBti(bytes), header: parseBtiHeader(bytes) };
      }
      return null;
    },
    font(name, shiftJis): ScreenFont | null {
      // FNT1 names rock_24_20_4i_e.bfn (msgus.arc; a few screens say rock_24_20_4i.bfn). Japanese placeholder text is
      // shown with msgjp.arc's font so it stays readable; the game replaces it at runtime.
      const source = shiftJis && japaneseFonts ? japaneseFonts : fonts;
      if (!source) return null;
      const key = `${source.rootName}/${name}`;
      if (!decodedFonts.has(key)) {
        const bytes = fileData(source, `font/${name}`) ?? source.files.find((f) => f.path.endsWith(".bfn"))?.data ?? null;
        const font = bytes ? parseBfn(isYaz0(bytes) ? decompressYaz0(bytes) : bytes) : null;
        decodedFonts.set(key, font ? { font, sheets: decodeBfnSheets(font) } : null);
      }
      return decodedFonts.get(key)!;
    },
  };
}

async function selectScreen(): Promise<void> {
  const archivePath = ui.archive.value;
  const path = ui.screen.value;
  const capture = () => canvas.capture();
  const noText = () => false;
  window.fsoScreens = { archive: archivePath, screen: path, panes: 0, drawn: 0, notes: [], ready: false, capture, message: null, setText: noText };
  try {
    const archive = await loadArchive(archivePath);
    const screen = parseBlo(fileData(archive, path)!);
    const view = canvas.show(screen, await assetsFor(archivePath));
    const link = new URLSearchParams(location.hash.slice(1));
    if (link.get("bg") && [...ui.background.options].some((o) => o.value === link.get("bg"))) ui.background.value = link.get("bg")!;
    canvas.setBackground(ui.background.value as Background);
    current = { screen, view, rows: new Map() };
    const panes = [...walkPanes(screen.root)].map((p) => p.pane);
    if (link.get("all") === "1") for (const p of panes) view.setPaneVisible(p, true);
    for (const [param, visible] of [["hide", false], ["show", true]] as const) {
      const pattern = link.get(param);
      if (pattern) for (const p of panes) if (new RegExp(pattern).test(p.tag)) view.setPaneVisible(p, visible);
    }
    const byTag = (tag: string) => panes.find((p) => p.tag === tag);
    for (const spec of (link.get("tex") ?? "").split(",").filter(Boolean)) {
      const [tag, name] = spec.split(":");
      const pane = byTag(tag!);
      if (pane && name && !view.setPaneTexture(pane, name)) console.warn(`texture ${name} not found`);
    }
    for (const spec of (link.get("move") ?? "").split(";").filter(Boolean)) {
      const [tag, xy = ""] = spec.split(":");
      const [x, y] = xy.split(",").map(Number);
      const pane = byTag(tag!);
      if (pane && Number.isFinite(x) && Number.isFinite(y)) view.setPanePosition(pane, x!, y!);
    }
    const message = archivePath === MESSAGE_ARCHIVE && path.endsWith(`/${messages.box}`) ? messages.apply(view, screen.root) : null;
    buildTree(screen, view);
    const counts = { picture: 0, window: 0, textbox: 0, pane: 0 };
    for (const p of panes) counts[p.kind]++;
    ui.info.textContent =
      `${screen.width}×${screen.height} · ${counts.picture} pictures, ${counts.window} windows, ${counts.textbox} text boxes, ` +
      `${counts.pane} panes · ${screen.materials.length} materials · ${screen.textures.length} textures` +
      (view.notes.size ? ` · ${view.notes.size} panes with problems` : "");
    link.set("arc", archivePath);
    link.set("scrn", path.split("/").pop()!);
    if (message) messages.toLink(link);
    else for (const k of ["msg", "bmg", "page", "box"]) link.delete(k);
    history.replaceState(null, "", `#${link.toString()}`);
    animations.show(archive, path, view, link);
    const wantedPane = link.get("pane");
    select(wantedPane ? (panes.find((p) => p.tag === wantedPane) ?? null) : null);
    window.fsoScreens = {
      archive: archivePath,
      screen: path,
      panes: panes.length,
      drawn: view.object.children.length ? countMeshes(view) : 0,
      notes: [...view.notes].map(([p, n]) => [p.tag, n]),
      ready: true,
      capture,
      message,
      setText: (tag, text) => {
        const done = view.setText(tag, text);
        canvas.invalidate();
        return done;
      },
      animation: () => animations.state(),
      seek: (frame) => {
        animations.setPlaying(false);
        animations.seek(frame);
      },
    };
  } catch (error) {
    ui.info.textContent = `Can't show this screen: ${(error as Error).message}`;
    ui.info.classList.add("error");
    console.error(error);
  }
}

function countMeshes(view: ScreenView): number {
  let n = 0;
  view.object.traverse((o) => (n += (o as { isMesh?: boolean }).isMesh ? 1 : 0));
  return n;
}

const KIND_LETTER = { pane: "N", picture: "P", window: "W", textbox: "T" } as const;

function buildTree(screen: BloScreen, view: ScreenView): void {
  const rows = current!.rows;
  const make = (pane: BloPane, depth: number): HTMLLIElement => {
    const li = document.createElement("li");
    if (depth < 2) li.classList.add("open");
    const item = document.createElement("div");
    item.className = "item";
    const twist = document.createElement("span");
    twist.className = "twist";
    twist.textContent = pane.children.length ? "▸" : "";
    twist.addEventListener("click", (e) => {
      e.stopPropagation();
      li.classList.toggle("open");
    });
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = view.panes.get(pane)!.visible;
    box.addEventListener("click", (e) => e.stopPropagation());
    box.addEventListener("change", () => {
      view.setPaneVisible(pane, box.checked);
      canvas.invalidate();
    });
    const kind = document.createElement("span");
    kind.className = `kind ${pane.kind}`;
    kind.textContent = KIND_LETTER[pane.kind];
    const tag = document.createElement("span");
    tag.textContent = pane.tag;
    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent =
      pane.kind === "textbox" ? JSON.stringify(pane.text.slice(0, 24)) : pane.kind === "pane" ? "" : texturesOf(screen, pane).join(" ");
    item.append(twist, box, kind, tag, meta);
    const note = view.notes.get(pane);
    if (note) {
      const n = document.createElement("span");
      n.className = "note";
      n.textContent = `⚠ ${note}`;
      item.append(n);
    }
    item.addEventListener("click", () => select(pane));
    li.append(item);
    if (pane.children.length) {
      const ul = document.createElement("ul");
      ul.append(...pane.children.map((c) => make(c, depth + 1)));
      li.append(ul);
    }
    rows.set(pane, li);
    return li;
  };
  ui.tree.replaceChildren(make(screen.root, 0));
}

function texturesOf(screen: BloScreen, pane: BloPane): string[] {
  if (pane.kind === "pane") return [];
  const material = screen.materials[pane.material];
  return (material?.textures ?? []).map((t) => (t === null ? "-" : (screen.textures[t]?.name ?? `#${t}`).replace(/\.bti$/, "")));
}

function select(pane: BloPane | null): void {
  if (!current) return;
  if (selected) current.rows.get(selected)?.querySelector(".item")?.classList.remove("selected");
  selected = pane;
  canvas.highlight(pane);
  if (!pane) {
    ui.details.textContent = "Click a pane in the tree or on the screen.";
    return;
  }
  const row = current.rows.get(pane);
  row?.querySelector(".item")?.classList.add("selected");
  for (let p = row?.parentElement; p && p !== ui.tree; p = p.parentElement) if (p.tagName === "LI") p.classList.add("open");
  row?.querySelector(".item")?.scrollIntoView({ block: "nearest" });
  ui.details.textContent = describe(current.screen, pane, current.view.notes.get(pane));
}

function describe(screen: BloScreen, p: BloPane, note?: string): string {
  const f = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
  const lines = [
    `${p.block} ${p.tag}  #${p.id}${p.visible ? "" : "  (hidden by default)"}`,
    `size ${f(p.width)}×${f(p.height)}  at ${f(p.x)}, ${f(p.y)}  anchor ${p.anchor}`,
  ];
  if (p.rotateZ || p.scaleX !== 1 || p.scaleY !== 1) lines.push(`rotate ${f(p.rotateZ)}°  scale ${f(p.scaleX)}, ${f(p.scaleY)}`);
  if (p.kind !== "pane") {
    const m = screen.materials[p.material]!;
    const hex = (c: number[]) => c.map((x) => Math.max(0, Math.min(255, x)).toString(16).padStart(2, "0")).join("");
    lines.push(`material ${p.material} ${m.name}  alpha ${m.matColors[0]![3]}`);
    lines.push(`textures ${texturesOf(screen, p).join(", ") || "none"}`);
    lines.push(`TEV ${m.tevStages.length} stages  C0 ${hex(m.tevColors[0]!)}  C1 ${hex(m.tevColors[1]!)}`);
    if (p.kind === "picture" && p.cornerColors.some((c) => hex(c) !== "ffffffff")) lines.push(`corners ${p.cornerColors.map(hex).join(" ")}`);
    if (p.kind === "window")
      lines.push(`content ${p.contentX},${p.contentY} ${p.contentWidth}×${p.contentHeight}  mirror 0x${p.frameMirror.toString(16)}  frames ${p.frameMaterials.join(",")}`);
    if (p.kind === "textbox") {
      lines.push(`font ${p.fontWidth}×${p.fontHeight}  spacing ${p.charSpace}/${p.lineSpace}  bind h${p.hBinding} v${p.vBinding}  colors ${hex(p.topColor)} ${hex(p.bottomColor)}`);
      lines.push(`text (${p.textBytes.length}/${p.maxLength}) ${JSON.stringify(p.text)}`);
    }
  }
  if (note) lines.push(`⚠ ${note}`);
  return lines.join("\n");
}

function setAll(visible: (pane: BloPane) => boolean): void {
  if (!current) return;
  for (const [pane, row] of current.rows) {
    const v = visible(pane);
    current.view.setPaneVisible(pane, v);
    (row.querySelector("input") as HTMLInputElement).checked = v;
  }
  canvas.invalidate();
}

canvas.onPick = (pane) => select(pane);
ui.archive.addEventListener("change", () => void selectArchive());
ui.screen.addEventListener("change", () => void selectScreen());
ui.background.addEventListener("change", () => canvas.setBackground(ui.background.value as Background));
ui.showAll.addEventListener("click", () => setAll(() => true));
ui.defaults.addEventListener("click", () => setAll((p) => p.visible));
ui.hideAll.addEventListener("click", () => setAll((p) => p === current?.screen.root));
ui.expand.addEventListener("click", () => {
  const open = ui.expand.textContent === "Expand";
  ui.tree.querySelectorAll("li").forEach((li) => li.classList.toggle("open", open));
  ui.expand.textContent = open ? "Collapse" : "Expand";
});
document.querySelectorAll<HTMLButtonElement>("[data-zoom]").forEach((button) =>
  button.addEventListener("click", () => canvas.setZoom(button.dataset.zoom === "fit" ? "fit" : Number(button.dataset.zoom))),
);
window.addEventListener("hashchange", () => {
  if (!store) return;
  const link = new URLSearchParams(location.hash.slice(1));
  const arc = link.get("arc");
  if (arc && arc !== ui.archive.value && [...ui.archive.options].some((o) => o.value === arc)) {
    ui.archive.value = arc;
    void selectArchive(link.get("scrn") ?? undefined);
  } else if (link.get("scrn") && !ui.screen.value.endsWith(`/${link.get("scrn")}`)) {
    void selectArchive(link.get("scrn")!);
  }
});

await openServerStore()
  .then(useStore)
  .catch((error: Error) => setStatus(error.message, true));
