// The Hyrulean Adventure: any stage (#stage=boss0WS, Lake Hylia by default; Esc or the pause button for the stage
// list), its rooms one at a time in the sim (@fso/sim/adventure), drawn by view.ts. Deep links: #room=1&x=300&y=280
// (room px), #debug (collision, hit boxes), #player=0-3 (the leader's tunic), #players=1-4 (the formation's Links, 4 by
// default), #select (the stage list), #touch=, #route (the stage played by its scripted route, drive.ts: Lake Hylia,
// the Cave of No Return, Tingle's Tower, Hyrule Castle; #stage=boss013&room=11&route the Phantom Ganon fight; also
// window.fso.route), #mute (sound off for this page), #nolight (the rooms without their darkness), #manual (time
// stands still until window.fso.advance(ticks)). The C stick's formations: T / F / G / H (box, cross, long, wide)
// or the gamepad's right stick. Sound (sound.ts) starts on the first key press, click or tap (browsers need a gesture);
// M mutes.
// Dev server only (captures, docs/tools.md): F8 captures the moment (Shift+F8 with a note) to captures/,
// #replay=<capture id|latest>[&at=<tick>] replays a capture's stage to that tick and freezes it there (F9 plays on).
import { bmgMessageById, bmgPlainText, decodeBfnSheets, decodeBti, parseBfn, decompressYaz0, Dol, isYaz0, loadActorTypes, loadSob, loadSpriteSheet, parseBlo, parseBtiHeader, parseRarc, readTileTypes, Stage, type Bmg, type RarcArchive } from "@fso/formats";
import type { ScreenAssets } from "@fso/render";
import { ADVENTURE_BINDINGS, LocalInput } from "@fso/input";
import { TouchControls } from "@fso/input/touch";
import { hashState, InputLog, replayFrameSteps, RunCursor, SUBPX, type AdventureRecord } from "@fso/sim";
import { actorStats, AdventureStage, carryOf, messageBook, FORMATION_BUTTONS, GATHER_BUTTON, CAVE_OF_NO_RETURN_MILESTONES, HYRULE_CASTLE_MILESTONES, LAKE_HYLIA_MILESTONES, PHANTOM_GANON_MILESTONES, TINGLE_TOWER_MILESTONES, playedAlone, quotaMet, RoutePlayer, SEPARATE_BUTTON, selectButtons, startAdventure, stepAdventure, type AdventureGame, type Goal } from "@fso/sim/adventure";
import { openServerStore, type AssetStore } from "@fso/web";
import { adventureStages, englishMessages, levelName, LEVELS, type StageInfo } from "./stages.ts";
import { GbaWindow } from "./gbawindow.ts";
import { AdventureHud } from "./hud.ts";
import { MessageWindow } from "./messagewindow.ts";
import { BOX_SCREENS, DialogueBox } from "./dialogue.ts";
import { AdventureView } from "./view.ts";
import { CLEAR_SHOW_TICKS, carryFor, hashFor, loadRun, nextStage, saveCarry, saveRun, summary, WORLD_1 } from "./run.ts";
import { AdventureAudio, AdventureCues } from "./sound.ts";

const ROOT = "GC4Sword_usa";
const DEFAULT_STAGE = "boss010";
const TICK_MS = 1000 / 60;
/** "You've gathered enough Force Gems!…" (msgus.arc _e.bmg), shown this long once the Links have the quota. */
const QUOTA_MESSAGE = 0x24d;
const QUOTA_SHOW_TICKS = 300;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.hash.slice(1));
const debug = params.has("debug");
/** World 1 is one run (run.ts): a cleared stage loads the next, then the end screen; #run=off stops at the banner. */
const chain = params.get("run") !== "off";
const session = (() => {
  try {
    return sessionStorage;
  } catch {
    return undefined;
  }
})();
/** Loads another stage (or `end`) with the deep link's other parameters kept. */
const goTo = (id: string) => {
  location.hash = hashFor(location.hash.slice(1), id);
  location.reload();
};
/**
 * The C stick on the keyboard (a cluster like WASD's) and on a gamepad's right stick (past 0.6, as the left one); the
 * pad's X and Y (Q: the Links apart, E: together again) and its D-pad's pick of a Link (1-4: green, red, blue, purple).
 */
