// Online Shadow Battle (docs/netcode.md "Battle integration"): the lobby (create a room, or join one by code or invite
// link; the host's settings; start; rematch), the net match that steps the battle from a worker timer so hidden tabs
// keep playing, and the online overlays (banners, results, netplay stats). main.ts hands over its screens through
// the hooks and draws `online.game` while it's set; everything else about online play lives here.
//
// Free play (#free, the home page's mode): a name, then straight into a free room (the lobby's `free`: up to 8, anyone
// comes and goes) and onto free play's map. No room screen: its host (the first one in) keeps free play going for
// whoever is in the room, restarting it with everyone where they stand when someone joins or leaves (keepFree), and
// can start a battle for everyone; its results lead back to free play.
//
// Deep links (after #): online (open the online screen) · create · join=WORD [&spectate] · free · name=…
//   server=ws(s)://… · autostart=N (the host starts once N players are in) · arena= hearts= time=<s> wins=
//   delay=<frames> players=<max> (in free play: hearts, time and wins are the battles') · cpus=normal,hard (CPU players
//   after the players, by level)
//   transport=auto|webrtc|relay · lag=<ms>&jitter=<ms>&loss=<0-1> (artificial network trouble on our packets)
//   ice=fail (WebRTC never connects: TURN candidates only, and there is no TURN server; tests the relay fallback)
// create, join and spectate act once: boot() takes them out of the address, so a reload doesn't create or join again,
// and a link pasted into the address bar of the open page (a hash change) reloads it to follow the link. An invite
// opened without a name (none given, none saved) asks for one before joining; free play with a name= goes straight in.
//
// Phones stop a page when it goes to the background or the screen locks: they freeze its JS, or put it in the
// back-forward cache (pagehide with persisted, which also closes its sockets). Beyond the session's disconnect timeout
// (3 s) the others have cut us, so a page that comes back from either rejoins its match (below); without a way back
// (no key kept) it ends its match and says so (the "dropped" screen: watch the rest as a spectator, or back to the room
// for the next match). Before it goes, it tells the other players it's going to the background (an app message
// through the lobby's signaling), so their "P2 dropped out" can say why.
//
// Rejoining (docs/netcode.md "Rejoining"): a player keeps the room and his lobby key in sessionStorage while a match
// runs. A page back from the background, a reload (it lands on #online, or #free), or a lost lobby connection brings
// him back into the running match in his slot: the lobby's join with the key, then a snapshot from another player
// (startNetMatch). In a free room too: its free play, or the battle started from it.
import type { Stage } from "@fso/formats";
import { LobbyClient, ROOM_CODE, roomCode, startNetMatch, type NetMatch, type RoomInfo, type Route, type SessionEvent, type StartInfo, type TransportMode } from "@fso/net";
import { arenaSpawns, hashGame, type ArenaProps, type GameState, type World } from "@fso/sim";
import { startTicker } from "@fso/web";
import { LobbyUi, memberName } from "./lobby-ui.ts";
import { isTouch } from "./mobile.ts";
import { NetStats } from "./netstats.ts";
import { AUTO_DELAY, battleGame, cleanConfig, cpuSlots, DEFAULT_CONFIG, delayOptions, freeSpots, initialBattle, initialFree, parseConfig, PLAYER_LEFT, type MatchConfig } from "./online-game.ts";

const NAME_KEY = "fso.battle.online.name";
const SERVER_KEY = "fso.battle.online.server";
/** sessionStorage (this tab, kept through a reload): the running match to rejoin (RejoinRecord). */
const REJOIN_KEY = "fso.battle.online.rejoin";
/** Frames of final-state hashes kept (10 min), to compare peers (tests, desync hunting). */
const KEEP_FINALS = 36_000;
const STATS_MS = 250;
/**
 * A gap between two ticks this long means the page was frozen (a phone locked, another app in front) past the
 * session's disconnect timeout: the other players have cut us.
 */
const FROZEN_MS = 3000;
/** A free room's battle results stay up this long, then its host brings everyone back to free play. */
export const BACK_TO_FREE_MS = 8000;
/** A page that dropped out of a match rejoins it by itself at most once in this long (a link that keeps failing). */
const AUTO_REJOIN_MS = 60_000;
/** The arena of a free room's battles (the one moreSpawns fits and whose theme free play plays): The Field. */
const FREE_BATTLE_ARENA = 0;

/** Free play's map: its stage (for drawing) and collision (freeWorld). */
export interface FreeMap {
  stage: Stage;
  world: World;
}

/** What a match shows: an arena room (its music too), or free play's map; and how many Links. */
export interface MatchScene {
  room: number;
  players: number;
  map?: FreeMap;
}

export interface OnlineHooks {
  stage: Stage;
  worldFor(room: number): World;
  /** The arena's hazards, orb generators and bushes (arenaProps). */
  propsFor(room: number): ArenaProps;
  /** Free play's map, loaded on first use. */
  freeMap(): Promise<FreeMap>;
  /** The local menu's picks: where the host's room settings start. */
  defaults(): Partial<MatchConfig> & { players?: number };
  /** This browser's buttons (its one Link). */
  input(): number;
  /** Online screens take over: "lobby" hides the local ones, "match" also shows the arena and HUD for a match. */
  screen(what: "lobby" | "match", scene?: MatchScene): void;
  /** Back to local play (the menu). */
  exit(): void;
}

type Desync = Extract<SessionEvent, { type: "desync" }>;

interface Running {
  /** Set once the match is over for this page (a rematch, the end, leaving): its late callbacks are ignored. */
  closed: boolean;
  start: StartInfo;
  /** Our player index, -1 when spectating. */
  local: number;
  config: MatchConfig;
  net: NetMatch<GameState>;
  stopTicker: () => void;
  /** Display names by player index (the CPUs after the players). */
  names: string[];
  /** CPU players (after the room's players). */
  cpus: number;
  /** Players who left (their Links are out). */
  left: Set<number>;
  waiting: Set<number>;
  desyncs: Desync[];
  routes: Map<string, Route>;
  /** Frame last handed to the renderer (takeFrames). */
  drawn: number;
  /** The final state reached matchOver (results shown). */
  over: boolean;
  /** When the ticker last ticked (performance.now()): a long gap = the page was frozen. */
  tickedAt: number;
  /** Players whose page said it went to the background (and hasn't said it's back). */
  away: Set<number>;
  /** The match's collision (read by the e2e scripts' bots: window.fso.online.current.world). */
  world: World;
  /** A free room's battle: the timer that brings everyone back to free play once its results are up. */
  backToFree: number;
}

