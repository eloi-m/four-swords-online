// Online Free Play in headless Chrome: pages of one browser open apps/battle's #free against a local signaling server
// and meet in one free room. Starts its own Vite (port 5242, its /signal proxy pointed at the lobby, the game files from
// extracted/) and signaling server (5243; E2E_PORT and E2E_SIGNAL_PORT override them), and stops them at the end.
//   1. Alice, then Bob: the host (Alice) gets the Battle mode button, Bob is told who has it. They walk off; Cara joins:
//      free play restarts with the three, Alice and Bob where they stood, Cara apart from them.
//   2. Dan and Eve join (Eve is P5: the yellow tunic, no HUD corners, the name tags always up); Dan's page goes away
//      (its lobby connection drops, then it's frozen): no restart, his place kept; Finn joins: free play restarts for
//      six with Dan still P4 (out); Dan's page comes back: he's P4 of the restarted free play, his Link in, hashes
//      identical from his snapshot on; then he leaves (the Leave button): free play restarts at once for the other
//      five, standing where they were. Cara's page is frozen past the cut (CDP, as a locked phone): she comes back into the same free
//      play in her slot by herself (her key, a snapshot), no restart, her Link in again, hashes identical from her
//      snapshot on.
//   3. Alice presses Battle mode: a Shadow Battle for the five on The Field (2 hearts, 1 win). Gus opens the page
//      mid-battle and watches it. Alice's bot knocks the others out, every page shows "P1 wins", and free play comes
//      back by itself a few seconds later, with Gus in it. Bob's page is frozen mid-battle: he rejoins the battle.
//   4. Alice closes her tab: Eve (the next member: Bob and Cara rejoined after her) becomes the host and gets the
//      button; free play goes on without a restart, Alice's Link out (her place kept for the lobby's 2 min).
//   5. A phone (emulated) alone: the name prompt upright, Play by a tap, then free play in landscape with the host's
//      bar clear of the on-screen pause button and the sound button.
// Every match's final states must hash alike on every page, on every frame.
//   node tools/e2e/src/free-play.ts [outDir]   (ports: E2E_PORT, E2E_SIGNAL_PORT)
import { mkdirSync, mkdtempSync } from "node:fs";
import { join, resolve } from "node:path";
import { startSignalServer } from "@fso/signal";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { createServer } from "vite";
import { waitReady } from "./ready.ts";
import { browserPath } from "./browsers.ts";

const CHROME = browserPath("chrome");
const VITE_PORT = Number(process.env.E2E_PORT ?? 5242), SIGNAL_PORT = Number(process.env.E2E_SIGNAL_PORT ?? 5243);
const [outArg = "out/e2e-free"] = process.argv.slice(2);
const out = resolve(outArg);
mkdirSync(out, { recursive: true });

type Player = { x: number; y: number; facing: string };
type Fighter = { hearts: number; mode: string; stars: number };
type Game = { tick: number; players: Player[]; battle: { phase: string; fighters: Fighter[] } };
type Run = {
  local: number;
  start: { players: number[]; match: number };
  config: { mode?: string; at?: [number, number, number, string][]; hearts: number; wins: number };
  net: { match: number; frame: number; localPlayer: number; session: { finalizedFrame: number; stats: { desyncs: number } } | null; spectator: { frame: number } | null; state: Game };
};
type Online = { current: Run | null; finals: Map<number, number>; script: ((frame: number, state: Game) => number) | null; lobby: { you: number } | null };
type Audio = { log: { name: string }[]; arenaBgm(room: number): string | null };
type Win = Window & { fso: { mode: string; online: Online | null; hud: { visibleRoots(): string[][] }; audio: Audio | null } };

/** The BGM changes a page asked for (names, "stopBgm"), and The Field's theme. */
const music = (page: Page) =>
  page.evaluate(() => {
    const audio = (window as unknown as Win).fso.audio;
    return { field: audio?.arenaBgm(0) ?? null, bgm: audio?.log.filter((e) => /^JA_BGM|^stopBgm$/.test(e.name)).map((e) => e.name) ?? [] };
  });

process.env.FSO_SIGNAL_PORT = String(SIGNAL_PORT); // read by apps/battle/vite.config.ts for its /signal proxy
const signal = await startSignalServer({ port: SIGNAL_PORT });
const vite = await createServer({
  configFile: resolve(import.meta.dirname, "../../../apps/battle/vite.config.ts"),
  root: resolve(import.meta.dirname, "../../../apps/battle"),
  // (No HMR: its client reloads a page whose socket drops, which a frozen page's does.)
  server: { port: VITE_PORT, strictPort: true, hmr: false },
  logLevel: "warn",
});
await vite.listen();
const base = `http://localhost:${VITE_PORT}/`;
console.log(`vite ${base}, signaling ws://localhost:${SIGNAL_PORT}`);

