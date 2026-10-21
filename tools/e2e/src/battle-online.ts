// Online Shadow Battle in headless Chrome: pages of one browser play apps/battle's online mode against a local
// signaling server, and every page must hold identical state hashes on every final frame. Starts its own Vite
// (port 5187, its /signal proxy pointed at the lobby, the game files from extracted/) and signaling server (5188;
// E2E_PORT and E2E_SIGNAL_PORT override them), and stops them at the end.
//   1. 2 players on the Tower of Winds (no hazards to get in the way; side view: both drop to its bottom floor): P1's
//      bot knocks P2 out, a spectator joins mid-match, everyone reaches "P1 wins";
//      then a rematch in the same room, where P2 closes his tab mid-round: P1 wins the round and the match.
//   2. 4 players under 60±30 ms and 10% loss, brawling: P3's packets all get lost for 1.5 s (everyone waits, then
//      resumes), then P4 closes his tab mid-round: the others go on without his Link until the round ends.
//   3. A forced desync (one page's state nudged): both pages raise the warning and show it in the stats overlay.
//   4. The menus by hand: Play online, create, join by typing the code, the host's settings reaching the guest, start,
//      end the match (Esc menu), watch instead / play again, leave from the Esc menu.
//   5. 2 players and 2 CPUs (picked in the host's room settings) on the Tower of Flames under 40±20 ms / 5% loss, with
//      a spectator joining mid-match: every page plays the CPUs alike, to the results. The names over the Links: up
//      at the round's start ("You" over one's own Link, "CPU hard"), faded once the fight is on, the spectator's too.
//   6. Rejoining: 3 players brawl, P3 reloads his page mid-round and comes back into his slot (his Link in from the
//      next round), every page's hashes identical from his snapshot on; then the same over the relay with 40±20 ms and
//      5% loss, where P3's lobby connection also drops in round 2 and the page rejoins by itself.
//   7. Arbitrated disconnects: 4 players, the link between P3 and P4 goes down mid-round: P1 cuts P4 alone, P1-P3 play
//      on with identical hashes, P4 learns he was cut and rejoins by himself.
//   8. A 2–2 split: P1-P2 and P3-P4 stop hearing each other mid-round; the lobby referees the tie, one half plays on,
//      the other drops out and rejoins by itself: one match throughout, the four in it again at the end.
//   9. 3 players and a spectator: P1 closes his tab mid-round and P2 feeds the spectator from then on.
//   node tools/e2e/src/battle-online.ts [outDir]   (ports: E2E_PORT, E2E_SIGNAL_PORT; E2E_ONLY=partition,split,feed: some)
import { mkdirSync, mkdtempSync } from "node:fs";
import { join, resolve } from "node:path";
import type { SessionStats } from "@fso/net";
import { startSignalServer } from "@fso/signal";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { createServer } from "vite";
import { waitReady } from "./ready.ts";
import { browserPath } from "./browsers.ts";

const CHROME = browserPath("chrome");
const VITE_PORT = Number(process.env.E2E_PORT ?? 5187), SIGNAL_PORT = Number(process.env.E2E_SIGNAL_PORT ?? 5188);
const COUNTDOWN = 409; // packages/sim COUNTDOWN_TICKS
const [outArg = "out/e2e"] = process.argv.slice(2);
const out = resolve(outArg);
mkdirSync(out, { recursive: true });

type Fighter = { hearts: number; mode: string; stars: number };
type Game = { tick: number; players: { x: number; y: number }[]; battle: { phase: string; phaseTick: number; round: number; roundWinner: number; matchWinner: number; fighters: Fighter[]; cpus?: { player: number; level: string }[] } };
type Net = {
  match: number;
  localPlayer: number;
  frame: number;
  session: { frame: number; finalizedFrame: number; stats: SessionStats; peerInfo(): { id: string; rtt: number; status: string }[] } | null;
  spectator: { frame: number } | null;
  transport: { route(peer: string): string };
};
type Online = {
  current: { net: Net; left: Set<number> } | null;
  finals: Map<number, number>;
  log: { type: string; player?: number; reason?: string; frame?: number }[];
  script: ((frame: number, state: Game) => number) | null;
  game: Game | null;
};
type Win = Window & { fso: { mode: string; online: Online | null } };

process.env.FSO_SIGNAL_PORT = String(SIGNAL_PORT); // read by apps/battle/vite.config.ts for its /signal proxy
const signal = await startSignalServer({ port: SIGNAL_PORT });
const vite = await createServer({
  configFile: resolve(import.meta.dirname, "../../../apps/battle/vite.config.ts"),
  root: resolve(import.meta.dirname, "../../../apps/battle"),
  server: { port: VITE_PORT, strictPort: true },
  logLevel: "warn",
});
await vite.listen();
const base = `http://localhost:${VITE_PORT}/`;
console.log(`vite ${base}, signaling ws://localhost:${SIGNAL_PORT} (pages use ${base.replace("http", "ws")}signal)`);

