// The online screens in the DOM (built here, styled by online.css): connect (name, create a room, join by code),
// the room (players by slot color, then the CPU players, spectators, the host's settings, start), free play's name
// prompt and its bar over the match (how many are in, the host's Battle mode button), the results with rematch, the
// in-match menu, the "dropped while in the background" screen, and a banner for network news. No netcode here:
// online.ts drives it through the methods and callbacks.
import { roomCode, type MemberInfo, type RoomInfo } from "@fso/net";
import { ARENA_ROOMS, CPU_LEVELS, HEART_OPTIONS, MAX_FIGHTERS, MAX_LINKS, type GameState } from "@fso/sim";
import { linkIcon, PLAYER_COLORS, playerName } from "./hud.ts";
import { fillArt } from "./menu-art.ts";
import { arenaTitle, menuText } from "./menu-text.ts";
import { isTouch, shareLink } from "./mobile.ts";
import { AUTO_DELAY, cleanConfig, cpuSlots, MAX_DELAY, TIME_OPTIONS, WIN_OPTIONS, type MatchConfig } from "./online-game.ts";
import "./online.css";

type OptionKey = "arena" | "max" | "hearts" | "time" | "wins" | "delay" | "cpus" | "level";

export interface LobbyActions {
  create(): void;
  join(code: string, spectator: boolean): void;
  /** Back to the local menu. */
  back(): void;
  /** Host: a setting changed. */
  configure(config: MatchConfig, maxPlayers: number): void;
  start(): void;
  /** Between matches: watch instead of playing, or play instead of watching. */
  role(spectator: boolean): void;
  leaveRoom(): void;
  rematch(): void;
  /** Host: end the match, back to the room. */
  toRoom(): void;
  /** After a drop: watch the match that goes on without us. */
  rejoinAsSpectator(): void;
  /** After a drop: back to the room (the host brings everyone back; the others wait there for the next match). */
  rejoinRoom(): void;
  /** Free play's prompt: in, under the name typed. */
  playFree(): void;
  /** Free play's host: a battle for everyone on the map. */
  battle(): void;
  /** Out of free play: where the site's home link goes, or the local menu. */
  home(): void;
}

// (The settings' labels: an icon, a name, and a shorter name for phones in landscape.)
const option = (key: string, icon: string, name: string, short: string, select: string, title = "") =>
  `<label class="opt opt-${key}"${title ? ` title="${title}"` : ""}>${icon}<span class="opt-name"><span class="long">${name}</span><span class="short">${short}</span></span> ${select}</label>`;