const FORMATION_KEYS: Readonly<Record<string, number>> = {
  KeyT: FORMATION_BUTTONS.box,
  KeyF: FORMATION_BUTTONS.cross,
  KeyG: FORMATION_BUTTONS.long,
  KeyH: FORMATION_BUTTONS.wide,
  KeyQ: SEPARATE_BUTTON,
  KeyE: GATHER_BUTTON,
  Digit1: selectButtons(0),
  Digit2: selectButtons(1),
  Digit3: selectButtons(2),
  Digit4: selectButtons(3),
};

/** The formation buttons held: keys (`held`) and the first gamepad's right stick. */
function formationButtons(held: ReadonlySet<string>): number {
  let out = 0;
  for (const code of held) out |= FORMATION_KEYS[code] ?? 0;
  const pad = (navigator.getGamepads?.() ?? []).find((g) => g?.connected);
  const [, , cx = 0, cy = 0] = pad?.axes ?? [];
  if (Math.hypot(cx, cy) > 0.6) out |= Math.abs(cx) > Math.abs(cy) ? (cx > 0 ? FORMATION_BUTTONS.wide : FORMATION_BUTTONS.cross) : cy > 0 ? FORMATION_BUTTONS.long : FORMATION_BUTTONS.box;
  return out;
}

/** The stages with a scripted route (drive.ts): Lake Hylia's (lakehylia.ts), the Cave of No Return's (cavenoreturn.ts,
 *  to its room 3), Tingle's Tower's (tingletower.ts), Hyrule Castle's (hyrulecastle.ts, its first two rooms). */
const ROUTES: Readonly<Record<string, readonly { name: string; goals: readonly Goal[] }[]>> = {
  boss010: LAKE_HYLIA_MILESTONES,
  boss011: CAVE_OF_NO_RETURN_MILESTONES,
  boss012: TINGLE_TOWER_MILESTONES,
  boss013: HYRULE_CASTLE_MILESTONES,
};
/** The stage's route from where the Links start: Hyrule Castle's room 11 (#room=11) fights Phantom Ganon. */
const routeFor = (id: string, room: number | undefined) => (id === "boss013" && room === 11 ? PHANTOM_GANON_MILESTONES : ROUTES[id]);

/**
 * A stage's scripted route driving the leader instead of the controls, from milestone `from`: where it is (the
 * milestone, the goal), and the error that stopped it, if one did.
 */
class RouteRunner {
  milestone = 0;
  error = "";
  private player: RoutePlayer | null = null;
  private readonly milestones: readonly { name: string; goals: readonly Goal[] }[];
  constructor(milestones: readonly { name: string; goals: readonly Goal[] }[], from = 0) {
    this.milestones = milestones;
    this.milestone = from;
  }
  get count(): number {
    return this.milestones.length;
  }
  get done(): boolean {
    return this.milestone >= this.milestones.length || this.error !== "";
  }
  get goal(): string {
    return this.player?.current ?? "";
  }
  get name(): string {
    return this.milestones[this.milestone]?.name ?? "done";
  }
  next(game: AdventureGame, stage: AdventureStage): number {
    while (!this.done) {
      this.player ??= new RoutePlayer(this.milestones[this.milestone]!.goals);
      try {
        const buttons = this.player.next(game, stage);
        if (!this.player.done) return buttons;
      } catch (error) {
        this.error = (error as Error).message;
        return 0;
      }
      this.player = null;
      this.milestone++;
    }
    return 0;
  }
}

async function main(): Promise<void> {
  const store = await openServerStore();
  const progress = $<HTMLProgressElement>("progress");
  store.onProgress = (loaded, total) => ((progress.hidden = false), (progress.value = loaded / total));
  const archive = async (path: string): Promise<RarcArchive> => {
    const bytes = await store.read(`${ROOT}/${path}`);
    return parseRarc(isYaz0(bytes) ? decompressYaz0(bytes) : bytes);
  };
  let messages = null, messageArchive: RarcArchive | null = null;
  try {
    messageArchive = await archive("msgus.arc");
    messages = englishMessages(messageArchive);
  } catch {
    // names fall back to "Stage W-S"; no one talks
  }
  const stages = adventureStages(messages);
  // A capture's replay (dev server) plays its own stage from where its Links started.
  const replay = import.meta.env.DEV && params.has("replay") ? ((await (await import("@fso/web/capture")).fetchReplay(params.get("replay")!)) as AdventureRecord) : null;
  const wanted = replay?.stage ?? params.get("stage") ?? DEFAULT_STAGE;
  if (wanted === "end") return endScreen(stages);
  if (wanted === WORLD_1[0] && !replay) saveRun(session, {});
  const info = stages.find((s) => s.id === wanted) ?? stages.find((s) => s.id === DEFAULT_STAGE)!;
  $("boot-status").textContent = `Loading ${info.name}…`;
  const picker = stagePicker(stages, messages ? (l) => levelName(messages, l) : (l) => `Level ${l}`, info);
  await start(store, archive, stages, info, picker, messages, messageArchive, replay);
  store.onProgress = null;
  $("boot").hidden = true;
  if (params.has("select")) picker.open();
}

