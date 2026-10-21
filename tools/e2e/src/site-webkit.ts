// The site's main flows in WebKit, the engine of Safari: Safari's own driver needs `safaridriver --enable` (admin
// rights), so this drives Playwright's WebKit build instead (playwright-core 1.59.1: its WebKit revision 2251 is
// the last one built for macOS 14). Install the browser once:
//   PLAYWRIGHT_BROWSERS_PATH=~/.cache/fso-webkit node tools/e2e/node_modules/playwright-core/cli.js install webkit
// then, against a running site (pnpm site:preview, or site.ts's servers, or a deployment):
//   PLAYWRIGHT_BROWSERS_PATH=~/.cache/fso-webkit node tools/e2e/src/site-webkit.ts [url=http://localhost:5191/]
// Checks: the home page finds the game files, Shadow Battle (every arena draws with 4 Links, the AudioWorklet runs, P1
// walks, nothing new in OPFS), the Lake Hylia slice, an online duel
// between two WebKit tabs, and a match hosted by headless Chrome and joined from WebKit (V8 and JavaScriptCore
// must step the sim identically). Screenshots in out/e2e-site/webkit/.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { webkit, type BrowserContext, type Page } from "playwright-core";
import puppeteer, { type Page as ChromePage } from "puppeteer-core";
import { leaveMatch, opfsEntries, waitReady } from "./ready.ts";
import { browserPath } from "./browsers.ts";

const CHROME = browserPath("chrome");
const [base = "http://localhost:5191/"] = process.argv.slice(2);
const out = resolve("out/e2e-site/webkit");
mkdirSync(out, { recursive: true });
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// What the pages expose (apps/site/src/home.ts, apps/battle/src/main.ts, apps/game).
type Net = { match: number; session: { finalizedFrame: number; stats: { desyncs: number }; peerInfo(): { id: string }[] } | null; transport: { route(peer: string): string } };
type Win = Window & {
  fsoHome: { data: string; error: string; files: number; sky: { mode: string; tick: number } };
  fso: {
    mode: string;
    game: { tick: number; players: { x: number }[]; battle: { phase: string; fighters: { hearts: number }[] } };
    audio: { state: string; contextState: string; stats: { seconds: number; bgm: { notes: number } } | null } | null;
    online: { current: { net: Net } | null; finals: Map<number, number>; script: unknown; game: { battle: { fighters: { hearts: number }[] } } | null } | null;
  };
};

const problems: string[] = [];
const results: Record<string, string> = {};
const flow = async (name: string, run: () => Promise<string>) => {
  const before = problems.length, t = Date.now();
  try {
    results[name] = `${await run()} (${((Date.now() - t) / 1000).toFixed(1)} s)`;
  } catch (e) {
    problems.push(`${name}: ${(e as Error).message.split("\n")[0]}`);
    results[name] = (e as Error).message.split("\n")[0]!;
  }
  console.log(`${name}: ${problems.length > before ? "FAIL" : "ok"} ${results[name]}`);
  for (const p of problems.slice(before)) console.log(`  ${p}`);
};
const watch = <P extends Page | ChromePage>(page: P, label: string): P => {
  (page as Page).on("console", (m) => m.type() === "error" && problems.push(`[${label}] console error: ${m.text()}`));
  (page as Page).on("pageerror", (e) => problems.push(`[${label}] page error: ${e.message}`));
  return page;
};
/** Distinct colors on the page's #screen canvas, read right after its next frame is drawn. */
const colors = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<number>((done) =>
        requestAnimationFrame(() => {
          const screen = document.getElementById("screen") as HTMLCanvasElement;
          const c = document.createElement("canvas");
          c.width = screen.width;
          c.height = screen.height;
          const ctx = c.getContext("2d")!;
          ctx.drawImage(screen, 0, 0);
          const px = ctx.getImageData(0, 0, c.width, c.height).data;
          const seen = new Set<number>();
          for (let i = 0; i < px.length; i += 28) seen.add((px[i]! << 16) | (px[i + 1]! << 8) | px[i + 2]!);
          done(seen.size);
        }),
      ),
  );

// Playwright's WebKit may keep OPFS across profiles (a disc the old import flow stored): the pages must add nothing.
let opfsBefore: string[] = [];

