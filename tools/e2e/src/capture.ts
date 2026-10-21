// Captures and replays (tools/capture, docs/tools.md) end to end, in headless Chrome against its own dev servers
// (apps/battle on 5293, apps/game on 5294; E2E_PORT moves them) writing to a temporary captures folder: a local match
// vs 2 CPUs and Lake Hylia are played in real time with held keys, F8 captures them (Shift+F8 with a typed note), the
// capture's files and index line must appear, then the capture replays to the same state hash in node
// (tools/capture/src/replay.ts) and in the page (#replay=<id>), and shot.ts screenshots the replay.
//   node tools/e2e/src/capture.ts [outDir]
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import puppeteer, { type KeyInput, type Page } from "puppeteer-core";
import { createServer, type ViteDevServer } from "vite";
import { openReady } from "./ready.ts";
import { browserPath } from "./browsers.ts";

const CHROME = browserPath("chrome");
const PORT = Number(process.env.E2E_PORT ?? 5293);
const REPO = resolve(import.meta.dirname, "../../..");
const [outArg = "out/e2e-capture"] = process.argv.slice(2);
const out = resolve(outArg);
mkdirSync(out, { recursive: true });
const captures = mkdtempSync(join(out, "captures-"));
process.env.FSO_CAPTURES = captures; // (read by the dev servers' plugin and the tools)

type Entry = { id: string; app: string; note: string; tick: number | null; frame: string; replay: boolean };
type Replay = { steps: number; done: boolean; hash: number; expected: number };
type Win = Window & { fso: { mode?: string; game: { tick: number } | null; replay: Replay | null }; fsoCapture?: unknown };