const browser: Browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  userDataDir: mkdtempSync(join(out, "profile-")),
  defaultViewport: { width: 960, height: 640, deviceScaleFactor: 1 },
  args: ["--autoplay-policy=no-user-gesture-required"],
  protocolTimeout: 60_000,
});
const problems: string[] = [];
const check = (ok: boolean, message: string) => void (ok || problems.push(message));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function open(name: string, extra = ""): Promise<Page> {
  const page = await browser.newPage();
  page.on("console", (m) => {
    if (m.type() === "error" && !/Back-Forward Cache/.test(m.text())) problems.push(`${name} console: ${m.text()}`); // (Chrome closes a frozen page's sockets)
    if (process.env.DEBUG) console.log(`[${name}] ${m.type()}: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`${name} page error: ${e instanceof Error ? e.message : String(e)}`));
  await page.goto(`${base}#free&name=${name}${extra}`, { waitUntil: "domcontentloaded" });
  await waitReady(page, () => (window as unknown as Win).fso?.mode === "online", 60_000);
  return page;
}

/** Screenshot after two fresh frames: background tabs don't render, so their canvas can be stale. */
async function shot(page: Page, file: string): Promise<void> {
  await page.bringToFront();
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await sleep(200);
  await page.screenshot({ path: join(out, file) });
}

/** Waits until the page plays `mode` with `players` Links in all, itself one of them (or watching: `local` -1). */
const waitMode = (page: Page, mode: string, players: number, timeout = 30_000, watching = false) =>
  page.waitForFunction(
    (m, n, w) => {
      const run = (window as unknown as Win).fso.online?.current;
      return !!run && (run.config.mode ?? "") === m && run.net.state.players.length === n && (w ? run.local < 0 : run.local >= 0);
    },
    { timeout, polling: 50 },
    mode,
    players,
    watching,
  );
const waitFree = (pages: Page[], players: number, timeout?: number) => Promise.all(pages.map((p) => waitMode(p, "free", players, timeout)));

const setScript = (page: Page, source: string) =>
  page.evaluate((src) => {
    (window as unknown as Win).fso.online!.script = (0, eval)(src);
  }, source);

const status = (page: Page) =>
  page.evaluate(() => {
    const o = (window as unknown as Win).fso.online!, run = o.current;
    const text = (id: string) => document.getElementById(id)?.textContent ?? "";
    const shown = (id: string) => !(document.getElementById(id) as HTMLElement).hidden;
    return {
      you: o.lobby?.you ?? 0,
      match: run?.net.match ?? 0,
      mode: run?.config.mode ?? "",
      local: run?.local ?? -2,
      players: run?.start.players ?? [],
      at: run?.config.at ?? [],
      frame: run?.net.frame ?? 0,
      final: run?.net.session?.finalizedFrame ?? run?.net.spectator?.frame ?? 0,
      desyncs: run?.net.session?.stats.desyncs ?? 0,
      links: run?.net.state.players.map((p) => ({ x: Math.floor(p.x / 256), y: Math.floor(p.y / 256), facing: p.facing })) ?? [],
      phase: run?.net.state.battle.phase ?? "",
      bar: shown("free-bar"),
      count: text("free-players"),
      button: shown("free-battle") ? ((document.getElementById("free-battle") as HTMLButtonElement).disabled ? "disabled" : "enabled") : "hidden",
      hostNote: text("free-host"),
      banner: shown("online-banner") ? text("online-banner") : "",
      results: shown("online-results") ? text("online-results-title") : null,
      resultsNote: text("online-results-note"),
      rematch: shown("online-rematch"),
      tags: [...document.querySelectorAll(".nametag:not([hidden]) .tag-body")].map((t) => t.textContent ?? ""),
      tagsShown: !!document.querySelector(".nametags.shown"),
      stats: document.querySelectorAll(".nametag .tag-stats .tag-heart").length,
      hudCorners: (window as unknown as Win).fso.hud.visibleRoots().filter((r) => r.length > 0).length,
    };
  });

/** Every page's final-state hashes of the current match, frames `from`..last, must be identical (and present). */
async function compareFinals(name: string, pages: Page[], from = 0): Promise<void> {
  const upTo = Math.min(...(await Promise.all(pages.map(status))).map((s) => s.final));
  const finals = await Promise.all(pages.map((p) => p.evaluate((a, n) => Array.from({ length: n - a + 1 }, (_, i) => (window as unknown as Win).fso.online!.finals.get(a + i) ?? -1), from, upTo)));
  const bad = finals[0]!.findIndex((h, i) => h === -1 || finals.some((other) => other[i] !== h));
  check(bad === -1, `${name}: hashes differ (or are missing) from frame ${from + bad}: ${finals.map((x) => x[bad]).join(" / ")}`);
  check(upTo - from > 30, `${name}: only ${upTo - from + 1} final frames to compare`);
  console.log(`  ${name}: ${bad === -1 ? `identical hashes on all ${upTo - from + 1} frames${from ? ` from ${from}` : ""}` : `DIVERGED at frame ${from + bad}`} (${pages.length} pages)`);
}

/** Freezes a page's JS (timers, workers, sockets' events) for `ms`, as iOS does to a page in the background. */
async function freeze(page: Page, ms: number): Promise<void> {
  const cdp = await page.createCDPSession();
  await cdp.send("Page.setWebLifecycleState", { state: "frozen" });
  await sleep(ms);
  await cdp.send("Page.setWebLifecycleState", { state: "active" });
  await cdp.detach();
}

/**
 * Freezes `page` (one of `pages`, not the host) past the others' cut, and checks it comes back into the same match
 * (`mode`) in its slot by itself: a new session from a snapshot, the others' "rejoined", no restart. Returns the first
 * frame it has (its snapshot's).
 */
async function frozenRejoins(name: string, page: Page, pages: Page[], mode: string): Promise<number> {
  const was = await status(page);
  await page.evaluate(() => void ((window as unknown as Win & { frozenNet?: unknown }).frozenNet = (window as unknown as Win).fso.online!.current!.net));
  await freeze(page, 4000);
  const t0 = Date.now();
  const back = await page
    .waitForFunction(
      (m, local) => {
        const w = window as unknown as Win & { frozenNet?: unknown }, run = w.fso.online?.current;
        return !!run && run.net !== w.frozenNet && run.net.match === m && run.local === local && !!run.net.session;
      },
      { timeout: 25_000, polling: 100 },
      was.match,
      was.local,
    )
    .then(() => true, () => false);
  const s = await status(page);
  check(back && s.mode === mode, `${name}: not back in the ${mode} (match ${was.match} → ${s.match}, P${was.local + 1} → P${s.local + 1}, "${s.banner}")`);
  console.log(`  ${name}: back as P${s.local + 1} of match ${s.match} ${((Date.now() - t0) / 1000).toFixed(1)} s after the thaw; banner "${s.banner}"`);
  const others = pages.filter((p) => p !== page);
  for (const p of others) {
    await p.waitForFunction((player) => (window as unknown as { fso: { online: { log: { type: string; player?: number }[] } } }).fso.online.log.some((e) => e.type === "rejoined" && e.player === player), { timeout: 10_000, polling: 50 }, was.local).catch(() => problems.push(`${name}: a page didn't see P${was.local + 1} come back`));
  }
  const matches = (await Promise.all(others.map(status))).map((o) => o.match);
  check(matches.every((m) => m === was.match), `${name}: the others are in matches ${matches.join(", ")}, not ${was.match}`);
  return page.evaluate(() => Math.min(...(window as unknown as Win).fso.online!.finals.keys()));
}

/** Clicks through JS: page.click waits for a render, which background tabs never do. */
const click = (page: Page, selector: string) => page.$eval(selector, (el) => (el as HTMLElement).click());

/** Walks (the sim's buttons: 1 up, 2 down, 4 left, 8 right) for `frames` from the page's next frames, then stands. */
async function walk(page: Page, buttons: number, frames: number): Promise<void> {
  const { frame } = await status(page);
  await setScript(page, `(frame) => (frame < ${frame + 4 + frames} ? ${buttons} : 0)`);
}

/** Where `ids`' Links stand now in the page's free play (px), by member id. */
async function standing(page: Page, ids: number[]): Promise<Map<number, { x: number; y: number; facing: string }>> {
  const s = await status(page);
  return new Map(ids.map((id) => [id, s.links[s.players.indexOf(id)]!]));
}

/** After a restart: `before` Links (by member id) start where they stood, in the config and in the state. */
async function checkKept(name: string, page: Page, before: Map<number, { x: number; y: number; facing: string }>): Promise<void> {
  const s = await status(page);
  for (const [id, was] of before) {
    const at = s.at.find((a) => a[0] === id), now = s.links[s.players.indexOf(id)];
    check(!!at && at[1] === was.x && at[2] === was.y && at[3] === was.facing, `${name}: member ${id}'s place in the restart is ${JSON.stringify(at)}, he stood at ${JSON.stringify(was)}`);
    check(!!now && now.x === was.x && now.y === was.y, `${name}: member ${id}'s Link starts at ${JSON.stringify(now)}, not ${JSON.stringify(was)}`);
  }
  const links = s.links;
  for (const [i, a] of links.entries()) for (const b of links.slice(i + 1)) check(Math.abs(a.x - b.x) + Math.abs(a.y - b.y) >= 32, `${name}: two Links start on top of each other (${JSON.stringify(links)})`);
}

// P1's bot: to the nearest Link still standing, beside him, facing him, and a swing whenever he can be hit. It finds
// its way on the arena's 8 px cells (a breadth-first search to a cell beside its target, where its ±7 px body fits),
// so no wall, pocket or push (a stick held into a wall keeps a Link leaning on it, as in the game) holds it up. The
// others turn their backs at the round's start (no shield) and stand.
const KNOCKOUT = `(player) => {
  let last = 0, path = [], pathAt = -99, goal = -1;
  const world = () => window.fso.online.current.world;
  const fits = (w, cx, cy) => {
    for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) {
      if (x < 0 || y < 0 || x >= w.widthCells || y >= w.heightCells) return false;
      const i = y * w.widthCells + x;
      if (w.solid[i] || w.surface[i] === 1 || w.surface[i] === 3) return false; // (walls, pits, deep water)
    }
    return true;
  };
  const route = (w, from, to) => {
    const W = w.widthCells, prev = new Int32Array(W * w.heightCells).fill(-1), queue = [from];
    prev[from] = from;
    for (let k = 0; k < queue.length; k++) {
      const c = queue[k];
      if (c === to) break;
      for (const n of [c + 1, c - 1, c + W, c - W]) {
        if (n < 0 || n >= prev.length || prev[n] >= 0 || !fits(w, n % W, Math.floor(n / W))) continue;
        prev[n] = c;
        queue.push(n);
      }
    }
    if (prev[to] < 0) return [];
    const out = [];
    for (let c = to; c !== from; c = prev[c]) out.unshift(c);
    return out;
  };
  let lx = 0, ly = 0, still = 0, away = 0, turn = 0;
  // Stuck (leaning on a wall: a push, or wedged where its search can't start), it walks another way a while, each in
  // turn.
  const unstick = (dirs, me) => {
    still = Math.abs(me.x - lx) + Math.abs(me.y - ly) < 64 ? still + 1 : 0;
    [lx, ly] = [me.x, me.y];
    if (still >= 12 && away === 0) [away, turn, still] = [24, turn + 1, 0];
    return away > 0 ? (away--, [2, 8, 1, 4][turn & 3]) : dirs;
  };
  return (frame, g) => {
    const b = g.battle, me = g.players[player];
    if (b.phase !== "play" || b.fighters[player].hearts === 0) return (last = 0);
    let target = -1, best = Infinity;
    b.fighters.forEach((f, i) => {
      if (i === player || f.hearts === 0 || f.mode === "dead") return;
      const p = g.players[i], d = Math.abs(p.x - me.x) + Math.abs(p.y - me.y);
      if (d < best) [best, target] = [d, i];
    });
    if (target < 0) return (last = 0);
    const t = g.players[target], side = t.x >= me.x ? -1 : 1;
    const ex = (t.x + side * 16 * 256 - me.x) / 256, ey = (t.y - me.y) / 256;
    if (Math.abs(ex) <= 5 && Math.abs(ey) <= 3) {
      const face = side < 0 ? "right" : "left";
      if (me.facing !== face) return (last = side < 0 ? 8 : 4);
      if (me.action === "none" && b.fighters[target].invincible === 0 && !(last & 16)) return (last = 16);
      return (last = 0);
    }
    const w = world(), W = w.widthCells, cell = (x, y) => Math.floor(y / 2048) * W + Math.floor(x / 2048);
    if (frame - pathAt >= 15 || goal !== target || !path.length) {
      // (Beside the target on whichever side it can reach, the nearer first.)
      const spots = [side, -side].map((s) => cell(t.x + s * 16 * 256, t.y));
      path = route(w, cell(me.x, me.y), spots[0]);
      if (!path.length) path = route(w, cell(me.x, me.y), spots[1]);
      [pathAt, goal] = [frame, target];
    }
    while (path.length > 1 && path[0] === cell(me.x, me.y)) path.shift();
    const next = path[Math.min(1, path.length - 1)];
    if (next === undefined) return (last = unstick((ex > 3 ? 8 : ex < -3 ? 4 : 0) | (ey > 3 ? 2 : ey < -3 ? 1 : 0), me));
    const nx = ((next % W) * 8 + 4) * 256 - me.x, ny = (Math.floor(next / W) * 8 + 4) * 256 - me.y;
    return (last = unstick((nx > 256 ? 8 : nx < -256 ? 4 : 0) | (ny > 256 ? 2 : ny < -256 ? 1 : 0), me));
  };
}`;
const TURN_AWAY = `(frame, g) => (g.battle.phase === "play" && g.battle.phaseTick < 3 ? 1 : 0)`;

async function freePlay(): Promise<Page[]> {
  console.log("\nfree play: joins and leaves");
  const a = await open("Alice", "&wins=1&hearts=2");
  await waitFree([a], 1);
  let sa = await status(a);
  console.log(`  Alice alone: match ${sa.match}, bar "${sa.count}", button ${sa.button}`);
  check(sa.bar && sa.count === "1/8" && sa.button === "disabled", `alone: the host's bar ${JSON.stringify(sa)}`);
  const b = await open("Bob");
  await waitFree([a, b], 2);
  const [sa2, sb] = await Promise.all([status(a), status(b)]);
  console.log(`  + Bob: bar "${sb.count}", Alice's button ${sa2.button}, Bob's ${sb.button} ("${sb.hostNote}")`);
  check(sa2.button === "enabled" && sa2.hostNote === "", `Alice's bar with Bob in: ${sa2.button} "${sa2.hostNote}"`);
  check(sb.button === "hidden" && sb.hostNote === "Alice can start a battle" && sb.count === "2/8", `Bob's bar: ${sb.button} "${sb.hostNote}" ${sb.count}`);

  // Alice walks right, Bob down; they stop; Cara joins: both stay where they stood.
  await walk(a, 8, 50);
  await walk(b, 2, 40);
  await sleep(2000);
  for (const p of [a, b]) await setScript(p, `(frame) => 0`); // (the next match counts its frames from 0 again)
  const ids = [sa2.you, sb.you];
  const before = await standing(a, ids);
  const moved = [...before.values()], first = sa2.links;
  check(moved[0]!.x > first[0]!.x + 30 && moved[1]!.y > first[1]!.y + 20, `the walks didn't move the Links (${JSON.stringify(first)} → ${JSON.stringify(moved)})`);
  const c = await open("Cara");
  await waitFree([a, b, c], 3);
  await checkKept("Cara joins", a, before);
  const sc = await status(c);
  console.log(`  + Cara: match ${sc.match}, places ${JSON.stringify(sc.at)}, Links ${JSON.stringify(sc.links)}; Alice's banner "${(await status(a)).banner}"`);
  check(sc.match > sa2.match, `Cara's join didn't restart free play (match ${sa2.match} → ${sc.match})`);
  await sleep(1500);
  await compareFinals("free play, 3 players", [a, b, c]);

  const d = await open("Dan");
  await waitFree([a, b, c, d], 4);
  const e = await open("Eve");
  const five = [a, b, c, d, e];
  await waitFree(five, 5);
  await sleep(1500);
  const se = await status(e);
  console.log(`  + Dan, Eve: Eve is P${se.local + 1}; her tags ${se.tags.join(" | ")} (${se.tagsShown ? "shown" : "hidden"}), HUD corners ${se.hudCorners}`);
  check(se.local === 4 && se.tagsShown && se.tags.length === 5 && se.hudCorners === 0, `five in free play, Eve's page: ${JSON.stringify(se)}`);
  await compareFinals("free play, 5 players", five);
  // The Field's theme, once: free play's restarts don't start it again.
  const tunes = await music(a);
  console.log(`  Alice's music through 4 restarts: ${tunes.bgm.join(", ")} (The Field: ${tunes.field})`);
  check(!!tunes.field && tunes.bgm.join() === tunes.field, `free play's music: ${JSON.stringify(tunes)}`);
  await shot(a, "free-play-A.png");
  await shot(e, "free-play-E.png");

  // Dan's page goes away (its lobby connection drops, then it's frozen: a locked phone): no restart, his place is kept.
  const four = [a, b, c, e];
  const danWas = await status(d);
  await d.evaluate(() => void ((window as unknown as Win & { frozenNet?: unknown }).frozenNet = (window as unknown as Win).fso.online!.current!.net));
  const cdp = await d.createCDPSession();
  await d.evaluate(() => (window as unknown as { fso: { online: { lobby: { close(): void } } } }).fso.online.lobby.close());
  await cdp.send("Page.setWebLifecycleState", { state: "frozen" });
  await a.waitForFunction((id) => ((window as unknown as { fso: { online: { lobby: { room: { away?: number[] } } } } }).fso.online.lobby.room.away ?? []).includes(id), { timeout: 10_000, polling: 50 }, danWas.you).catch(() => problems.push("Dan's place isn't kept (room.away)"));
  await sleep(4000); // (the others cut him: his Link is out)
  const sa4 = await status(a);
  check(sa4.match === se.match, `Dan going away restarted free play (match ${se.match} → ${sa4.match})`);
  // Finn joins: free play restarts for six, Dan still P4 (out until he's back), Finn after Eve.
  const keep = await standing(a, [0, 1, 2, 4].map((i) => se.players[i]!));
  const f = await open("Finn");
  await waitFree([...four, f], 6);
  await checkKept("Finn joins while Dan is away", a, keep);
  const [restart, sf5] = await Promise.all([status(a), status(f)]);
  console.log(`  Dan away, + Finn: match ${restart.match}, players ${JSON.stringify(restart.players)} (Dan was ${danWas.you}), Finn P${sf5.local + 1}`);
  check(restart.players[3] === danWas.you && sf5.local === 5 && (await status(e)).local === 4, `the restart with Dan away: ${JSON.stringify(restart.players)}, Finn P${sf5.local + 1}`);
  // Dan's page comes back: into the restarted free play as himself (P4, his name), his Link in where it stood.
  await cdp.send("Page.setWebLifecycleState", { state: "active" });
  await cdp.detach();
  const danBack = await d
    .waitForFunction((m) => { const w = window as unknown as Win & { frozenNet?: unknown }, run = w.fso.online?.current; return !!run && run.net !== w.frozenNet && run.net.match === m && run.local === 3 && !!run.net.session; }, { timeout: 30_000, polling: 100 }, restart.match)
    .then(() => true, () => false);
  const sd6 = await status(d);
  check(danBack, `Dan isn't back as P4 of match ${restart.match} (match ${sd6.match}, P${sd6.local + 1}, "${sd6.banner}")`);
  await walk(d, 2, 20);
  await sleep(2500);
  const danLink = await a.evaluate(() => { const run = (window as unknown as Win).fso.online!.current!; return { mode: run.net.state.battle.fighters[3]!.mode, tag: [...document.querySelectorAll(".nametag .tag-body")].map((t) => t.textContent ?? "") }; });
  console.log(`  Dan back as P${sd6.local + 1}: his Link on Alice's page ${danLink.mode}, tags ${danLink.tag.join(" | ")}`);
  check(danLink.mode !== "dead" && danLink.tag.some((t) => /Dan/.test(t)), `Dan's Link after his return: ${JSON.stringify(danLink)}`);
  const six = [...four, d, f];
  const danFirst = await d.evaluate(() => Math.min(...(window as unknown as Win).fso.online!.finals.keys()));
  await compareFinals("free play, everyone from Dan's snapshot", six, danFirst);
  // Dan leaves for good (the Leave button): free play restarts at once without him, the others where they stood.
  const kept = await standing(a, [0, 1, 2, 4, 5].map((i) => restart.players[i]!));
  await d.evaluate(() => (window as unknown as { fso: { online: { home(): void } } }).fso.online.home());
  await waitFree([...four, f], 5);
  await checkKept("Dan leaves", a, kept);
  const [sa6, se6] = await Promise.all([status(a), status(e)]);
  console.log(`  - Dan: ${sa6.count}, Eve is now P${se6.local + 1}; Alice's banner "${sa6.banner}"`);
  check(sa6.count === "5/8" && se6.local === 3 && /Dan left/.test(sa6.banner), `after Dan left: ${sa6.count}, Eve P${se6.local + 1}, "${sa6.banner}"`);
  await d.close();

  // Cara's page freezes past the cut (a locked phone): she rejoins the same free play in her slot, her Link in again.
  const five2 = [...four, f];
  await sleep(1000);
  const caraFirst = await frozenRejoins("Cara frozen in free play", c, five2, "free");
  await walk(c, 8, 30);
  await sleep(2000);
  const sa5 = await status(a), sc5 = await status(c);
  const link = (await a.evaluate((i) => (window as unknown as Win).fso.online!.current!.net.state.battle.fighters[i]!.mode, sc5.local));
  console.log(`  Cara's Link on Alice's page: ${link}; Alice's banner "${sa5.banner}"`);
  check(link !== "dead", `Cara's Link is still out after her rejoin (${link})`);
  check(sa5.desyncs === 0 && sc5.desyncs === 0, `free play rejoin: desyncs (Alice ${sa5.desyncs}, Cara ${sc5.desyncs})`);
  await compareFinals("free play, the four others", [a, b, e, f]);
  await compareFinals("free play, everyone from Cara's snapshot", five2, caraFirst);
  return five2;
}

async function battle(pages: Page[]): Promise<void> {
  console.log("\nbattle mode, and back to free play");
  const [a] = pages;
  const t0 = Date.now();
  await click(a!, "#free-battle");
  await Promise.all(pages.map((p) => waitMode(p, "battle", 5)));
  const sa = await status(a!);
  console.log(`  battle: match ${sa.match}, ${sa.links.length} Links at ${JSON.stringify(sa.links.map((l) => [l.x, l.y]))}; bar ${sa.bar ? "shown" : "hidden"}`);
  await setScript(a!, `(${KNOCKOUT})(0)`);
  for (const p of pages.slice(1)) await setScript(p, TURN_AWAY);
  // A latecomer watches the battle, then plays the free play after it.
  const g = await open("Gus");
  await waitMode(g, "battle", 5, 30_000, true);
  const sg = await status(g);
  console.log(`  + Gus mid-battle: watching, banner "${sg.banner}"`);
  check(/battle is on/.test(sg.banner), `Gus's banner: "${sg.banner}"`);
  await a!.waitForFunction(() => (window as unknown as Win).fso.online!.current!.net.state.battle.phase === "play", { timeout: 20_000, polling: 100 });
  await a!.bringToFront(); // (background tabs don't render: their name tags stay as they were)
  await sleep(1500);
  const sb = await status(a!);
  console.log(`  mid-battle: tags ${sb.tags.join(" | ")} (${sb.tagsShown ? "shown" : "hidden"}, ${sb.stats} hearts), HUD corners ${sb.hudCorners}`);
  check(!sb.bar && sb.tagsShown && sb.tags.length === 5 && sb.stats === 10 && sb.hudCorners === 0, `the 5-Link battle's screen: ${JSON.stringify(sb)}`);
  await shot(a!, "battle-5-A.png");
  // Bob's page freezes mid-battle: he rejoins the battle in his slot (his Link out until a next round).
  const bob = pages[1]!;
  const bobFirst = await frozenRejoins("Bob frozen mid-battle", bob, [...pages, g].filter((p) => p !== g), "battle");
  await setScript(bob, TURN_AWAY);
  const all = [...pages, g];
  for (;;) {
    const st = await Promise.all(all.map(status));
    if (st.every((s) => s.results)) break;
    if (Date.now() - t0 > 150_000) {
      problems.push(`battle: no results after 150 s (${st.map((s) => `${s.phase} ${s.results}`).join(", ")})`);
      return;
    }
    await sleep(250);
  }
  const shownAt = Date.now();
  const st = await Promise.all(all.map(status));
  for (const s of st) check(/P1 WINS!/.test(s.results ?? "") && !s.rematch && /Back to free play/.test(s.resultsNote), `battle results on member ${s.you}: ${s.results}, rematch ${s.rematch}, "${s.resultsNote}"`);
  for (const s of st) check(s.desyncs === 0, `battle: desync on member ${s.you}`);
  console.log(`  results after ${Math.round((shownAt - t0) / 1000)} s: "${st[0]!.results}" (note "${st[0]!.resultsNote}")`);
  await compareFinals("battle, 4 players and a spectator", all.filter((p) => p !== bob));
  await compareFinals("battle, everyone from Bob's snapshot", all, bobFirst);
  await shot(a!, "battle-results-A.png");
  await shot(g, "battle-results-Gus.png");
  for (const p of pages) await setScript(p, `(frame, g) => 0`);
  await waitFree(all, 6, 20_000).catch(() => problems.push("free play didn't come back after the battle"));
  console.log(`  free play back ${((Date.now() - shownAt) / 1000).toFixed(1)} s after the results, with Gus in (P${(await status(g)).local + 1})`);
  check(Date.now() - shownAt < 12_000, `free play came back ${Date.now() - shownAt} ms after the results`);
  await a!.bringToFront(); // (a background tab draws nothing, so its sound cues wait)
  await sleep(1000);
  const tunes = await music(a!);
  console.log(`  Alice's music since: ${tunes.bgm.slice(1).join(", ")}`);
  check(tunes.bgm.at(-1) === tunes.field && tunes.bgm.includes("JA_BGM_RESULT"), `the music after the battle: ${JSON.stringify(tunes)}`);
  await compareFinals("free play after the battle, 6 players", all);
  await shot(g, "free-play-after-Gus.png");

  // The host leaves: the room's next member hosts (Eve: Bob and Cara came back in after her, under new member ids),
  // and free play goes on without a restart: a closed tab (or a reload) keeps its place a while, Alice's Link is out.
  const rest = all.slice(1);
  const before = (await status(rest[0]!)).match;
  await a!.close({ runBeforeUnload: true });
  await rest[0]!.waitForFunction(() => (window as unknown as Win).fso.online!.current!.net.state.battle.fighters[0]!.mode === "dead", { timeout: 10_000, polling: 100 }).catch(() => problems.push("Alice's Link isn't out after she closed her tab"));
  await sleep(1500);
  const st2 = await Promise.all(rest.map(status));
  check(st2.every((s) => s.match === before && s.mode === "free"), `Alice closing her tab restarted free play (${before} → ${st2.map((s) => s.match).join(", ")})`);
  const hosts = st2.filter((s) => s.button === "enabled" && s.hostNote === "");
  console.log(`  - Alice: buttons ${st2.map((s) => s.button).join(", ")}, bar "${st2[0]!.count}", "${st2[0]!.hostNote}"`);
  check(hosts.length === 1 && st2[2]!.button === "enabled" && /^Eve can start a battle$/.test(st2[0]!.hostNote), `Eve as the host: ${JSON.stringify(st2.map((s) => [s.button, s.hostNote]))}`);
  for (const p of rest) await p.close();
}

const UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";

/**
 * A phone alone in a new free room: the name prompt upright (no rotate screen, 44 px targets, no sideways scroll),
 * Play by a tap, the rotate screen once the map shows, then in landscape the bar with the host's button (44 px), clear
 * of the on-screen pause button and the sound button.
 */
async function phone(): Promise<void> {
  console.log("\na phone: upright, then in landscape");
  const page = await browser.newPage();
  page.on("console", (m) => void (m.type() === "error" && problems.push(`phone console: ${m.text()}`)));
  page.on("pageerror", (e) => problems.push(`phone page error: ${e instanceof Error ? e.message : String(e)}`));
  await page.emulate({ userAgent: UA, viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: false } });
  await page.goto(`${base}#free`, { waitUntil: "domcontentloaded" });
  await waitReady(page, () => (window as unknown as Win).fso?.mode === "online" && !document.getElementById("online-free")!.hidden, 60_000);
  const rotated = () => page.evaluate(() => getComputedStyle(document.getElementById("rotate")!).display !== "none");
  const layout = () =>
    page.evaluate(() => {
      const small = [...document.querySelectorAll<HTMLElement>("#online-free button, #online-free input, #free-bar button")]
        .filter((el) => el.getClientRects().length > 0)
        .map((el) => ({ id: el.id, box: el.getBoundingClientRect() }))
        .filter(({ box }) => box.width < 44 || box.height < 44)
        .map(({ id, box }) => `#${id} ${Math.round(box.width)}×${Math.round(box.height)}`);
      return { scroll: document.documentElement.scrollWidth - innerWidth, small };
    });
  const upright = await layout();
  check(!(await rotated()) && upright.scroll <= 0 && upright.small.length === 0, `phone upright, the prompt: rotate ${await rotated()}, ${JSON.stringify(upright)}`);
  await shot(page, "free-prompt-phone.png");
  await page.tap("#free-name");
  await page.keyboard.type("Pia");
  await page.tap("#free-play");
  await waitMode(page, "free", 1);
  check(await rotated(), "phone upright: no rotate screen over free play");
  await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true });
  await sleep(1200); // (the bar steps aside every 500 ms at most)
  const land = await layout();
  const clash = await page.evaluate(() => {
    const bar = document.getElementById("free-bar")!.getBoundingClientRect();
    return [...document.querySelectorAll<HTMLElement>(".fso-touch-pause, #audio")]
      .filter((el) => el.getClientRects().length > 0)
      .map((el) => ({ id: el.id || el.className, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.left < bar.right && bar.left < r.right && r.top < bar.bottom && bar.top < r.bottom)
      .map(({ id }) => id);
  });
  const s = await status(page);
  console.log(`  prompt upright: ok; in landscape: bar "${s.count}", button ${s.button}, too small ${JSON.stringify(land.small)}, overlaps ${JSON.stringify(clash)}`);
  check(!(await rotated()) && s.bar && s.button === "disabled" && land.small.length === 0 && land.scroll <= 0 && clash.length === 0, `phone in landscape: ${JSON.stringify({ land, clash, s })}`);
  await shot(page, "free-play-phone.png");
  await page.close();
}

try {
  await battle(await freePlay());
  await phone();
} catch (error) {
  problems.push(`aborted: ${(error as Error).stack ?? (error as Error).message}`);
} finally {
  await browser.close();
  await vite.close();
  await signal.close();
}
if (problems.length) {
  console.log(`\nproblems:\n${problems.join("\n")}`);
  process.exitCode = 1;
} else console.log(`\nall scenarios passed; screenshots in ${out}`);
