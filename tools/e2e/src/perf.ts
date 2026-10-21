// Frame-time profile of Shadow Battle in the production build: 4 Links played by bots (through fake gamepads, so the
// app runs unmodified, in real time on requestAnimationFrame) on each arena, at a Retina-sized window (1512×945 CSS px,
// device pixel ratio 2). Per frame: the animation-frame callback's CPU time split into the sim steps, the camera, the
// sound cues, the HUD and the three.js render, the GPU time of the render (Chrome: EXT_disjoint_timer_query_webgl2),
// and the interval between frames. Then an online match between two tabs under artificial lag (rollbacks): the cost
// of each 60 Hz net tick (inputs, prediction, rollback and resimulation). Needs no dev server (builds the site and
// serves it with vite preview on 5195, game files from extracted/, lobby on 5196; E2E_PORT and E2E_SIGNAL_PORT
// override them).
// --profile (Chrome) also records a CPU profile of the Tower of Flames run and of the online front tab
// (out/e2e-perf/*.cpuprofile, open in Chrome DevTools) and prints the functions with the most self time.
// --phone (Chrome) emulates a landscape phone instead (852×393 CSS px at device pixel ratio 3, which the renderers cap
// at 2; isMobile and hasTouch, so the on-screen controls show), and --cpu=N slows the page's CPU N times (Chrome's
// throttling, a rough stand-in for a phone's slower cores). --ports=site,lobby replaces 5195,5196 (as E2E_PORT and
// E2E_SIGNAL_PORT do).
//   node tools/e2e/src/perf.ts [chrome|firefox|all] [--arenas=0,1,…] [--seconds=8] [--profile] [--finals=1]
//     [--no-build] [--url=…] [--phone] [--cpu=4] [--ports=5195,5196]
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { startSignalServer } from "@fso/signal";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { build, preview } from "vite";
import { openReady } from "./ready.ts";
import { browserPath, type BrowserName } from "./browsers.ts";

const SITE_CONFIG = resolve(import.meta.dirname, "../../../apps/site/vite.config.ts");

const args = process.argv.slice(2);
const opt = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const [SITE_PORT = Number(process.env.E2E_PORT ?? 5195), SIGNAL_PORT = Number(process.env.E2E_SIGNAL_PORT ?? 5196)] = (opt("ports") ?? "").split(",").filter(Boolean).map(Number);
const phone = args.includes("--phone");
const VIEWPORT = phone
  ? { width: 852, height: 393, deviceScaleFactor: 3, isMobile: true, hasTouch: true, isLandscape: true }
  : { width: 1512, height: 945, deviceScaleFactor: 2 };
const SCREEN = `${VIEWPORT.width}×${VIEWPORT.height} @${VIEWPORT.deviceScaleFactor}x${phone ? " (phone)" : ""}`;
const cpu = Number(opt("cpu") ?? 1);
const [which = "chrome"] = args.filter((a) => !a.startsWith("--"));
if (!["chrome", "firefox", "all"].includes(which)) {
  console.error("usage: perf [chrome|firefox|all] [--arenas=0,1] [--seconds=8] [--no-build] [--url=] [--phone] [--cpu=N] [--ports=site,lobby]");
  process.exit(1);
}
const browsers: BrowserName[] = which === "all" ? ["chrome", "firefox"] : [which as BrowserName];
const arenas = (opt("arenas") ?? "0,1,2,3,4,5,6,7,8,9").split(",").map(Number);
const seconds = Number(opt("seconds") ?? 8);
const out = resolve("out/e2e-perf");
mkdirSync(out, { recursive: true });
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const profiling = args.includes("--profile");

