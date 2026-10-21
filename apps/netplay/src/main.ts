// Netplay demo: Lake Hylia for 2–4 players over the rollback netcode (packages/net).
// Open two tabs: create a room in one, join it by code in the other, start. Deep links (after #):
//   create | join=WORD [&spectate]   autostart=N (host starts once N players are in)   name=Alice
//   server=ws://host:5185 (default: /signal here)   transport=auto|webrtc|relay   delay=2 (input delay, frames)
//   lag=80&jitter=30&loss=0.1 (artificial latency/jitter ms and loss rate on outgoing packets)
import { decompressYaz0, Dol, isYaz0, parseRarc, readTileTypes, Stage, type RarcArchive } from "@fso/formats";
import { ADVENTURE_BINDINGS, LocalInput } from "@fso/input";
import { TouchControls } from "@fso/input/touch";
import { LobbyClient, roomCode, startNetMatch, type RollbackGame, type RoomInfo, type Route, type SessionEvent, type StartInfo, type TransportMode } from "@fso/net";
import { ROOM_H, ROOM_W } from "@fso/render";
import { buildWorld, cloneGame, createGame, hashGame, openSpots, stepGame, SUBPX, type GameState, type World } from "@fso/sim";
import { openServerStore, startTicker, type AssetStore } from "@fso/web";
import { Scene } from "./scene.ts";

const ROOT = "GC4Sword_usa";
const STAGE = "boss010";
const COLORS = ["green", "red", "blue", "purple"];
const KEEP_FINALS = 36_000; // frames of final hashes kept for comparisons (10 min)

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.hash.slice(1));

interface Assets {
  data: RarcArchive;
  stage: Stage;
  world: World;
}

async function main(): Promise<void> {
  const store = await openServerStore();
  $("boot-status").textContent = "Loading Lake Hylia…";
  const progress = $<HTMLProgressElement>("progress");
  store.onProgress = (loaded, total) => ((progress.hidden = false), (progress.value = loaded / total));
  const assets = await loadAssets(store);
  store.onProgress = null;
  $("boot").hidden = true;
  const { lobby, start } = await lobbyPhase();
  $("lobby").hidden = true;
  runMatch(lobby, start, assets);
}

async function loadAssets(store: AssetStore): Promise<Assets> {
  const archive = async (path: string): Promise<RarcArchive> => {
    const bytes = await store.read(`${ROOT}/${path}`);
    return parseRarc(isYaz0(bytes) ? decompressYaz0(bytes) : bytes);
  };
  const data = await archive("data.arc");
  const stage = new Stage(await archive(`Boss/${STAGE}.arc`));
  const world = buildWorld(stage, readTileTypes(new Dol(await store.read("sys/main.dol"))));
  return { data, stage, world };
}

// --- lobby ---

function lobbyPhase(): Promise<{ lobby: LobbyClient; start: StartInfo }> {
  $("lobby").hidden = false;
  const server = $<HTMLInputElement>("server"), name = $<HTMLInputElement>("name"), code = $<HTMLInputElement>("code");
  const status = $("lobby-status"), spectate = $<HTMLInputElement>("spectate");
  // Default: signal under the page's base on its own host (Vite proxies it to the lobby, vite.config.ts).
  const own = new URL(`${import.meta.env.BASE_URL}signal`, location.href);
  own.protocol = own.protocol === "https:" ? "wss:" : "ws:";
  server.value = params.get("server") ?? own.href;
  name.value = params.get("name") ?? "";
  code.value = params.get("join") ?? "";
  spectate.checked = params.has("spectate");
  let lobby: LobbyClient | null = null;

  return new Promise((resolve) => {
    const connect = async (): Promise<LobbyClient> => {
      if (lobby) return lobby;
      status.textContent = `Connecting to ${server.value}…`;
      const client = await LobbyClient.connect(server.value);
      lobby = client;
      client.on("room", (room) => showRoom(client, room));
      client.on("start", (start) => resolve({ lobby: client, start }));
      client.on("error", (message) => (status.textContent = message));
      client.on("close", () => (status.textContent = "Lost the connection to the lobby server."));
      return client;
    };
    const enter = async (how: "create" | "join") => {
      try {
        const client = await connect();
        const options = { name: name.value.trim() || undefined };
        await (how === "create" ? client.create({ ...options, maxPlayers: 4 }) : client.join(roomCode(code.value), { ...options, spectator: spectate.checked }));
        $("choose").hidden = true;
        status.textContent = "";
      } catch (error) {
        status.textContent = (error as Error).message;
      }
    };
    $("create").onclick = () => void enter("create");
    $("join").onclick = () => void enter("join");
    $("start").onclick = () => lobby?.start({ delay: Number(params.get("delay") ?? 2) });
    if (params.has("create")) void enter("create");
    else if (params.has("join")) void enter("join");
  });
}