/** World 1 cleared: the Force Gems per stage, back to the start or the stage list. */
function endScreen(stages: readonly StageInfo[]): void {
  const { rows, total } = summary(loadRun(session), (id) => stages.find((s) => s.id === id)?.name ?? id);
  $("end-gems").innerHTML = [...rows.map((r) => `<tr><td>${escape(r.name)}</td><td>${r.gems}</td></tr>`), `<tr class="total"><td>Force Gems</td><td>${total}</td></tr>`].join("");
  $("boot").hidden = true;
  $("end").hidden = false;
  $("end-again").addEventListener("click", () => goTo(WORLD_1[0]!));
  $("end-stages").addEventListener("click", () => {
    location.hash = `stage=${WORLD_1[0]}&select`;
    location.reload();
  });
  $("end-again").focus();
  (window as unknown as { fso: unknown }).fso = { end: { rows, total } };
}

interface Picker {
  open(): void;
  close(): void;
  readonly isOpen: boolean;
}

/** The stage list: a dialog of the 8 levels and their stages; picking one loads it (#stage=). */
function stagePicker(stages: readonly StageInfo[], level: (n: number) => string, current: StageInfo): Picker {
  const dialog = $<HTMLDialogElement>("stages");
  const list = $("stage-list");
  for (let l = 1; l <= LEVELS; l++) {
    const group = document.createElement("section");
    group.innerHTML = `<h2>${l}. ${escape(level(l))}</h2>`;
    for (const s of stages.filter((x) => x.level === l)) {
      const a = document.createElement("a");
      a.href = `#stage=${s.id}`;
      a.textContent = s.name;
      a.dataset.stage = s.id;
      if (s.id === current.id) a.setAttribute("aria-current", "true");
      a.addEventListener("click", (e) => {
        e.preventDefault();
        location.hash = `stage=${s.id}`;
        location.reload();
      });
      group.append(a);
    }
    list.append(group);
  }
  $("stages-close").addEventListener("click", () => dialog.close());
  return {
    open: () => {
      if (!dialog.open) dialog.showModal();
      (list.querySelector<HTMLElement>("[aria-current]") ?? list.querySelector("a"))?.focus();
    },
    close: () => dialog.close(),
    get isOpen() {
      return dialog.open;
    },
  };
}

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