type ProfileNode = { id: number; callFrame: { functionName: string; url: string; lineNumber: number }; hitCount?: number; children?: number[] };
/** Runs `during` under the V8 sampling profiler (Chrome only); saves the profile and prints the top self times. */
async function profile(page: Page, file: string, during: () => Promise<void>): Promise<void> {
  if (!profiling || (await page.browser().version()).startsWith("firefox")) return during();
  const cdp = await page.createCDPSession();
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 100 });
  await cdp.send("Profiler.start");
  await during();
  const { profile: p } = (await cdp.send("Profiler.stop")) as unknown as { profile: { nodes: ProfileNode[]; samples: number[]; startTime: number; endTime: number } };
  writeFileSync(join(out, file), JSON.stringify(p));
  const self = new Map<string, number>();
  for (const node of p.nodes) {
    const f = node.callFrame;
    const key = `${f.functionName || "(anonymous)"} ${f.url.split("/").pop()}:${f.lineNumber + 1}`;
    self.set(key, (self.get(key) ?? 0) + (node.hitCount ?? 0));
  }
  const total = p.samples.length;
  const top = [...self].sort((a, b) => b[1] - a[1]).slice(0, 22);
  console.log(`  profile ${file}: ${total} samples over ${((p.endTime - p.startTime) / 1e6).toFixed(1)} s`);
  for (const [key, n] of top) console.log(`    ${((n / total) * 100).toFixed(1).padStart(5)} %  ${key}`);
  await cdp.detach();
}

let base = opt("url") ?? `http://localhost:${SITE_PORT}/`;
const stops: (() => Promise<void>)[] = [];
if (!opt("url")) {
  process.env.FSO_SIGNAL_PORT = String(SIGNAL_PORT);
  if (!args.includes("--no-build")) await build({ configFile: SITE_CONFIG, logLevel: "error" });
  const signal = await startSignalServer({ port: SIGNAL_PORT });
  const server = await preview({ configFile: SITE_CONFIG, preview: { port: SITE_PORT, strictPort: true }, logLevel: "warn" });
  stops.push(() => signal.close(), () => server.close());
  base = `http://localhost:${SITE_PORT}/`;
}

// Installed before the page's own scripts: frame timing, 4 fake gamepads driven by a bot, and method wrappers.
function instrument(): void {
  type Game = { tick: number; players: { x: number; y: number; facing: string }[]; battle?: { phase: string; fighters: { hearts: number; item: string | null; carryLink: number; carryEntity: number }[]; entities: { kind: string; x: number; y: number }[] } };
  const w = window as unknown as Record<string, unknown> & { fso?: { game: Game | null; mode: string } };
  const perf = {
    on: false,
    frames: [] as { at: number; total: number; parts: Record<string, number>; ticks: number; entities: number }[],
    parts: {} as Record<string, number>,
    gpu: [] as number[],
    lastTick: -1,
    add(key: string, ms: number) {
      this.parts[key] = (this.parts[key] ?? 0) + ms;
    },
  };
  w.__perf = perf;
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) =>
    raf((now) => {
      if (!perf.on) return cb(now);
      perf.parts = {};
      const tick = w.fso?.game?.tick ?? 0;
      const t0 = performance.now();
      cb(now);
      const total = performance.now() - t0;
      const game = w.fso?.game;
      perf.frames.push({ at: t0, total, parts: perf.parts, ticks: (game?.tick ?? 0) - tick, entities: game?.battle?.entities.length ?? 0 });
    });

  // Gamepad n = player n (the match starts with "gamepads first"). Standard mapping: 0 = A (sword), 1 = B (item),
  // 2 = X (action), 12-15 = d-pad.
  const pads = [0, 1, 2, 3].map((index) => ({ index, id: "perf bot", connected: true, mapping: "standard", timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) }));
  let seed = 12345;
  const botTick = () => {
    const game = w.fso?.game, b = game?.battle;
    if (!game || !b || game.tick === perf.lastTick) return;
    perf.lastTick = game.tick;
    const t0 = performance.now();
    game.players.forEach((p, i) => {
      const pad = pads[i]!;
      for (const button of pad.buttons) button.pressed = false;
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      const noise = seed >>> 16;
      const f = b.fighters[i]!;
      if (b.phase !== "play" || f.hearts <= 0) return;
      let target: { x: number; y: number } | null = null, best = Infinity;
      game.players.forEach((q, j) => {
        const d = Math.abs(q.x - p.x) + Math.abs(q.y - p.y);
        if (j !== i && b.fighters[j]!.hearts > 0 && d < best) (best = d), (target = q);
      });
      const pickup = b.entities.find((e) => e.kind === "pickup" && Math.abs(e.x - p.x) + Math.abs(e.y - p.y) < 120 * 256);
      const goal: { x: number; y: number } | null = pickup ?? target;
      if (!goal) return;
      if (noise % 9 === 0) return void (pad.buttons[12 + (noise % 4)]!.pressed = true);
      const dx = (goal.x - p.x) / 256, dy = (goal.y - p.y) / 256;
      if (Math.abs(dx) > 12) pad.buttons[dx > 0 ? 15 : 14]!.pressed = true;
      else if (Math.abs(dy) > 4) pad.buttons[dy > 0 ? 13 : 12]!.pressed = true;
      const near = !pickup && Math.abs(dx) + Math.abs(dy) < 30;
      if (f.carryLink >= 0 || f.carryEntity !== 0) pad.buttons[2]!.pressed = noise % 16 === 0;
      else if (near && noise % 5 === 0) pad.buttons[2]!.pressed = true;
      else if (near && noise % 3 === 0) pad.buttons[0]!.pressed = true;
      else if (f.item && noise % 13 === 0) pad.buttons[1]!.pressed = true;
    });
    perf.add("bot", performance.now() - t0);
  };
  Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => (botTick(), pads) });
}

