// The whole site (apps/site: one origin, every page loading the game files from <base>data/) in Chrome and Firefox.
// Builds the site, serves the build with `vite preview` (port 5193, the game files from extracted/ through
// tools/bundle's plugin, /signal proxied to its own lobby server on 5194; E2E_PORT and E2E_SIGNAL_PORT override them),
// then per browser, in a fresh profile:
//   1. home (Shadow Battle's title screen): the game files are there, the game's art drawn from them, the browser
//      checks, the About dialog, and the layout of a phone in landscape (no sideways scroll, 44 px targets);
//   2. Shadow Battle from the home page's "Local Battle": the menu comes up by itself,
//      4 Links on every arena for a moment (the canvas draws), audio starts on a click, P1 walks with the keyboard,
//      Esc back to the menu, P1's Right remapped to G in the Controls dialog (and back to the defaults), the home link;
//   3. the Lake Hylia adventure (Link walks);
//   4. online: /online/#create in one tab, the invite in another, a 2-player match played by scripts: identical
//      state hashes on every final frame, and the route (WebRTC or the relay); again with #transport=relay (the
//      lobby's relay, through the reverse proxy when testing a deployment);
//   5. the data: Shadow Battle opened again takes every game file from the HTTP cache (hashed URLs under
//      <base>data/, only the manifest revalidated), and nothing is kept in the origin's private storage (OPFS);
//   6. with both browsers: Chrome hosts and Firefox joins one online match (V8 and SpiderMonkey must agree).
// Screenshots in out/e2e-site/<browser>/. Real time (no stepping by hand), so it also shows the pages run live.
//   node tools/e2e/src/site.ts [chrome|firefox|all] [--url=http://host/ (test a running site)] [--no-build]
// BASE=/fso/ builds and serves the site under that path (as deployed), the game files then at /fso/data/.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { startSignalServer } from "@fso/signal";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { build, preview } from "vite";
import { leaveMatch, opfsEntries, waitReady } from "./ready.ts";
import { browserPath, type BrowserName } from "./browsers.ts";

const SITE_PORT = Number(process.env.E2E_PORT ?? 5193), SIGNAL_PORT = Number(process.env.E2E_SIGNAL_PORT ?? 5194);
const ROOT = resolve(import.meta.dirname, "../../..");
const SITE_CONFIG = join(ROOT, "apps/site/vite.config.ts");

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const [which = "all"] = args.filter((a) => !a.startsWith("--"));
const urlFlag = args.find((a) => a.startsWith("--url="))?.slice(6);
if (!["chrome", "firefox", "all"].includes(which)) {
  console.error("usage: site [chrome|firefox|all] [--url=http://host/] [--no-build]");
  process.exit(1);
}
const browsers: BrowserName[] = which === "all" ? ["chrome", "firefox"] : [which as BrowserName];
const outRoot = resolve("out/e2e-site");
mkdirSync(outRoot, { recursive: true });

