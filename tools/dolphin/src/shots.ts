// Our frames for a comparison: a replay record (@fso/sim replay.ts) written as a capture, replayed by the app's own
// dev server (#replay=<id>&at=<tick>) in headless Chrome and shot at 640 x 480; and side-by-sides with Dolphin's.
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ReplayRecord } from "@fso/sim";
import { browserPath } from "@fso/e2e/browsers";
import puppeteer from "puppeteer-core";

/** The frame size both sides are shown at (Dolphin dumps 608 x 452 or so at 1x: scaled to this). */
export const SHOT_W = 640;
export const SHOT_H = 480;
/** The captures the comparisons' dev servers replay (FSO_CAPTURES). */
export const COMPARE_CAPTURES = "out/dolphin-compare/captures";

/** The apps the comparisons shoot, by their folder. */
const APPS = { battle: "apps/battle", game: "apps/game" } as const;

/** Writes a record where a dev server started with FSO_CAPTURES = COMPARE_CAPTURES replays it. */
export function writeRecord(id: string, record: ReplayRecord): void {
  const dir = join(COMPARE_CAPTURES, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "replay.json"), JSON.stringify(record));
}

/** Starts the app's dev server on `port` replaying COMPARE_CAPTURES; resolves once it answers. */
export async function startDevServer(app: keyof typeof APPS, port: number): Promise<{ url: string; stop: () => void }> {
  const proc: ChildProcess = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--port", String(port), "--strictPort"], {
    cwd: APPS[app],
    env: { ...process.env, FSO_CAPTURES: resolve(COMPARE_CAPTURES) },
    stdio: "ignore",
    detached: true,
  });
  const stop = () => {
    try {
      process.kill(-proc.pid!, "SIGTERM");
    } catch {
      // already gone
    }
  };
  const url = `http://localhost:${port}/`;
  for (let waited = 0; ; waited += 250) {
    try {
      if ((await fetch(url)).ok) return { url, stop };
    } catch {
      // not up yet
    }
    if (waited > 60_000 || proc.exitCode !== null) {
      stop();
      throw new Error(`the ${app} dev server didn't start on port ${port}`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** The page at `url` replaying capture `id` to each tick, shot into `files[i]`. */
export async function shoot(url: string, id: string, ticks: readonly number[], files: readonly string[]): Promise<void> {
  const profile = mkdtempSync(join(tmpdir(), "fso-compare-"));
  const browser = await puppeteer.launch({ executablePath: browserPath("chrome"), headless: true, userDataDir: profile, defaultViewport: { width: SHOT_W, height: SHOT_H, deviceScaleFactor: 1 } });
  try {
    for (const [i, tick] of ticks.entries()) {
      const page = await browser.newPage();
      page.on("pageerror", (e) => console.warn(`page error: ${e instanceof Error ? e.message : String(e)}`));
      await page.goto(`${url}#replay=${id}&at=${tick}`, { waitUntil: "load" });
      await page.waitForFunction(() => (window as unknown as { fso?: { replay?: { done: boolean } } }).fso?.replay?.done, { timeout: 120_000, polling: 100 });
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      await page.screenshot({ path: files[i]! as `${string}.png` });
      await page.close();
    }
  } finally {
    await browser.close();
    rmSync(profile, { recursive: true, force: true });
  }
}

/** Dolphin's frame (scaled to SHOT_W x SHOT_H) left, ours right (ImageMagick). */
export function sideBySide(dolphin: string, ours: string | null, out: string): void {
  const right = ours ? [ours, "-resize", `${SHOT_W}x${SHOT_H}!`] : ["-size", `${SHOT_W}x${SHOT_H}`, "xc:black"];
  execFileSync("magick", [dolphin, "-resize", `${SHOT_W}x${SHOT_H}!`, "(", ...right, ")", "+append", out]);
}