async function home(page: Page): Promise<string> {
  await page.goto(base);
  await waitReady(page, () => (window as unknown as Win).fsoHome?.data === "ready", 20_000);
  const missing = await page.$$eval("#checks li.missing", (els) => els.map((e) => e.textContent ?? ""));
  if (missing.length) problems.push(`home: the browser checks miss ${missing.join("; ")}`);
  opfsBefore = await opfsEntries(page);
  // The title screen's live sky (title-sky.ts) runs where WebGL does; else the static sky stays.
  await page.waitForFunction(() => (window as unknown as Win).fsoHome.sky.mode !== "loading", undefined, { timeout: 20_000 }).catch(() => {});
  const sky0 = await page.evaluate(() => (window as unknown as Win).fsoHome.sky);
  if (sky0.mode === "canvas") {
    await page.waitForFunction((t) => (window as unknown as Win).fsoHome.sky.tick > t + 30, sky0.tick, { timeout: 10_000 }).catch(() => {});
    const sky = await page.evaluate(() => (window as unknown as Win).fsoHome.sky);
    if (sky.tick <= sky0.tick + 30) problems.push(`home: the live sky doesn't run (tick ${sky0.tick} → ${sky.tick})`);
  }
  return `${await page.evaluate(() => (window as unknown as Win).fsoHome.files)} game files on the server, sky ${sky0.mode}`;
}

const BRAWL = `(player) => { let last = 0; return (frame, g) => {
  const b = g.battle, me = g.players[player], other = g.players[1 - player];
  if (b.phase !== "play" || b.fighters[player].hearts === 0) return (last = 0);
  let v = Math.imul(Math.floor(frame / 30) + 1, 0x9e3779b1) ^ Math.imul(player + 7, 0x85ebca6b);
  v = Math.imul(v ^ (v >>> 16), 0x7feb352d); v ^= v >>> 15;
  if ((v >>> 0) % 3 === 0 && frame % 30 < 12) return (last = [1, 2, 4, 8][(v >>> 4) % 4]);
  const dx = (other.x - me.x) / 256, dy = (other.y - me.y) / 256;
  const toward = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 8 : 4) : dy > 0 ? 2 : 1;
  if (Math.abs(dx) + Math.abs(dy) < 28) return (last = last & 16 ? toward : toward | 16);
  return (last = (Math.abs(dx) > 10 ? (dx > 0 ? 8 : 4) : 0) | (Math.abs(dy) > 10 ? (dy > 0 ? 2 : 1) : 0));
}; }`;
const status = () => {
  const o = (window as unknown as Win).fso.online!;
  const net = o.current!.net;
  return { final: net.session?.finalizedFrame ?? 0, desyncs: net.session?.stats.desyncs ?? 0, routes: net.session?.peerInfo().map((p) => net.transport.route(p.id)) ?? [], hearts: o.game?.battle.fighters.map((f) => f.hearts) ?? [] };
};
const finals = (n: number) => Array.from({ length: n + 1 }, (_, f) => (window as unknown as Win).fso.online!.finals.get(f) ?? -1);