// Shapes read back from the pages (apps/site/src/home.ts, apps/battle/src/main.ts, apps/game/src/main.ts).
type Home = {
  data: string;
  error: string;
  files: number;
  bytes: number;
  art: boolean;
  logo: { mode: string; glints: number; frame: number };
  sky: { mode: string; tick: number; strikes: number; flash: [number, number]; bolts: boolean };
};
type Game = { tick: number; players: { x: number; y: number }[]; battle?: { phase: string; fighters: { hearts: number }[] } };
type Win = Window & {
  fsoHome: Home;
  fso: {
    mode: string;
    game: Game;
    audio: { state: string; contextState: string; stats: { seconds: number; bgm: { notes: number } } | null; error: string | null } | null;
    online: {
      current: { net: { match: number; frame: number; session: { finalizedFrame: number; stats: { rollbacks: number; desyncs: number }; peerInfo(): { id: string }[] } | null; transport: { route(peer: string): string }; localPlayer: number } } | null;
      finals: Map<number, number>;
      script: ((frame: number, state: Game) => number) | null;
      game: Game | null;
    } | null;
  };
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A brawl bot (tools/e2e/src/battle-online.ts): each Link goes for the other, swinging when close.
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

// --- Servers: the production build under vite preview, and a lobby for it. ------------------------------------------
let base = urlFlag ?? `http://localhost:${SITE_PORT}${process.env.BASE ?? "/"}`; // BASE: read by the site's vite.config.ts too
const stops: (() => Promise<void>)[] = [];
if (!urlFlag) {
  process.env.FSO_SIGNAL_PORT = String(SIGNAL_PORT); // apps/site/vite.config.ts proxies /signal there
  if (!flags.has("--no-build")) {
    const t = Date.now();
    await build({ configFile: SITE_CONFIG, logLevel: "warn" });
    console.log(`site built in ${((Date.now() - t) / 1000).toFixed(1)} s`);
  }
  const signal = await startSignalServer({ port: SIGNAL_PORT });
  const server = await preview({ configFile: SITE_CONFIG, preview: { port: SITE_PORT, strictPort: true }, logLevel: "warn" });
  stops.push(() => signal.close(), () => server.close());
  base = `http://localhost:${SITE_PORT}${process.env.BASE ?? "/"}`;
}
console.log(`site ${base}`);

const matrix: Record<string, Record<string, string>> = {};
let failures = 0;
try {
  for (const name of browsers) await runBrowser(name);
  if (browsers.length > 1) await crossBrowser();
} finally {
  for (const stop of stops) await stop().catch(() => {});
}

console.log("\nresults");
const flows = [...new Set(Object.values(matrix).flatMap((r) => Object.keys(r)))];
const columns = Object.keys(matrix);
console.log(`${"flow".padEnd(14)}${columns.map((b) => b.padEnd(48)).join("")}`);
for (const flow of flows) console.log(`${flow.padEnd(14)}${columns.map((b) => (matrix[b]?.[flow] ?? "-").slice(0, 46).padEnd(48)).join("")}`);
if (failures) {
  console.log(`\n${failures} problem(s)`);
  process.exitCode = 1;
}

function launch(name: BrowserName, profile: string): Promise<Browser> {
  return puppeteer.launch({
    browser: name,
    executablePath: browserPath(name),
    headless: true,
    userDataDir: profile,
    defaultViewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
    args: name === "chrome" ? ["--autoplay-policy=no-user-gesture-required"] : [],
    // Firefox: let audio start without a gesture prompt.
    extraPrefsFirefox: { "media.autoplay.default": 0, "media.autoplay.blocking_policy": 0 },
    protocolTimeout: 120_000,
    // A local HTTPS test of the deployment (deploy/Caddyfile with its internal CA): --url=https://localhost:8443/.
    acceptInsecureCerts: true,
  });
}

async function runBrowser(name: BrowserName): Promise<void> {
  console.log(`\n=== ${name}`);
  const out = join(outRoot, name);
  mkdirSync(out, { recursive: true });
  const profile = mkdtempSync(join(outRoot, `profile-${name}-`));
  const results: Record<string, string> = (matrix[name] = {});
  const problems: string[] = [];
  const launched = await launch(name, profile);
  const version = await launched.version();
  console.log(version);
  results.version = version;

  const open = async (path: string, label: string): Promise<Page> => {
    const page = await launched.newPage();
    page.on("console", (m) => {
      const text = m.text();
      if (m.type() === "error" && !/favicon|Failed to load resource.*404/.test(text)) problems.push(`[${label}] console error: ${text}`);
      if (process.env.DEBUG) console.log(`  [${label}] ${m.type()}: ${text}`);
    });
    page.on("pageerror", (e) => problems.push(`[${label}] page error: ${e instanceof Error ? e.message : String(e)}`));
    await page.goto(new URL(path, base).href, { waitUntil: "load" });
    return page;
  };
  const shot = async (page: Page, file: string) => {
    await page.bringToFront();
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await page.screenshot({ path: join(out, file) });
  };
  const flow = async (label: string, run: () => Promise<string>) => {
    const before = problems.length, t = Date.now();
    try {
      const summary = await run();
      const failed = problems.length > before;
      results[label] = `${failed ? "FAIL" : "ok"} ${summary} (${((Date.now() - t) / 1000).toFixed(1)} s)`;
    } catch (error) {
      problems.push(`${label}: ${(error as Error).message.split("\n")[0]}`);
      results[label] = `FAIL ${(error as Error).message.split("\n")[0]}`;
    }
    console.log(`${label}: ${results[label]}`);
    for (const p of problems.slice(before)) console.log(`  ${p}`);
  };
  const check = (ok: boolean, message: string) => {
    if (!ok) problems.push(message);
  };

  try {
    // 1. Home: the game files are on the server; the page fits a phone in landscape.
    const home = await open("", "home");
    await flow("home", async () => {
      await waitReady(home, () => (window as unknown as Win).fsoHome?.data === "ready", 20_000);
      const data = await home.evaluate(() => (window as unknown as Win).fsoHome);
      check(data.files > 100 && data.bytes > 30e6, `home: the manifest lists ${data.files} files, ${data.bytes} bytes`);
      const missing = await home.$$eval("#checks li.missing", (els) => els.map((e) => e.textContent ?? ""));
      check(missing.length === 0, `home: browser checks missing ${missing.join("; ")}`);
      check((await home.$("input[type=file], #drop")) === null, "home: still has a disc import");
      // The title screen's art comes from the game files (the logo, the Link icons).
      await home.waitForFunction(() => (window as unknown as Win).fsoHome.art && document.querySelector(".logo.has-art"), { timeout: 10_000 }).catch(() => {});
      const art = await home.evaluate(() => ({ logo: !!document.querySelector(".logo.has-art"), icons: document.querySelectorAll(".mode .link-icon.art-ready").length }));
      check(art.logo && art.icons === 5, `home: the game's art is missing (logo ${art.logo}, ${art.icons} of 5 mode icons)`);
      check((await home.$$(".mode")).length === 5, "home: not 5 ways to play");
      // The live logo (title-logo.ts: title.blo with title.btk's glint), loaded after the static one; Chrome has WebGL.
      await home.waitForFunction(() => (window as unknown as Win).fsoHome.logo.mode !== "loading", { timeout: 20_000 }).catch(() => {});
      const logo = await home.evaluate(() => (window as unknown as Win).fsoHome.logo);
      console.log(`  live logo: ${logo.mode}`);
      check(logo.mode === "canvas" || (name !== "chrome" && logo.mode === "image"), `home: the live logo is ${logo.mode}`);
      // The title screen's sky (title-sky.ts: its 3D clouds, drifting and lit by lightning), behind everything; without
      // WebGL the static sky art stays. Its clock must run, and the canvas must cover the page.
      await home.waitForFunction(() => (window as unknown as Win).fsoHome.sky.mode !== "loading", { timeout: 20_000 }).catch(() => {});
      const sky0 = await home.evaluate(() => (window as unknown as Win).fsoHome.sky);
      if (sky0.mode === "canvas") {
        await home.waitForFunction((t: number) => (window as unknown as Win).fsoHome.sky.tick > t + 30, { timeout: 10_000 }, sky0.tick).catch(() => {});
        await home.waitForFunction(() => (window as unknown as Win).fsoHome.sky.bolts, { timeout: 20_000 }).catch(() => {});
        const sky = await home.evaluate(() => {
          const s = (window as unknown as Win).fsoHome.sky, r = document.querySelector(".sky-canvas")?.getBoundingClientRect();
          return { ...s, live: !!document.querySelector(".sky.live"), covers: !!r && r.width >= window.innerWidth && r.height >= window.innerHeight };
        });
        console.log(`  live sky: tick ${sky.tick}, ${sky.strikes} strikes, bolts ${sky.bolts}`);
        check(sky.tick > sky0.tick + 30 && sky.live && sky.covers, `home: the live sky isn't running or doesn't cover the page (${JSON.stringify(sky)})`);
        check(sky.bolts, "home: the lightning's bolts didn't load (data.arc)");
      } else {
        const art = await home.evaluate(() => getComputedStyle(document.querySelector(".sky")!, "::before").opacity);
        console.log(`  live sky: ${sky0.mode} (static art opacity ${art})`);
        check(name !== "chrome" && sky0.mode === "image" && art === "1", `home: the live sky is ${sky0.mode} and the static sky's opacity ${art}`);
      }
      await shot(home, "home.png");
      // About opens as a dialog (the checks, the adventure slice), and Esc closes it.
      await home.click('[data-open="about-dialog"]');
      check(await home.$eval("#about-dialog", (d) => (d as HTMLDialogElement).open), "home: About didn't open");
      await shot(home, "home-about.png");
      await home.keyboard.press("Escape");
      check(!(await home.$eval("#about-dialog", (d) => (d as HTMLDialogElement).open)), "home: Esc didn't close About");
      // A phone in landscape (iPhone 14 CSS size): no sideways scroll, and every mode at least 44 px high.
      await home.setViewport({ width: 844, height: 390 });
      const phone = await home.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        smallest: Math.min(...[...document.querySelectorAll(".mode, .extras button")].map((c) => c.getBoundingClientRect().height)),
        below: Math.max(...[...document.querySelectorAll(".mode, .extras button")].map((c) => c.getBoundingClientRect().bottom)) - window.innerHeight,
      }));
      check(phone.overflow <= 0, `home: ${phone.overflow} px of sideways scroll on a phone`);
      check(phone.smallest >= 44, `home: a target is ${phone.smallest} px high on a phone`);
      check(phone.below <= 0, `home: the menu goes ${phone.below} px below a phone's screen`);
      await shot(home, "home-phone.png");
      await home.setViewport({ width: 1280, height: 800 });
      return `${data.files} files, ${(data.bytes / 1e6).toFixed(1)} MB, art drawn; phone: targets ≥ ${phone.smallest.toFixed(0)} px${missing.length ? `, missing: ${missing.join(", ")}` : ""}`;
    });

    // 2. Shadow Battle through the home page's "Local Battle".
    await flow("battle", async () => {
      await home.bringToFront();
      await Promise.all([home.waitForNavigation({ waitUntil: "load" }), home.click('a[data-page="battle"]')]);
      const page = home;
      await waitReady(page, () => (window as unknown as Win).fso?.mode === "menu");
      check((await page.$(".fso-home")) !== null, "battle: no home link");
      await shot(page, "battle-menu.png");
      // Audio: a click is the gesture that starts it.
      await page.click("#menu h1");
      await page.waitForFunction(() => ["running", "failed"].includes((window as unknown as Win).fso.audio?.state ?? ""), { timeout: 60_000, polling: 100 });
      // Every arena with 4 Links: the canvas must draw something after a few real frames.
      const blank: number[] = [];
      for (let room = 0; room < 10; room++) {
        await page.click(`.arena[data-room="${room}"]`);
        await page.select("#opt-players", "4");
        await page.click("#start");
        await sleep(350);
        const colors = await canvasColors(page, "#screen");
        if (colors < 16) blank.push(room);
        await leaveMatch(page);
      }
      check(blank.length === 0, `battle: blank canvas on arenas ${blank.join(", ")}`);
      // A 2-player match on the Field; P1 walks right once the countdown is over.
      await page.click('.arena[data-room="0"]');
      await page.select("#opt-players", "2");
      await page.click("#start");
      await page.waitForFunction(() => (window as unknown as Win).fso.game?.battle?.phase === "play", { timeout: 20_000, polling: 50 });
      const x0 = await page.evaluate(() => (window as unknown as Win).fso.game.players[0]!.x);
      const t0 = await page.evaluate(() => (window as unknown as Win).fso.game.tick);
      const w0 = Date.now();
      await page.keyboard.down("KeyD");
      await sleep(600);
      await page.keyboard.up("KeyD");
      const g = await page.evaluate(() => ({ x: (window as unknown as Win).fso.game.players[0]!.x, tick: (window as unknown as Win).fso.game.tick }));
      const rate = ((g.tick - t0) * 1000) / (Date.now() - w0);
      check(g.x > x0 + 256 * 20, `battle: P1 didn't walk right (${x0 / 256} → ${g.x / 256})`);
      check(rate > 50, `battle: the sim ran at ${rate.toFixed(0)} ticks/s`);
      await shot(page, "battle-match.png");
      const audio = await page.evaluate(() => {
        const a = (window as unknown as Win).fso.audio;
        return a ? { state: a.state, context: a.contextState, seconds: a.stats?.seconds ?? 0, notes: a.stats?.bgm.notes ?? 0, error: a.error } : null;
      });
      check(audio?.state === "running" && audio.context === "running" && audio.seconds > 0.5 && audio.notes > 0, `battle: audio ${JSON.stringify(audio)}`);
      // Esc: the game's pause screen (the sim stops), then Choose an Area and Yes back to the menu.
      await page.keyboard.press("Escape");
      const paused = await page.evaluate(() => !!(window as unknown as { fso: { pause: { state: unknown } } }).fso.pause.state);
      await shot(page, "battle-pause.png");
      await leaveMatch(page, async () => {});
      check(paused && (await page.evaluate(() => (window as unknown as Win).fso.mode)) === "menu", `battle: Esc paused ${paused}, then the pause's Choose an Area didn't go back to the menu`);
      // Controls: P1's Right becomes G, then walk with G. M (the mute shortcut) is refused and doesn't mute meanwhile.
      const muted = await page.evaluate(() => (window as unknown as { fso: { audio: { muted: boolean } } }).fso.audio.muted);
      await page.click("#controls-open");
      await page.click('#controls-dialog button.binding[data-column="0"][data-action="Right"]:not(.add)');
      await page.keyboard.press("KeyM");
      const hint = await page.$eval("#controls-hint", (el) => el.textContent ?? "");
      await page.keyboard.press("KeyG");
      await shot(page, "battle-controls.png");
      const bound = await page.$eval('#controls-dialog button.binding[data-column="0"][data-action="Right"]:not(.add)', (el) => el.textContent);
      check(bound === "G" && hint.includes("taken"), `battle: Right bound to ${bound} (hint "${hint}")`);
      check((await page.evaluate(() => (window as unknown as { fso: { audio: { muted: boolean } } }).fso.audio.muted)) === muted, "battle: M reached the page while remapping");
      await page.click("#controls-done");
      const listed = await page.$eval("#controls li", (el) => el.textContent ?? "");
      check(listed.includes("W A S G move"), `battle: the menu lists ${listed}`);
      await page.click("#start");
      await page.waitForFunction(() => (window as unknown as Win).fso.game?.battle?.phase === "play", { timeout: 20_000, polling: 50 });
      const r0 = await page.evaluate(() => (window as unknown as Win).fso.game.players[0]!.x);
      await page.keyboard.down("KeyG");
      await sleep(400);
      await page.keyboard.up("KeyG");
      const r1 = await page.evaluate(() => (window as unknown as Win).fso.game.players[0]!.x);
      check(r1 > r0 + 256 * 10, `battle: P1 didn't walk right with G (${r0 / 256} → ${r1 / 256})`);
      await leaveMatch(page);
      await page.click("#controls-open");
      await page.click("#controls-defaults");
      await page.click("#controls-done");
      check((await page.$eval("#controls li", (el) => el.textContent ?? "")).includes("WASD"), "battle: defaults not restored");
      // The home link goes back to the home page.
      await page.mouse.move(40, 20);
      await page.mouse.move(60, 18);
      await Promise.all([page.waitForNavigation({ waitUntil: "load" }), page.click(".fso-home")]);
      await waitReady(page, () => (window as unknown as Win).fsoHome?.data === "ready", 10_000);
      return `10 arenas drawn, walked ${((g.x - x0) / 256).toFixed(0)} px (${((r1 - r0) / 256).toFixed(0)} with G), ${rate.toFixed(0)} ticks/s, audio ${audio?.context} ${audio?.seconds.toFixed(1)} s`;
    });

    // 3. The adventure slice (the home page's About links it).
    await flow("adventure", async () => {
      const page = await open("adventure/", "adventure");
      await waitReady(page, () => document.getElementById("boot")!.hidden && (window as unknown as Win).fso?.game);
      const before = await page.evaluate(() => (window as unknown as Win).fso.game.players[0]!.x);
      await page.keyboard.down("KeyD");
      await sleep(500);
      await page.keyboard.up("KeyD");
      const after = await page.evaluate(() => (window as unknown as Win).fso.game.players[0]!.x);
      check(after > before, `adventure: Link didn't move (${before} → ${after})`);
      const colors = await canvasColors(page, "#screen");
      check(colors >= 16, `adventure: blank canvas (${colors} colors)`);
      await shot(page, "adventure.png");
      await page.close();
      return `walked ${((after - before) / 256).toFixed(0)} px, ${colors} colors`;
    });

    // 4. Online: two tabs, a room by invite, a scripted duel; then again through the lobby's relay only.
    const closeLater: Page[] = [];
    const duel = (transport: string) => async () => {
      const a = await open(`online/#create&autostart=2&arena=2&hearts=6&wins=1&time=0&name=Alice&transport=${transport}`, "A");
      await a.waitForFunction(() => location.pathname.endsWith("/battle/") && (window as unknown as Win).fso?.mode === "online", { timeout: 60_000, polling: 100 });
      await a.waitForFunction(() => (document.getElementById("online-room-code")?.textContent?.length ?? 0) >= 4, { timeout: 20_000, polling: 100 });
      const invite = await a.$eval("#online-invite", (el) => (el as HTMLAnchorElement).href);
      check(invite.includes("/battle/#join="), `online: invite link ${invite}`);
      await shot(a, "online-room.png");
      const b = await open(`${new URL(invite).pathname}${new URL(invite).hash}&name=Bob&transport=${transport}`, "B");
      closeLater.push(a, b);
      const inMatch = (p: Page) => p.waitForFunction(() => (window as unknown as Win).fso?.online?.current?.net.match === 1, { timeout: 60_000, polling: 100 });
      await Promise.all([inMatch(a), inMatch(b)]);
      for (const [i, page] of [a, b].entries()) {
        await page.evaluate((src) => ((window as unknown as Win).fso.online!.script = (0, eval)(src)), `(${BRAWL})(${i})`);
      }
      // Alternate the tab in front (the other one runs in the background, as a real player's other tab would).
      for (let s = 0; s < 8; s++) {
        await (s % 2 ? b : a).bringToFront();
        await sleep(1000);
      }
      const status = (p: Page) =>
        p.evaluate(() => {
          const net = (window as unknown as Win).fso.online!.current!.net;
          const routes = net.session?.peerInfo().map((p) => net.transport.route(p.id)) ?? [];
          return { frame: net.frame, final: net.session?.finalizedFrame ?? 0, rollbacks: net.session?.stats.rollbacks ?? 0, desyncs: net.session?.stats.desyncs ?? 0, routes };
        });
      const [sa, sb] = await Promise.all([status(a), status(b)]);
      const upTo = Math.min(sa.final, sb.final);
      const finals = await Promise.all([a, b].map((p) => p.evaluate((n) => Array.from({ length: n + 1 }, (_, f) => (window as unknown as Win).fso.online!.finals.get(f) ?? -1), upTo)));
      const bad = finals[0]!.findIndex((h, f) => h === -1 || h !== finals[1]![f]);
      check(upTo > 300, `online: only ${upTo} final frames in 8 s`);
      check(bad === -1, `online: hashes differ from frame ${bad}`);
      check(sa.desyncs + sb.desyncs === 0, "online: desync reported");
      const routes = [...sa.routes, ...sb.routes];
      if (transport !== "auto") check(routes.every((r) => r === transport), `online: routes ${routes.join("/")} with transport=${transport}`);
      await shot(a, `online-match-${transport}.png`);
      for (const page of [a, b]) await page.close();
      return `${upTo + 1} frames identical, rollbacks ${sa.rollbacks}/${sb.rollbacks}, route ${routes.join("/")}`;
    };
    await flow("online", duel("auto"));
    for (const page of closeLater.splice(0)) if (!page.isClosed()) await page.close();
    await flow("online-relay", duel("relay"));
    for (const page of closeLater.splice(0)) if (!page.isClosed()) await page.close();

    // 5. The data: a second visit takes the game files from the HTTP cache; nothing is kept in OPFS.
    await flow("data", async () => {
      const t = Date.now();
      const page = await open("battle/#mute", "battle-again");
      await waitReady(page, () => (window as unknown as Win).fso?.mode === "menu");
      const ready = Date.now() - t;
      const loads = await page.evaluate(() =>
        (performance.getEntriesByType("resource") as PerformanceResourceTiming[])
          .filter((e) => e.name.includes("/data/"))
          .map((e) => ({ url: e.name, transfer: e.transferSize, size: e.decodedBodySize })),
      );
      const dir = new URL("data/", base).href;
      const files = loads.filter((l) => !l.url.endsWith("/manifest.json"));
      check(loads.some((l) => l.url === `${dir}manifest.json`), `data: no manifest fetched from ${dir}`);
      check(files.length >= 3 && files.every((l) => l.url.startsWith(dir) && /\?v=[0-9a-f]{16}$/.test(l.url)), `data: file URLs ${files.map((l) => l.url).join(" ")}`);
      const downloaded = files.filter((l) => l.transfer > 0);
      check(downloaded.length === 0, `data: downloaded again instead of from the HTTP cache: ${downloaded.map((l) => l.url.slice(dir.length)).join(", ")}`);
      const stored = await opfsEntries(page);
      check(stored.length === 0, `data: OPFS holds ${stored.join(", ")}`);
      await page.close();
      const bytes = files.reduce((sum, l) => sum + l.size, 0);
      return `${files.length} files (${(bytes / 1e6).toFixed(1)} MB) from the HTTP cache, menu in ${(ready / 1000).toFixed(1)} s, OPFS empty`;
    });
  } finally {
    await launched.close().catch(() => {});
    rmSync(profile, { recursive: true, force: true });
  }
  failures += problems.length;
}