function showRoom(lobby: LobbyClient, room: RoomInfo): void {
  $("room").hidden = false;
  $("room-code").textContent = room.code;
  const link = new URL(location.href);
  link.hash = `join=${room.code}`;
  $<HTMLAnchorElement>("room-link").href = link.href;
  $<HTMLAnchorElement>("room-link").textContent = "invite link";
  const list = $("members");
  list.replaceChildren(
    ...room.members.map((m) => {
      const li = document.createElement("li");
      const role = m.slot === null ? "spectator" : `P${m.slot + 1} (${COLORS[m.slot]})`;
      li.textContent = `${m.name} · ${role}${m.id === room.host ? " · host" : ""}${m.id === lobby.you ? " · you" : ""}`;
      return li;
    }),
  );
  const players = room.members.filter((m) => m.slot !== null).length;
  const host = room.host === lobby.you;
  const start = $<HTMLButtonElement>("start");
  start.hidden = !host;
  start.disabled = players < 2 || room.started;
  $("lobby-status").textContent = host ? (players < 2 ? "Waiting for another player…" : "") : "Waiting for the host to start…";
  const auto = Number(params.get("autostart") ?? 0);
  if (host && auto > 0 && players >= auto && !room.started) lobby.start({ delay: Number(params.get("delay") ?? 2) });
}

// --- match ---

/** Deterministic spawns (the same on every machine): free spots around the start room's center. */
function spawnPoints(stage: Stage, world: World, count: number): { x: number; y: number }[] {
  return openSpots(world, { x: stage.layout.startX * ROOM_W + ROOM_W / 2, y: stage.layout.startY * ROOM_H + ROOM_H / 2 }, count);
}