const profile = mkdtempSync(join(tmpdir(), "fso-webkit-"));
const context: BrowserContext = await webkit.launchPersistentContext(profile, { headless: true, viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
try {
  const page = watch(context.pages()[0] ?? (await context.newPage()), "home");
  await flow("home", () => home(page));

  await flow("battle", async () => {
    await page.goto(new URL("battle/", base).href);
    await waitReady(page, () => (window as unknown as Win).fso?.mode === "menu");
    await page.click("#menu h1");
    await page.waitForFunction(() => ["running", "failed"].includes((window as unknown as Win).fso.audio?.state ?? ""), null, { timeout: 60_000 });
    const blank: number[] = [];
    for (let room = 0; room < 10; room++) {
      await page.click(`.arena[data-room="${room}"]`);
      await page.selectOption("#opt-players", "4");
      await page.click("#start");
      await sleep(350);
      if ((await colors(page)) < 16) blank.push(room);
      if (room === 1) await page.screenshot({ path: join(out, "battle-arena-1.png") });
      await leaveMatch(page);
    }
    if (blank.length) problems.push(`battle: blank canvas on arenas ${blank.join(", ")}`);
    await page.click('.arena[data-room="0"]');
    await page.selectOption("#opt-players", "2");
    await page.click("#start");
    await page.waitForFunction(() => (window as unknown as Win).fso.game?.battle?.phase === "play", null, { timeout: 20_000 });
    const x0 = await page.evaluate(() => (window as unknown as Win).fso.game.players[0]!.x);
    await page.keyboard.down("KeyD");
    await sleep(600);
    await page.keyboard.up("KeyD");
    const x1 = await page.evaluate(() => (window as unknown as Win).fso.game.players[0]!.x);
    if (x1 <= x0 + 256 * 20) problems.push(`battle: P1 didn't walk right (${x0 / 256} → ${x1 / 256})`);
    const audio = await page.evaluate(() => ({ state: (window as unknown as Win).fso.audio?.state, context: (window as unknown as Win).fso.audio?.contextState, seconds: (window as unknown as Win).fso.audio?.stats?.seconds ?? 0 }));
    if (audio.state !== "running" || audio.seconds < 0.5) problems.push(`battle: audio ${JSON.stringify(audio)}`);
    await leaveMatch(page);
    const opfs = await opfsEntries(page);
    if (opfs.join() !== opfsBefore.join()) problems.push(`battle: OPFS went from [${opfsBefore.join(", ")}] to [${opfs.join(", ")}]`);
    return `10 arenas drawn, walked ${((x1 - x0) / 256).toFixed(0)} px, audio ${audio.context} ${audio.seconds.toFixed(1)} s`;
  });

  await flow("adventure", async () => {
    const p = watch(await context.newPage(), "adventure");
    await p.goto(new URL("adventure/", base).href);
    await waitReady(p, () => document.getElementById("boot")!.hidden && !!(window as unknown as Win).fso?.game);
    const a = await p.evaluate(() => (window as unknown as Win).fso.game.players[0]!.x);
    await p.keyboard.down("KeyD");
    await sleep(500);
    await p.keyboard.up("KeyD");
    const b = await p.evaluate(() => (window as unknown as Win).fso.game.players[0]!.x);
    const n = await colors(p);
    if (b <= a || n < 16) problems.push(`adventure: Link ${a} → ${b}, ${n} colors`);
    await p.screenshot({ path: join(out, "adventure.png") });
    await p.close();
    return `walked ${((b - a) / 256).toFixed(0)} px, ${n} colors`;
  });

  await flow("online", async () => {
    const a = watch(await context.newPage(), "A");
    await a.goto(new URL("online/#create&autostart=2&arena=2&hearts=6&wins=1&time=0&name=A", base).href);
    await a.waitForFunction(() => (document.getElementById("online-room-code")?.textContent?.length ?? 0) >= 4, null, { timeout: 60_000 });
    const invite = new URL(await a.$eval("#online-invite", (el) => (el as HTMLAnchorElement).href));
    const b = watch(await context.newPage(), "B");
    await b.goto(`${invite.origin}${invite.pathname}${invite.hash}&name=B`);
    for (const p of [a, b]) await p.waitForFunction(() => (window as unknown as Win).fso?.online?.current?.net.match === 1, null, { timeout: 60_000 });
    for (const [i, p] of [a, b].entries()) await p.evaluate((src) => ((window as unknown as Win).fso.online!.script = (0, eval)(src)), `(${BRAWL})(${i})`);
    await sleep(8000);
    const [sa, sb] = [await a.evaluate(status), await b.evaluate(status)];
    const upTo = Math.min(sa.final, sb.final);
    const [fa, fb] = [await a.evaluate(finals, upTo), await b.evaluate(finals, upTo)];
    const bad = fa.findIndex((h, f) => h === -1 || h !== fb[f]);
    if (upTo < 300 || bad !== -1 || sa.desyncs + sb.desyncs) problems.push(`online: ${upTo + 1} frames, first difference at ${bad}`);
    await a.close();
    await b.close();
    return `${upTo + 1} frames identical, route ${[...sa.routes, ...sb.routes].join("/")}`;
  });

  await flow("chrome+webkit", async () => {
    const chrome = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: mkdtempSync(join(tmpdir(), "fso-chrome-")) });
    try {
      const c = watch(await chrome.newPage(), "chrome");
      await c.goto(new URL("online/#create&autostart=2&arena=2&hearts=6&wins=1&time=0&name=Chrome", base).href);
      await c.waitForFunction(() => (document.getElementById("online-room-code")?.textContent?.length ?? 0) >= 4, { timeout: 60_000 });
      const invite = new URL(await c.$eval("#online-invite", (el) => (el as HTMLAnchorElement).href));
      const w = watch(await context.newPage(), "webkit");
      await w.goto(`${invite.origin}${invite.pathname}${invite.hash}&name=WebKit`);
      await c.waitForFunction(() => (window as unknown as Win).fso?.online?.current?.net.match === 1, { timeout: 60_000 });
      await w.waitForFunction(() => (window as unknown as Win).fso?.online?.current?.net.match === 1, null, { timeout: 60_000 });
      await c.evaluate((src) => ((window as unknown as Win).fso.online!.script = (0, eval)(src)), `(${BRAWL})(0)`);
      await w.evaluate((src) => ((window as unknown as Win).fso.online!.script = (0, eval)(src)), `(${BRAWL})(1)`);
      await sleep(15_000);
      const [sa, sb] = [await c.evaluate(status), await w.evaluate(status)];
      const upTo = Math.min(sa.final, sb.final);
      const [fa, fb] = [await c.evaluate(finals, upTo), await w.evaluate(finals, upTo)];
      const bad = fa.findIndex((h, f) => h === -1 || h !== fb[f]);
      if (upTo < 700 || bad !== -1 || sa.desyncs + sb.desyncs) problems.push(`chrome+webkit: ${upTo + 1} frames, first difference at ${bad}`);
      await w.close();
      return `${upTo + 1} frames identical, route ${[...sa.routes, ...sb.routes].join("/")}, hearts ${sa.hearts.join("/")}`;
    } finally {
      await chrome.close();
    }
  });
} finally {
  await context.close();
  rmSync(profile, { recursive: true, force: true });
}
console.log(`\n${problems.length} problem(s)`);
if (problems.length) process.exitCode = 1;