/** What a reloaded page (or one that lost the lobby) needs to come back into its match: the lobby, the room, our key. */
interface RejoinRecord {
  server: string;
  code: string;
  key: string;
  match: number;
  /** A free room's (free play, or a battle started from it). */
  free?: boolean;
}

/** What a page tells the other players through the lobby when it goes to the background or comes back. */
interface AwaySignal {
  away: boolean;
  /** The match it's about (StartInfo.match). */
  match: number;
}

/** The lobby named at build time (VITE_SIGNAL_URL), else `signal` under the site's base on the page's own host (a
 *  reverse proxy in production, Vite's proxy in dev): ws://localhost:5181/signal, wss://example.org/fso/signal. */
export function defaultServer(): string {
  const configured = import.meta.env.VITE_SIGNAL_URL as string | undefined;
  if (configured) return configured;
  const url = new URL(`${import.meta.env.BASE_URL}signal`, location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.href;
}

/** `url` with the lobby's shared secret, when the site publishes one at data/lobby-token: Safari doesn't send the
 *  page's Basic credentials on a WebSocket and pages can't set headers on one, so the lobby takes it as ?token=.
 *  No token file (an open lobby) = `url` as is. */
export async function withLobbyToken(url: string): Promise<string> {
  let token = "";
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/lobby-token`, { cache: "no-store" });
    // A dev server may answer any path with a page: only a plain token counts.
    if (res.ok) token = (await res.text()).trim();
  } catch {
    // offline or blocked: try without
  }
  if (!/^[\w-]{16,256}$/.test(token)) return url;
  const withToken = new URL(url);
  withToken.searchParams.set("token", token);
  return withToken.href;
}

export class Online {
  readonly ui: LobbyUi;
  lobby: LobbyClient | null = null;
  current: Running | null = null;
  /** Hashes of the current match's final states, by frame (when `recordFinals`). */
  readonly finals = new Map<number, number>();
  /**
   * Hash every final state, for tests comparing peers frame by frame and for desync hunting: on under automation
   * (navigator.webdriver, the e2e tests) or with #finals, off with #finals=0. Players don't need it (the session
   * compares its own hashes every 30 frames), and it costs up to ~0.15 ms a frame on the busiest arena.
   */
  readonly recordFinals: boolean;
  /** Session events of the current match. */
  readonly log: SessionEvent[] = [];
  /** Test hook: replaces the local buttons; gets the frame they are for and the state on screen. */
  script: ((frame: number, state: GameState) => number) | null = null;
  private readonly hooks: OnlineHooks;
  private readonly params: URLSearchParams;
  private readonly netStats = new NetStats();
  private lobbyUrl = "";
  private config: MatchConfig;
  private maxPlayers: number;
  private autostart: number;
  private busy = false;
  private statsAt = 0;
  /** The room we were dropped from (a frozen page), for rejoining it. */
  private droppedFrom = "";
  /** What the "dropped" screen shows (null once back in). */
  private dropped: { text: string; watch: boolean } | null = null;
  /** A match stopped by pagehide into the back-forward cache: shown as a drop if the page comes back. */
  private parked: { at: number; code: string; watch: boolean; free: boolean } | null = null;
  /** When this page last rejoined by itself after dropping out of a match (droppedOut), performance.now(). */
  private autoRejoinAt = -Infinity;
  /** Tests: how the last drop was noticed (a freeze, the back-forward cache, cut by the others, our side of a split
   *  lost), and how long the page was gone (0 for the last two). */
  lastDrop: { how: "frozen" | "pagehide" | "cut" | "split"; ms: number } | null = null;
  /** This page went to free play (#free): its screens instead of the online lobby's. */
  private free = false;
  /** Free play's map, once loaded. */
  private map: FreeMap | null = null;
  /** A free room's battles: the default rules, or the deep link's hearts, time and wins. */
  private readonly battleConfig: MatchConfig;
  /** Whether this page hosted its free room when keepFree last looked. */
  private wasHost = false;
  /** The players (member ids, ascending) of the free play this page last asked the lobby to start, until it starts. */
  private requested: string | null = null;

  constructor(hooks: OnlineHooks, params: URLSearchParams) {
    this.hooks = hooks;
    this.params = params;
    this.recordFinals = params.has("finals") ? params.get("finals") !== "0" : navigator.webdriver === true;
    this.autostart = Number(params.get("autostart") ?? 0);
    const d = hooks.defaults();
    // (#delay=auto: the input delay adapting to the network, AUTO_DELAY.)
    const num = (key: string) => (!params.has(key) ? undefined : key === "delay" && params.get(key) === "auto" ? AUTO_DELAY : Number(params.get(key)));
    this.config = cleanConfig({
      arena: num("arena") ?? d.arena,
      hearts: num("hearts") ?? d.hearts,
      time: num("time") ?? d.time,
      wins: num("wins") ?? d.wins,
      delay: num("delay") ?? d.delay,
      cpus: (params.get("cpus")?.split(",").filter(Boolean) ?? []) as MatchConfig["cpus"],
    });
    this.maxPlayers = Math.min(4, Math.max(2, Math.floor(num("players") ?? 4) || 4));
    this.battleConfig = {
      ...cleanConfig({ hearts: num("hearts") ?? DEFAULT_CONFIG.hearts, time: num("time") ?? DEFAULT_CONFIG.time, wins: num("wins") ?? DEFAULT_CONFIG.wins, delay: num("delay") }),
      arena: FREE_BATTLE_ARENA,
      mode: "battle",
    };
    this.ui = new LobbyUi({
      create: () => void this.guard(() => this.create()),
      join: (code, spectator) => void this.guard(() => this.join(code, spectator)),
      back: () => this.back(),
      configure: (config, maxPlayers) => this.configure(config, maxPlayers),
      start: () => this.startMatch(),
      role: (spectator) => this.lobby?.setRole(spectator),
      leaveRoom: () => this.leaveRoom(),
      rematch: () => this.startMatch(),
      toRoom: () => this.lobby?.end(),
      rejoinAsSpectator: () => void this.guard(() => this.rejoin(true)),
      rejoinRoom: () => void this.guard(() => this.rejoin(false)),
      playFree: () => void this.guard(() => this.playFree()),
      battle: () => this.startBattle(),
      home: () => this.home(),
    });
    this.ui.name = this.ui.freeName = params.get("name") ?? load(NAME_KEY) ?? "";
    this.ui.server = params.get("server") ?? load(SERVER_KEY) ?? defaultServer();
    this.ui.code = roomCode(params.get("join") ?? "");
    this.ui.serverShown = params.has("server") || params.has("debug") || this.ui.server !== defaultServer();
    window.addEventListener("keydown", (e) => this.key(e));
    window.addEventListener("hashchange", () => {
      const hash = new URLSearchParams(location.hash.slice(1));
      if (hash.has("join") || hash.has("create") || hash.has("online") || hash.has("free")) location.reload();
    });
    window.addEventListener("pagehide", (e) => this.pagehide(e.persisted));
    window.addEventListener("pageshow", (e) => e.persisted && this.pageshow());
    document.addEventListener("visibilitychange", () => this.tellAway(document.visibilityState === "hidden"));
  }

  /** The state to draw while a net match runs (main.ts draws it and nothing else), else null. */
  get game(): GameState | null {
    return this.current?.net.state ?? null;
  }

  /** Frames the match advanced since the last call (the camera eases once per frame). */
  takeFrames(): number {
    const run = this.current;
    if (!run) return 0;
    const n = run.net.frame - run.drawn;
    run.drawn = run.net.frame;
    return Math.max(0, Math.min(n, 60));
  }

  get localPlayer(): number {
    return this.current?.net.localPlayer ?? -1;
  }

  /** The match's display names by player index (the room's names, then "CPU (level)"), empty between matches. */
  get names(): readonly string[] {
    return this.current?.names ?? [];
  }

  /** Opens or closes the match menu (Esc, or the on-screen controls' pause button). */
  togglePause(): void {
    if (this.current && !this.ui.resultsShown) this.ui.pause();
  }

  /** Places what goes over the TV frame (CSS px in the window; free play's bar), every rendered frame. */
  place(frame: { x: number; y: number; w: number; h: number }): void {
    this.ui.placeFreeBar(frame);
  }

  /** Opens the online screen (the menu's "Play online"). */
  open(): void {
    this.hooks.screen("lobby");
    if (this.lobby?.room) this.ui.showRoom();
    else this.ui.showConnect();
  }

  /** Follows the online deep links; returns whether it took over from the local menu. */
  boot(): boolean {
    const p = this.params;
    if (p.has("free")) {
      this.openFree();
      return true;
    }
    if (!p.has("online") && !p.has("create") && !p.has("join")) return false;
    const hash = [...new URLSearchParams(location.hash.slice(1))].filter(([key]) => !["online", "create", "join", "spectate"].includes(key));
    const rest = new URLSearchParams([["online", ""], ...hash]).toString().replace(/=(?=&|$)/g, ""); // (#online&debug, not #online=&debug=)
    history.replaceState(null, "", `${location.pathname}${location.search}#${rest}`);
    this.open();
    const record = rejoinRecord(), back = p.has("create") || p.has("join") || record?.free ? null : record;
    if (back) void this.guard(() => this.rejoinMatch(back));
    else if (p.has("create")) void this.guard(() => this.create());
    else if (p.has("join") && !this.ui.name) {
      // Nameless, the room would call us "Player 2".
      this.ui.status(`Pick a name, then ${p.has("spectate") ? "Watch" : "Join"}.`);
      this.ui.focusName();
    } else if (p.has("join")) void this.guard(() => this.join(this.ui.code, p.has("spectate")));
    return true;
  }

  // --- lobby ---

  private async guard(action: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await action();
    } catch (error) {
      this.ui.status(sentence((error as Error).message), true);
    } finally {
      this.busy = false;
    }
  }

  private async connect(): Promise<LobbyClient> {
    const url = this.ui.server || defaultServer();
    if (this.lobby && this.lobbyUrl === url) return this.lobby;
    this.lobby?.close();
    this.lobby = null;
    const own = url === defaultServer();
    this.ui.status(own ? "Connecting…" : `Connecting to ${url}…`);
    // Our own lobby may want the site's token; a lobby elsewhere (#server=) never gets it.
    const lobby = await LobbyClient.connect(own ? await withLobbyToken(url) : url).catch((error: Error) => {
      throw own ? new Error("Could not reach the lobby server.") : error; // (its message has the address, token and all)
    });
    this.lobby = lobby;
    this.lobbyUrl = url;
    save(SERVER_KEY, url === defaultServer() ? null : url);
    lobby.on("room", (room) => lobby === this.lobby && this.onRoom(room));
    lobby.on("start", (start) => lobby === this.lobby && this.onStart(start));
    lobby.on("end", () => lobby === this.lobby && this.onEnd());
    lobby.on("error", (message) => lobby === this.lobby && this.onError(message));
    lobby.on("close", () => lobby === this.lobby && this.onLobbyClosed());
    lobby.on("left", (id) => lobby === this.lobby && this.onMemberLeft(id));
    lobby.on("rejoin", (player, id, match) => lobby === this.lobby && this.onMemberBack(player, id, match));
    lobby.on("signal", (from, data) => lobby === this.lobby && this.onSignal(from, data as Partial<AwaySignal>));
    return lobby;
  }

  private async create(): Promise<void> {
    const lobby = await this.connect();
    save(NAME_KEY, this.ui.name || null);
    await lobby.create({ name: this.ui.name || undefined, maxPlayers: this.maxPlayers, config: this.config });
    this.ui.showRoom();
  }

  private async join(code: string, spectator: boolean, rejoin?: string): Promise<void> {
    if (!ROOM_CODE.test(code)) throw new Error("Enter the room's word (4 or 5 letters).");
    const lobby = await this.connect();
    save(NAME_KEY, this.ui.name || null);
    const name = this.ui.name || undefined;
    try {
      // (With our key, the lobby puts us back into its running match; without one running, it's a plain join.)
      await lobby.join(code, { name, spectator, rejoin });
    } catch (error) {
      if (spectator || !/already started/.test((error as Error).message)) throw error;
      // A match is running: watch it, then take a free slot for the next one.
      await lobby.join(code, { name, spectator: true });
      this.ui.banner("A match is running: you're watching it, and can play the next one.", "info", 6000);
    }
    this.ui.showRoom();
  }

  // --- free play ---

  /** Free play's prompt (#free): a name, then Play; a name given in the link goes straight in. */
  private openFree(): void {
    this.free = true;
    this.hooks.screen("lobby");
    this.ui.showFree();
    if (this.params.has("name")) void this.guard(() => this.playFree());
    else if (!isTouch()) this.ui.focusFreeName(); // (a phone's keyboard would cover the page)
  }

  /**
   * Into a free room (the lobby puts us in one with room, or opens one), once free play's map is loaded. With `back`
   * (a free room's match we dropped out of: a reload, the page back from the background), into that room with our key
   * first, which puts us back into its running match in our slot; if that room is gone, free play anew.
   */
  private async playFree(back = rejoinRecord()): Promise<void> {
    this.free = true;
    const name = this.ui.freeName;
    save(NAME_KEY, name || null);
    this.ui.joining = true;
    try {
      this.ui.status("Loading the map…");
      this.map ??= await this.hooks.freeMap();
      if (back?.free) this.ui.server = back.server;
      const lobby = await this.connect();
      if (back?.free) {
        this.ui.status("Rejoining free play…");
        try {
          await lobby.join(back.code, { name: name || undefined, rejoin: back.key });
          return;
        } catch {
          saveRejoin(null); // (the room is gone, or full)
        }
      }
      this.ui.status("Joining free play…");
      await lobby.free({ name: name || undefined });
    } catch (error) {
      this.ui.joining = false;
      throw error;
    }
  }

  /**
   * A free room's host keeps free play going for whoever is in the room: starts it when nothing runs, and restarts
   * it (everyone where they stand) when someone in the room isn't one of its players (a newcomer), or when one of its
   * players is gone for good (he left, or was away past the lobby's FREE_AWAY_MS). A player away (his lobby connection
   * dropped: a page in the background) keeps his place meanwhile, through restarts too (startFree): his Link is out
   * until he rejoins in his slot with his key, where he stood. A battle plays on while people join (they watch it) and
   * ends in its results, which bring everyone back (BACK_TO_FREE_MS), unless fewer than two of its players are left, or
   * this page just became the host (the last one left mid-battle).
   */
  private keepFree(): void {
    const lobby = this.lobby, room = lobby?.room;
    const host = !!room?.free && room.host === lobby!.you;
    const became = host && !this.wasHost;
    this.wasHost = host;
    if (!host) return;
    const run = this.current, members = slotted(room!), away = room!.away ?? [];
    const restart =
      !run ||
      (run.config.mode === "free"
        ? members.some((id) => !run.start.players.includes(id)) || run.start.players.some((id) => !members.includes(id) && !away.includes(id))
        : became || run.start.players.filter((id) => members.includes(id)).length < 2);
    if (restart) this.startFree();
  }

  /**
   * Host: free play for everyone in the room, the Links of the free play running now where they stand, its players away
   * kept in their places (out until they rejoin; the lobby's `keep`).
   */
  private startFree(): void {
    const lobby = this.lobby, room = lobby?.room;
    if (!room?.free || room.host !== lobby!.you) return;
    const run = this.current, free = run?.config.mode === "free";
    const keep = free ? run.start.players.filter((id) => room.away?.includes(id)) : [];
    const key = [...slotted(room), ...keep].sort((a, b) => a - b).join();
    if (key === this.requested) return;
    this.requested = key;
    const at = free ? freeSpots(run.net.state, run.start.players, keep) : [];
    lobby!.start({ ...DEFAULT_CONFIG, delay: this.battleConfig.delay, mode: "free", at } satisfies MatchConfig, keep);
  }

  /** Host, in free play: a battle for everyone on the map. */
  private startBattle(): void {
    const lobby = this.lobby, room = lobby?.room;
    if (!room?.free || room.host !== lobby!.you || this.current?.config.mode !== "free" || slotted(room).length < 2) return;
    lobby!.start(this.battleConfig);
  }

  /** A free play started before we came in: wait for the host's restart with us in it. */
  private joiningFree(): void {
    this.hooks.screen("lobby");
    this.ui.showFree();
    this.ui.joining = true;
    this.ui.status("Joining free play…");
  }

  /** What changed since the last free play: who came, who went, and our Link's number if it changed. */
  private freeNews(previous: Running | null, run: Running): string {
    if (!previous || previous.config.mode !== "free") return "";
    const was = previous.start.players, now = run.start.players;
    const news = [
      ...now.filter((id) => !was.includes(id)).map((id) => `${memberName(run.start.room.members, id)} joined`),
      ...was.filter((id) => !now.includes(id)).map((id) => `${previous.names[was.indexOf(id)] ?? "?"} left`),
    ];
    if (previous.local >= 0 && run.local >= 0 && previous.local !== run.local) news.push(`you are P${run.local + 1} now`);
    return news.join(" · ");
  }

  /** Out of free play: the site's home page (its home link, apps/site/src/nav.ts), else the local menu. */
  private home(): void {
    saveRejoin(null);
    this.endMatch(false);
    this.lobby?.leave();
    this.lobby?.close();
    this.lobby = null;
    this.lobbyUrl = "";
    this.free = this.wasHost = false;
    this.requested = null;
    const link = document.querySelector<HTMLAnchorElement>("a.fso-home");
    if (link) return location.assign(link.href);
    history.replaceState(null, "", `${location.pathname}${location.search}`);
    this.ui.hideAll();
    this.hooks.exit();
  }

  /** Back from the background (a locked phone) after the others cut us: into free play again, as a newcomer. */
  private async rejoinFree(): Promise<void> {
    const lobby = this.lobby;
    if (lobby?.room) {
      lobby.leave();
      lobby.room = null;
    }
    this.hooks.screen("lobby");
    this.ui.showFree();
    await this.playFree(null);
  }

  /**
   * Back into the match we dropped out of (a reload, a lost lobby connection, the page back from the background): the
   * lobby's join with our key, which replays the match's start with `resume` (onStart); if the match is over, it's a
   * plain join of the room.
   */
  private async rejoinMatch(record: RejoinRecord): Promise<void> {
    this.ui.server = record.server;
    const lobby = this.lobby;
    // (Still in its room, the lobby takes the key from this connection as is: a leave would give up a free room's place.)
    if (lobby?.room && lobby.room.code !== record.code) {
      lobby.leave();
      lobby.room = null;
    }
    if (record.free) {
      this.hooks.screen("lobby");
      this.ui.showFree();
      return this.playFree(record);
    }
    this.ui.status("Rejoining the match…");
    try {
      await this.join(record.code, false, record.key);
    } catch (error) {
      saveRejoin(null);
      throw error;
    }
  }

  /** After a drop (see droppedInBackground): into the room again, as a spectator of the running match or not. */
  private async rejoin(spectator: boolean): Promise<void> {
    const code = this.droppedFrom;
    this.dropped = null;
    const lobby = this.lobby;
    if (!spectator && lobby?.room?.code === code) {
      // Still in the room: the host brings everyone back to it, the others wait there for the next match.
      if (lobby.room.host === lobby.you && lobby.room.started) lobby.end();
      this.ui.showRoom();
      this.ui.updateRoom(lobby.room, lobby.you, this.invite(code), this.config);
      return;
    }
    if (lobby?.room) {
      lobby.leave();
      lobby.room = null;
    }
    await this.join(code, spectator);
  }

  private invite(code: string): string {
    const url = new URL(location.href);
    url.hash = `join=${code}${this.lobbyUrl && this.lobbyUrl !== defaultServer() ? `&server=${encodeURIComponent(this.lobbyUrl)}` : ""}`;
    return url.href;
  }

  private onRoom(room: RoomInfo): void {
    const lobby = this.lobby!;
    if (room.free) {
      this.ui.updateFree(room, lobby.you);
      return this.keepFree();
    }
    const host = room.host === lobby.you;
    if (!host && room.config) this.config = cleanConfig(room.config as Partial<MatchConfig>);
    if (!host) this.maxPlayers = room.maxPlayers;
    this.ui.updateRoom(room, lobby.you, this.invite(room.code), this.config);
    const players = room.members.filter((m) => m.slot !== null).length;
    if (host && this.autostart > 0 && players >= this.autostart && players + cpuSlots(this.config, players).length >= 2 && !room.started && !this.current) {
      this.autostart = 0;
      this.startMatch();
    }
  }

  private configure(config: MatchConfig, maxPlayers: number): void {
    this.config = config;
    this.maxPlayers = maxPlayers;
    this.lobby?.configure({ maxPlayers, config });
  }

  /** Host: start the match, or a rematch (the room's settings, the players in the room now). */
  private startMatch(): void {
    const room = this.lobby?.room;
    if (!room || room.host !== this.lobby!.you || room.free) return;
    const players = room.members.filter((m) => m.slot !== null).length;
    if (players + cpuSlots(this.config, players).length < 2) return this.ui.status("A battle needs 2 players (or a CPU).", true);
    this.lobby!.start(this.config);
  }

  private onError(message: string): void {
    this.requested = null;
    if (this.current) this.ui.banner(`Lobby: ${message}`, "warn");
    else this.ui.status(sentence(message), true);
  }

  private onLobbyClosed(): void {
    this.lobby = null;
    this.lobbyUrl = "";
    this.wasHost = false;
    this.requested = null;
    const run = this.current, record = rejoinRecord();
    // (A page frozen in the background that comes back to a closed lobby gets its "dropped" screen: droppedInBackground.)
    if (run && run.local >= 0 && !run.over && record && record.match === run.net.match && performance.now() - run.tickedAt < FROZEN_MS) {
      // The others hear we left the lobby and cut us: come back into the match with our key.
      console.warn("netplay: lost the lobby connection; rejoining the match");
      this.endMatch(true);
      this.hooks.screen("lobby");
      if (record.free) this.ui.showFree();
      else this.ui.showConnect();
      window.setTimeout(() => void this.guard(() => this.rejoinMatch(record)), 300);
      return;
    }
    if (this.current) {
      this.ui.banner(`Lost the lobby server: the match goes on, but ${this.free ? "nobody can join" : "no rematch"}.`, "warn", 6000);
      this.ui.updateRoomLost();
    } else if (this.ui.droppedShown) this.showDropped(); // (now offering to reconnect)
    else {
      if (this.free) {
        this.ui.showFree();
        this.ui.joining = false;
      } else this.ui.showConnect();
      this.ui.status("Lost the connection to the lobby server.", true);
    }
  }

  private leaveRoom(): void {
    if (this.lobby?.room?.free || this.free) return this.home();
    saveRejoin(null);
    this.endMatch(false);
    this.dropped = null;
    this.lobby?.leave();
    if (this.lobby) this.lobby.room = null;
    this.hooks.screen("lobby");
    this.ui.showConnect();
    this.ui.status("");
  }

  private back(): void {
    saveRejoin(null);
    this.endMatch(false);
    this.lobby?.close();
    this.lobby = null;
    this.ui.hideAll();
    this.hooks.exit();
  }

  private shutdown(): void {
    this.endMatch(false);
    this.lobby?.close();
  }

  /**
   * The page is going away. Into the back-forward cache (`persisted`: a phone's browser in the background, and the
   * browser closes our sockets), it may come back: remember the match to say what happened then. No bye packets:
   * the lobby connection closing tells the others at once, and they know we went to the background.
   */
  private pagehide(persisted: boolean): void {
    const run = this.current;
    if (!persisted || !run || run.local < 0 || run.over) return this.shutdown();
    this.tellAway(true);
    this.parked = { at: Date.now(), code: this.lobby?.room?.code ?? run.start.room.code, watch: this.canWatch(run), free: !!run.start.room.free };
    this.endMatch(true);
    this.lobby?.close();
    this.lobby = null;
    this.lobbyUrl = "";
    this.wasHost = false;
  }

  private pageshow(): void {
    const parked = this.parked;
    this.parked = null;
    if (!parked) return;
    const ms = Date.now() - parked.at;
    this.lastDrop = { how: "pagehide", ms };
    console.warn(`netplay: the page was in the back-forward cache for ${ms} ms; the match went on without us`);
    const record = rejoinRecord();
    if (record && record.code === parked.code) return void this.guard(() => this.rejoinMatch(record));
    if (parked.free) return void this.guard(() => this.rejoinFree());
    this.hooks.screen("lobby");
    this.droppedFrom = parked.code;
    this.dropped = { text: backgroundText(ms), watch: parked.watch };
    this.showDropped();
  }

  /**
   * Tells the other players of the running match that this page went to the background, or came back. Phones and
   * tablets only: a desktop's background tab keeps playing (the worker ticker).
   */
  private tellAway(away: boolean): void {
    const run = this.current, lobby = this.lobby;
    if (!run || !lobby || run.local < 0 || !isTouch()) return;
    for (const id of run.start.players) if (id !== lobby.you) lobby.signal(id, { away, match: run.net.match } satisfies AwaySignal);
  }

  private onSignal(from: number, data: Partial<AwaySignal>): void {
    const run = this.current;
    if (!run || run.closed || typeof data?.away !== "boolean" || data.match !== run.net.match) return; // (WebRTC's signals: not ours)
    const player = run.start.players.indexOf(from);
    if (player < 0) return;
    if (data.away) run.away.add(player);
    else run.away.delete(player);
  }

  /** After dropping out, the rest of the match can be watched: at least two players go on (one of them feeds us). */
  private canWatch(run: Running): boolean {
    const others = run.start.players.length - 1 - [...run.left].filter((p) => p !== run.local).length;
    return others >= 2;
  }

  // --- matches ---

  private onStart(start: StartInfo): void {
    const lobby = this.lobby!;
    if ([...start.players].sort((a, b) => a - b).join() === this.requested) this.requested = null;
    const previous = this.current;
    // The previous match (a rematch) ends without byes: everyone is moving on to this one.
    this.endMatch(true);
    let config: MatchConfig, state: GameState, world: World;
    try {
      config = parseConfig(start.config);
      if (config.mode === "free") {
        if (!this.map) throw new Error("free play's map isn't loaded");
        if (!start.players.includes(lobby.you)) return this.joiningFree();
        world = this.map.world;
        state = initialFree(world, config, start.players, start.seed);
      } else {
        world = this.hooks.worldFor(config.arena);
        state = initialBattle(arenaSpawns(this.hooks.stage, config.arena), config, start.players.length, start.seed, this.hooks.propsFor(config.arena));
      }
    } catch (error) {
      if (start.room.free) this.ui.showFree();
      else this.ui.showRoom();
      this.ui.status(`Can't play this match: ${(error as Error).message}`, true);
      return;
    }
    const free = config.mode === "free";
    this.finals.clear();
    this.log.length = 0;
    const p = this.params;
    const impaired = p.has("lag") || p.has("jitter") || p.has("loss");
    const cpus = cpuSlots(config, start.players.length);
    const run: Running = {
      closed: false,
      start,
      local: start.players.indexOf(lobby.you),
      config,
      net: null!,
      stopTicker: () => {},
      // (A player away, kept in a free play's restart, is no member now: the name he had.)
      names: [...start.players.map((id) => (start.room.members.some((m) => m.id === id) ? memberName(start.room.members, id) : (previous?.names[previous.start.players.indexOf(id)] ?? "?"))), ...cpus.map((level) => `CPU (${level})`)],
      cpus: cpus.length,
      left: new Set(),
      waiting: new Set(),
      desyncs: [],
      routes: new Map(),
      drawn: 0,
      over: false,
      tickedAt: performance.now(),
      away: new Set(),
      world,
      backToFree: 0,
    };
    const game = battleGame(world);
    run.net = startNetMatch<GameState>(lobby, start, {
      game,
      state,
      ...delayOptions(config),
      disconnectedInput: PLAYER_LEFT,
      mode: (p.get("transport") ?? "auto") as TransportMode,
      iceTransportPolicy: p.get("ice") === "fail" ? "relay" : undefined,
      impairment: impaired ? { latency: Number(p.get("lag") ?? 0), jitter: Number(p.get("jitter") ?? 0), loss: Number(p.get("loss") ?? 0) } : undefined,
      onEvent: (e) => this.onEvent(run, e),
      onFinal: (frame, s) => this.onFinal(run, frame, s),
      onRoute: (peer, route) => run.routes.set(peer, route),
      onSpectatorLost: () => this.onFeedLost(run),
      onResume: (ok) => this.onResume(run, ok),
    });
    this.current = run;
    // (A free play restarted while some of its players were away: their Links are out until they rejoin.)
    start.players.forEach((id, p) => start.room.members.some((m) => m.id === id) || run.left.add(p));
    // A reload, a lost lobby connection or the page back from the background can bring this page back into the match:
    // the room, our key.
    if (run.local >= 0) saveRejoin({ server: this.ui.server, code: start.room.code, key: lobby.key, match: run.net.match, ...(start.room.free ? { free: true } : {}) });
    const net = run.net;
    run.stopTicker = startTicker(
      () => {
        if (run.closed) return;
        const now = performance.now(), gap = now - run.tickedAt;
        run.tickedAt = now;
        if (gap >= FROZEN_MS && run.local >= 0 && !run.over) return this.droppedInBackground(run, gap);
        const frame = (net.session?.frame ?? 0) + (net.session?.inputDelay ?? 0);
        const busy = this.ui.paused || this.ui.resultsShown;
        const input = this.script ? this.script(frame, net.state) : busy ? 0 : this.hooks.input();
        net.tick(input & 0x7fff); // never PLAYER_LEFT
      },
      () => net.pump(),
    );
    const players = start.players.length + cpus.length;
    this.hooks.screen("match", free ? { room: FREE_BATTLE_ARENA, players, map: this.map! } : { room: config.arena, players });
    this.ui.hideAll();
    this.ui.freeBar = free;
    this.ui.joining = false;
    const you = net.localPlayer;
    const keys = isTouch() ? "" : ": WASD or the d-pad, J / A to swing";
    if (net.resuming) this.ui.banner(`Rejoining ${free ? "free play" : "the match"} as P${you + 1}…`, "info", 0);
    else if (free) {
      const news = this.freeNews(previous, run);
      if (news || previous?.config.mode !== "free") this.ui.banner(news || `Free play: you are P${you + 1}${keys}`, "info", 4000);
    } else if (start.room.free && you < 0) this.ui.banner("A battle is on: you'll be in the free play after it", "info", 5000);
    else this.ui.banner(you >= 0 ? `You are P${you + 1}${keys}` : `Watching ${run.names.join(" vs ")}`, "info", 4000);
    requestAnimationFrame(() => this.overlays(run));
    if (start.room.free) this.keepFree();
  }

  /** Stops the current match: `quiet` = no bye packets (a rematch or the end, where everyone moves on together). */
  private endMatch(quiet: boolean): void {
    const run = this.current;
    if (!run) return;
    this.current = null;
    run.closed = true;
    clearTimeout(run.backToFree);
    run.stopTicker();
    run.net.close({ quiet });
    this.ui.hideResults();
    this.ui.pause(false);
    this.ui.clearBanner();
  }

  /**
   * The page was frozen for `gap` ms (a phone's screen locked, the browser in the background): the others have cut us
   * and played on. Back into the match with our key (rejoinMatch); without one, stop our match (the bye makes sure they
   * cut us) and say what happened, with ways back in.
   */
  private droppedInBackground(run: Running, gap: number): void {
    console.warn(`netplay: the page was frozen for ${Math.round(gap)} ms; the match went on without us`);
    this.lastDrop = { how: "frozen", ms: gap };
    const record = rejoinRecord();
    if (record && record.code === run.start.room.code && record.match === run.net.match) {
      // Back into it in our slot (the others cut us). No byes: this page's session is an earlier life of the slot.
      this.endMatch(true);
      this.hooks.screen("lobby");
      if (record.free) this.ui.showFree();
      else this.ui.showConnect();
      this.ui.status(record.free ? "Rejoining free play…" : "Rejoining the match…");
      // (After the socket events the freeze held back: a lobby connection closed meanwhile is seen as closed first.)
      window.setTimeout(() => void this.guard(() => this.rejoinMatch(record)), 300);
      return;
    }
    if (run.start.room.free) {
      this.endMatch(false);
      return void this.guard(() => this.rejoinFree());
    }
    const watch = this.canWatch(run);
    this.endMatch(false);
    this.hooks.screen("lobby");
    this.droppedFrom = this.lobby?.room?.code ?? run.start.room.code;
    this.dropped = { text: backgroundText(gap), watch };
    this.showDropped();
  }

  /**
   * Our session dropped out of the match (the session's "dropped"): the others cut us, or our side of a split lost
   * (docs/netcode.md "Disconnects"); they go on without us. Back in with our key, as after a freeze, unless we did that
   * less than AUTO_REJOIN_MS ago (a link that keeps failing): then the "dropped" screen says the connection was lost.
   */
  private droppedOut(run: Running, reason: "cut" | "split"): void {
    const record = rejoinRecord(), now = performance.now();
    this.lastDrop = { how: reason, ms: 0 };
    console.warn(`netplay: dropped out of the match (${reason === "split" ? "our side of a split lost" : "the others cut us"})`);
    // (After the tick that raised it: the session is still in its advance().)
    window.setTimeout(() => {
      if (run.closed) return;
      if (record && record.code === run.start.room.code && record.match === run.net.match && now - this.autoRejoinAt >= AUTO_REJOIN_MS) {
        this.autoRejoinAt = now;
        this.endMatch(true);
        this.hooks.screen("lobby");
        if (record.free) this.ui.showFree();
        else this.ui.showConnect();
        this.ui.status(record.free ? "Lost the other players: rejoining free play…" : "Lost the other players: rejoining the match…");
        return void this.guard(() => this.rejoinMatch(record));
      }
      const watch = this.canWatch(run);
      this.endMatch(false);
      if (run.start.room.free) return void this.guard(() => this.rejoinFree());
      this.hooks.screen("lobby");
      this.droppedFrom = this.lobby?.room?.code ?? run.start.room.code;
      this.dropped = { text: "Lost the connection to the other players: they went on without you.", watch };
      this.showDropped();
    }, 0);
  }

  private showDropped(): void {
    const lobby = this.lobby, room = lobby?.room ?? null;
    if (this.dropped) this.ui.showDropped(this.dropped.text, { ...this.dropped, lobby: room !== null, host: room !== null && room.host === lobby!.you });
  }

  private onEnd(): void {
    saveRejoin(null);
    this.endMatch(true);
    this.hooks.screen("lobby");
    this.ui.showRoom(); // the "room" update that follows fills it in
  }

  private who(run: Running, player: number): string {
    return `P${player + 1} (${run.names[player] ?? "?"})`;
  }

  private onEvent(run: Running, e: SessionEvent): void {
    if (run.closed) return;
    this.log.push(e);
    switch (e.type) {
      case "desync": {
        // Once out of sync, every later check fails too: warn once, keep the list in the stats overlay.
        run.desyncs.push(e);
        if (run.desyncs.length > 1) break;
        const player = this.playerOf(run, e.peer);
        console.error("desync", e);
        this.ui.banner(`Desync with ${player >= 0 ? this.who(run, player) : e.peer} at frame ${e.frame} (details: \` key)`, "bad", 8000);
        this.ui.statsShown = true;
        break;
      }
      case "interrupted":
        run.waiting.add(e.player);
        this.ui.banner(`Waiting for ${this.who(run, e.player)}${run.away.has(e.player) ? ": their page is in the background" : ""}…`, "warn", 0);
        break;
      case "resumed":
        run.waiting.delete(e.player);
        if (run.waiting.size === 0) this.ui.clearBanner();
        break;
      case "disconnected": {
        run.waiting.delete(e.player);
        if (run.left.has(e.player)) break; // a peer reported an earlier cut: same player
        run.left.add(e.player);
        // Gone without a bye: the page went to the background (it said so), or nothing heard for 3 s (a phone that
        // locked without a word, or lost its network).
        const who = this.who(run, e.player);
        const away = run.away.has(e.player) && e.reason !== "left", lost = e.reason === "timeout";
        const text =
          e.reason === "dropped-us" ? `Lost ${who}: we couldn't stay in sync` : away ? `${who} dropped out: their page went to the background` : lost ? `${who} lost the connection` : `${who} left the match`;
        const note = away ? "A locked phone or another app in front stops the page." : lost ? "Their page may have gone to the background (a locked phone, another app) or lost its network." : "";
        this.ui.banner(text, "warn", 5000);
        // (Against CPUs, the match goes on; in a free room, free play comes back.)
        if (run.local >= 0 && run.start.players.length - run.left.size + run.cpus <= 1 && !run.over && !run.start.room.free)
          this.ui.showAlone(note && run.start.players.length === 2 ? text : "Everyone else left the match", note);
        break;
      }
      case "rejoined":
        run.left.delete(e.player);
        run.waiting.delete(e.player);
        this.ui.banner(`${this.who(run, e.player)} is back${run.config.mode === "free" ? "" : ": in from the next round"}`, "info", 5000);
        if (!run.over && this.ui.resultsShown) this.ui.hideResults(); // ("Everyone else left": not any more)
        break;
      case "dropped":
        if (run.local >= 0 && !run.over) this.droppedOut(run, e.reason);
        break;
      case "error":
        console.warn(`netplay: ${e.message}`);
        break;
    }
  }

  /** We're back in the match (a snapshot from another player), or couldn't get back in. */
  private onResume(run: Running, ok: boolean): void {
    if (run.closed) return;
    const session = run.net.session;
    if (!ok || !session) {
      this.ui.banner(`Couldn't rejoin the match (${run.net.resumeError}): you can watch it, or wait for the next one.`, "bad", 8000);
      return;
    }
    for (let p = 0; p < run.start.players.length; p++) if (session.cutFrame(p) !== Infinity) run.left.add(p);
    const keys = isTouch() ? "" : ": WASD or the d-pad, J / A to swing";
    const free = run.config.mode === "free";
    this.ui.banner(`Back in ${free ? "free play" : "the match"} as P${run.local + 1}${free ? "" : ": in from the next round"}${keys}`, "info", 5000);
  }

  /** A player of the match came back (rejoined in his slot under a new member id): spectators' names and banners. */
  private onMemberBack(player: number, id: number, match: number): void {
    const run = this.current;
    if (!run || run.closed || run.net.match !== match) return;
    // (The lobby says so before the room update that lists him: until then, the name he had.)
    const name = memberName(this.lobby?.room?.members ?? run.start.room.members, id);
    if (name !== "?") run.names[player] = name;
    if (run.local >= 0) return; // (players get the session's "rejoined")
    run.left.delete(player);
    this.ui.banner(`${this.who(run, player)} is back`, "info", 5000);
  }

  /** A spectator hears of departures from the lobby (players get the session's "disconnected", frame-exact). */
  private onMemberLeft(id: number): void {
    const run = this.current;
    const player = run ? run.start.players.indexOf(id) : -1;
    if (!run || run.closed || run.local >= 0 || player < 0 || run.left.has(player)) return;
    run.left.add(player);
    this.ui.banner(`${this.who(run, player)} left the match`, "warn", 5000);
  }

  private onFeedLost(run: Running): void {
    if (run.closed || run.over) return;
    this.ui.showAlone("The match feed stopped (every player left)");
  }

  private onFinal(run: Running, frame: number, state: GameState): void {
    if (run.closed) return; // (a spectator reports frame 0 before startNetMatch returns)
    if (this.recordFinals) {
      this.finals.set(frame, hashGame(state));
      this.finals.delete(frame - KEEP_FINALS);
    }
    // Results from final states only: a predicted knockout can still be rolled back.
    const over = state.battle?.phase === "matchOver";
    if (over === run.over) return;
    run.over = over;
    clearTimeout(run.backToFree);
    if (over) {
      this.ui.showResults(state, run.names, run.left, run.local < 0);
      if (run.start.room.free) run.backToFree = window.setTimeout(() => !run.closed && run.over && this.startFree(), BACK_TO_FREE_MS);
    } else this.ui.hideResults();
  }

  private playerOf(run: Running, peer: string): number {
    return run.start.players.indexOf(Number(peer));
  }

  private overlays(run: Running): void {
    if (run.closed) return;
    const now = performance.now();
    if (this.ui.statsShown && now - this.statsAt >= STATS_MS) {
      this.statsAt = now;
      const text = this.netStats.text(
        {
          net: run.net,
          code: run.start.room.code,
          names: run.names,
          routes: run.routes,
          playerOf: (peer) => this.playerOf(run, peer),
          desyncs: run.desyncs,
          feed: run.local < 0 ? String(run.start.players[0]) : undefined,
        },
        now,
      );
      this.ui.stats(text, run.desyncs.length > 0);
    }
    requestAnimationFrame(() => this.overlays(run));
  }

  private key(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (e.code === "Backquote" && this.current) {
      this.ui.statsShown = !this.ui.statsShown;
      this.statsAt = 0;
    } else if (e.code === "Escape") this.togglePause();
    else if (e.code === "Enter" && this.current && this.ui.resultsShown) this.startMatch();
  }
}