/**
 * Chrome hosts, Firefox joins: one match across two JavaScript engines (V8 and SpiderMonkey), which must step the sim
 * bit-identically.
 */
async function crossBrowser(): Promise<void> {
  console.log("\n=== chrome + firefox");
  const results: Record<string, string> = (matrix["chrome+firefox"] = {});
  const problems: string[] = [];
  const profiles = (["chrome", "firefox"] as const).map((n) => mkdtempSync(join(outRoot, `profile-${n}-`)));
  const [chrome, firefox] = await Promise.all([launch("chrome", profiles[0]!), launch("firefox", profiles[1]!)]);
  const t = Date.now();
  try {
    const open = async (browser: Browser, path: string, label: string) => {
      const page = await browser.newPage();
      page.on("console", (m) => m.type() === "error" && problems.push(`[${label}] console error: ${m.text()}`));
      page.on("pageerror", (e) => problems.push(`[${label}] page error: ${e instanceof Error ? e.message : String(e)}`));
      await page.goto(new URL(path, base).href, { waitUntil: "load" });
      return page;
    };
    const a = await open(chrome, "online/#create&autostart=2&arena=2&hearts=6&wins=1&time=0&name=Chrome", "chrome");
    await a.waitForFunction(() => (document.getElementById("online-room-code")?.textContent?.length ?? 0) >= 4, { timeout: 60_000, polling: 100 });
    const invite = new URL(await a.$eval("#online-invite", (el) => (el as HTMLAnchorElement).href));
    const b = await open(firefox, `${invite.pathname}${invite.hash}&name=Firefox`, "firefox");
    const inMatch = (p: Page) => p.waitForFunction(() => (window as unknown as Win).fso?.online?.current?.net.match === 1, { timeout: 60_000, polling: 100 });
    await Promise.all([inMatch(a), inMatch(b)]);
    for (const [i, page] of [a, b].entries()) await page.evaluate((src) => ((window as unknown as Win).fso.online!.script = (0, eval)(src)), `(${BRAWL})(${i})`);
    await sleep(15_000);
    const status = (p: Page) =>
      p.evaluate(() => {
        const net = (window as unknown as Win).fso.online!.current!.net;
        return { final: net.session?.finalizedFrame ?? 0, rollbacks: net.session?.stats.rollbacks ?? 0, desyncs: net.session?.stats.desyncs ?? 0, routes: net.session?.peerInfo().map((p) => net.transport.route(p.id)) ?? [] };
      });
    const [sa, sb] = await Promise.all([status(a), status(b)]);
    const upTo = Math.min(sa.final, sb.final);
    const finals = await Promise.all([a, b].map((p) => p.evaluate((n) => Array.from({ length: n + 1 }, (_, f) => (window as unknown as Win).fso.online!.finals.get(f) ?? -1), upTo)));
    const bad = finals[0]!.findIndex((h, f) => h === -1 || h !== finals[1]![f]);
    if (upTo < 700) problems.push(`cross-browser: only ${upTo} final frames in 15 s`);
    if (bad !== -1) problems.push(`cross-browser: hashes differ from frame ${bad}`);
    if (sa.desyncs + sb.desyncs) problems.push("cross-browser: desync reported");
    const game = await a.evaluate(() => (window as unknown as Win).fso.online!.game!.battle!.fighters.map((f) => f.hearts));
    results.online = `${problems.length ? "FAIL" : "ok"} ${upTo + 1} frames identical, rollbacks ${sa.rollbacks}/${sb.rollbacks}, route ${[...sa.routes, ...sb.routes].join("/")}, hearts ${game.join("/")} (${((Date.now() - t) / 1000).toFixed(1)} s)`;
  } catch (error) {
    problems.push(`cross-browser: ${(error as Error).message.split("\n")[0]}`);
    results.online = `FAIL ${(error as Error).message.split("\n")[0]}`;
  } finally {
    await Promise.all([chrome.close().catch(() => {}), firefox.close().catch(() => {})]);
    for (const profile of profiles) rmSync(profile, { recursive: true, force: true });
  }
  console.log(`online: ${results.online}`);
  for (const p of problems) console.log(`  ${p}`);
  failures += problems.length;
}

/** Distinct colors on a canvas right after the page's next frame is drawn (read in the same task as the draw). */
function canvasColors(page: Page, selector: string): Promise<number> {
  return page.evaluate(
    (sel) =>
      new Promise<number>((done) =>
        // Registered after the app's own callback for the next frame, so this runs right after it draws.
        requestAnimationFrame(() => {
          const screen = document.querySelector(sel) as HTMLCanvasElement;
          const copy = document.createElement("canvas");
          copy.width = screen.width;
          copy.height = screen.height;
          const ctx = copy.getContext("2d")!;
          ctx.drawImage(screen, 0, 0);
          const pixels = ctx.getImageData(0, 0, copy.width, copy.height).data;
          const seen = new Set<number>();
          for (let i = 0; i < pixels.length; i += 4 * 7) seen.add((pixels[i]! << 16) | (pixels[i + 1]! << 8) | pixels[i + 2]!);
          done(seen.size);
        }),
      ),
    selector,
  );
}
