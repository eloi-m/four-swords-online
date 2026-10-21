// Two-player netplay in headless Chrome: two pages of one browser run apps/netplay against a local signaling server,
// play scripted inputs, and must end with identical state hashes on every final frame. Starts its own Vite (port 5184,
// E2E_PORT overrides it; the game files from extracted/) and signaling servers and stops them at the end. Scenarios:
// default transport (WebRTC), relay fallback with an impaired network, WebRTC with a bad network, plus a spectator
// joining mid-match.
//   node tools/e2e/src/netplay.ts [frames=600] [outDir]
import { mkdirSync, mkdtempSync } from "node:fs";
import { join, resolve } from "node:path";
import type { SessionStats } from "@fso/net";
import { startSignalServer } from "@fso/signal";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { createServer } from "vite";
import { waitReady } from "./ready.ts";
import { browserPath } from "./browsers.ts";

const CHROME = browserPath("chrome");
const [framesArg = "600", outArg = "out/e2e"] = process.argv.slice(2);
const FRAMES = Number(framesArg);
const out = resolve(outArg);
mkdirSync(out, { recursive: true });

interface Scenario {
  name: string;
  /** Extra deep-link parameters for both pages. */
  params: string;
  /** Expected route to the other players once connected. */
  route: "webrtc" | "relay";
  spectator?: boolean;
  /** Pages playing (default 2). */
  players?: number;
}
const SCENARIOS: Scenario[] = [
  { name: "auto (WebRTC)", params: "", route: "webrtc", spectator: true },
  { name: "relay + 60±30 ms, 10% loss", params: "&transport=relay&lag=60&jitter=30&loss=0.1", route: "relay" },
  { name: "WebRTC + 100±40 ms, 20% loss", params: "&transport=webrtc&lag=100&jitter=40&loss=0.2", route: "webrtc" },
  { name: "4 players, auto + 40±20 ms, 5% loss", params: "&lag=40&jitter=20&loss=0.05", route: "webrtc", players: 4 },
];
const LABELS = "ABCD";

type Fso = {
  local: number;
  log: { type: string }[];
  finals: Map<number, number>;
  routes: Map<string, string>;
  script: ((frame: number) => number) | null;
  session: { frame: number; finalizedFrame: number; stats: SessionStats; peerInfo(): { id: string; rtt: number; status: string }[] } | null;
  spectator: { frame: number } | null;
  state: { players: { x: number; y: number }[] };
};

const signal = await startSignalServer({ port: 0 });
const vite = await createServer({
  configFile: resolve(import.meta.dirname, "../../../apps/netplay/vite.config.ts"),
  root: resolve(import.meta.dirname, "../../../apps/netplay"),
  ...(process.env.E2E_PORT ? { server: { port: Number(process.env.E2E_PORT), strictPort: true } } : {}),
  logLevel: "warn",
});
await vite.listen();
const base = `http://localhost:${vite.config.server.port}/`;
const server = `ws://localhost:${signal.port}`;
console.log(`vite ${base}, signaling ${server}`);

const browser: Browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  userDataDir: mkdtempSync(join(out, "profile-")),
  defaultViewport: { width: 960, height: 640, deviceScaleFactor: 1 },
});
const problems: string[] = [];

async function open(hash: string, label: string): Promise<Page> {
  const page = await browser.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`${label} console: ${m.text()}`);
    if (process.env.DEBUG) console.log(`[${label}] ${m.type()}: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`${label} page error: ${e instanceof Error ? e.message : String(e)}`));
  await page.goto(`${base}#${hash}`, { waitUntil: "domcontentloaded" });
  // The lobby can be over within a poll interval (auto-join + auto-start), hence the fso check.
  await waitReady(page, () => !document.getElementById("lobby")!.hidden || "fso" in window);
  return page;
}

// Scripted walks: each player holds a direction (sometimes with the sword) for 12–30 frames, then stops.
const SCRIPT = `(player, until) => (frame) => {
  if (frame > until) return 0;
  const seg = Math.floor(frame / (12 + player * 6));
  let v = Math.imul(seg + 1, 0x9e3779b1) ^ Math.imul(player + 7, 0x85ebca6b);
  v = Math.imul(v ^ (v >>> 16), 0x7feb352d); v ^= v >>> 15;
  const dirs = [1, 2, 4, 8, 5, 6, 9, 10, 0];
  return dirs[(v >>> 0) % dirs.length] | ((v >>> 8) % 5 === 0 ? 16 : 0);
}`;