function runMatch(lobby: LobbyClient, start: StartInfo, { data, stage, world }: Assets): void {
  const players = start.players.length;
  const config = (start.config ?? {}) as { delay?: number };
  const game: RollbackGame<GameState> = { clone: cloneGame, step: (s, inputs) => stepGame(s, inputs, world), hash: hashGame };

  const finals = new Map<number, number>();
  const onFinal = (frame: number, state: GameState) => {
    finals.set(frame, hashGame(state));
    finals.delete(frame - KEEP_FINALS);
  };
  const log: SessionEvent[] = [];
  const banner = $("banner");
  let bannerUntil = 0;
  const say = (text: string, bad = false, ms = 3000) => {
    banner.textContent = text;
    banner.className = bad ? "bad" : "";
    banner.hidden = false;
    bannerUntil = bad ? Infinity : performance.now() + ms;
  };
  const who = (player: number) => `P${player + 1} (${start.room.members.find((m) => m.id === start.players[player])?.name ?? "?"})`;
  const onEvent = (e: SessionEvent) => {
    log.push(e);
    if (e.type === "desync") {
      say(`Desync with ${e.peer} at frame ${e.frame}`, true);
      console.error("desync", e);
    } else if (e.type === "interrupted") say(`Waiting for ${who(e.player)}…`, false, 60_000);
    else if (e.type === "resumed") bannerUntil = 0;
    else if (e.type === "disconnected") say(`${who(e.player)} left (after frame ${e.frame})`);
    else if (e.type === "error") console.error(e.message);
  };

  const routes = new Map<string, Route>();
  const impaired = params.has("lag") || params.has("loss") || params.has("jitter");
  const match = startNetMatch<GameState>(lobby, start, {
    game,
    state: createGame(world, spawnPoints(stage, world, players)),
    mode: (params.get("transport") ?? "auto") as TransportMode,
    impairment: impaired ? { latency: Number(params.get("lag") ?? 0), jitter: Number(params.get("jitter") ?? 0), loss: Number(params.get("loss") ?? 0) } : undefined,
    inputDelay: Number(params.get("delay") ?? config.delay ?? 2),
    onEvent,
    onFinal,
    onRoute: (peer, route) => routes.set(peer, route),
    onSpectatorLost: () => say("Lost the host", true),
  });
  const { session, spectator, lossy, localPlayer: local } = match;
  for (const p of session?.peerInfo() ?? [{ id: String(start.players[0]) }]) routes.set(p.id, match.transport.route(p.id));
  window.addEventListener("pagehide", () => match.close());

  // Keyboard, the first gamepad, and on touch screens the on-screen controls (#touch=on|off), for a player.
  const input = new LocalInput(window, ADVENTURE_BINDINGS);
  const touch = new TouchControls({ after: document.getElementById("hud")! });
  touch.show(local >= 0);
  input.attach(0, touch);
  const fso = {
    lobby,
    match,
    session,
    spectator,
    world,
    local,
    players,
    finals,
    routes,
    log,
    /** Scripted input for tests: frame → buttons (replaces the keyboard). */
    script: null as ((frame: number) => number) | null,
    get state(): GameState {
      return match.state;
    },
  };
  (window as unknown as { fso: unknown }).fso = fso;

  startTicker(
    () => {
      const frame = (session?.frame ?? 0) + (session?.inputDelay ?? 0);
      match.tick(fso.script ? fso.script(frame) & 0xffff : input.single());
    },
    () => match.pump(),
  );

  const canvas = $<HTMLCanvasElement>("screen");
  const scene = new Scene(canvas, data, stage, world);
  const hud = $("hud");
  let frames = 0, fps = 0, fpsAt = performance.now();
  const draw = (now: number) => {
    const state = fso.state;
    scene.render(state, Math.max(0, local));
    touch.place();
    frames++;
    if (now - fpsAt >= 1000) {
      fps = frames;
      frames = 0;
      fpsAt = now;
    }
    if (now > bannerUntil) banner.hidden = true;
    const me = state.players[Math.max(0, local)]!;
    const origin = scene.origin(state.room);
    const lines = [
      `Lake Hylia · room ${start.room.code} · ${local >= 0 ? `you are ${who(local)}, ${COLORS[local]}` : "spectating"} · ${fps} fps`,
      `(${Math.floor(me.x / SUBPX) - origin.x}, ${Math.floor(me.y / SUBPX) - origin.y})${local >= 0 ? " · arrows/WASD to move · J/Z sword" : ""}`,
    ];
    if (session) {
      const s = session.stats;
      lines.push(
        `frame ${session.frame} (final ${session.finalizedFrame}) · delay ${session.inputDelay} · rollbacks ${s.rollbacks} (avg ${(s.rollbackFrames / Math.max(1, s.rollbacks)).toFixed(1)}, max ${s.maxRollback}) · stalls ${s.predictionStalls}+${s.syncStalls}${session.stalled ? ` (${session.stalled})` : ""}`,
      );
      for (const p of session.peerInfo()) {
        const label = p.player >= 0 ? who(p.player) : `spectator ${p.id}`;
        lines.push(`${label}: ${routes.get(p.id) ?? "?"} ${Number.isNaN(p.rtt) ? "–" : `${Math.round(p.rtt)} ms`} · ahead ${p.advantage.toFixed(1)} f · ${p.status}`);
      }
      if (lossy) lines.push(`impaired: +${lossy.impairment.latency}±${lossy.impairment.jitter} ms, ${Math.round(lossy.impairment.loss * 100)}% loss`);
    } else if (spectator) lines.push(`frame ${spectator.frame} · backlog ${spectator.backlog}`);
    hud.textContent = lines.join("\n");
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
}

main().catch((error) => {
  $("boot").hidden = false;
  $("boot-status").textContent = `Error: ${(error as Error).message}`;
  console.error(error);
});