const HTML = `
<div id="online" class="screen" data-view="connect" hidden>
  <h1 class="online-title">
    <span class="art-slot plate"><img class="plate-art" data-art="battlePlate" alt="" /><span class="art-text gold-title">Shadow Battle</span></span>
    <span class="online-tag">Online</span>
  </h1>
  <section id="online-connect" class="frame">
    <h2 class="frame-title">Play online</h2>
    <form id="online-form">
      <label class="field"><span>Your name</span> <input id="online-name" maxlength="24" size="16" autocomplete="nickname" enterkeyhint="next" /></label>
      <div class="ways">
        <div class="way">
          <h3>New room</h3>
          <button id="online-create" type="button" class="primary" data-fullscreen>Create a room</button>
        </div>
        <span class="or">or</span>
        <div class="way">
          <h3>Join a room</h3>
          <div class="join">
            <input id="online-code" size="7" placeholder="WORD" aria-label="Room word" enterkeyhint="go" autocomplete="off" autocorrect="off" autocapitalize="characters" spellcheck="false" />
            <button id="online-join" data-fullscreen>Join</button>
            <button id="online-watch" type="button" title="Join as a spectator" data-fullscreen>Watch</button>
          </div>
        </div>
      </div>
    </form>
    <div class="connect-foot">
      <details id="online-server-box" class="server" hidden><summary>Server</summary><input id="online-server" size="34" spellcheck="false" aria-label="Lobby server" /></details>
      <button id="online-back" class="link">Back to local play</button>
    </div>
  </section>
  <section id="online-free" class="frame" hidden>
    <h2 class="frame-title">Free Play</h2>
    <p class="free-about">One big field for everyone who comes along: run around, swing, lift and throw each other, and nobody gets hurt, until the first one there starts a battle.</p>
    <form id="free-form">
      <label class="field"><span>Your name</span> <input id="free-name" maxlength="24" size="16" autocomplete="nickname" enterkeyhint="go" /></label>
      <button id="free-play" class="primary" data-fullscreen>Play</button>
    </form>
    <div class="connect-foot"><button id="free-back" type="button" class="link">Back</button></div>
  </section>
  <div id="online-room" hidden>
    <div class="room-head">
      <span class="room-label">Room</span> <strong id="online-room-code"></strong>
      <button id="online-copy">Copy invite link</button>
      <p class="note invite"><a id="online-invite" target="_blank"></a></p>
    </div>
    <section class="frame room-fighters">
      <h2 class="frame-title">Fighters</h2>
      <ol id="online-players" class="slots"></ol>
      <p id="online-spectators" class="note"></p>
    </section>
    <section class="frame room-rules">
      <h2 class="frame-title">Rules</h2>
      <div class="room-options">
        <div class="opt-arena">
          <canvas id="online-preview" width="512" height="384"></canvas>
          <label class="opt"><span class="opt-name">Arena</span> <select id="online-arena"></select></label>
        </div>
        ${option("hearts", `<span class="rule-icon heart" data-art-bg="heart"></span>`, "Hearts", "Hearts", `<select id="online-hearts"></select>`)}
        ${option("time", `<span class="rule-icon clock"></span>`, "Time limit", "Time", `<select id="online-time"></select>`)}
        ${option("wins", `<span class="rule-icon star won"></span>`, "Wins", "Wins", `<select id="online-wins"></select>`)}
        ${option("max", `<span class="rule-icon link-icon" data-art-bg="link1"></span>`, "Players", "Players", `<select id="online-max"><option value="2">2</option><option value="3">3</option><option value="4">4</option></select>`)}
        ${option("cpus", `<span class="rule-icon link-icon cpu" data-art-bg="link3"></span>`, "CPU players", "CPUs", `<select id="online-cpus"></select>`, "Links the computer plays, after the players (every browser runs them)")}
        ${option("level", `<span class="rule-icon level"></span>`, "CPU level", "Level", `<select id="online-cpu-level"></select>`)}
        ${option("delay", `<span class="rule-icon delay"></span>`, "Input delay", "Delay", `<select id="online-delay"></select>`, "Frames between pressing a button and the Link reacting (hides network lag); Auto follows each player's connection")}
      </div>
    </section>
    <div class="buttons room-buttons">
      <button id="online-start" class="primary" data-fullscreen>Start</button>
      <button id="online-role"></button>
      <button id="online-leave">Leave room</button>
    </div>
  </div>
  <p id="online-status" class="note"></p>
</div>
<div id="online-results" class="screen overlay" hidden>
  <h1 id="online-results-title"></h1>
  <ol id="online-standings" class="standings"></ol>
  <div class="buttons">
    <button id="online-rematch" class="primary" data-fullscreen>Rematch <kbd>Enter</kbd></button>
    <button id="online-to-room">Back to the room</button>
    <button id="online-results-leave">Leave room</button>
  </div>
  <p id="online-results-note" class="note"></p>
</div>
<div id="online-pause" class="screen overlay" hidden>
  <section class="frame online-panel">
    <h2 class="frame-title">Online match</h2>
    <p class="note">The match goes on while this menu is open.</p>
    <div class="buttons stack">
      <button id="online-resume" class="primary" data-pause="continue">Back to the match <kbd>Esc</kbd></button>
      <button id="online-end" data-pause="area">End the match for everyone</button>
      <button id="online-quit" data-pause="game">Leave the match</button>
    </div>
  </section>
</div>
<div id="online-dropped" class="screen" hidden>
  <section class="frame online-panel">
    <h2 class="frame-title">Disconnected</h2>
    <p id="online-dropped-text"></p>
    <p id="online-dropped-note" class="note"></p>
    <div class="buttons">
      <button id="online-dropped-watch" class="primary" data-fullscreen>Watch the match</button>
      <button id="online-dropped-room" data-fullscreen>Back to the room</button>
      <button id="online-dropped-leave">Leave the room</button>
    </div>
  </section>
</div>
<div id="free-bar" hidden>
  <span class="free-count"><b>Free play</b> <span id="free-players"></span></span>
  <button id="free-battle" type="button">Battle mode</button>
  <span id="free-host"></span>
</div>
<div id="online-banner" hidden></div>
<pre id="netstats" hidden></pre>
`;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const clock = (s: number) => (s === 0 ? "Off" : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);

