// Local Shadow Battle: 2-4 Links on one machine (two keyboard layouts plus gamepads, and the on-screen touch controls
// for P1); any of them can be a CPU (the sim's cpu.ts), so one player can fight the computer.
// Deep link: #arena=0-9&players=2-4&hearts=2|3|4|6&time=<seconds>&wins=<n>&start (skip the menu), #cpu=2,3 or
// #cpu=2:hard,4:easy (CPU players by number, normal by default; players grows to include them), #vs=cpu (the home
// page's "Vs. Computer": P1 plays, the others are CPUs at their last level) or #vs=local (everyone plays), #debug,
// #camera=full, #mute, #seed=<n> (the battle's random generator: what the item orbs hold), #touch=on|off (the
// on-screen controls, shown on touch screens by default). Audio starts on the first key press, click or tap (browsers
// need a gesture); M mutes. Dev server only (captures, docs/tools.md): F8 captures the moment (Shift+F8 with a
// note) to captures/, #replay=<capture id|latest>[&at=<tick>] replays a capture's match to that tick and freezes it
// there (F9 plays on from it).
import {
  applyOverlay,
  createImage,
  decodeBti,
  decompressYaz0,
  Dol,
  drawLayer,
  isYaz0,
  LAYER_PIXELS,
  loadOverlay,
  loadSob,
  loadSpriteSheet,
  loadTileset,
  parseBlo,
  parseBtiHeader,
  parseRarc,
  readTileTypes,
  Stage,
  type RarcArchive,
  type Tileset,
} from "@fso/formats";
import { LocalInput } from "@fso/input";
import { TouchControls } from "@fso/input/touch";
import type { ScreenAssets } from "@fso/render";
import {
  addCpus,
  ARENA_H,
  Button,
  ARENA_ROOMS,
  arenaName,
  arenaProps,
  arenaSpawns,
  buildArenaWorld,
  CPU_LEVELS,
  cpuInputs,
  cpuLevel,
  createBattle,
  DEFAULT_RULES,
  FREE_ROOMS,
  FREE_STAGE,
  freeWorld,
  hashGame,
  HEART_OPTIONS,
  InputLog,
  MAX_FIGHTERS,
  replayFrameSteps,
  RunCursor,
  stepGame,
  SUBPX,
  type ArenaProps,
  type BattleRecord,
  type CpuLevel,
  type GameState,
  type World,
} from "@fso/sim";
import { GameArt, openServerStore, SYS_DOL, type AssetStore } from "@fso/web";
import { BattleScreens } from "./banners.ts";
import { ControlsDialog } from "./controls.ts";
import { BattleHud, linkIcon, PLAYER_COLORS, playerName } from "./hud.ts";
import { fillArt, setMenuArt } from "./menu-art.ts";
import { isTouch, setupMobilePage, WakeLock } from "./mobile.ts";
import { NameTags } from "./nametags.ts";
import { Online, type FreeMap } from "./online.ts";
import { PauseScreen } from "./pause.ts";
import { RankLabels } from "./ranks.ts";
import type { PauseInput } from "./pause-state.ts";
import { LocalResults } from "./results2d.ts";
import { ArenaView, withTrickFloors } from "./scene.ts";
import { darkSeconds, SideRoomOverlay } from "./siderooms.ts";
import { arenaLabel, arenaTitle, menuText, setMenuMessages } from "./menu-text.ts";
import { ScreenFiles } from "./screen-files.ts";
import { BattleAudio, SoundCues } from "./sound.ts";
import { screensView, TOTAL, TOTAL_PLAYERS, type ScreensView } from "./timeline.ts";
import { TotalScreen } from "./total.ts";

const ROOT = "GC4Sword_usa";
const TICK_MS = 1000 / 60;
const SETTINGS_KEY = "fso.battle.settings";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.hash.slice(1));

/** Who plays a Link: a person at this machine, or the computer at a level. */
type Slot = "human" | CpuLevel;

interface Settings {
  room: number;
  players: number;
  hearts: number;
  time: number; // seconds, 0 = no limit
  wins: number;
  padsFirst: boolean;
  /** Per player (P1-P4): human or CPU. */
  slots: Slot[];
}

const DEFAULTS: Settings = { room: 0, players: 2, hearts: DEFAULT_RULES.hearts, time: 0, wins: 3, padsFirst: false, slots: ["human", "human", "human", "human"] };
/** A touch screen has one player (the on-screen controls): the others start as CPUs. */
const TOUCH_SLOTS: Slot[] = ["human", "normal", "normal", "normal"];


interface Match {
  game: GameState;
  world: World;
  settings: Settings;
  /** Dev server: the match's start and inputs (@fso/sim replay.ts), for F8's captures. */
  record: Omit<BattleRecord, "inputs" | "checkpoints" | "tick" | "hash"> | null;
  log: InputLog | null;
}

/** A capture being replayed (#replay=): its inputs, fed this many more steps; then the match stands still until F9. */
interface Replaying {
  id: string;
  cursor: RunCursor;
  left: number;
  steps: number;
}