const problems: string[] = [];
const check = (ok: boolean, what: string) => (ok ? console.log(`ok   ${what}`) : (problems.push(what), console.log(`FAIL ${what}`)));
const index = (): Entry[] => (existsSync(join(captures, "index.jsonl")) ? readFileSync(join(captures, "index.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Entry) : []);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function nextEntry(count: number): Promise<Entry> {
  for (let t = 0; t < 200 && index().length <= count; t++) await sleep(100);
  const entry = index()[count];
  if (!entry) throw new Error("no capture reached the index");
  return entry;
}
/** Holds each key a while, in real time (the loop runs on its own clock). */
async function play(page: Page, keys: [KeyInput, number][]): Promise<void> {
  for (const [key, ms] of keys) {
    await page.keyboard.down(key);
    await sleep(ms);
    await page.keyboard.up(key);
  }
}
/** Runs one of tools/capture's scripts (asynchronously: this process serves the pages shot.ts opens). */
const node = (script: string, ...args: string[]) =>
  new Promise<{ ok: boolean; text: string }>((resolve) =>
    execFile(process.execPath, [join(REPO, "tools/capture/src", script), ...args], { encoding: "utf8", env: process.env }, (error, stdout, stderr) => resolve({ ok: !error, text: error ? `${stdout}${stderr}` : stdout })),
  );

async function serve(app: string, port: number): Promise<ViteDevServer> {
  const server = await createServer({ configFile: join(REPO, `apps/${app}/vite.config.ts`), root: join(REPO, `apps/${app}`), server: { port, strictPort: true }, logLevel: "warn" });
  await server.listen();
  return server;
}

/** F8 (or Shift+F8 with `note` typed), then the capture's files and index line; then its replays. */
async function captureAndReplay(page: Page, app: string, url: string, note?: string): Promise<void> {
  const before = index().length;
  if (note === undefined) await page.keyboard.press("F8");
  else {
    await page.keyboard.down("Shift");
    await page.keyboard.press("F8");
    await page.keyboard.up("Shift");
    await page.waitForSelector("#fso-capture-note", { timeout: 5000 });
    await page.keyboard.type(note);
    await page.keyboard.press("Enter");
  }
  const entry = await nextEntry(before);
  const dir = join(captures, entry.id);
  console.log(`${app}: capture ${entry.id} at tick ${entry.tick}${entry.note ? ` "${entry.note}"` : ""}`);
  check(entry.app === app && entry.replay && entry.tick !== null && entry.tick > 60, `${app}: an index line with the tick and a replay`);
  check(entry.note === (note ?? ""), `${app}: the note "${note ?? ""}" in the index`);
  for (const file of ["frame.png", "capture.json", "state.json", "replay.json"]) check(existsSync(join(dir, file)), `${app}: ${file} written`);
  // A blank WebGL read-back compresses to a few KB; a drawn frame doesn't.
  check(statSync(join(dir, "frame.png")).size > 30_000, `${app}: frame.png holds a drawn frame (${statSync(join(dir, "frame.png")).size} bytes)`);
  const state = JSON.parse(readFileSync(join(dir, "state.json"), "utf8")) as { tick: number };
  check(state.tick === entry.tick, `${app}: state.json at the capture's tick`);

  const replayed = await node("replay.ts", entry.id);
  check(replayed.ok && /= the capture's/.test(replayed.text), `${app}: replays in node to the capture's hash`);
  console.log(replayed.text.trim().replace(/^/gm, "     "));
  const early = await node("replay.ts", entry.id, "--at", "60", "--state", join(out, `${app}-at-60.json`));
  check(early.ok && /tick 60\b/.test(early.text), `${app}: replay.ts --at 60 stops at tick 60`);

  const replay = await page.browser().newPage();
  await openReady(replay, `${url}#replay=${entry.id}&mute`, () => (window as unknown as Win).fso?.replay?.done, 120_000);
  const r = (await replay.evaluate(() => (window as unknown as Win).fso.replay)) as Replay;
  check(r.hash === r.expected && r.steps === entry.tick, `${app}: #replay= reaches the capture's state in the page (step ${r.steps}, hash ${r.hash.toString(16)} vs ${r.expected.toString(16)})`);
  await replay.close();
  const shot = await node("shot.ts", entry.id, "--at", String(Math.max(1, entry.tick! - 30)));
  check(shot.ok && /hash = the recording's|no recorded hash/.test(shot.text) && existsSync(join(dir, `at-${Math.max(1, entry.tick! - 30)}.png`)), `${app}: shot.ts screenshots the replay half a second earlier`);
  console.log(shot.text.trim().replace(/^/gm, "     "));
}

const servers = [await serve("battle", PORT), await serve("game", PORT + 1)];
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: mkdtempSync(join(out, "profile-")), defaultViewport: { width: 1280, height: 800, deviceScaleFactor: 1 } });
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => problems.push(`page error: ${e instanceof Error ? e.message : String(e)}`));
  // Shadow Battle: P1 against two CPUs, past the intro, moving and swinging.
  const battle = `http://localhost:${PORT}/`;
  await openReady(page, `${battle}#arena=1&players=3&cpu=2,3&start&mute`, () => (window as unknown as Win).fso?.mode === "match");
  check(await page.evaluate(() => typeof (window as unknown as Win).fsoCapture === "function"), "battle: window.fsoCapture on the dev server");
  await sleep(7000); // (the round's intro)
  await play(page, [["KeyD", 600], ["KeyS", 400], ["KeyJ", 100], ["KeyA", 500], ["KeyJ", 100], ["KeyW", 300]]);
  await captureAndReplay(page, "battle", battle);
  await play(page, [["KeyD", 300], ["KeyJ", 100]]);
  await captureAndReplay(page, "battle", battle, "P1 swung at nothing");

  // The adventure: Lake Hylia, the Links walking about.
  const game = `http://localhost:${PORT + 1}/`;
  await openReady(page, `${game}#stage=boss010&mute`, () => ((window as unknown as Win).fso?.game?.tick ?? 0) > 0);
  await play(page, [["ArrowUp", 800], ["ArrowLeft", 600], ["KeyJ", 100], ["ArrowDown", 400], ["ArrowRight", 700]]);
  await captureAndReplay(page, "game", game, "the Links walked about");
  await page.screenshot({ path: join(out, "game.png") });

} finally {
  await browser.close();
  for (const server of servers) await server.close();
}
console.log(`captures in ${captures}`);
if (problems.length) {
  console.log(`${problems.length} problem(s):\n${problems.join("\n")}`);
  process.exit(1);
}
console.log("capture e2e passed");