/** Wraps the view's, HUD's and cues' per-frame methods to time them (once they exist), and the GPU timer queries. */
function wrapParts(): boolean {
  const w = window as unknown as {
    fso: { view: Record<string, unknown> & { renderer: { getContext(): WebGL2RenderingContext } }; hud: Record<string, unknown>; cues: Record<string, unknown> | null };
    __perf: { on: boolean; add(key: string, ms: number): void; gpu: number[] };
    __wrapped?: boolean;
  };
  if (w.__wrapped || !w.fso?.cues) return !!w.__wrapped;
  w.__wrapped = true;
  const perf = w.__perf;
  const wrap = (obj: Record<string, unknown>, name: string, key: string) => {
    const f = obj[name] as (...a: unknown[]) => unknown;
    obj[name] = function (this: unknown, ...a: unknown[]) {
      const t0 = performance.now();
      const r = f.apply(this, a);
      perf.add(key, performance.now() - t0);
      return r;
    };
  };
  const gl = w.fso.view.renderer.getContext();
  // WebGL calls per frame: draws, and texture / buffer uploads (count and bytes).
  const count = (name: string, key: string, bytes?: (a: unknown[]) => number) => {
    const g = gl as unknown as Record<string, (...a: unknown[]) => unknown>;
    const f = g[name]!.bind(gl);
    g[name] = (...a: unknown[]) => {
      if (perf.on) {
        perf.add(key, 1);
        if (bytes) perf.add(`${key} KB`, bytes(a) / 1024);
      }
      return f(...a);
    };
  };
  const view = (a: unknown[]) => (a.find((x) => ArrayBuffer.isView(x)) as ArrayBufferView | undefined)?.byteLength ?? 0;
  count("drawElements", "draws");
  count("drawArrays", "draws");
  count("drawElementsInstanced", "draws");
  count("drawArraysInstanced", "draws");
  count("texImage2D", "tex uploads", view);
  count("texSubImage2D", "tex uploads", view);
  count("bufferData", "buffer uploads", view);
  count("bufferSubData", "buffer uploads", view);
  const ext = gl.getExtension("EXT_disjoint_timer_query_webgl2") as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  const pending: WebGLQuery[] = [];
  const render = w.fso.view.render as (...a: unknown[]) => unknown;
  w.fso.view.render = function (this: unknown, ...a: unknown[]) {
    const t0 = performance.now();
    let query: WebGLQuery | null = null;
    if (ext && perf.on) {
      query = gl.createQuery();
      gl.beginQuery(ext.TIME_ELAPSED_EXT, query!);
    }
    const r = render.apply(this, a);
    if (query) {
      gl.endQuery(ext!.TIME_ELAPSED_EXT);
      pending.push(query);
    }
    while (pending.length && gl.getQueryParameter(pending[0]!, gl.QUERY_RESULT_AVAILABLE)) {
      const q = pending.shift()!;
      if (!gl.getParameter(ext!.GPU_DISJOINT_EXT)) perf.gpu.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
      gl.deleteQuery(q);
    }
    perf.add("render", performance.now() - t0);
    return r;
  };
  // The HUD's share of the render: its J2D panes are drawn by a render call of their own.
  const renderer = w.fso.view.renderer as unknown as { render(scene: unknown, camera: unknown): void };
  const hudScene = (w.fso.hud as { scene?: unknown }).scene, draw = renderer.render.bind(renderer);
  renderer.render = (scene, camera) => {
    if (scene !== hudScene || !perf.on) return draw(scene, camera);
    const parts = (w.__perf as unknown as { parts: Record<string, number> }).parts, before = parts.draws ?? 0, t0 = performance.now();
    draw(scene, camera);
    perf.add("hud render", performance.now() - t0);
    perf.add("hud draws", (parts.draws ?? 0) - before);
  };
  // The particle effects (apps/battle particles.ts): their CPU share of the render, and how many were drawn.
  const particles = (w.fso.view as unknown as { particles?: { update(game: unknown): void; stats: { particles: number } } }).particles;
  if (particles) {
    const update = particles.update.bind(particles);
    particles.update = (game) => {
      const t0 = performance.now();
      update(game);
      if (perf.on) {
        perf.add("particles", performance.now() - t0);
        perf.add("particle count", particles.stats.particles);
      }
    };
  }
  wrap(w.fso.view, "follow", "camera");
  wrap(w.fso.hud, "update", "hud");
  wrap(w.fso.hud, "place", "hud");
  wrap(w.fso.cues!, "observe", "cues");
  return true;
}

