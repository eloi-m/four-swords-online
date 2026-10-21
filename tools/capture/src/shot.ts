// Replays a capture in headless Chrome on the dev server (the app's #replay=<id>&at=<tick>) and screenshots the page
// at each tick asked: the frames before and after the moment the player captured, drawn by the real renderer. Checks
// the replayed state's hash against the capture's (or the log's checkpoint at that tick, when there is one).
//   node tools/capture/src/shot.ts [id|latest] [--at 600,900,1200] [--url http://localhost:5181/]   (pnpm capture:shot)
// The URL defaults to the page the capture came from (its dev server must be running). PNGs: captures/<id>/at-<tick>.png.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import puppeteer from "puppeteer-core";
import { captureFolder, repoRelative } from "./captures.ts";
import { browserPath } from "@fso/e2e/browsers";

const CHROME = browserPath("chrome");
const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const atArg = option("--at"), urlArg = option("--url");
const dir = captureFolder(args[0]);
const id = basename(dir);
const meta = JSON.parse(readFileSync(join(dir, "capture.json"), "utf8")) as { url: string; viewport?: { width: number; height: number } };
const page0 = (urlArg ?? meta.url).split("#")[0]!;
const ticks: (number | null)[] = atArg ? atArg.split(",").map(Number) : [null]; // null: the capture's own tick

type Replay = { steps: number; done: boolean; hash: number; expected: number };
const profile = mkdtempSync(join(tmpdir(), "fso-shot-"));
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  userDataDir: profile,
  defaultViewport: { width: meta.viewport?.width ?? 1280, height: meta.viewport?.height ?? 800, deviceScaleFactor: 1 },
});
let failed = false;
try {
  for (const at of ticks) {
    const page = await browser.newPage();
    page.on("pageerror", (e) => console.warn(`page error: ${e instanceof Error ? e.message : String(e)}`));
    // A fresh document per tick (the hash alone changing wouldn't reload it).
    await page.goto(`${page0}#replay=${id}${at === null ? "" : `&at=${at}`}&mute`, { waitUntil: "load" });
    await page.waitForFunction(() => (window as unknown as { fso?: { replay?: Replay } }).fso?.replay?.done, { timeout: 120_000, polling: 100 });
    // Two more frames: the last replayed step drawn.
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const replay = (await page.evaluate(() => (window as unknown as { fso: { replay: Replay } }).fso.replay)) as Replay;
    const file = join(dir, `at-${at ?? "capture"}.png`);
    await page.screenshot({ path: file });
    const check = replay.expected < 0 ? "no recorded hash at this tick" : replay.hash === replay.expected ? "hash = the recording's" : `hash ${replay.hash.toString(16)} != the recording's ${replay.expected.toString(16)}`;
    if (replay.expected >= 0 && replay.hash !== replay.expected) failed = true;
    console.log(`step ${replay.steps}: ${repoRelative(file)} (${check})`);
    await page.close();
  }
} finally {
  await browser.close();
  rmSync(profile, { recursive: true, force: true });
}
if (failed) process.exit(1);