async function scenario(s: Scenario): Promise<void> {
  const t0 = Date.now();
  const common = `server=${server}${s.params}`;
  const n = s.players ?? 2;
  const a = await open(`create&autostart=${n}&name=A&${common}`, `${s.name} A`);
  await a.waitForFunction(() => document.getElementById("room-code")!.textContent!.length >= 4, { polling: 100 });
  const code = await a.$eval("#room-code", (el) => el.textContent!);
  const pages = [a];
  for (let i = 1; i < n; i++) pages.push(await open(`join=${code}&name=${LABELS[i]}&${common}`, `${s.name} ${LABELS[i]}`));
  const leaver = pages.at(-1)!;
  for (const page of pages) await page.waitForFunction(() => (window as unknown as { fso?: Fso }).fso?.session, { timeout: 30_000, polling: 100 });
  for (const page of pages) {
    await page.evaluate((src, until) => {
      const fso = (window as unknown as { fso: Fso }).fso;
      fso.script = (0, eval)(src)(fso.local, until);
    }, SCRIPT, FRAMES);
  }
  let spectator: Page | null = null;
  const status = (page: Page) =>
    page.evaluate(() => {
      const f = (window as unknown as { fso: Fso }).fso;
      return {
        frame: f.session?.frame ?? f.spectator!.frame,
        final: f.session?.finalizedFrame ?? f.spectator!.frame,
        routes: Object.fromEntries(f.routes),
        stats: f.session?.stats,
        peers: f.session?.peerInfo().map((p) => ({ id: p.id, rtt: Math.round(p.rtt), status: p.status })),
        players: f.state.players.map((p) => [Math.round(p.x / 256), Math.round(p.y / 256)]),
      };
    });
  const initial = (await status(a)).players;
  // Play until everyone has finalized past the end of the script.
  const target = FRAMES + 60;
  for (;;) {
    const st = await Promise.all(pages.map(status));
    if (s.spectator && !spectator && st[0]!.frame > FRAMES / 2) {
      spectator = await open(`join=${code}&spectate&name=S&${common}`, `${s.name} S`);
      await spectator.waitForFunction(() => (window as unknown as { fso?: Fso }).fso?.spectator, { timeout: 30_000, polling: 100 });
    }
    if (st.every((x) => x.final >= target)) break;
    if (Date.now() - t0 > 120_000) {
      problems.push(`${s.name}: timed out (${st.map((x) => x.final).join(" / ")} final frames)`);
      break;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (spectator) {
    await spectator.waitForFunction((t) => (window as unknown as { fso: Fso }).fso.spectator!.frame >= t, { timeout: 60_000, polling: 100 }, target).catch(() => problems.push(`${s.name}: spectator did not catch up`));
  }
  const watchers = spectator ? [...pages, spectator] : pages;
  const finals = await Promise.all(
    watchers.map((page) => page.evaluate((t) => Array.from({ length: t + 1 }, (_, f) => (window as unknown as { fso: Fso }).fso.finals.get(f) ?? -1), target)),
  );
  const firstDiff = finals[0]!.findIndex((h, f) => finals.some((other) => other[f] !== h) || h === -1);
  const st = await Promise.all(pages.map(status));
  for (const [i, page] of watchers.entries()) await page.screenshot({ path: join(out, `netplay-${SCENARIOS.indexOf(s)}-${i < n ? LABELS[i] : "S"}.png`) });
  const samePositions = st.every((x) => JSON.stringify(x.players) === JSON.stringify(st[0]!.players));
  console.log(`\n${s.name}: ${firstDiff === -1 ? `identical hashes on all ${target + 1} frames` : `DIVERGED at frame ${firstDiff}`}${spectator ? " (spectator included)" : ""}`);
  for (const [i, x] of st.entries()) {
    const k = x.stats!;
    console.log(
      `  ${LABELS[i]}: frame ${x.frame}, rollbacks ${k.rollbacks} (avg ${(k.rollbackFrames / Math.max(1, k.rollbacks)).toFixed(1)}, max ${k.maxRollback}), ` +
        `stalls ${k.predictionStalls}+${k.syncStalls}, hash checks ${k.hashChecks}, desyncs ${k.desyncs}, ${Math.round(k.bytesSent / Math.max(1, k.packetsSent))} B/packet, ` +
        `peers ${JSON.stringify(x.peers)}, routes ${JSON.stringify(x.routes)}, Links at ${JSON.stringify(x.players)}`,
    );
  }
  if (firstDiff !== -1) problems.push(`${s.name}: hashes differ from frame ${firstDiff}`);
  if (!samePositions) problems.push(`${s.name}: final positions differ between the pages`);
  for (const x of st) {
    if (x.stats!.desyncs > 0) problems.push(`${s.name}: desync reported`);
    if (x.stats!.hashChecks < FRAMES / 30 - 2) problems.push(`${s.name}: only ${x.stats!.hashChecks} hash checks`);
    const routes = Object.values(x.routes);
    if (!routes.includes(s.route)) problems.push(`${s.name}: expected a ${s.route} route, got ${JSON.stringify(x.routes)}`);
  }
  if (st[0]!.players.some((p, i) => p[0] === initial[i]![0] && p[1] === initial[i]![1])) problems.push(`${s.name}: a Link didn't move`);
  // Closing the last player's tab: A must see it leave at once (bye packet / lobby "left"), not after the 3 s timeout.
  const closedAt = Date.now();
  await leaver.close({ runBeforeUnload: true });
  const left = await a
    .waitForFunction(() => (window as unknown as { fso: { log: { type: string; reason?: string }[] } }).fso.log.find((e) => e.type === "disconnected"), { timeout: 10_000, polling: 50 })
    .then((h) => h.jsonValue() as unknown as Promise<{ reason: string; frame: number }>)
    .catch(() => null);
  const who = LABELS[n - 1];
  if (!left) problems.push(`${s.name}: A never saw ${who} leave`);
  else {
    console.log(`  ${who} closed its tab: A saw it ${Date.now() - closedAt} ms later (${left.reason}, after frame ${left.frame})`);
    if (left.reason === "timeout") problems.push(`${s.name}: A only noticed ${who} leaving by timeout`);
  }
  for (const page of watchers) if (!page.isClosed()) await page.close();
}

try {
  for (const s of SCENARIOS) await scenario(s);
} catch (error) {
  problems.push(`aborted: ${(error as Error).message}`);
} finally {
  await browser.close();
  await vite.close();
  await signal.close();
}
if (problems.length) {
  console.log(`\nproblems:\n${problems.join("\n")}`);
  process.exitCode = 1;
} else console.log("\nall scenarios passed");