type FrameStats = { frames: { at: number; total: number; parts: Record<string, number>; ticks: number; entities: number }[]; gpu: number[] };
const stat = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const at = (p: number) => s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0;
  return { mean: s.reduce((a, b) => a + b, 0) / Math.max(1, s.length), p95: at(0.95), p99: at(0.99), max: s.at(-1) ?? 0 };
};
const ms = (x: number) => x.toFixed(2);

function summarize(label: string, r: FrameStats): Record<string, string | number> {
  const f = r.frames.slice(1);
  const intervals = f.slice(1).map((x, i) => x.at - f[i]!.at);
  const part = (k: string) => stat(f.map((x) => x.parts[k] ?? 0));
  const total = stat(f.map((x) => x.total));
  const others = ["render", "hud", "camera", "cues", "bot"];
  const sim = stat(f.map((x) => x.total - others.reduce((a, k) => a + (x.parts[k] ?? 0), 0)));
  const iv = stat(intervals);
  const gpu = stat(r.gpu);
  const span = (f.at(-1)!.at - f[0]!.at) / 1000;
  return {
    arena: label,
    fps: (f.length / span).toFixed(1),
    "ticks/s": (f.reduce((a, x) => a + x.ticks, 0) / span).toFixed(1),
    "frame gap p99/max": `${ms(iv.p99)}/${ms(iv.max)}`,
    "slow gaps": intervals.filter((x) => x > 1000 / 60 + 4).length,
    "cpu mean/p99": `${ms(total.mean)}/${ms(total.p99)}`,
    "sim": ms(sim.mean),
    "render": `${ms(part("render").mean)}/${ms(part("render").p99)}`,
    "hud": ms(part("hud").mean),
    "cues": ms(part("cues").mean),
    "gpu mean/p99": r.gpu.length ? `${ms(gpu.mean)}/${ms(gpu.p99)}` : "n/a",
    "draws": part("draws").mean.toFixed(0),
    "hud draws/ms": `${part("hud draws").mean.toFixed(0)}/${ms(part("hud render").mean)}`,
    "particles ms (n)": `${ms(part("particles").mean)}/${ms(part("particles").p99)} (${part("particle count").mean.toFixed(0)})`,
    "uploads (KB)/frame": `${part("tex uploads").mean.toFixed(1)} tex (${part("tex uploads KB").mean.toFixed(1)}), ${part("buffer uploads").mean.toFixed(1)} buf (${part("buffer uploads KB").mean.toFixed(1)})`,
    "entities": Math.max(...f.map((x) => x.entities)),
  };
}