/** A room's players (member ids) in slot order: the players of the match the host would start now. */
function slotted(room: RoomInfo): number[] {
  return room.members.filter((m) => m.slot !== null).sort((a, b) => a.slot! - b.slot!).map((m) => m.id);
}

/** The "dropped" screen's text after the page was frozen or in the back-forward cache for `ms`. */
function backgroundText(ms: number): string {
  return `The connection dropped while this page was in the background (${Math.round(ms / 1000)} s). The other players went on without you.`;
}

/** The lobby's errors are lowercase phrases ("no such room"). */
function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The match this tab can rejoin (sessionStorage: kept through a reload, not shared with other tabs). */
function rejoinRecord(): RejoinRecord | null {
  try {
    const r = JSON.parse(sessionStorage.getItem(REJOIN_KEY) ?? "null") as Partial<RejoinRecord> | null;
    return r && typeof r.code === "string" && typeof r.key === "string" && typeof r.server === "string" && typeof r.match === "number" ? (r as RejoinRecord) : null;
  } catch {
    return null;
  }
}

function saveRejoin(record: RejoinRecord | null): void {
  try {
    if (record) sessionStorage.setItem(REJOIN_KEY, JSON.stringify(record));
    else sessionStorage.removeItem(REJOIN_KEY);
  } catch {}
}

function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function save(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
}