/** Test hooks (tools/e2e/src/battle.ts). */
const fso = {
  mode: "boot" as "boot" | "menu" | "match" | "online",
  game: null as GameState | null,
  world: null as World | null,
  stage: null as Stage | null,
  view: null as ArenaView | null,
  hud: null as BattleHud | null,
  /** The game's own round screens (banners.ts, total.ts) and the local match's end (results2d.ts). */
  screens: null as BattleScreens | null,
  total: null as TotalScreen | null,
  results: null as LocalResults | null,
  /** The local match's pause screen (pause.ts): the sim stops while it is up. */
  pause: null as PauseScreen | null,
  /** The ranking labels by the portraits and over the heads (ranks.ts). */
  ranks: null as RankLabels | null,
  audio: null as BattleAudio | null,
  cues: null as SoundCues | null,
  settings: { ...DEFAULTS },
  startMatch: (_settings?: Partial<Settings>) => {},
  showMenu: () => {},
  online: null as Online | null,
  /** The screen kept on during matches (mobile.ts). */
  wakeLock: new WakeLock(),
  touch: null as TouchControls | null,
  /** The replay of a capture (#replay=, dev server): where it is; `done` once it stands at its tick. */
  replay: null as { id: string; steps: number; done: boolean; hash: number; expected: number } | null,
};
(window as unknown as { fso: typeof fso }).fso = fso;

async function main(): Promise<void> {
  setupMobilePage();
  const store = await openServerStore();
  $("boot-status").textContent = "Loading the arenas…";
  const progress = $<HTMLProgressElement>("progress");
  store.onProgress = (loaded, total) => ((progress.hidden = false), (progress.value = loaded / total));
  await start(store);
  store.onProgress = null;
  $("boot").hidden = true;
}