async function launch(name: BrowserName, profile: string): Promise<Browser> {
  return puppeteer.launch({
    browser: name,
    executablePath: browserPath(name),
    headless: true,
    userDataDir: profile,
    defaultViewport: VIEWPORT,
    args: name === "chrome" ? ["--autoplay-policy=no-user-gesture-required"] : [],
    extraPrefsFirefox: { "media.autoplay.default": 0, "media.autoplay.blocking_policy": 0 },
    protocolTimeout: 180_000,
    acceptInsecureCerts: true,
  });
}

/** Chrome's CPU throttling on a page (--cpu=N). */
async function throttle(page: Page): Promise<void> {
  if (cpu > 1 && !(await page.browser().version()).startsWith("firefox")) await (await page.createCDPSession()).send("Emulation.setCPUThrottlingRate", { rate: cpu });
}

async function local(browser: Browser, name: string): Promise<void> {
  const page = await browser.newPage();
  await throttle(page);
  await page.evaluateOnNewDocument(instrument);
  await openReady(page, new URL("battle/", base).href, () => (window as unknown as { fso: { mode: string } }).fso?.mode === "menu");
  // The gesture that starts the audio (its worklet runs during the measurement): a tap on a phone.
  await (phone ? page.touchscreen.tap(VIEWPORT.width / 2, 4) : page.click("#menu h1"));
  await page.waitForFunction(wrapParts, { timeout: 60_000, polling: 200 });
  const rows: Record<string, string | number>[] = [];
  for (const room of arenas) {
    await page.evaluate((room) => {
      const w = window as unknown as { fso: { startMatch(s: object): void; view: { cameraMode: string } } };
      w.fso.startMatch({ room, players: 4, hearts: 6, time: 0, wins: 9, padsFirst: true });
    }, room);
    await page.waitForFunction(() => (window as unknown as { fso: { game: { battle: { phase: string } } } }).fso.game.battle.phase === "play", { timeout: 20_000, polling: 50 });
    await page.evaluate(() => {
      const p = (window as unknown as { __perf: { on: boolean; frames: unknown[]; gpu: unknown[] } }).__perf;
      p.frames = [];
      p.gpu = [];
      p.on = true;
    });
    await (room === 1 ? profile(page, `${name}-local-arena-1.cpuprofile`, () => sleep(seconds * 1000)) : sleep(seconds * 1000));
    const r = await page.evaluate(() => {
      const p = (window as unknown as { __perf: FrameStats & { on: boolean } }).__perf;
      p.on = false;
      return { frames: p.frames, gpu: p.gpu };
    });
    if (room === arenas[0] || room === 1) await page.screenshot({ path: join(out, `${name}-arena-${room}.png`) });
    const row = summarize(`${room}`, r);
    rows.push(row);
    console.log(`  ${JSON.stringify(row)}`);
  }
  const audio = await page.evaluate(() => {
    const a = (window as unknown as { fso: { audio: { state: string; stats: { seconds: number } | null } | null } }).fso.audio;
    return a ? `${a.state}, ${a.stats?.seconds.toFixed(0)} s played` : "none";
  });
  console.log(`${name}, local, 4 bots, ${seconds} s per arena (ms; audio ${audio})`);
  console.table(rows);
  await page.close();
}