async function start(store: AssetStore, archive: (path: string) => Promise<RarcArchive>, stages: readonly StageInfo[], info: StageInfo, picker: Picker, messages: Bmg | null, messageArchive: RarcArchive | null, replay: AdventureRecord | null): Promise<void> {
  const data = await archive("data.arc");
  // One player with the four Links: the rooms played alone (the view draws what the sim plays).
  const stage = playedAlone(new Stage(await archive(`Boss/${info.id}.arc`)));
  const dol = new Dol(await store.read("sys/main.dol"));
  const tileTypes = readTileTypes(dol);
  const stats = actorStats(loadActorTypes(data) ?? new Map());
  const adventure = new AdventureStage(stage, tileTypes, stats);
  // Signs and people talk with the game's messages (the sim reads the pages' lengths for the typing).
  if (messages) adventure.messages = messageBook(messages);
  const sheet = loadSpriteSheet(data, stage.layout.npcSheetId);
  const linkFrames = loadSob(data, "player_sob.bin");

  const num = (key: string) => (params.has(key) ? Number(params.get(key)) : undefined);
  const room = replay ? replay.room : num("room");
  const x = replay ? replay.x : num("x"), y = replay ? replay.y : num("y");
  // The four Links in formation (#players=1 for the leader alone).
  const players = replay?.players ?? Math.max(1, Math.min(4, Number(params.get("players") ?? 4)));
  // A stage reached through the run starts with what the stage before it ended with (run.ts carryFor); a replay, with
  // its record's carry and each Link where its record put him.
  const runCarry = carryFor(session, info.id, chain && !replay);
  const carry = replay ? (replay.carry ?? null) : runCarry;
  const start = { kind: "adventure" as const, stage: info.id, room, x, y, players, ...(carry ? { carry } : {}), ...(replay?.links ? { links: replay.links } : {}), ...(replay?.switches !== undefined ? { switches: replay.switches } : {}), ...(replay?.shadow ? { shadow: replay.shadow } : {}) };
  const game: AdventureGame = startAdventure({ ...start, inputs: [], checkpoints: [], tick: 0, hash: 0 }, adventure);
  // Dev server: the stage's start and inputs (@fso/sim replay.ts) for F8's captures, and a capture's replay.
  const record = import.meta.env.DEV ? start : null;
  const log = record && new InputLog();
  let replaying: { cursor: RunCursor; left: number; steps: number } | null = null;
  const tunic = Number(params.get("player") ?? 0) & 3;
  const view = new AdventureView($<HTMLCanvasElement>("screen"), data, stage, adventure, tileTypes, sheet, linkFrames, debug);
  view.tunic = tunic;
  if (params.has("nolight")) view.lighting.enabled = false; // the rooms without their darkness (light.ts)
  // A replay that starts in the middle of a room (each Link put on his spot) starts with the room's lights settled.
  if (replay?.links) view.light.settle(game, adventure);
  try {
    const main2D = await archive("main2D.arc"), game2D = await archive("game2D.arc");
    const window = archiveFile(main2D, "scrn/main_gba_window.blo");
    if (window) view.gbaFrame = new GbaWindow(parseBlo(window), screenAssets([main2D]));
    const hud = archiveFile(game2D, "scrn/main_adv.blo");
    if (hud) view.hud = new AdventureHud(parseBlo(hud), screenAssets([game2D, main2D]));
    const fontFile = messageArchive && archiveFile(messageArchive, "font/rock_24_20_4i_e.bfn");
    if (messages && fontFile) {
      const font = parseBfn(fontFile), sheets = decodeBfnSheets(font);
      const screens = Object.fromEntries(Object.entries(BOX_SCREENS).flatMap(([style, name]) => {
        const file = archiveFile(main2D, `scrn/${name}`);
        return file ? [[style, parseBlo(file)]] : [];
      }));
      view.dialogue = new DialogueBox(screens, { ...screenAssets([main2D]), font: () => ({ font, sheets }) }, messages);
      const box = archiveFile(main2D, "scrn/main_message_window.blo");
      if (box) view.messageWindow = new MessageWindow(parseBlo(box), { ...screenAssets([main2D]), font: () => ({ font, sheets }) }, messages);
    }
  } catch (error) {
    console.warn("no HUD or GBA window:", error);
  }

  // Keyboard, the first gamepad, and on touch screens the on-screen controls (#touch=on|off; their pause button
  // opens the stage list, as Esc does).
  const input = new LocalInput(window, ADVENTURE_BINDINGS);
  const touch = new TouchControls({ after: $("hud"), pause: () => (picker.isOpen ? picker.close() : picker.open()) });
  touch.show(true);
  input.attach(0, touch);
  addEventListener("keydown", (e) => {
    if (e.code !== "Escape" || picker.isOpen) return;
    e.preventDefault();
    picker.open();
  });
  const formationKeys = new Set<string>();
  addEventListener("keydown", (e) => FORMATION_KEYS[e.code] && formationKeys.add(e.code));
  addEventListener("keyup", (e) => formationKeys.delete(e.code));
  addEventListener("blur", () => formationKeys.clear());
  const stageRoute = routeFor(info.id, room);
  let route: RouteRunner | null = params.has("route") && stageRoute ? new RouteRunner(stageRoute, Number(params.get("route")) || 0) : null;
  const fso = {
    game,
    stage: adventure,
    view,
    particles: view.particles,
    touch,
    info,
    /** Where a pixel of the current area is on the page (CSS px). */
    /** The audio and its cues (sound.ts), once loaded. */
    audio: null as AdventureAudio | null,
    cues: null as AdventureCues | null,
    toScreen: (px: number, py: number) => view.toScreen(game, px, py),
    /** The leader in world px (rooms laid out on the grid) or area px inside a GBA-screen area. */
    leader: () => {
      const p = game.players[0]!, a = game.adventure, cell = adventure.cellOf(a.room)!;
      return a.area ? { x: p.x / SUBPX, y: p.y / SUBPX, room: a.room, area: a.area } : { x: p.x / SUBPX + cell.cx * 512, y: p.y / SUBPX + cell.cy * 384, room: a.room, area: 0 };
    },
    /** #manual: time stands still until advance(ticks) steps it with the keys held (for a driver that plays from screenshots). */
    manual: params.has("manual"),
    advance: (_ticks: number): void => {},
    /** The replay of a capture (#replay=, dev server): where it is; `done` once it stands at its tick. */
    replay: null as { id: string; steps: number; done: boolean; hash: number; expected: number } | null,
    /** The stage's scripted route (from its start): `start()` hands the leader to it, then read its state. */
    route: {
      start: (from = 0) => void (route = stageRoute ? new RouteRunner(stageRoute, from) : null),
      stop: () => void (route = null),
      get state() {
        return route && { milestone: route.milestone, milestones: route.count, name: route.name, goal: route.goal, done: route.done, error: route.error };
      },
    },
  };
  (window as unknown as { fso: unknown }).fso = fso;
  if (import.meta.env.DEV) {
    void import("@fso/web/capture").then(({ installCapture }) =>
      installCapture({
        app: "game",
        canvas: $<HTMLCanvasElement>("screen"),
        render: () => view.render(game),
        info: () => ({ stage: info.id, name: info.name, tick: game.tick, room: game.adventure.room, area: game.adventure.area, leader: fso.leader(), route: fso.route.state, hud: $("hud").textContent, banner: $("banner").hidden ? "" : $("banner").textContent }),
        state: () => game,
        replay: () => record && log && { ...record, inputs: log.runs, checkpoints: log.checkpoints, tick: game.tick, hash: hashState(game) },
      }),
    );
    addEventListener("keydown", (e) => {
      if (e.code === "F9" && fso.replay?.done) replaying = null;
    });
    if (replay) {
      const total = replay.inputs.reduce((n, [, t]) => n + t, 0);
      const at = params.has("at") ? Math.min(total, Math.max(0, Number(params.get("at")))) : total;
      replaying = { cursor: new RunCursor(replay.inputs), left: at, steps: 0 };
      fso.replay = { id: params.get("replay")!, steps: 0, done: at === 0, hash: hashState(game), expected: at === total ? replay.hash : (replay.checkpoints.find(([t]) => t === at)?.[1] ?? -1) };
    }
  }

  // Audio loads in the background; the AudioContext starts on the first key press, click or tap (iOS: a touch's
  // pointerup). The stage's BGM is its map CSV's (sound.ts).
  const audioReady = AdventureAudio.load((path) => store.read(path), dol).then((audio) => {
    if (params.has("mute")) audio.muteForSession();
    fso.audio = audio;
    fso.cues = new AdventureCues(audio, adventure, audio.stageBgm(stage.layout.bgmId));
    audioControls(audio);
    return audio;
  });
  audioReady.catch((error: Error) => console.warn(`audio unavailable: ${error.message}`));
  const gesture = () => void audioReady.then((audio) => audio.start()).catch(() => {});
  addEventListener("keydown", gesture);
  addEventListener("pointerup", gesture);
  addEventListener("keydown", (e) => {
    if (e.code !== "KeyM" || e.repeat || !fso.audio || picker.isOpen) return;
    fso.audio.muted = !fso.audio.muted;
    audioControls(fso.audio);
  });

  const tick = () => {
    const buttons = route && !route.done ? route.next(game, adventure) : input.single() | formationButtons(formationKeys);
    const fed = [picker.isOpen ? 0 : buttons];
    stepAdventure(game, fed, adventure);
    log?.push(fed, game);
    fso.cues?.observe(game);
    view.follow(game);
  };
  fso.advance = (ticks: number) => {
    for (let n = 0; n < ticks; n++) tick();
    view.render(game);
  };

  const canvas = $<HTMLCanvasElement>("screen");
  const hud = $("hud"), banner = $("banner");
  // The game's message when the Links have the quota (0x24D), shown a while; the stage cleared, until Esc.
  const quotaMessage = messages ? bmgMessageById(messages, QUOTA_MESSAGE) : undefined;
  const quotaText = quotaMessage ? bmgPlainText(quotaMessage).trim() : "The Force Gem quota is met.";
  let quotaAt = quotaMet(game) ? -1 : 0;
  const next = chain && !replay ? nextStage(info.id) : null;
  let leaving = false;
  let last = performance.now(), acc = 0, frames = 0, fps = 0, fpsAt = last;
  const loop = (now: number) => {
    acc += Math.min(now - last, 250);
    last = now;
    touch.place(view.frame());
    if (replaying) {
      // A capture's replay: its logged inputs fast, the last second and a half as played (replayFrameSteps), then the
      // game stands still where the capture was taken.
      for (let n = replayFrameSteps(replaying.left); n > 0; n--, replaying.left--, replaying.steps++) {
        const buttons = replaying.cursor.next() ?? [0];
        stepAdventure(game, buttons, adventure);
        log?.push(buttons, game);
        fso.cues?.observe(game, true);
        view.follow(game);
      }
      if (replaying.left === 0 && fso.replay && !fso.replay.done) Object.assign(fso.replay, { steps: replaying.steps, done: true, hash: hashState(game) });
      acc = 0;
    }
    if (fso.manual) acc = 0;
    while (acc >= TICK_MS) {
      tick();
      acc -= TICK_MS;
    }
    view.render(game);
    frames++;
    if (now - fpsAt >= 1000) {
      fps = frames;
      frames = 0;
      fpsAt = now;
    }
    const p = game.players[0]!, a = game.adventure;
    if (!quotaAt && quotaMet(game)) quotaAt = game.tick;
    if (next && a.cleared && !leaving && game.tick - a.cleared >= CLEAR_SHOW_TICKS) {
      leaving = true;
      saveRun(session, { ...loadRun(session), [info.id]: a.gems });
      saveCarry(session, next === "end" ? null : { stage: next, carry: carryOf(game) });
      goTo(next);
    }
    const nextName = next && next !== "end" ? stages.find((s) => s.id === next)?.name : undefined;
    const text = a.cleared ? `${info.name}: cleared!${nextName ? `\nNext: ${nextName}` : ""}` : quotaAt > 0 && game.tick - quotaAt < QUOTA_SHOW_TICKS ? quotaText : "";
    if (banner.textContent !== text) banner.textContent = text;
    banner.hidden = !text;
    const where = a.area ? `room ${a.room} · inside ${a.area}` : `room ${a.room}`;
    const help = touch.visible ? "stick to move · Sword · Item talks/reads · Action lifts · pause: stages" : "arrows/WASD · J/Z sword · L/C action · K/X item, talk/read · TFGH formations · Q/E apart/together, 1-4 a Link · Esc: stages";
    hud.textContent = `${info.name} · ${where} · (${Math.floor(p.x / SUBPX)}, ${Math.floor(p.y / SUBPX)}) · ${fps} fps\n${help}${debug ? " · debug" : ""}`;
    void canvas;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

/** The sound button and volume slider (top right of the page), kept in sync with the audio's state (as apps/battle's). */
function audioControls(audio: AdventureAudio): void {
  const box = $("audio"), mute = $<HTMLButtonElement>("mute"), volume = $<HTMLInputElement>("volume");
  box.hidden = false;
  mute.textContent = audio.muted ? "Sound off" : "Sound on";
  mute.classList.toggle("off", audio.muted);
  volume.value = String(audio.volume);
  if (box.dataset.wired) return;
  box.dataset.wired = "1";
  mute.addEventListener("click", () => {
    audio.muted = !audio.muted;
    audioControls(audio);
  });
  volume.addEventListener("input", () => {
    audio.volume = Number(volume.value);
    if (audio.muted && audio.volume > 0) audio.muted = false;
    audioControls(audio);
  });
  // Give the keyboard back to the game (arrow keys would otherwise move the slider too).
  for (const el of [mute, volume]) el.addEventListener("change", () => el.blur());
  mute.addEventListener("click", () => mute.blur());
}

/** A file of an archive by path (case-insensitive, as the screens name their textures), unpacked. */
function archiveFile(archive: RarcArchive, path: string): Uint8Array | null {
  const file = archive.files.find((f) => f.path.toLowerCase() === path.toLowerCase());
  return file ? (isYaz0(file.data) ? decompressYaz0(file.data) : file.data) : null;
}

/** Textures for a J2D screen from its archives' timg/ (as apps/battle's HUD finds them). */
function screenAssets(archives: RarcArchive[]): ScreenAssets {
  return {
    texture(name) {
      for (const a of archives) {
        const bytes = archiveFile(a, `timg/${name}`);
        if (bytes) return { image: decodeBti(bytes), header: parseBtiHeader(bytes) };
      }
      return null;
    },
  };
}

main().catch((error) => {
  $("boot").hidden = false;
  $("boot-status").textContent = `Error: ${(error as Error).message}`;
  console.error(error);
});