async function start(store: AssetStore): Promise<void> {
  const archive = async (path: string): Promise<RarcArchive> => {
    const bytes = await store.read(`${ROOT}/${path}`);
    return parseRarc(isYaz0(bytes) ? decompressYaz0(bytes) : bytes);
  };
  const data = await archive("data.arc");
  const stage = new Stage(await archive("Boss/boss500.arc"));
  const dol = new Dol(await store.read(SYS_DOL));
  const tileTypes = readTileTypes(dol);
  const view = new ArenaView($("screen"), data, stage, tileTypes, loadSpriteSheet(data, stage.layout.npcSheetId), loadSob(data, "player_sob.bin"));
  view.debug = params.has("debug");
  if (params.has("nolight")) view.lighting.enabled = false; // the Dark World without its darkness
  if (params.get("camera") === "full") view.cameraMode = "full";
  // The J2D battle HUD: game2D.arc's main_bat.blo, textures from game2D then main2D (the digits and partial hearts).
  const hudArchives = [await archive("game2D.arc"), await archive("main2D.arc")];
  view.setDigits(hudArchives[1]!); // (the Tower of Winds' giant bomb's countdown)
  // The menus' art (menu-art.ts): the Shadow Battle plate, the Link icons, the title screen's sky.
  const art = new GameArt(store);
  art.provide("game2D.arc", hudArchives[0]!);
  setMenuArt(art);
  const hud = new BattleHud(parseBlo(archiveFile(hudArchives[0]!, "scrn/main_bat.blo")!), hudAssets(hudArchives), $("hud"));
  view.hud = hud;
  // The game's own round screens, drawn in the HUD's scene over it: the intro, the knockouts, the result (banners.ts)
  // and the Total screen (total.ts), from the screen archives, data.arc's "Go!" and the US messages and font.
  const [resultArc, messages] = await Promise.all([archive("result.arc"), archive("msgus.arc")]);
  const files = new ScreenFiles(new Map([["game2D.arc", hudArchives[0]!], ["main2D.arc", hudArchives[1]!], ["result.arc", resultArc], ["data.arc", data], ["msgus.arc", messages]]));
  // The menus' words from the same messages (menu-text.ts): arena names, Rules, START!, the results, the pause.
  setMenuMessages(files.bmg);
  showMenuText();
  const screens = new BattleScreens(files), total = new TotalScreen(files);
  // The local match's pause (Esc, a gamepad's Start, the on-screen pause button): game2D's pause.blo (pause.ts).
  const pause = new PauseScreen(files, $("pause"));
  // The HUD's ranking labels ("1st", "2nd"… by the portraits and over the heads: ranks.ts).
  const ranks = new RankLabels(files);
  hud.scene.add(ranks.group, screens.group, ...total.objects, pause.group);
  const results = new LocalResults($("results"), $("rematch"), $("to-menu"));
  const input = new LocalInput();
  // The on-screen controls (touch screens): P1's, or this browser's Link online; their pause button does what Esc does.
  const touch = new TouchControls({ after: $("hud"), pause: () => (online.current ? online.togglePause() : fso.mode === "match" && togglePause()) });
  input.attach(0, touch);
  // Audio loads in the background; the AudioContext starts on the first key press, click or tap (iOS: a touch's pointerup).
  let cues: SoundCues | null = null;
  const audioReady = BattleAudio.load((path) => store.read(path), stage, dol).then((audio) => {
    if (params.has("mute")) audio.muteForSession();
    fso.audio = audio;
    fso.cues = cues = new SoundCues(audio);
    if (match) cues.reset(match.settings.room);
    else if (online.game) cues.reset(onlineRoom);
    audioControls(audio);
    return audio;
  });
  audioReady.catch((error: Error) => console.warn(`audio unavailable: ${error.message}`));
  const gesture = () => void (fso.audio ? fso.audio.start() : audioReady.then((audio) => audio.start())).catch(() => {});
  window.addEventListener("keydown", gesture, { capture: true });
  window.addEventListener("pointerdown", gesture, { capture: true });
  window.addEventListener("pointerup", gesture, { capture: true });
  const worlds = new Map<number, World>();
  const worldFor = (room: number) => worlds.get(room) ?? worlds.set(room, buildArenaWorld(stage, tileTypes, room)).get(room)!;
  // The arena's hazards, orb generators and bushes, for the sim (props.ts).
  const props = new Map<number, ArenaProps>();
  const propsFor = (room: number) => props.get(room) ?? props.set(room, arenaProps(stage, tileTypes, room)).get(room)!;
  Object.assign(fso, { stage, view, hud, touch, screens, total, results, pause, ranks });

  let settings = loadSettings();
  let match: Match | null = null;
  const menu = buildMenu(data, stage, () => settings, (s) => {
    settings = s;
    saveSettings(s);
    input.gamepadsFirst = s.padsFirst;
    showControls(input, s);
  });

  let replaying: Replaying | null = null;
  const startMatch = (overrides: Partial<Settings> = {}, seedOverride?: number) => {
    settings = { ...settings, ...overrides };
    if (seedOverride === undefined) saveSettings(settings); // (a replay leaves the menu's settings alone)
    replaying = null;
    fso.replay = null;
    menu.sync();
    input.gamepadsFirst = settings.padsFirst;
    const world = worldFor(settings.room);
    const spawns = arenaSpawns(stage, settings.room).slice(0, settings.players);
    // The battle's random generator (what the orbs hold): #seed=<n> for a repeatable match, else a new one each time.
    const seed = seedOverride ?? (params.has("seed") ? Number(params.get("seed")) >>> 0 : crypto.getRandomValues(new Uint32Array(1))[0]!);
    const rules = { hearts: settings.hearts, timeLimit: settings.time * 60, wins: settings.wins };
    const game = createBattle(settings.room, spawns, rules, propsFor(settings.room), seed);
    const cpus = settings.slots.slice(0, spawns.length).flatMap((slot, player) => (slot === "human" ? [] : [{ player, level: slot }]));
    addCpus(game, cpus);
    const record = import.meta.env.DEV ? { kind: "battle" as const, room: settings.room, players: spawns.length, rules, seed, cpus } : null;
    match = { game, world, settings, record, log: record && new InputLog() };
    pause.reset();
    view.show(settings.room, spawns.length);
    hud.reset(spawns.length);
    results.reset();
    cues?.reset(settings.room);
    Object.assign(fso, { mode: "match", game, world, settings });
    fso.wakeLock.hold(true);
    touch.show(true);
    $("menu").hidden = true;
    $("results").hidden = true;
    $("hud").hidden = false;
  };
  const showMenu = () => {
    match = null;
    pause.reset();
    results.reset();
    fso.mode = "menu";
    fso.wakeLock.hold(false);
    fso.audio?.stopAll();
    touch.show(false);
    $("hud").hidden = true;
    $("results").hidden = true;
    $("menu").hidden = false;
    menu.sync();
    showControls(input, settings);
  };
  Object.assign(fso, { startMatch, showMenu });
  // The pause: Esc, Start or the pause button open it during a round (at the match's end Esc is the results' Menu).
  let pauseHeld = 0, pauseKeys: PauseInput = {};
  const togglePause = () => {
    if (!match || match.game.battle?.phase === "matchOver") return showMenu();
    if (!pause.active) pauseHeld = localButtons(input, match.settings).reduce((a, m) => a | m, 0);
    pause.toggle();
  };
  // Choose a Game: the site's home page (the game's mode select), or the menu where the app runs on its own.
  const chooseGame = () => {
    const home = document.querySelector<HTMLAnchorElement>("a.fso-home");
    if (home) location.assign(home.href);
    else showMenu();
  };

  // Free play's map (freeplay.ts): its stage and collision, loaded the first time a page goes to free play.
  let freeMap: Promise<FreeMap> | null = null;
  const loadFreeMap = () =>
    (freeMap ??= archive(`Boss/${FREE_STAGE}.arc`).then((a) => {
      const free = new Stage(a);
      return { stage: free, world: freeWorld(free, tileTypes) };
    }));
  // Online play (online.ts): lobby, rooms and the net match, which steps the game itself; this file only draws it.
  let onlineRoom = 0; // (the arena whose music the online match plays)
  const online = new Online(
    {
      stage,
      worldFor,
      propsFor,
      freeMap: () => loadFreeMap().catch((error: Error) => ((freeMap = null), Promise.reject(error))),
      defaults: () => ({ arena: settings.room, hearts: settings.hearts, time: settings.time, wins: settings.wins, players: settings.players }),
      input: () => input.single(),
      screen: (what, scene = { room: 0, players: 2 }) => {
        match = null;
        fso.mode = "online";
        $("menu").hidden = true;
        $("results").hidden = true;
        $("hud").hidden = what !== "match";
        fso.wakeLock.hold(what === "match");
        touch.show(what === "match", online.localPlayer >= 0); // a spectator gets the pause button only
        if (what === "match") {
          const free = !!scene.map;
          if (scene.map) view.showMap(scene.map.stage, FREE_ROOMS, scene.players);
          else view.show(scene.room, scene.players);
          // The HUD's four corners, for battles that fit them.
          hud.reset(free || scene.players > MAX_FIGHTERS ? 0 : scene.players);
          onlineRoom = scene.room;
          cues?.reset(scene.room, free); // (free play restarting doesn't restart its music)
        } else fso.audio?.stopAll();
      },
      exit: showMenu,
    },
    params,
  );
  fso.online = online;
  // Online the match menu (the lobby's #online-pause) gets the game's pause screen under its buttons: the plate drops
  // in, Continue then the room's choices in the message font; the match goes on meanwhile.
  const onlinePause = new PauseScreen(files, $("online-pause"), { online: { area: "End the match", game: "Leave the match" } });
  $("online-pause").classList.add("game-look");
  hud.scene.add(onlinePause.group);
  let onlineHeld = 0;
  /** One tick of the online match menu: opens and closes with the lobby's, its cursor on this browser's buttons. */
  const stepOnlinePause = () => {
    const paused = online.ui.paused;
    if (paused && !onlinePause.active) {
      onlinePause.offer(!$("online-end").hidden, { area: "End the match", game: $("online-quit").textContent || "Leave" });
      onlinePause.toggle();
      onlineHeld = input.single();
    } else if (!paused && onlinePause.state && onlinePause.state.phase !== "closing") onlinePause.state.resume();
    if (!onlinePause.active) return;
    const now = input.single(), fresh = now & ~onlineHeld;
    onlineHeld = now;
    const outcome = onlinePause.step({ ...pauseKeys, up: !!(fresh & Button.Up), down: !!(fresh & Button.Down), a: pauseKeys.a || !!(fresh & Button.Sword), b: pauseKeys.b || !!(fresh & Button.Item) });
    pauseKeys = {};
    if (outcome === "continue") online.ui.pause(false);
    else if (outcome === "area") $("online-end").click();
    else if (outcome === "game") $("online-quit").click();
  };
  Object.assign(fso, { onlinePause });
  $("play-online").addEventListener("click", () => online.open());
  // Key and gamepad bindings (controls.ts), applied when the dialog closes.
  const controls = new ControlsDialog(input, () => showControls(input, settings), touch);
  // Human or CPU, per player: the select on each row of the controls list.
  $("controls").addEventListener("change", (e) => {
    const select = e.target as HTMLSelectElement;
    if (!select.matches("select.slot")) return;
    const slots = [...settings.slots];
    slots[Number(select.dataset.slot)] = select.value as Slot;
    settings = { ...settings, slots };
    saveSettings(settings);
    showControls(input, settings);
    select.blur();
  });
  $("controls-open").addEventListener("click", () => controls.open());
  $("pause-controls").addEventListener("click", () => controls.open());

  $("start").addEventListener("click", () => startMatch());
  $("rematch").addEventListener("click", () => startMatch());
  $("to-menu").addEventListener("click", showMenu);
  // The match's end: a click or a tap anywhere moves on from "PRESS START" (on a touch screen the on-screen controls
  // take most taps); keys and buttons: the loop, LocalResults.
  window.addEventListener("pointerdown", () => match && results.press(match.game), { capture: true });
  window.addEventListener("keydown", (e) => {
    const end = match?.game.battle?.phase === "matchOver";
    if (onlinePause.active && fso.mode === "online" && (e.code === "Enter" || e.code === "Space" || e.code === "NumpadEnter")) {
      pauseKeys.a = true;
      e.preventDefault();
      return;
    }
    if (pause.active && fso.mode === "match") {
      // The pause takes the keys: Esc is Start, Enter / Space A, Backspace B (the players' own keys work too).
      if (e.code === "Escape") togglePause();
      else if (e.code === "Enter" || e.code === "Space" || e.code === "NumpadEnter") pauseKeys.a = true;
      else if (e.code === "Backspace") pauseKeys.b = true;
      if (["Escape", "Enter", "Space", "NumpadEnter", "Backspace"].includes(e.code)) e.preventDefault();
      return;
    }
    if (end && results.pressed === null && (e.code === "Enter" || e.code === "Space" || e.code === "NumpadEnter")) results.press(match!.game);
    else if (!$("results").hidden && (e.code === "ArrowLeft" || e.code === "ArrowRight")) results.cursor = e.code === "ArrowLeft" ? 0 : 1;
    else if (!$("results").hidden && (e.code === "Enter" || e.code === "Space") && results.cursor === 1) showMenu();
    else if ((e.code === "Enter" && (fso.mode === "menu" || !$("results").hidden)) || (e.code === "Space" && !$("results").hidden)) startMatch();
    else if (e.code === "Escape" && fso.mode === "match") togglePause();
    else if (e.code === "KeyV" && (fso.mode === "match" || fso.mode === "online")) view.cameraMode = view.cameraMode === "fit" ? "full" : "fit";
    else if (e.code === "KeyM" && fso.audio) {
      fso.audio.muted = !fso.audio.muted;
      audioControls(fso.audio);
    }
  });
  for (const event of ["gamepadconnected", "gamepaddisconnected"]) window.addEventListener(event, () => fso.mode === "menu" && showControls(input, settings));

  // Online, the players' names over their Links at each round's start (nametags.ts).
  const tags = new NameTags($("hud"));
  // The side rooms' insets (a frame in the tunic color) and the marks where a Link comes out onto the TV (siderooms.ts).
  const sides = new SideRoomOverlay($("hud"));
  const present = (game: GameState): ScreensView => {
    const frame = view.frame();
    const links = view.screenLinks(game);
    hud.update(game, links, (i) => view.linkSprite(game, i)); // (the corners a Link stands in front of hide: hud.ts)
    ranks.update(game, hud.shownPlayers, (i) => hud.cornerAlpha(i), links, (i) => hud.inSideRoom(i));
    hud.place(frame);
    touch.place(frame);
    // Online, only this browser's own side room shows (a spectator sees what the TV shows); locally, everyone's.
    view.insetPlayers = online.game === game ? (online.localPlayer >= 0 ? [online.localPlayer] : []) : null;
    // The game's round screens: online, the match's end goes on to the Total screen by itself (no one waits for a press).
    const local = online.game !== game, b = game.battle;
    const shown = screensView(game, local ? "press" : "auto", local ? results.pressed : null);
    screens.update(shown, links);
    pause.draw();
    pause.place(frame);
    if (!local) {
      onlinePause.draw();
      onlinePause.place(frame);
    } else if (onlinePause.active) onlinePause.reset();
    total.update(shown.total && b ? { s: shown.total.s, stars: b.fighters.map((f) => f.stars), winner: b.roundWinner, highlight: local ? 0 : online.localPlayer, cursor: local && b.phase === "matchOver" ? results.cursor : null } : null);
    // Under the Total screen (opaque from the end of its fade to black) the arena isn't drawn at all.
    view.render(game, !!shown.total && shown.total.s >= TOTAL.fadeOut);
    sides.update(view.insets(game).map((r) => ({ ...r, seconds: darkSeconds(game, r.player) })), view.exitPoints(game), game.tick);
    if (online.game === game) {
      tags.update(view.heads(game), online.names, online.localPlayer, game.battle, frame);
      online.place(frame);
      // Over the Total screen, the online results are a strip along the bottom (online.css).
      document.getElementById("online-results")?.classList.toggle("total", !!shown.total);
    } else tags.hide();
    return shown;
  };
  let last = performance.now(), acc = 0;
  const loop = (now: number) => {
    acc += Math.min(now - last, 250);
    last = now;
    const net = online.game;
    if (net) {
      // Online: the net match steps the game from a worker timer (online.ts), rolling back at times; present its
      // latest state (the cues are keyed by the tick their cause started, so re-shown or skipped frames are fine).
      acc = 0;
      for (let n = online.takeFrames(); n > 0; n--) {
        view.follow(net);
        stepOnlinePause();
      }
      cues?.observe(net);
      present(net);
    } else if (match && replaying) {
      // A capture's replay: its logged inputs fast, the last second and a half as played (replayFrameSteps), then the
      // match stands still where the capture was taken.
      const { game, world } = match;
      for (let n = replayFrameSteps(replaying.left); n > 0; n--, replaying.left--, replaying.steps++) {
        const buttons = replaying.cursor.next() ?? [];
        stepGame(game, cpuInputs(game, world, buttons), world);
        match.log?.push(buttons, game);
        view.follow(game);
      }
      if (replaying.left === 0 && fso.replay && !fso.replay.done) Object.assign(fso.replay, { steps: replaying.steps, done: true, hash: hashGame(game) });
      acc = 0;
      present(game);
    } else if (match && (pause.active || padStart(match))) {
      // Paused: the sim stands still; the pause steps on its own clock with the local players' fresh presses.
      if (!pause.active) togglePause();
      cues?.quiet(); // (the held sounds: a circle's hum, a fuse)
      let outcome: ReturnType<PauseScreen["step"]> = null;
      while (acc >= TICK_MS && !outcome) {
        const now = localButtons(input, match.settings).reduce((a, m) => a | m, 0), fresh = now & ~pauseHeld;
        pauseHeld = now;
        const start = padStart(match);
        outcome = pause.step({ ...pauseKeys, up: !!(fresh & Button.Up), down: !!(fresh & Button.Down), left: !!(fresh & Button.Left), right: !!(fresh & Button.Right), a: pauseKeys.a || !!(fresh & Button.Sword), b: pauseKeys.b || !!(fresh & Button.Item), start: pauseKeys.start || start });
        pauseKeys = {};
        acc -= TICK_MS;
      }
      if (outcome === "area") showMenu();
      else if (outcome === "game") chooseGame();
      else {
        if (outcome === "continue") acc = 0; // (play goes on from here, no catching up)
        present(match.game);
      }
    } else if (match) {
      const game = match.game;
      let picked: "continue" | "quit" | null = null;
      while (acc >= TICK_MS && !picked) {
        // The CPUs' buttons come from the state (cpu.ts), the others' from this machine's keyboards and gamepads (at
        // the match's end also the press on "PRESS START", then Continue / Quit: results2d.ts).
        const buttons = localButtons(input, match.settings);
        picked = results.buttonsDown(game, buttons, screens.last);
        stepGame(game, cpuInputs(game, match.world, buttons), match.world);
        match.log?.push(buttons, game);
        view.follow(game);
        cues?.observe(game);
        acc -= TICK_MS;
      }
      if (picked === "continue") startMatch();
      else if (picked === "quit") showMenu();
      else {
        const shown = present(game);
        // The results (#results, over the Total screen's buttons) once they are up; without a Total screen, at once.
        const up = game.battle?.phase === "matchOver" && (results.buttonsUp(shown) || game.battle.fighters.length > TOTAL_PLAYERS);
        if (up && $("results").hidden) showResults(game);
        if (up && shown.total) results.place(view.frame());
      }
    } else acc = 0;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  if (import.meta.env.DEV) {
    const redraw = () => {
      const game = online.game ?? match?.game;
      if (game) present(game);
    };
    devTools(() => match, startMatch, (r) => (replaying = r), view, redraw);
  }
  if (online.boot()) return;
  if (import.meta.env.DEV && params.has("replay")) return;
  if (params.has("start")) startMatch();
  else showMenu();
}

/**
 * Dev server only: F8 captures (packages/web capture.ts), #replay= replays a capture's match, F9 plays on from it.
 * `replay` sets the main loop's replay.
 */
function devTools(current: () => Match | null, startMatch: (s: Partial<Settings>, seed: number) => void, replay: (r: Replaying | null) => void, view: ArenaView, render: () => void): void {
  void import("@fso/web/capture").then(async ({ installCapture, fetchReplay }) => {
    installCapture({
      app: "battle",
      canvas: $<HTMLCanvasElement>("screen"),
      render,
      info: () => {
        const game = fso.game, b = game?.battle;
        return {
          mode: fso.mode,
          tick: game?.tick ?? null,
          arena: game ? arenaName(game.room) : null,
          phase: b?.phase ?? null,
          round: b?.round ?? null,
          camera: view.cameraMode,
          players: game?.players.map((p, i) => ({ x: p.x / SUBPX, y: p.y / SUBPX, action: p.action, facing: p.facing, hearts: b?.fighters[i]?.hearts, cpu: cpuLevel(game, i) })),
        };
      },
      state: () => fso.game,
      replay: () => {
        const m = current();
        return m?.record && m.log && { ...m.record, inputs: m.log.runs, checkpoints: m.log.checkpoints, tick: m.game.tick, hash: hashGame(m.game) };
      },
    });
    addEventListener("keydown", (e) => {
      if (e.code === "F9" && fso.replay?.done) replay(null);
    });
    const id = params.get("replay");
    if (!id) return;
    const record = (await fetchReplay(id)) as BattleRecord;
    const total = record.inputs.reduce((n, [, t]) => n + t, 0);
    const at = params.has("at") ? Math.min(total, Math.max(0, Number(params.get("at")))) : total;
    const slots = DEFAULTS.slots.map((_, i): Slot => record.cpus.find((c) => c.player === i)?.level ?? "human");
    startMatch({ room: record.room, players: record.players, hearts: record.rules.hearts, time: record.rules.timeLimit / 60, wins: record.rules.wins, slots }, record.seed);
    fso.replay = { id, steps: 0, done: at === 0, hash: hashGame(fso.game!), expected: at === total ? record.hash : (record.checkpoints.find(([t]) => t === at)?.[1] ?? -1) };
    replay({ id, cursor: new RunCursor(record.inputs), left: at, steps: 0 });
  }).catch((error: Error) => {
    console.warn(`dev tools: ${error.message}`);
    if (fso.mode === "boot") fso.showMenu(); // (a replay that couldn't load)
  });
}

/** A fresh press of Start on any gamepad (standard mapping: button 9), during a round of a local match. */
let startWasDown = false;
function padStart(match: Match): boolean {
  const down = [...(navigator.getGamepads?.() ?? [])].some((pad) => !!pad?.buttons[9]?.pressed);
  const fresh = down && !startWasDown;
  startWasDown = down;
  return fresh && match.game.battle?.phase !== "matchOver";
}

function showResults(game: GameState): void {
  const b = game.battle!;
  // The game's "P1 WINS!" (its result banner reads the same: banners.ts).
  const title = Object.assign(document.createElement("span"), { textContent: menuText().wins[b.matchWinner] ?? `${playerName(b.matchWinner)} WINS!` });
  title.style.color = PLAYER_COLORS[b.matchWinner]!;
  $("results-title").replaceChildren(title);
  const order = b.fighters.map((f, i) => ({ f, i })).sort((a, z) => z.f.stars - a.f.stars || a.i - z.i);
  $("standings").innerHTML = order
    .map(({ f, i }) => {
      const stars = Array.from({ length: b.rules.wins }, (_, s) => `<i class="star${s < f.stars ? " won" : ""}"></i>`).join("");
      const cpu = cpuLevel(game, i);
      return `<li class="${i === b.matchWinner ? "winner" : ""}" style="--color:${PLAYER_COLORS[i]}"><span class="link-icon" data-art-bg="${linkIcon(i)}"></span><b>${playerName(i)}</b>${cpu ? `CPU (${cpu}) · ` : ""}${f.stars} ${f.stars === 1 ? "star" : "stars"}<span class="stars">${stars}</span></li>`;
    })
    .join("");
  fillArt($("standings"));
  $("results").hidden = false;
}

/** The menu's and the pause's words from the game's messages (menu-text.ts); the page's own until they're read. */
function showMenuText(): void {
  const t = menuText();
  $("menu-title").textContent = t.title;
  $("rules-title").textContent = t.rules;
  $("start-label").textContent = t.start;
  $("pause-continue").textContent = t.continue;
  $("pause-yes").textContent = t.yes;
  $("pause-no").textContent = t.no;
  // The results' two buttons lie on the Total screen's Continue / Quit (results2d.ts).
  $("rematch-label").textContent = t.continue;
  $("to-menu-label").textContent = t.quit;
}

const SLOT_NAMES: Readonly<Record<Slot, string>> = { human: "Player", easy: "CPU: easy", normal: "CPU: normal", hard: "CPU: hard" };

/** The humans' buttons from this machine: they take the keyboard layouts and gamepads in order; CPU slots get 0. */
function localButtons(input: LocalInput, s: Settings): number[] {
  const slots = s.slots.slice(0, s.players);
  const humans = input.sample(slots.filter((slot) => slot === "human").length);
  let k = 0;
  return slots.map((slot) => (slot === "human" ? humans[k++] ?? 0 : 0));
}

/**
 * One row per player: its color and icon, who plays it (a select: player or a CPU level) and with what. On a touch
 * screen only the controllers it has count: the on-screen controls for P1, gamepads; a keyboard layout isn't one.
 */
function showControls(input: LocalInput, s: Settings): void {
  const slots = s.slots.slice(0, s.players);
  const touch = isTouch();
  const who = input.describe(slots.filter((slot) => slot === "human").length).map((text) => {
    if (!touch || !text) return text;
    return text.split(" · ").filter((part) => !part.startsWith("Keyboard")).join(" · ") || null;
  });
  let k = 0;
  $("controls").innerHTML = slots
    .map((slot, i) => {
      const text = slot === "human" ? (who[k++] ?? null) : "";
      const options = (["human", ...CPU_LEVELS] as const).map((o) => `<option value="${o}"${o === slot ? " selected" : ""}>${SLOT_NAMES[o]}</option>`).join("");
      const none = touch ? "no controller: pick a CPU or connect a gamepad" : "no controller: connect a gamepad";
      return `<li class="${text === null ? "none" : ""}" style="--color:${PLAYER_COLORS[i]}"><span class="link-icon" data-art-bg="link${i + 1}"></span><b>${playerName(i)}</b><select class="slot" data-slot="${i}" aria-label="Who plays ${playerName(i)}">${options}</select><span class="how">${text ?? none}</span></li>`;
    })
    .join("");
  fillArt($("controls"));
}

/** The arena picker (thumbnails drawn from the disc) and the rule options. */
function buildMenu(data: RarcArchive, stage: Stage, get: () => Settings, set: (s: Settings) => void): { sync(): void } {
  const tilesets = new Map<number, Tileset>();
  const arenas = $("arenas");
  const buttons = ARENA_ROOMS.map((room) => {
    const button = document.createElement("button");
    button.className = arenaName(room).includes("Dark World") ? "arena dark" : "arena";
    button.dataset.room = String(room);
    // The game's "Tower of Flames\n(Dark World)" → the name, and the world under it.
    const { name, world } = arenaLabel(room);
    const label = document.createElement("span");
    label.textContent = name;
    if (world) label.append(Object.assign(document.createElement("small"), { textContent: world }));
    button.append(thumbnail(data, stage, room, tilesets), label);
    button.addEventListener("click", () => {
      set({ ...get(), room });
      sync();
    });
    arenas.append(button);
    return button;
  });
  const players = $<HTMLSelectElement>("opt-players"), hearts = $<HTMLSelectElement>("opt-hearts");
  const time = $<HTMLSelectElement>("opt-time"), wins = $<HTMLSelectElement>("opt-wins"), padsFirst = $<HTMLInputElement>("opt-pads-first");
  const read = () =>
    set({ ...get(), players: Number(players.value), hearts: Number(hearts.value), time: Number(time.value), wins: Number(wins.value), padsFirst: padsFirst.checked });
  for (const control of [players, hearts, time, wins, padsFirst]) control.addEventListener("change", read);
  const sync = () => {
    const s = get();
    buttons.forEach((b, i) => b.classList.toggle("selected", ARENA_ROOMS[i] === s.room));
    $("arena-name").textContent = arenaTitle(s.room);
    players.value = String(s.players);
    hearts.value = String(s.hearts);
    time.value = String(s.time);
    wins.value = String(s.wins);
    padsFirst.checked = s.padsFirst;
  };
  sync();
  return { sync };
}

function thumbnail(data: RarcArchive, stage: Stage, room: number, tilesets: Map<number, Tileset>): HTMLCanvasElement {
  const index = stage.tilesetIndexOf(room);
  const tileset = tilesets.get(index) ?? tilesets.set(index, loadTileset(data, index)).get(index)!;
  const image = createImage(LAYER_PIXELS, LAYER_PIXELS);
  for (const group of [1, 2] as const) {
    const layer = group === 1 ? withTrickFloors(stage.layer(room, 1), stage, data, room) : stage.layer(room, 2);
    if (layer) drawLayer(image, tileset, layer);
  }
  const overlay = loadOverlay(data, stage.overlayTextureIdOf(room));
  if (overlay) applyOverlay(image, overlay);
  const canvas = document.createElement("canvas");
  canvas.width = LAYER_PIXELS;
  canvas.height = ARENA_H;
  const pixels = new Uint8ClampedArray(LAYER_PIXELS * ARENA_H * 4);
  pixels.set(image.data.subarray(0, pixels.length));
  canvas.getContext("2d")!.putImageData(new ImageData(pixels, LAYER_PIXELS, ARENA_H), 0, 0);
  return canvas;
}

/** A file of an archive by path (case-insensitive: screens name textures in other cases than the files), unpacked. */
function archiveFile(archive: RarcArchive, path: string): Uint8Array | null {
  const file = archive.files.find((f) => f.path.toLowerCase() === path.toLowerCase());
  return file ? (isYaz0(file.data) ? decompressYaz0(file.data) : file.data) : null;
}

/** Textures for a J2D screen: its archive's timg/ first, then the shared ones (as apps/screens does). */
function hudAssets(archives: RarcArchive[]): ScreenAssets {
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

/** The sound button and volume slider (top right of the page), kept in sync with the audio's state. */
function audioControls(audio: BattleAudio): void {
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

function loadSettings(): Settings {
  let stored: Partial<Settings> = {};
  try {
    stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as Partial<Settings>;
  } catch {}
  const s = { ...DEFAULTS, ...(isTouch() && !stored.slots ? { slots: TOUCH_SLOTS } : {}), ...stored };
  const num = (key: string) => (params.has(key) ? Number(params.get(key)) : null);
  s.room = num("arena") ?? s.room;
  s.players = num("players") ?? s.players;
  s.slots = DEFAULTS.slots.map((d, i) => (Array.isArray(s.slots) && ["human", ...CPU_LEVELS].includes(s.slots[i]!) ? s.slots[i]! : d));
  // The home page's modes: P1 against the computer (each CPU keeps its last level), or everyone plays.
  if (params.get("vs") === "cpu") s.slots = s.slots.map((slot, i) => (i === 0 ? "human" : slot === "human" ? "normal" : slot));
  else if (params.get("vs") === "local") s.slots = DEFAULTS.slots.map(() => "human" as Slot);
  if (params.has("vs")) {
    // Once: a reload keeps what the menu changed since.
    const hash = new URLSearchParams(location.hash.slice(1));
    hash.delete("vs");
    history.replaceState(null, "", `${location.pathname}${location.search}${hash.size ? `#${hash}` : ""}`);
  }
  if (params.has("cpu")) {
    // #cpu=2,3 or #cpu=2:hard,4:easy: those players are CPUs (normal unless given), the others human.
    s.slots = DEFAULTS.slots.map(() => "human" as Slot);
    for (const item of (params.get("cpu") ?? "").split(",")) {
      const [n, level = "normal"] = item.split(":");
      const i = Number(n) - 1;
      if (Number.isInteger(i) && i >= 0 && i < 4 && (CPU_LEVELS as readonly string[]).includes(level)) {
        s.slots[i] = level as CpuLevel;
        if (!params.has("players")) s.players = Math.max(s.players, i + 1);
      }
    }
  }
  s.hearts = num("hearts") ?? s.hearts;
  s.time = num("time") ?? s.time;
  s.wins = num("wins") ?? s.wins;
  // Keep values the menu can show.
  if (!(ARENA_ROOMS as readonly number[]).includes(s.room)) s.room = DEFAULTS.room;
  s.players = Math.min(4, Math.max(2, Math.floor(s.players) || DEFAULTS.players));
  if (!(HEART_OPTIONS as readonly number[]).includes(s.hearts)) s.hearts = DEFAULTS.hearts;
  if (![0, 60, 120, 180, 300].includes(s.time)) s.time = DEFAULTS.time;
  if (![1, 2, 3, 5].includes(s.wins)) s.wins = DEFAULTS.wins;
  return s;
}

function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {}
}

main().catch((error) => {
  $("boot").hidden = false;
  $("boot-status").textContent = `Error: ${(error as Error).message}`;
  console.error(error);
});