async function online(browser: Browser, name: string): Promise<void> {
  // Two tabs on the Tower of Flames with 50±20 ms of lag and 5% loss on each side, bots brawling: rollbacks.
  // finals=0: as for players, no per-frame state hashes (apps/battle/src/online.ts recordFinals; --finals=1 adds them).
  const lag = `&lag=50&jitter=20&loss=0.05&delay=2&finals=${opt("finals") ?? 0}`;
  const open = async (hash: string) => {
    const page = await browser.newPage();
    await throttle(page);
    await page.evaluateOnNewDocument(instrument);
    await page.goto(new URL(`battle/#${hash}`, base).href, { waitUntil: "load" });
    return page;
  };
  const a = await open(`create&autostart=2&arena=1&hearts=6&wins=9&time=0&name=A${lag}`);
  await a.waitForFunction(() => (document.getElementById("online-room-code")?.textContent?.length ?? 0) >= 4, { timeout: 60_000, polling: 100 });
  const code = await a.$eval("#online-room-code", (el) => el.textContent!);
  const b = await open(`join=${code}&name=B${lag}`);
  for (const page of [a, b]) await page.waitForFunction(() => (window as unknown as { fso: { online: { current: { net: { match: number } } | null } } }).fso.online?.current?.net.match === 1, { timeout: 60_000, polling: 100 });
  const bot = `(player) => (frame, g) => {
    const b = g.battle, me = g.players[player], other = g.players[1 - player];
    if (b.phase !== "play") return 0;
    const dx = (other.x - me.x) / 256, dy = (other.y - me.y) / 256;
    let v = Math.imul(Math.floor(frame / 7) + 1, 0x9e3779b1) ^ Math.imul(player + 3, 0x85ebca6b); v ^= v >>> 15;
    if ((v >>> 0) % 4 === 0) return [1, 2, 4, 8, 16, 64][(v >>> 5) % 6];
    return (Math.abs(dx) > 12 ? (dx > 0 ? 8 : 4) : Math.abs(dy) > 4 ? (dy > 0 ? 2 : 1) : 0) | (Math.abs(dx) + Math.abs(dy) < 30 && frame % 3 === 0 ? 16 : 0);
  }`;
  for (const [i, page] of [a, b].entries()) {
    await page.evaluate((src) => {
      const w = window as unknown as { fso: { online: { script: unknown; current: { net: Record<string, unknown> } } }; __ticks: number[] };
      w.fso.online.script = (0, eval)(src);
      const net = w.fso.online.current.net;
      const tick = net.tick as (...a: unknown[]) => unknown;
      w.__ticks = [];
      net.tick = function (this: unknown, ...a: unknown[]) {
        const t0 = performance.now();
        const r = tick.apply(this, a);
        w.__ticks.push(performance.now() - t0);
        return r;
      };
    }, `(${bot})(${i})`);
  }
  await a.bringToFront();
  await a.waitForFunction(wrapParts, { timeout: 30_000, polling: 200 }).catch(() => {});
  await a.evaluate(() => {
    const p = (window as unknown as { __perf: { on: boolean; frames: unknown[]; gpu: unknown[] } }).__perf;
    p.frames = [];
    p.gpu = [];
    p.on = true;
  });
  await profile(a, `${name}-online-A.cpuprofile`, () => sleep(seconds * 1000));
  const rows = [];
  for (const [i, page] of [a, b].entries()) {
    const r = await page.evaluate(() => {
      const w = window as unknown as { __ticks: number[]; __perf: FrameStats & { on: boolean }; fso: { online: { current: { net: { session: { stats: { rollbacks: number; rollbackFrames: number; maxRollback: number; frames: number } } } } } } };
      w.__perf.on = false;
      return { ticks: w.__ticks, stats: w.fso.online.current.net.session.stats, frames: w.__perf.frames, gpu: w.__perf.gpu };
    });
    const t = stat(r.ticks.slice(60));
    rows.push({
      page: i ? "B (background tab)" : "A (front tab)",
      "net ticks": r.ticks.length,
      rollbacks: r.stats.rollbacks,
      "avg/max length": `${(r.stats.rollbackFrames / Math.max(1, r.stats.rollbacks)).toFixed(1)}/${r.stats.maxRollback}`,
      "tick µs mean/p99/max": `${(t.mean * 1000).toFixed(0)}/${(t.p99 * 1000).toFixed(0)}/${(t.max * 1000).toFixed(0)}`,
      ...(i === 0 && r.frames.length > 2 ? { "frame cpu mean/p99": (() => { const s = stat(r.frames.slice(1).map((x) => x.total)); return `${ms(s.mean)}/${ms(s.p99)}`; })() } : {}),
    });
  }
  console.log(`${name}, online, 2 tabs, Tower of Flames, 50±20 ms lag and 5% loss each way, ${seconds} s`);
  console.table(rows);
  await a.close();
  await b.close();
}

try {
  for (const name of browsers) {
    const profile = mkdtempSync(join(out, `profile-${name}-`));
    const browser = await launch(name, profile);
    console.log(`\n=== ${name} ${await browser.version()} · ${SCREEN}${cpu > 1 ? ` · CPU ÷${cpu}` : ""}`);
    try {
      await local(browser, name);
      await online(browser, name);
    } finally {
      await browser.close();
      rmSync(profile, { recursive: true, force: true });
    }
  }
} finally {
  for (const stop of stops) await stop().catch(() => {});
}