/** Free play's bar: its gap to the frame's top and to what it steps aside for, and how often it looks again (ms). */
const BAR_GAP = 6;
const BAR_REPLACE_MS = 500;

export class LobbyUi {
  private readonly selects: Record<OptionKey, HTMLSelectElement>;
  private bannerTimer = 0;
  private barPlacedAt = 0;
  private room: RoomInfo | null = null;
  private you = 0;

  constructor(actions: LobbyActions) {
    document.body.insertAdjacentHTML("beforeend", HTML);
    fillArt($("online"));
    this.selects = {
      arena: $("online-arena"),
      max: $("online-max"),
      hearts: $("online-hearts"),
      time: $("online-time"),
      wins: $("online-wins"),
      delay: $("online-delay"),
      cpus: $("online-cpus"),
      level: $("online-cpu-level"),
    };
    this.fill("arena", ARENA_ROOMS.map((r) => [r, arenaTitle(r)]));
    this.fill("hearts", HEART_OPTIONS.map((h) => [h, String(h)]));
    this.fill("time", TIME_OPTIONS.map((t) => [t, clock(t)]));
    this.fill("wins", WIN_OPTIONS.map((w) => [w, String(w)]));
    this.fill("delay", [[AUTO_DELAY, "Auto"], ...Array.from({ length: MAX_DELAY + 1 }, (_, d): [number, string] => [d, `${d} ${d === 1 ? "frame" : "frames"}`])]);
    this.fill("cpus", Array.from({ length: MAX_FIGHTERS }, (_, n) => [n, String(n)]));
    this.fill("level", CPU_LEVELS.map((l, k) => [k, l]));

    $("online-create").onclick = () => actions.create();
    // Join is the form's submit button: a tap, or Enter / the keyboard's Go key in the code field.
    $("online-form").addEventListener("submit", (e) => {
      e.preventDefault();
      actions.join(this.code, false);
    });
    $("online-watch").onclick = () => actions.join(this.code, true);
    $("online-name").addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || e.isComposing) return;
      e.preventDefault(); // (no submit from here: on to the code)
      $("online-code").focus();
    });
    const code = $<HTMLInputElement>("online-code");
    code.addEventListener("input", () => {
      if (/[^a-z]/i.test(code.value)) code.value = roomCode(code.value); // a pasted invite link, stray spaces
    });
    $("online-back").onclick = () => actions.back();
    $("online-start").onclick = () => actions.start();
    $("online-role").onclick = () => actions.role(this.mySlot() !== null);
    $("online-leave").onclick = () => actions.leaveRoom();
    $("online-results-leave").onclick = () => actions.leaveRoom();
    $("online-quit").onclick = () => actions.leaveRoom();
    $("online-rematch").onclick = () => actions.rematch();
    $("online-to-room").onclick = () => actions.toRoom();
    $("online-end").onclick = () => actions.toRoom();
    $("online-resume").onclick = () => this.pause(false);
    $("online-copy").onclick = () => void this.shareInvite();
    if (isTouch() && "share" in navigator) $("online-copy").textContent = "Share invite link";
    $("online-dropped-watch").onclick = () => actions.rejoinAsSpectator();
    $("online-dropped-room").onclick = () => actions.rejoinRoom();
    $("online-dropped-leave").onclick = () => actions.leaveRoom();
    // Play is the free form's submit button: a tap, or Enter / the keyboard's Go key in the name field.
    $("free-form").addEventListener("submit", (e) => {
      e.preventDefault();
      actions.playFree();
    });
    $("free-back").onclick = () => actions.home();
    $("free-battle").onclick = () => {
      $("free-battle").blur(); // (the keyboard goes back to the game)
      actions.battle();
    };
    for (const select of Object.values(this.selects)) select.addEventListener("change", () => actions.configure(this.readConfig(), this.readMax()));
  }

  get name(): string {
    return $<HTMLInputElement>("online-name").value.trim();
  }
  set name(v: string) {
    $<HTMLInputElement>("online-name").value = v;
  }
  get server(): string {
    return $<HTMLInputElement>("online-server").value.trim();
  }
  set server(v: string) {
    $<HTMLInputElement>("online-server").value = v;
  }
  get code(): string {
    return roomCode($<HTMLInputElement>("online-code").value);
  }
  set code(v: string) {
    $<HTMLInputElement>("online-code").value = v;
  }

  /** The lobby server's field: for other servers (#server=, a saved one) and #debug. */
  set serverShown(v: boolean) {
    $("online-server-box").hidden = !v;
  }

  focusName(): void {
    $("online-name").focus();
  }

  status(text: string, bad = false): void {
    const el = $("online-status");
    el.textContent = text;
    el.classList.toggle("bad", bad);
  }

  /** The connect panel (name, create, join). */
  showConnect(): void {
    this.room = null;
    this.showView("connect");
  }

  /** The room panel, kept up to date by `updateRoom`. */
  showRoom(): void {
    this.showView("room");
  }

  /** Free play's prompt (a name, Play); also what shows while joining, with the status under it. */
  showFree(): void {
    this.showView("free");
  }

  private showView(view: "connect" | "room" | "free"): void {
    this.hideOverlays();
    $("online").hidden = false;
    $("online").dataset.view = view;
    $("online-connect").hidden = view !== "connect";
    $("online-room").hidden = view !== "room";
    $("online-free").hidden = view !== "free";
  }

  get freeName(): string {
    return $<HTMLInputElement>("free-name").value.trim();
  }
  set freeName(v: string) {
    $<HTMLInputElement>("free-name").value = v;
  }

  focusFreeName(): void {
    $("free-name").focus();
  }

  /** Free play's Play button, off while the page joins. */
  set joining(v: boolean) {
    $<HTMLButtonElement>("free-play").disabled = v;
  }

  /**
   * A free room changed: who's in, who hosts. The bar over free play counts the players; the host gets the Battle
   * mode button (from 2 players), the others are told who has it.
   */
  updateFree(room: RoomInfo, you: number): void {
    this.room = room;
    this.you = you;
    const players = room.members.filter((m) => m.slot !== null).length, host = room.host === you;
    $("free-players").textContent = `${players}/${MAX_LINKS}`;
    const battle = $<HTMLButtonElement>("free-battle");
    battle.hidden = !host;
    battle.disabled = players < 2;
    battle.title = players < 2 ? "A battle needs another player" : "Start a Shadow Battle for everyone here";
    const hostName = room.members.find((m) => m.id === room.host)?.name ?? "the host";
    $("free-host").textContent = host ? "" : `${hostName} can start a battle`;
    $("free-bar").dataset.placed = "";
    this.syncResultsButtons();
  }

  /** Free play's bar over the match (shown while free play runs). */
  set freeBar(v: boolean) {
    $("free-bar").hidden = !v;
  }
  get freeBar(): boolean {
    return !$("free-bar").hidden;
  }

  /**
   * Places free play's bar at the top middle of the TV frame (CSS px in the window), clear of the on-screen pause
   * button (moved right of it) and of the sound button (moved under it). Cheap when nothing moved: call it every frame.
   */
  placeFreeBar(frame: { x: number; y: number; w: number; h: number }): void {
    const bar = $("free-bar");
    if (bar.hidden) return;
    const now = performance.now(), key = `${frame.x},${frame.y},${frame.w},${bar.textContent}`;
    if (bar.dataset.placed === key && now - this.barPlacedAt < BAR_REPLACE_MS) return;
    bar.dataset.placed = key;
    this.barPlacedAt = now;
    const w = bar.offsetWidth, h = bar.offsetHeight;
    let left = frame.x + (frame.w - w) / 2, top = frame.y + BAR_GAP;
    for (const el of document.querySelectorAll<HTMLElement>(".fso-touch:not([hidden]) .fso-touch-pause:not([hidden]), #audio:not([hidden])")) {
      const r = el.getBoundingClientRect();
      if (!r.width || left >= r.right || left + w <= r.left || top >= r.bottom || top + h <= r.top) continue;
      if (r.left + r.width / 2 < left + w / 2) left = r.right + BAR_GAP;
      else top = r.bottom + BAR_GAP;
    }
    Object.assign(bar.style, { left: `${Math.round(left)}px`, top: `${Math.round(top)}px` });
  }

  /** Hides every online screen (a match runs, or back to local play). */
  hideAll(): void {
    $("online").hidden = true;
    this.hideOverlays();
  }

  private hideOverlays(): void {
    $("online-results").hidden = true;
    $("online-pause").hidden = true;
    $("online-dropped").hidden = true;
    $("free-bar").hidden = true;
  }

  get inRoomScreen(): boolean {
    return !$("online").hidden && !$("online-room").hidden;
  }

  updateRoom(room: RoomInfo, you: number, invite: string, config: MatchConfig): void {
    this.room = room;
    this.you = you;
    const host = room.host === you;
    $("online-room-code").textContent = room.code;
    const link = $<HTMLAnchorElement>("online-invite");
    link.href = invite;
    link.textContent = invite;
    const slots = Array.from({ length: room.maxPlayers }, (_, slot) => room.members.find((m) => m.slot === slot) ?? null);
    const players = room.members.filter((m) => m.slot !== null).length;
    // The CPUs take the Links after the players in the room when the match starts.
    const cpus = cpuSlots(config, players);
    const row = (i: number, className: string, who: string, tags: string[]) =>
      `<li class="${className}" style="--color:${PLAYER_COLORS[i]}"><span class="link-icon" data-art-bg="${linkIcon(i)}"></span><b>${playerName(i)}</b><span class="who">${who}</span>${tags.join("")}</li>`;
    $("online-players").innerHTML =
      slots
        .map((m, slot) => {
          const tags = m ? [m.id === room.host ? "host" : "", m.id === you ? "you" : ""].filter(Boolean).map((t) => `<span class="tag ${t}">${t}</span>`) : [];
          return row(slot, m ? "" : "open", m ? esc(m.name) : "open", tags);
        })
        .filter((_, slot) => slot < players || slot < MAX_FIGHTERS - cpus.length)
        .join("") +
      cpus.map((level, k) => row(players + k, "cpu", "CPU", [`<span class="tag level">${level}</span>`])).join("");
    fillArt($("online-players"));
    const watching = room.members.filter((m) => m.slot === null);
    $("online-spectators").textContent = watching.length ? `Watching: ${watching.map((m) => m.name + (m.id === you ? " (you)" : "")).join(", ")}` : "";
    // Settings: the host edits them, everyone else sees the host's.
    this.showConfig(config, room.maxPlayers, players);
    for (const select of Object.values(this.selects)) select.disabled = !host || room.started;
    const start = $<HTMLButtonElement>("online-start");
    start.hidden = !host;
    start.disabled = players + cpus.length < 2 || room.started;
    const role = $<HTMLButtonElement>("online-role");
    const mine = this.mySlot();
    role.textContent = mine === null ? "Play" : "Watch instead";
    role.disabled = room.started || (mine === null && players >= room.maxPlayers);
    const hostName = room.members.find((m) => m.id === room.host)?.name ?? "the host";
    if (room.started) this.status("A match is running…");
    else if (host) this.status(players + cpus.length < 2 ? "Waiting for another player (or add a CPU): share the room's word or the invite link." : "Ready when you are.");
    else this.status(mine === null ? `Watching: waiting for ${hostName} to start.` : `Waiting for ${hostName} to start…`);
    this.syncResultsButtons();
  }

  private mySlot(): number | null {
    return this.room?.members.find((m) => m.id === this.you)?.slot ?? null;
  }

  private fill(key: OptionKey, options: [number, string][]): void {
    this.selects[key].innerHTML = options.map(([v, label]) => `<option value="${v}">${esc(label)}</option>`).join("");
  }

  private showConfig(config: MatchConfig, maxPlayers: number, players: number): void {
    const s = this.selects;
    if (![...s.time.options].some((o) => Number(o.value) === config.time)) s.time.add(new Option(clock(config.time), String(config.time)));
    s.arena.value = String(config.arena);
    s.hearts.value = String(config.hearts);
    s.time.value = String(config.time);
    s.wins.value = String(config.wins);
    s.delay.value = String(config.delay);
    s.max.value = String(maxPlayers);
    // The players' slots and the CPUs share the 4 Links.
    for (const o of s.max.options) o.disabled = Number(o.value) < players || Number(o.value) + config.cpus.length > MAX_FIGHTERS;
    s.cpus.value = String(config.cpus.length);
    for (const o of s.cpus.options) o.disabled = Number(o.value) + players > MAX_FIGHTERS;
    s.level.value = String(Math.max(0, CPU_LEVELS.indexOf(config.cpus[0] ?? "normal")));
    this.preview(config.arena);
  }

  private readConfig(): MatchConfig {
    const n = (k: OptionKey) => Number(this.selects[k].value);
    const cpus = Array.from({ length: n("cpus") }, () => CPU_LEVELS[n("level")] ?? "normal");
    return cleanConfig({ arena: n("arena"), hearts: n("hearts"), time: n("time"), wins: n("wins"), delay: n("delay"), cpus });
  }

  /** The room's size for players: what's picked, less the CPUs' Links (never under the players already in). */
  private readMax(): number {
    const players = this.room?.members.filter((m) => m.slot !== null).length ?? 1;
    return Math.max(players, 2, Math.min(Number(this.selects.max.value), MAX_FIGHTERS - Number(this.selects.cpus.value)));
  }

  /** The arena's thumbnail, borrowed from the local menu's picker when it has one. */
  private preview(room: number): void {
    const canvas = $<HTMLCanvasElement>("online-preview");
    const source = document.querySelector<HTMLCanvasElement>(`.arena[data-room="${room}"] canvas`);
    canvas.hidden = !source;
    if (!source) return;
    canvas.width = source.width;
    canvas.height = source.height;
    canvas.getContext("2d")!.drawImage(source, 0, 0);
  }

  /** The share sheet on phones, else the clipboard, else the link to copy by hand. */
  private async shareInvite(): Promise<void> {
    const link = $<HTMLAnchorElement>("online-invite").href;
    const how = await shareLink(link, `Shadow Battle: join room ${this.room?.code ?? ""}`);
    if (how === "copied") this.status("Invite link copied.");
    else if (how === "failed") this.status(`Copy this link: ${link}`);
  }

  /**
   * The match went on without us while the page was frozen (a phone locked, another app in front): says so and
   * offers what's left. `watch`: the others play on and we can follow as a spectator; `lobby`: still in the room.
   */
  /** We dropped out of the match: `text` says how (droppedText), then the ways back. */
  showDropped(text: string, options: { watch: boolean; lobby: boolean; host: boolean }): void {
    this.hideAll();
    $("online-dropped-text").textContent = text;
    $("online-dropped-note").textContent = options.lobby
      ? options.host
        ? "Back to the room ends the match for everyone."
        : "You're still in the room: you can play the next match."
      : "The lobby connection was lost too: rejoining reconnects.";
    $("online-dropped-watch").hidden = !options.watch;
    $("online-dropped-room").textContent = options.lobby ? "Back to the room" : "Rejoin the room";
    $("online-dropped-room").classList.toggle("primary", !options.watch);
    $("online-dropped").hidden = false;
  }

  get droppedShown(): boolean {
    return !$("online-dropped").hidden;
  }

  // --- in a match ---

  /** The results over the final state; `names` by player index, `left` = players who left. */
  showResults(game: GameState, names: readonly string[], left: ReadonlySet<number>, spectating: boolean): void {
    const b = game.battle!;
    const winner = b.matchWinner;
    $("online-results-title").innerHTML =
      winner >= 0 ? `<span style="color:${PLAYER_COLORS[winner]}">${esc(menuText().wins[winner] ?? `${playerName(winner)} WINS!`)}</span>` : "The match is over";
    const order = b.fighters.map((f, i) => ({ f, i })).sort((a, z) => z.f.stars - a.f.stars || a.i - z.i);
    $("online-standings").innerHTML = order
      .map(({ f, i }) => {
        const stars = Array.from({ length: b.rules.wins }, (_, s) => `<i class="star${s < f.stars ? " won" : ""}"></i>`).join("");
        const tag = left.has(i) ? `<span class="tag left">left</span>` : "";
        return `<li class="${i === winner ? "winner" : ""}" style="--color:${PLAYER_COLORS[i]}"><span class="link-icon" data-art-bg="${linkIcon(i)}"></span><b>${playerName(i)}</b><span class="who">${esc(names[i] ?? "")}</span>${tag}<span class="stars">${stars}</span></li>`;
      })
      .join("");
    fillArt($("online-standings"));
    $("online-results").dataset.spectating = String(spectating);
    $("online-results").hidden = false;
    $("online-pause").hidden = true;
    this.syncResultsButtons();
  }

  /** "Everyone else left": the results screen without standings, and why (`note`) when it's known. */
  showAlone(text: string, note = ""): void {
    $("online-results-title").textContent = text;
    $("online-standings").innerHTML = note ? `<li class="alone-note">${esc(note)}</li>` : "";
    $("online-results").hidden = false;
    this.syncResultsButtons();
  }

  hideResults(): void {
    $("online-results").hidden = true;
  }

  get resultsShown(): boolean {
    return !$("online-results").hidden;
  }

  /** The lobby connection is gone: no more rematches from this page. */
  updateRoomLost(): void {
    this.room = null;
    this.syncResultsButtons();
  }

  // (A free room has no rematch and no room to go back to: free play comes back by itself.)
  private syncResultsButtons(): void {
    const room = this.room, host = room !== null && room.host === this.you, free = room?.free === true;
    const hostName = room?.members.find((m) => m.id === room.host)?.name ?? "the host";
    $("online-rematch").hidden = !host || free;
    $<HTMLButtonElement>("online-rematch").disabled = (room?.members.filter((m) => m.slot !== null).length ?? 0) < 2;
    $("online-to-room").hidden = !host || free;
    $("online-end").hidden = !host || free;
    $("online-results-leave").textContent = free ? "Leave" : "Leave room";
    $("online-quit").textContent = free ? "Leave" : "Leave the match";
    $("online-results-note").textContent = free
      ? "Back to free play in a few seconds…"
      : room
        ? host
          ? ""
          : `Waiting for ${hostName} to start the next match…`
        : "Lost the lobby server: no rematch.";
  }

  get paused(): boolean {
    return !$("online-pause").hidden;
  }

  /** The in-match menu (Esc). */
  pause(open = $("online-pause").hidden): void {
    if (open && this.resultsShown) return;
    $("online-pause").hidden = !open;
  }

  /** A short message over the match; `sticky` ones stay until replaced or cleared. */
  banner(text: string, kind: "info" | "warn" | "bad" = "info", ms = 3500): void {
    const el = $("online-banner");
    el.textContent = text;
    el.className = kind;
    el.hidden = false;
    clearTimeout(this.bannerTimer);
    if (ms > 0) this.bannerTimer = window.setTimeout(() => (el.hidden = true), ms);
  }

  clearBanner(text?: string): void {
    const el = $("online-banner");
    if (text === undefined || el.textContent === text) el.hidden = true;
  }

  /** The netplay stats box (toggled with `). */
  get statsShown(): boolean {
    return !$("netstats").hidden;
  }
  set statsShown(v: boolean) {
    $("netstats").hidden = !v;
  }
  stats(text: string, warn: boolean): void {
    const el = $("netstats");
    el.textContent = text;
    el.classList.toggle("warn", warn);
  }
}

/** A member's display name for player `i` of a match. */
export function memberName(members: readonly MemberInfo[], id: number | undefined): string {
  return members.find((m) => m.id === id)?.name ?? "?";
}