const browser: Browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  userDataDir: mkdtempSync(join(out, "profile-")),
  defaultViewport: { width: 960, height: 640, deviceScaleFactor: 1 },
  args: ["--autoplay-policy=no-user-gesture-required"],
  protocolTimeout: 30_000,
});
const problems: string[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function open(hash: string, label: string, expectedErrors?: RegExp, mode = "online"): Promise<Page> {
  const page = await browser.newPage();
  page.on("console", (m) => {
    if (m.type() === "error" && !expectedErrors?.test(m.text())) problems.push(`${label} console: ${m.text()}`);
    if (process.env.DEBUG) console.log(`[${label}] ${m.type()}: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`${label} page error: ${e instanceof Error ? e.message : String(e)}`));
  await page.goto(`${base}#${hash}`, { waitUntil: "domcontentloaded" });
  await waitReady(page, (m) => (window as unknown as Win).fso?.mode === m, 60_000, mode);
  return page;
}

/** Screenshot after two fresh frames: background tabs don't render, so their canvas can be stale. */
async function shot(page: Page, file: string): Promise<void> {
  await page.bringToFront();
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.screenshot({ path: join(out, file) });
}

const roomCode = async (page: Page) => {
  await page.waitForFunction(() => (document.getElementById("online-room-code")?.textContent?.length ?? 0) >= 4, { timeout: 20_000, polling: 100 });
  return page.$eval("#online-room-code", (el) => el.textContent!);
};
const waitMatch = (page: Page, match: number) =>
  page.waitForFunction((n) => (window as unknown as Win).fso.online?.current?.net.match === n, { timeout: 30_000, polling: 50 }, match);
const setScript = (page: Page, source: string) =>
  page.evaluate((src) => {
    (window as unknown as Win).fso.online!.script = (0, eval)(src);
  }, source);

const status = (page: Page) =>
  page.evaluate(() => {
    const o = (window as unknown as Win).fso.online!;
    const net = o.current?.net;
    const g = o.game;
    return {
      match: net?.match ?? 0,
      local: net?.localPlayer ?? -2,
      frame: net?.frame ?? 0,
      final: net?.session?.finalizedFrame ?? net?.spectator?.frame ?? 0,
      stats: net?.session?.stats ?? null,
      peers: net?.session?.peerInfo().map((p) => ({ id: p.id, rtt: Math.round(p.rtt), status: p.status, route: net.transport.route(p.id) })) ?? [],
      phase: g?.battle.phase ?? "",
      round: g?.battle.round ?? 0,
      hearts: g?.battle.fighters.map((f) => f.hearts) ?? [],
      modes: g?.battle.fighters.map((f) => f.mode) ?? [],
      stars: g?.battle.fighters.map((f) => f.stars) ?? [],
      results: document.getElementById("online-results")!.hidden ? null : document.getElementById("online-results-title")!.textContent,
      log: o.log.map((e) => `${e.type}${e.player !== undefined ? ` P${e.player + 1}` : ""}${e.reason ? ` ${e.reason}` : ""}`),
    };
  });

/** Every page's final-state hashes on frames 0..last must be identical (and present). Returns the frames compared. */
async function compareFinals(name: string, pages: Page[], last?: number, from = 0): Promise<number> {
  const upTo = last ?? Math.min(...(await Promise.all(pages.map(status))).map((s) => s.final));
  const finals = await Promise.all(pages.map((p) => p.evaluate((n, from) => Array.from({ length: n + 1 - from }, (_, k) => (window as unknown as Win).fso.online!.finals.get(from + k) ?? -1), upTo, from)));
  const k = finals[0]!.findIndex((h, f) => h === -1 || finals.some((other) => other[f] !== h)), bad = k < 0 ? -1 : from + k;
  if (bad !== -1) problems.push(`${name}: hashes differ (or are missing) from frame ${bad}: ${finals.map((x) => x[k]).join(" / ")}`);
  console.log(`  ${name}: ${bad === -1 ? `identical hashes on all ${upTo + 1 - from} frames${from ? ` from ${from}` : ""}` : `DIVERGED at frame ${bad}`} (${pages.length} pages)`);
  return upTo;
}

function report(label: string, s: Awaited<ReturnType<typeof status>>): void {
  const k = s.stats;
  const rb = k ? `rollbacks ${k.rollbacks} (avg ${(k.rollbackFrames / Math.max(1, k.rollbacks)).toFixed(1)}, max ${k.maxRollback}), stalls ${k.predictionStalls}+${k.syncStalls}, hash checks ${k.hashChecks}, desyncs ${k.desyncs}` : "spectator";
  console.log(`  ${label}: match ${s.match} frame ${s.frame}, ${rb}, peers ${JSON.stringify(s.peers)}, hearts ${s.hearts.join("/")}, stars ${s.stars.join("/")}, events [${s.log.join(", ")}]`);
}

// P1's bot: walk up to P2, face him and swing whenever he can be hit (as tools/e2e/src/battle.ts, from the state on
// screen; the inputs land `delay` frames later, which a bot doesn't mind).
const CHASE = `(() => { let last = 0; return (frame, g) => {
  const b = g.battle; let out = 0;
  if (b.phase === "play") {
    const [p1, p2] = g.players, dx = (p2.x - p1.x) / 256, dy = (p2.y - p1.y) / 256;
    if (Math.abs(dy) > 3) out = b.props.sideViews & 1 ? (dx > 0 ? 8 : 4) : dy > 0 ? 2 : 1; // (side view: off his ledge)
    else if (dx > 22) out = 8;
    else if (dx < 10) out = 4;
    else if (p1.facing !== "right") out = 8;
    else if (p1.action === "none" && b.fighters[1].invincible === 0 && !(last & 16)) out = 16;
  }
  return (last = out);
}; })()`;
// P2 turns his back (up) at the start of each round, so his shield doesn't block, then stands still. (The Tower of
// Winds is side view: he walks off his ledge down to the bottom floor first, and P1's bot follows him down.)
const TURN_AWAY = `(frame, g) => {
  const b = g.battle, t = b.phaseTick;
  if (b.phase !== "play") return 0;
  if (b.props.sideViews & 1) return t < 30 ? 4 : t >= 80 && t < 83 ? 1 : 0; // (side view: off his ledge to the floor first)
  return t < 3 ? 1 : 0;
}`;
// A brawl: each Link goes for the nearest Link still in, swinging when close, with random detours (every peer's
// script reads its own, possibly predicted, state; only the inputs it produces need to reach the others).
const BRAWL = `(player) => { let last = 0; return (frame, g) => {
  const b = g.battle, me = g.players[player];
  if (b.phase !== "play" || b.fighters[player].hearts === 0) return (last = 0);
  let target = null, best = Infinity;
  g.players.forEach((p, i) => {
    const d = Math.abs(p.x - me.x) + Math.abs(p.y - me.y);
    if (i !== player && b.fighters[i].hearts > 0 && d < best) { best = d; target = p; }
  });
  if (!target) return (last = 0);
  let v = Math.imul(Math.floor(frame / 30) + 1, 0x9e3779b1) ^ Math.imul(player + 7, 0x85ebca6b);
  v = Math.imul(v ^ (v >>> 16), 0x7feb352d); v ^= v >>> 15;
  if ((v >>> 0) % 3 === 0 && frame % 30 < 12) return (last = [1, 2, 4, 8][(v >>> 4) % 4]);
  const dx = (target.x - me.x) / 256, dy = (target.y - me.y) / 256;
  const toward = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 8 : 4) : dy > 0 ? 2 : 1;
  if (Math.abs(dx) + Math.abs(dy) < 28) return (last = last & 16 ? toward : toward | 16);
  return (last = (Math.abs(dx) > 10 ? (dx > 0 ? 8 : 4) : 0) | (Math.abs(dy) > 10 ? (dy > 0 ? 2 : 1) : 0));
}; }`;

async function duel(): Promise<void> {
  const name = "2 players, Tower of Winds";
  console.log(`\n${name}`);
  const t0 = Date.now();
  const a = await open("create&autostart=2&name=Alice&arena=2&hearts=2&wins=1&time=0", "A");
  const code = await roomCode(a);
  await shot(a, "online-room.png");
  const b = await open(`join=${code}&name=Bob`, "B");
  await Promise.all([waitMatch(a, 1), waitMatch(b, 1)]);
  await setScript(a, CHASE);
  await setScript(b, TURN_AWAY);
  await a.waitForFunction(() => (window as unknown as Win).fso.online!.game!.battle.phase === "play", { timeout: 20_000, polling: 50 });
  await a.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { code: "Backquote" }))); // the stats overlay
  await sleep(1000);
  await shot(a, "online-duel-stats-A.png");
  let spectator: Page | null = null;
  for (;;) {
    const [sa, sb] = await Promise.all([status(a), status(b)]);
    if (!spectator && sa.phase === "play" && sa.frame > 300) {
      spectator = await open(`join=${code}&spectate&name=Sam`, "S");
      await waitMatch(spectator, 1);
    }
    if (sa.results && sb.results && spectator && (await status(spectator)).results) break;
    if (Date.now() - t0 > 90_000) {
      problems.push(`${name}: no results after 90 s (${sa.phase}, hearts ${sa.hearts.join("/")})`);
      break;
    }
    await sleep(250);
  }
  const pages = [a, b, spectator!];
  const st = await Promise.all(pages.map(status));
  for (const [i, s] of st.entries()) {
    report("ABS"[i]!, s);
    if (!/P1 WINS!/.test(s.results ?? "")) problems.push(`${name}: page ${"ABS"[i]} shows "${s.results}"`);
    if (s.stats && s.stats.desyncs > 0) problems.push(`${name}: desync on ${"ABS"[i]}`);
  }
  if (st[0]!.hearts[1] !== 0 || st[0]!.stars.join() !== "1,0") problems.push(`${name}: P2 not knocked out (${JSON.stringify(st[0])})`);
  await compareFinals(name, pages);
  for (const [i, page] of pages.entries()) await shot(page, `online-duel-${"ABS"[i]}.png`);

  // Rematch in the same room; P2 closes his tab mid-round.
  console.log(`\n${name}: rematch, P2 leaves mid-round`);
  await a.$eval("#online-rematch", (el) => (el as HTMLButtonElement).click()); // (page.click waits for a render, and A is a background tab)
  await Promise.all(pages.map((p) => waitMatch(p, 2)));
  await setScript(a, `(frame, g) => 0`); // nobody gets hurt: the round only ends because P2 leaves
  await a.waitForFunction(() => (window as unknown as Win).fso.online!.game?.battle.phase === "play" && (window as unknown as Win).fso.online!.game!.battle.fighters.length === 2, { timeout: 20_000, polling: 50 });
  await sleep(1500);
  const before = await status(a);
  if (before.results) problems.push(`${name}: results still shown in the rematch`);
  await shot(b, "online-rematch-B.png");
  const closedAt = Date.now();
  await b.close({ runBeforeUnload: true });
  const left = await a
    .waitForFunction(() => (window as unknown as Win).fso.online!.log.find((e) => e.type === "disconnected"), { timeout: 10_000, polling: 50 })
    .then((h) => h.jsonValue() as unknown as Promise<{ reason: string; frame: number }>)
    .catch(() => null);
  if (!left) problems.push(`${name}: A never saw B leave`);
  else console.log(`  B closed its tab: A saw it ${Date.now() - closedAt} ms later (${left.reason}, after frame ${left.frame})`);
  await a.waitForFunction(() => document.getElementById("online-banner")!.textContent!.includes("left"), { timeout: 5000, polling: 50 }).catch(() => problems.push(`${name}: no "left" banner`));
  await shot(a, "online-left-A.png");
  const rest = [a, spectator!];
  // "Everyone else left" shows at once; the results replace it once the round's end is final.
  await Promise.all(rest.map((p) => p.waitForFunction(() => !document.getElementById("online-results")!.hidden && /WINS!/.test(document.getElementById("online-results-title")!.textContent!), { timeout: 30_000, polling: 100 }))).catch(() =>
    problems.push(`${name}: no results after P2 left`),
  );
  const st2 = await Promise.all(rest.map(status));
  for (const [i, s] of st2.entries()) {
    report("AS"[i]!, s);
    if (!/P1 WINS!/.test(s.results ?? "")) problems.push(`${name} rematch: page ${"AS"[i]} shows "${s.results}"`);
    if (s.modes[1] !== "dead" || s.hearts[1] !== 0) problems.push(`${name} rematch: P2's Link still in (${s.modes[1]}, ${s.hearts[1]})`);
  }
  await compareFinals(`${name} rematch`, rest);
  await shot(spectator!, "online-rematch-S.png");
  for (const page of rest) await page.close();
}

async function four(): Promise<void> {
  const name = "4 players, 60±30 ms, 10% loss";
  console.log(`\n${name}`);
  const net = "&lag=60&jitter=30&loss=0.1";
  const t0 = Date.now();
  const a = await open(`create&autostart=4&players=4&name=A&arena=0&hearts=4&wins=3&time=20${net}`, "A");
  const code = await roomCode(a);
  const pages = [a];
  for (const who of ["B", "C", "D"]) pages.push(await open(`join=${code}&name=${who}${net}`, who));
  await Promise.all(pages.map((p) => waitMatch(p, 1)));
  for (const [i, page] of pages.entries()) await setScript(page, `(${BRAWL})(${i})`);
  // Mid-round (6 s into it), D closes his tab.
  await a.waitForFunction(() => { const g = (window as unknown as Win).fso.online!.game; return !!g && g.battle.phase === "play" && g.battle.round === 1 && g.tick > 409 + 360; }, { timeout: 60_000, polling: 100 }); // (no game yet between matches)
  await shot(pages[3]!, "online-four-D.png");
  // C's packets all get lost for 1.5 s: the others wait for him ("interrupted"), then go on ("resumed").
  await pages[2]!.evaluate(() => void ((window as unknown as { fso: { online: { current: { net: { lossy: { impairment: { loss: number } } } } } } }).fso.online.current.net.lossy.impairment.loss = 1));
  await a.waitForFunction(() => document.getElementById("online-banner")!.textContent!.startsWith("Waiting for P3"), { timeout: 5000, polling: 50 }).catch(() => problems.push(`${name}: no "Waiting for P3" banner`));
  await shot(a, "online-four-waiting-A.png");
  await sleep(700);
  await pages[2]!.evaluate(() => void ((window as unknown as { fso: { online: { current: { net: { lossy: { impairment: { loss: number } } } } } } }).fso.online.current.net.lossy.impairment.loss = 0.1));
  await sleep(1500);
  for (const [i, page] of pages.entries()) {
    const events = (await status(page)).log;
    const expect = i === 2 ? [] : ["interrupted P3", "resumed P3"];
    for (const e of expect) if (!events.includes(e)) problems.push(`${name}: ${"ABCD"[i]} has no "${e}" event (${events.join(", ")})`);
  }
  const mid = await Promise.all(pages.map(status));
  for (const [i, s] of mid.entries()) report("ABCD"[i]!, s);
  if (mid[0]!.hearts.every((h) => h === 16)) problems.push(`${name}: nobody got hit in 6 s of brawl`);
  await compareFinals(`${name} (before D leaves)`, pages);
  await pages[3]!.close({ runBeforeUnload: true });
  const rest = pages.slice(0, 3);
  await Promise.all(rest.map((p) => p.waitForFunction(() => (window as unknown as Win).fso.online!.log.some((e) => e.type === "disconnected"), { timeout: 10_000, polling: 50 }))).catch(() =>
    problems.push(`${name}: not everyone saw D leave`),
  );
  await shot(a, "online-four-left-A.png");
  // The round goes on to its time limit (20 s), then the next one starts without D.
  const roundTwo = async (p: Page) => {
    for (const until = Date.now() + 90_000; Date.now() < until; await sleep(250)) {
      const round = await p.evaluate(() => (window as unknown as Win).fso.online?.game?.battle.round ?? 0);
      if (round >= 2) return;
    }
    throw new Error("90 s");
  };
  await Promise.all(rest.map(roundTwo)).catch((e: Error) =>
    problems.push(`${name}: round 1 never ended (${e.message.split("\n")[0]})`),
  );
  await sleep(1000);
  for (const page of rest) await setScript(page, `(frame, g) => 0`);
  await sleep(1500); // let the last inputs settle everywhere
  const st = await Promise.all(rest.map(status));
  for (const [i, s] of st.entries()) {
    report("ABC"[i]!, s);
    if (s.modes[3] !== "dead" || s.hearts[3] !== 0) problems.push(`${name}: D's Link still in on ${"ABC"[i]} (${s.modes[3]})`);
    if (s.stats && s.stats.desyncs > 0) problems.push(`${name}: desync on ${"ABC"[i]}`);
    if (!s.peers.some((p) => p.rtt >= 60)) problems.push(`${name}: RTTs look unimpaired ${JSON.stringify(s.peers)}`);
  }
  await compareFinals(name, rest);
  await shot(a, "online-four-A.png");
  console.log(`  took ${Math.round((Date.now() - t0) / 1000)} s`);
  for (const page of rest) await page.close();
}

async function desync(): Promise<void> {
  const name = "forced desync";
  console.log(`\n${name}`);
  const a = await open("create&autostart=2&name=A&arena=1", "X", /desync/);
  const b = await open(`join=${await roomCode(a)}&name=B`, "Y", /desync/);
  await Promise.all([waitMatch(a, 1), waitMatch(b, 1)]);
  await b.waitForFunction(() => (window as unknown as Win).fso.online!.game!.tick > 60, { polling: 50 });
  await b.evaluate(() => void ((window as unknown as Win).fso.online!.game!.players[0]!.x += 4 * 256)); // B's P1 is 4 px off
  const seen = await Promise.all(
    [a, b].map((p) => p.waitForFunction(() => (window as unknown as Win).fso.online!.log.find((e) => e.type === "desync"), { timeout: 10_000, polling: 50 }).then(() => true, () => false)),
  );
  if (!seen.every(Boolean)) problems.push(`${name}: desync not reported on ${seen.map((x, i) => (x ? "" : "AB"[i])).join("")}`);
  await shot(a, "online-desync-A.png"); // (a background tab doesn't draw its overlays: bring it to the front first)
  const overlay = await a.evaluate(() => ({ shown: !document.getElementById("netstats")!.hidden, text: document.getElementById("netstats")!.textContent!, banner: document.getElementById("online-banner")!.textContent }));
  console.log(`  A: banner "${overlay.banner}", stats overlay ${overlay.shown ? "shown" : "hidden"}: ${overlay.text.split("\n").find((l) => l.startsWith("DESYNC"))}`);
  if (!overlay.shown || !/DESYNC with P2/.test(overlay.text) || !/Desync/.test(overlay.banner ?? "")) problems.push(`${name}: no warning on A (${JSON.stringify(overlay)})`);
  for (const page of [a, b]) await page.close();
}

async function cpus(): Promise<void> {
  const name = "2 players and 2 CPUs, Tower of Flames, 40±20 ms, 5% loss";
  console.log(`\n${name}`);
  const t0 = Date.now();
  const net = "&lag=40&jitter=20&loss=0.05";
  // The host picks the CPUs in the room's settings; the guest sees them in the room.
  const a = await open(`create&name=A&arena=1&hearts=2&wins=1&time=0${net}`, "CA");
  const code = await roomCode(a);
  await a.select("#online-cpus", "2");
  await a.select("#online-cpu-level", "2"); // hard
  const b = await open(`join=${code}&name=B${net}`, "CB");
  const rows = await b
    .waitForFunction(() => [...document.querySelectorAll("#online-players li")].filter((li) => /CPU/.test(li.textContent!)).length === 2 && document.querySelectorAll("#online-players li:not(.open)").length === 4, { timeout: 10_000, polling: 50 })
    .then(() => b.evaluate(() => [...document.querySelectorAll("#online-players li")].map((li) => li.textContent)))
    .catch(() => null);
  if (!rows) problems.push(`${name}: the guest doesn't see the 2 CPUs in the room`);
  else console.log(`  the guest's room: ${rows.join(" | ")}`);
  await shot(b, "online-cpus-room-B.png");
  await click(a, "#online-start");
  await Promise.all([waitMatch(a, 1), waitMatch(b, 1)]);
  const cpusOf = (page: Page) => page.evaluate(() => (window as unknown as Win).fso.online!.game!.battle.cpus?.map((c) => `P${c.player + 1} ${c.level}`).join(", ") ?? "none");
  const levels = await Promise.all([a, b].map(cpusOf));
  console.log(`  CPUs: ${levels.join(" / ")}`);
  if (levels.some((l) => l !== "P3 hard, P4 hard")) problems.push(`${name}: CPUs ${JSON.stringify(levels)}`);
  // The names over the Links at the round's start (nametags.ts).
  for (const [page, want] of [[a, "P1You|P2B|P3CPUhard|P4CPUhard"], [b, "P1A|P2You|P3CPUhard|P4CPUhard"]] as const) {
    const t = await nameTags(page);
    console.log(`  name tags at the start: ${t.tags.join(" | ")} (${t.shown ? "shown" : "hidden"})`);
    if (!t.shown || t.tags.join("|") !== want) problems.push(`${name}: the name tags at the start are ${JSON.stringify(t)}, not ${want}`);
  }
  await setScript(a, `(${BRAWL})(0)`);
  await setScript(b, `(${BRAWL})(1)`);
  let spectator: Page | null = null;
  for (;;) {
    const [sa, sb] = await Promise.all([status(a), status(b)]);
    if (!spectator && sa.phase === "play" && sa.frame > COUNTDOWN + 300) {
      spectator = await open(`join=${code}&spectate&name=S`, "CS");
      await waitMatch(spectator, 1);
      // Well into the fight: the names have faded; the spectator's name the players, no "You".
      const [ta, ts] = [await nameTags(a), await nameTags(spectator, true)];
      console.log(`  name tags mid-fight: A ${ta.shown ? "shown" : "faded"}; spectator ${ts.tags.join(" | ")}`);
      if (ta.shown && (await status(a)).phase === "play") problems.push(`${name}: the name tags are still up mid-fight`);
      if (ts.tags.join("|") !== "P1A|P2B|P3CPUhard|P4CPUhard") problems.push(`${name}: the spectator's name tags are ${ts.tags.join("|")}`);
    }
    if (sa.results && sb.results && spectator && (await status(spectator)).results) break;
    if (Date.now() - t0 > 150_000) {
      problems.push(`${name}: no results after 150 s (${sa.phase}, hearts ${sa.hearts.join("/")})`);
      break;
    }
    await sleep(250);
  }
  const pages = [a, b, spectator!];
  const st = await Promise.all(pages.map(status));
  for (const [i, s] of st.entries()) {
    report("ABS"[i]!, s);
    if (!/WINS!/.test(s.results ?? "")) problems.push(`${name}: page ${"ABS"[i]} shows "${s.results}"`);
    if (s.stats && s.stats.desyncs > 0) problems.push(`${name}: desync on ${"ABS"[i]}`);
  }
  const standings = await a.evaluate(() => document.getElementById("online-standings")!.textContent);
  console.log(`  results: "${st[0]!.results}"; standings ${standings}`);
  if (!/CPU \(hard\)/.test(standings ?? "")) problems.push(`${name}: the standings don't name the CPUs (${standings})`);
  await compareFinals(name, pages);
  for (const [i, page] of pages.entries()) await shot(page, `online-cpus-${"ABS"[i]}.png`);
  console.log(`  took ${Math.round((Date.now() - t0) / 1000)} s`);
  for (const page of pages) await page.close();
}

/**
 * Rejoining (docs/netcode.md "Rejoining"): 3 players brawl, P3 reloads his page mid-round and comes back into his slot
 * (a snapshot from P1), his Link back in from the next round; every page's hashes identical on every frame from the
 * rejoiner's snapshot on (and P1's and P2's on all of them). `hash` adds to every page's link (`transport=relay`: the
 * relay only); `lobbyDrop`: then P3's lobby connection drops and the page rejoins again by itself.
 */
async function rejoin(label: string, hash: string, lobbyDrop: boolean): Promise<void> {
  const name = `3 players, P3 rejoins (${label})`;
  console.log(`\n${name}`);
  const t0 = Date.now();
  const a = await open(`create&autostart=3&players=3&name=A&arena=0&hearts=4&wins=5&time=10${hash}`, "RA");
  const code = await roomCode(a);
  const b = await open(`join=${code}&name=B${hash}`, "RB");
  const c = await open(`join=${code}&name=C${hash}`, "RC");
  const pages = [a, b, c];
  await Promise.all(pages.map((p) => waitMatch(p, 1)));
  for (const [i, page] of pages.entries()) await setScript(page, `(${BRAWL})(${i})`);
  // (Polled from here: a wait longer than the browser's 30 s protocol timeout fails.)
  const inPlay = async (page: Page, round: number, after = 0) => {
    for (const until = Date.now() + 120_000; Date.now() < until; await sleep(250)) {
      const ok = await page.evaluate((r, t) => { const g = (window as unknown as Win).fso.online?.game; return !!g && g.battle.phase === "play" && g.battle.round >= r && g.battle.phaseTick > t; }, round, after);
      if (ok) return;
    }
    throw new Error(`not in round ${round} after 120 s`);
  };
  const back = async (what: string, round: number) => {
    // Back in: the session started from a snapshot, the others saw the rejoin; his Link fights from the next round.
    await c.waitForFunction(() => { const w = window as unknown as Win & { dropped?: unknown }, n = w.fso.online?.current?.net; return !!n && n !== w.dropped && n.match === 1 && n.localPlayer === 2 && !!n.session; }, { timeout: 20_000, polling: 50 }).catch(() => problems.push(`${name}: P3 never got back in after the ${what}`));
    const since = Date.now();
    await setScript(c, `(${BRAWL})(2)`);
    for (const page of [a, b]) {
      await page.waitForFunction((n) => (window as unknown as Win).fso.online!.log.filter((e) => e.type === "rejoined" && e.player === 2).length >= n, { timeout: 10_000, polling: 50 }, round).catch(() => problems.push(`${name}: no "rejoined P3" event after the ${what}`));
    }
    const first = await c.evaluate(() => Math.min(...(window as unknown as Win).fso.online!.finals.keys()));
    console.log(`  P3 back ${Math.round((Date.now() - t0) / 100) / 10} s in, from frame ${first} (the snapshot's)`);
    await Promise.all(pages.map((p) => inPlay(p, round + 1, 60))).catch((e: Error) => problems.push(`${name}: round ${round + 1} never started after the ${what} (${e.message.split("\n")[0]})`));
    const st = await Promise.all(pages.map(status));
    for (const [i, s] of st.entries()) {
      report(`R${"ABC"[i]}`, s);
      if (s.modes[2] === "dead" && s.hearts[2] === 0 && s.round === round + 1) problems.push(`${name}: P3's Link still out in round ${s.round} on ${"ABC"[i]}`);
    }
    console.log(`  round ${round + 1} with P3 in (${Math.round((Date.now() - since) / 1000)} s after the rejoin)`);
    return first;
  };

  // Mid-round 1, P3 reloads his page: the others cut him, then he comes back with his key.
  await inPlay(a, 1, 240);
  await c.reload({ waitUntil: "domcontentloaded" });
  await waitReady(c, (m) => (window as unknown as Win).fso?.mode === m, 60_000, "online");
  let first = await back("reload", 1);
  if (lobbyDrop) {
    await compareFinals(`${name}, everyone from frame ${first} (before the lost lobby connection)`, pages, undefined, first);
    // Mid-round 2, P3's lobby connection drops: the page rejoins by itself.
    await inPlay(a, 2, 240);
    await c.evaluate(() => {
      const w = window as unknown as { dropped: unknown; fso: { online: { lobby: { close(): void }; current: { net: unknown } } } };
      w.dropped = w.fso.online.current.net; // (the match it drops out of)
      w.fso.online.lobby.close();
    });
    first = await back("lost lobby connection", 2);
  }
  await sleep(1000);
  for (const page of pages) await setScript(page, `(frame, g) => 0`);
  await sleep(1500); // let the last inputs settle everywhere
  const st = await Promise.all(pages.map(status));
  for (const [i, s] of st.entries()) {
    if (s.stats && s.stats.desyncs > 0) problems.push(`${name}: desync on ${"ABC"[i]}`);
    if ((s.stats?.hashChecks ?? 0) < 3) problems.push(`${name}: ${"ABC"[i]} compared ${s.stats?.hashChecks} hashes`);
  }
  await compareFinals(`${name}, P1 and P2`, [a, b]);
  await compareFinals(`${name}, everyone from frame ${first}`, pages, undefined, first);
  await shot(c, `online-rejoin-${label.replace(/\W+/g, "-")}-C.png`);
  console.log(`  took ${Math.round((Date.now() - t0) / 1000)} s`);
  for (const page of pages) await page.close();
}

type Lossy = { lossy: { impairment: { cut?: string[] } } };
const memberId = (page: Page) => page.evaluate(() => String((window as unknown as { fso: { online: { lobby: { you: number } } } }).fso.online.lobby.you));
/** The page drops every packet to these members from now on (its running match's impairment). */
const cut = (page: Page, peers: string[]) => page.evaluate((ids) => void ((window as unknown as { fso: { online: { current: { net: Lossy } } } }).fso.online.current.net.lossy.impairment.cut = ids), peers);
const disconnects = (page: Page) =>
  page.evaluate(() => (window as unknown as Win).fso.online!.log.filter((e) => e.type === "disconnected").map((e) => `P${e.player! + 1} ${e.reason}`));

/** When each page last dropped out of its match by itself (the others cut it, or its side of a split lost), or null. */
const lastDrop = (page: Page) => page.evaluate(() => (window as unknown as { fso: { online: { lastDrop: { how: string } | null } } }).fso.online.lastDrop?.how ?? null);
/** Remembers the page's running match (`window.first`), for backIn. */
const markMatch = (page: Page) => page.evaluate(() => void ((window as unknown as Win & { first?: unknown }).first = (window as unknown as Win).fso.online!.current!.net));
/** Waits until `page` plays match `match` again as `player`, in another net match than the one markMatch saw. */
const backIn = (page: Page, match: number, player: number, timeout = 25_000) =>
  page.waitForFunction(
    (m, p) => { const w = window as unknown as Win & { first?: unknown }, n = w.fso.online?.current?.net; return !!n && n !== w.first && n.match === m && n.localPlayer === p && !!n.session; },
    { timeout, polling: 100 },
    match,
    player,
  );

/**
 * Arbitrated disconnects (docs/netcode.md "Disconnects"): 4 players brawl, and mid-round the link between P3 and P4
 * goes down (each page drops every packet to the other) while both still reach P1 and P2. P1, the arbiter, cuts P4
 * alone (the higher of the two) once its grace is over; P1, P2 and P3 play on with identical hashes, and P4 learns he
 * was cut: he drops out and rejoins by himself in his slot (a new member id: the cut link was the old one's).
 */
async function partition(): Promise<void> {
  const name = "4 players, the link between P3 and P4 cut";
  console.log(`\n${name}`);
  const t0 = Date.now();
  const a = await open(`create&autostart=4&players=4&name=A&arena=0&hearts=4&wins=3&time=30&loss=0`, "PA");
  const code = await roomCode(a);
  const pages = [a];
  for (const who of ["B", "C", "D"]) pages.push(await open(`join=${code}&name=${who}&loss=0`, `P${who}`));
  await Promise.all(pages.map((p) => waitMatch(p, 1)));
  for (const [i, page] of pages.entries()) await setScript(page, `(${BRAWL})(${i})`);
  await a.waitForFunction(() => { const g = (window as unknown as Win).fso.online!.game; return !!g && g.battle.phase === "play" && g.tick > 409 + 240; }, { timeout: 60_000, polling: 100 });
  const [c, d] = [pages[2]!, pages[3]!];
  const [cId, dId] = [await memberId(c), await memberId(d)];
  await markMatch(d);
  await cut(c, [dId]);
  await cut(d, [cId]);
  const cutAt = Date.now();
  const rest = pages.slice(0, 3);
  for (const [i, page] of rest.entries()) {
    await page.waitForFunction(() => (window as unknown as Win).fso.online!.log.some((e) => e.type === "disconnected"), { timeout: 15_000, polling: 50 }).catch(() => problems.push(`${name}: ${"ABC"[i]} never cut anyone`));
  }
  console.log(`  P4 cut ${Math.round((Date.now() - cutAt) / 100) / 10} s after the link went down`);
  await d.waitForFunction(() => (window as unknown as { fso: { online: { lastDrop: { how: string } | null } } }).fso.online.lastDrop?.how === "cut", { timeout: 10_000, polling: 50 }).catch(() => problems.push(`${name}: P4 never learned he was cut`));
  await backIn(d, 1, 3).catch(() => problems.push(`${name}: P4 didn't rejoin by himself`));
  for (const [i, page] of rest.entries()) {
    await page.waitForFunction(() => (window as unknown as Win).fso.online!.log.some((e) => e.type === "rejoined" && e.player === 3), { timeout: 10_000, polling: 50 }).catch(() => problems.push(`${name}: ${"ABC"[i]} never saw P4 back`));
  }
  console.log(`  P4 back in his slot ${Math.round((Date.now() - cutAt) / 100) / 10} s after the link went down`);
  await sleep(3000); // the four play on
  for (const page of pages) await setScript(page, `(frame, g) => 0`);
  await sleep(1500);
  for (const [i, page] of rest.entries()) {
    const cuts = await disconnects(page), s = await status(page);
    report(`P${"ABC"[i]}`, s);
    if (cuts.join() !== (i === 2 ? "P4 timeout" : "P4 reported")) problems.push(`${name}: ${"ABC"[i]} cut ${JSON.stringify(cuts)}, not P4 alone`);
    if (s.stats && s.stats.desyncs > 0) problems.push(`${name}: desync on ${"ABC"[i]}`);
    if (await lastDrop(page)) problems.push(`${name}: ${"ABC"[i]} dropped out too`);
  }
  report("PD", await status(d));
  await compareFinals(name, rest);
  const first = await d.evaluate(() => Math.min(...(window as unknown as Win).fso.online!.finals.keys()));
  await compareFinals(`${name}, everyone from P4's snapshot (frame ${first})`, pages, undefined, first);
  await shot(d, "online-partition-D.png");
  console.log(`  took ${Math.round((Date.now() - t0) / 1000)} s`);
  for (const page of pages) await page.close();
}

/**
 * A 2–2 split (docs/netcode.md "Disconnects", "Splits"): 4 players brawl, and mid-round P1 and P2 stop hearing P3 and
 * P4 (every page drops every packet to the other half) while all four still reach the lobby. Neither half is a
 * majority: the lobby referees the tie, the half that claims first plays on and cuts the other, whose pages drop out
 * ("split") and rejoin by themselves in their slots (new member ids: the cut links were the old ones'). One match at
 * every moment: the winners never drop out, and in the end all four play it, hashes identical from the rejoins on.
 */
async function split(): Promise<void> {
  const name = "4 players, split 2–2";
  console.log(`\n${name}`);
  const t0 = Date.now();
  const a = await open(`create&autostart=4&players=4&name=A&arena=0&hearts=4&wins=3&time=30&loss=0`, "SA");
  const code = await roomCode(a);
  const pages = [a];
  for (const who of ["B", "C", "D"]) pages.push(await open(`join=${code}&name=${who}&loss=0`, `S${who}`));
  await Promise.all(pages.map((p) => waitMatch(p, 1)));
  for (const [i, page] of pages.entries()) await setScript(page, `(${BRAWL})(${i})`);
  await a.waitForFunction(() => { const g = (window as unknown as Win).fso.online!.game; return !!g && g.battle.phase === "play" && g.tick > 409 + 240; }, { timeout: 60_000, polling: 100 });
  const ids = await Promise.all(pages.map(memberId));
  for (const page of pages) await markMatch(page);
  for (const [i, page] of pages.entries()) await cut(page, i < 2 ? ids.slice(2) : ids.slice(0, 2));
  const splitAt = Date.now();
  // One half drops out (its side lost the tie)…
  let losers: number[] = [];
  for (const until = Date.now() + 20_000; Date.now() < until && losers.length < 2; await sleep(100)) {
    losers = (await Promise.all(pages.map(lastDrop))).flatMap((how, i) => (how ? [i] : []));
  }
  const how = await Promise.all(pages.map(lastDrop));
  console.log(`  ${Math.round((Date.now() - splitAt) / 100) / 10} s after the split: drops ${JSON.stringify(how)}`);
  const winners = [0, 1, 2, 3].filter((i) => !losers.includes(i));
  if (losers.join() !== "0,1" && losers.join() !== "2,3") problems.push(`${name}: pages ${losers.join()} dropped out (${JSON.stringify(how)}), not one half`);
  for (const i of losers) if (how[i] !== "split") problems.push(`${name}: page ${"ABCD"[i]} dropped out as "${how[i]}"`);
  // …and comes back into the match, which the other half played on.
  for (const i of losers) await backIn(pages[i]!, 1, i).catch(() => problems.push(`${name}: page ${"ABCD"[i]} didn't rejoin by itself`));
  for (const i of winners) {
    for (const p of losers) {
      await pages[i]!.waitForFunction((player) => (window as unknown as Win).fso.online!.log.some((e) => e.type === "rejoined" && e.player === player), { timeout: 10_000, polling: 50 }, p).catch(() => problems.push(`${name}: ${"ABCD"[i]} never saw P${p + 1} back`));
    }
  }
  console.log(`  P${losers.map((p) => p + 1).join(" and P")} back in their slots ${Math.round((Date.now() - splitAt) / 100) / 10} s after the split`);
  await sleep(3000); // the four play on
  for (const page of pages) await setScript(page, `(frame, g) => 0`);
  await sleep(1500);
  for (const [i, page] of pages.entries()) {
    const s = await status(page);
    report(`S${"ABCD"[i]}`, s);
    if (s.stats && s.stats.desyncs > 0) problems.push(`${name}: desync on ${"ABCD"[i]}`);
    if (s.match !== 1 || s.local !== i) problems.push(`${name}: ${"ABCD"[i]} plays match ${s.match} as P${s.local + 1}`);
    if (winners.includes(i)) {
      const cuts = (await disconnects(page)).sort().join();
      if (cuts !== losers.map((p) => `P${p + 1} timeout`).join()) problems.push(`${name}: ${"ABCD"[i]} cut ${cuts}`);
      if (await lastDrop(page)) problems.push(`${name}: ${"ABCD"[i]} dropped out of the half that went on`);
    }
  }
  await compareFinals(`${name}, the half that went on`, winners.map((i) => pages[i]!));
  const first = Math.max(...(await Promise.all(losers.map((i) => pages[i]!.evaluate(() => Math.min(...(window as unknown as Win).fso.online!.finals.keys()))))));
  await compareFinals(`${name}, everyone from the rejoins (frame ${first})`, pages, undefined, first);
  await shot(pages[losers[0] ?? 3]!, "online-split.png");
  console.log(`  took ${Math.round((Date.now() - t0) / 1000)} s`);
  for (const page of pages) await page.close();
}

/**
 * Spectators follow another player when P1 goes (docs/netcode.md "Spectators"): 3 players brawl with a spectator
 * watching from the start; mid-round P1 closes his tab, and P2 feeds the spectator from then on: it never shows "The
 * match feed stopped", and its hashes match P2's and P3's on every frame.
 */
async function feed(): Promise<void> {
  const name = "3 players and a spectator, P1 leaves";
  console.log(`\n${name}`);
  const t0 = Date.now();
  const a = await open(`create&players=3&name=A&arena=0&hearts=4&wins=3&time=20`, "FA");
  const code = await roomCode(a);
  const b = await open(`join=${code}&name=B`, "FB");
  const c = await open(`join=${code}&name=C`, "FC");
  const s = await open(`join=${code}&spectate&name=S`, "FS");
  await a.waitForFunction(() => document.querySelectorAll("#online-players li:not(.open)").length === 3 && /S/.test(document.getElementById("online-spectators")!.textContent!), { timeout: 10_000, polling: 50 });
  await click(a, "#online-start");
  const pages = [a, b, c, s];
  await Promise.all(pages.map((p) => waitMatch(p, 1)));
  for (const [i, page] of [a, b, c].entries()) await setScript(page, `(${BRAWL})(${i})`);
  await a.waitForFunction(() => { const g = (window as unknown as Win).fso.online!.game; return !!g && g.battle.phase === "play" && g.tick > 409 + 240; }, { timeout: 60_000, polling: 100 });
  const watched = (await status(s)).frame;
  await a.close({ runBeforeUnload: true });
  const rest = [b, c, s];
  await sleep(6000);
  const after = await status(s);
  const fedBy = await s.evaluate(() => (window as unknown as Win & { fso: { online: { current: { net: { spectator: { host: string } } } } } }).fso.online.current.net.spectator.host);
  const bId = await memberId(b);
  console.log(`  the spectator: frame ${watched} when P1 left, ${after.frame} 6 s later, fed by member ${fedBy} (P2 is ${bId})`);
  if (after.frame < watched + 250) problems.push(`${name}: the spectator stopped (frame ${watched} → ${after.frame})`);
  if (fedBy !== bId) problems.push(`${name}: the spectator is fed by ${fedBy}, not P2 (${bId})`);
  if (after.results && /feed stopped/.test(after.results)) problems.push(`${name}: the spectator shows "${after.results}"`);
  const alone = await s.evaluate(() => document.getElementById("online-results")!.hidden ? "" : document.getElementById("online-results")!.textContent);
  if (/feed stopped/.test(alone ?? "")) problems.push(`${name}: the spectator shows "${alone}"`);
  for (const page of [b, c]) await setScript(page, `(frame, g) => 0`);
  await sleep(2000);
  for (const [i, page] of rest.entries()) report(`F${"BCS"[i]}`, await status(page));
  await compareFinals(name, rest, Math.min(...(await Promise.all(rest.map(status))).map((x) => x.final)));
  await shot(s, "online-feed-S.png");
  console.log(`  took ${Math.round((Date.now() - t0) / 1000)} s`);
  for (const page of rest) await page.close();
}

/** The name tags a page shows (each one's text; `all`: the hidden ones too) and whether they're up, after bringing
 *  it to the front: background tabs don't render. */
async function nameTags(page: Page, all = false): Promise<{ shown: boolean; tags: string[] }> {
  await page.bringToFront();
  await sleep(300);
  return page.evaluate((all) => ({
    shown: !!document.querySelector(".nametags.shown"),
    tags: [...document.querySelectorAll(all ? ".nametag .tag-body" : ".nametag:not([hidden]) .tag-body")].map((t) => t.textContent ?? ""),
  }), all);
}

/** Clicks through JS: page.click waits for a render, which background tabs never do. */
const click = (page: Page, selector: string) => page.$eval(selector, (el) => (el as HTMLElement).click());
const type = (page: Page, selector: string, text: string) =>
  page.$eval(selector, (el, t) => ((el as HTMLInputElement).value = t), text);
const visible = (page: Page, selector: string) => page.waitForFunction((sel) => !(document.querySelector(sel) as HTMLElement).hidden, { timeout: 10_000, polling: 50 }, selector);

async function menus(): Promise<void> {
  const name = "menus";
  console.log(`\n${name}`);
  const a = await open("", "MA", undefined, "menu");
  await click(a, "#play-online");
  await type(a, "#online-name", "Alice");
  await click(a, "#online-create");
  const code = await roomCode(a);
  const b = await open("", "MB", undefined, "menu");
  await click(b, "#play-online");
  await type(b, "#online-name", "Bob");
  await type(b, "#online-code", code.toLowerCase());
  await click(b, "#online-join");
  await visible(b, "#online-room");
  await a.waitForFunction(() => document.querySelectorAll("#online-players li:not(.open)").length === 2, { timeout: 10_000, polling: 50 });
  await a.select("#online-arena", "2");
  await a.select("#online-hearts", "6");
  await b.waitForFunction(() => (document.getElementById("online-arena") as HTMLSelectElement).value === "2" && (document.getElementById("online-hearts") as HTMLSelectElement).value === "6", { timeout: 5000, polling: 50 }).catch(() => problems.push(`${name}: the host's settings didn't reach the guest`));
  const guest = await b.evaluate(() => ({ disabled: (document.getElementById("online-arena") as HTMLSelectElement).disabled, start: document.getElementById("online-start")!.hidden, names: [...document.querySelectorAll("#online-players .who")].map((e) => e.textContent) }));
  if (!guest.disabled || !guest.start || guest.names.join() !== "Alice,Bob,open,open") problems.push(`${name}: guest's room view ${JSON.stringify(guest)}`);
  await shot(b, "online-menus-room-B.png");
  await click(a, "#online-start");
  await Promise.all([waitMatch(a, 1), waitMatch(b, 1)]);
  const arena = await b.evaluate(() => (window as unknown as { fso: { online: { current: { config: { arena: number; hearts: number } } } } }).fso.online.current.config);
  if (arena.arena !== 2 || arena.hearts !== 6) problems.push(`${name}: match config ${JSON.stringify(arena)}`);
  // Esc menu → end the match for everyone → both back in the room.
  await a.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape" })));
  await visible(a, "#online-pause");
  await shot(a, "online-menus-pause-A.png");
  await click(a, "#online-end");
  for (const page of [a, b]) await visible(page, "#online-room");
  // Bob watches instead: Alice can't start alone; Bob plays again, and Alice starts match 2.
  await click(b, "#online-role");
  await a.waitForFunction(() => (document.getElementById("online-start") as HTMLButtonElement).disabled && /Watching: Bob/.test(document.getElementById("online-spectators")!.textContent!), { timeout: 5000, polling: 50 }).catch(() => problems.push(`${name}: Bob didn't become a spectator`));
  await click(b, "#online-role");
  await a.waitForFunction(() => !(document.getElementById("online-start") as HTMLButtonElement).disabled, { timeout: 5000, polling: 50 }).catch(() => problems.push(`${name}: Bob didn't get his slot back`));
  await click(a, "#online-start");
  await Promise.all([waitMatch(a, 2), waitMatch(b, 2)]);
  // Bob leaves from the Esc menu: Alice sees him go at once.
  await b.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape" })));
  await click(b, "#online-quit");
  await visible(b, "#online-connect");
  const left = await a.waitForFunction(() => (window as unknown as Win).fso.online!.log.find((e) => e.type === "disconnected"), { timeout: 5000, polling: 50 }).then((h) => h.jsonValue(), () => null);
  if (!left) problems.push(`${name}: Alice didn't see Bob leave`);
  await a.waitForFunction(() => !document.getElementById("online-results")!.hidden, { timeout: 5000, polling: 50 }).catch(() => problems.push(`${name}: no "everyone else left" screen`));
  await shot(a, "online-menus-alone-A.png");
  console.log(`  menus: room ${code}, settings shared, 2 matches, Bob left (${JSON.stringify(left)})`);
  for (const page of [a, b]) await page.close();
}

// E2E_ONLY=rejoin,duel runs only those scenarios.
const only = process.env.E2E_ONLY?.split(",");
const run = async (key: string, scenario: () => Promise<void>) => {
  if (!only || only.includes(key)) await scenario();
};
try {
  await run("menus", menus);
  await run("duel", duel);
  await run("four", four);
  await run("desync", desync);
  await run("cpus", cpus);
  await run("rejoin", () => rejoin("WebRTC", "", false));
  await run("rejoin", () => rejoin("relay, 40±20 ms, 5% loss, then a lost lobby connection", "&transport=relay&lag=40&jitter=20&loss=0.05", true));
  await run("partition", partition);
  await run("split", split);
  await run("feed", feed);
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
