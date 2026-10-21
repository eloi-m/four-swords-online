// Smoke test for apps/sound-test in headless Chrome: loads the game files, renders Lake Hylia's theme through the
// synth AudioWorklet with an OfflineAudioContext (no audio device needed), then plays it on a live AudioContext,
// checks that the sequencer schedules notes and plays a sound effect over it. Expects the dev server to be running
// (pnpm --filter @fso/sound-test exec vite --port 5178).
//   node tools/e2e/src/sound.ts [url] [outDir]
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import puppeteer from "puppeteer-core";
import { openReady, opfsEntries, waitReady } from "./ready.ts";
import { browserPath } from "./browsers.ts";

const CHROME = browserPath("chrome");
const [url = "http://localhost:5178/", outArg = "out/e2e"] = process.argv.slice(2);
const out = resolve(outArg);
mkdirSync(out, { recursive: true });

interface SoundTest {
  ready: boolean;
  bgm: { index: number; name: string; file?: string }[];
  stats: {
    seconds: number;
    notes: number;
    missing: number;
    voices: number;
    noteTracks: number;
    tempo: number;
    se: { notes: number; missing: number; voices: number };
  } | null;
  audioState: string;
  errors: string[];
  play(index: number): Promise<void>;
  playSe(name: string): Promise<void>;
  stop(): void;
  renderOffline(index: number, seconds: number): Promise<{ rms: number; peak: number; stats: SoundTest["stats"] }>;
}
declare const soundTest: SoundTest;

const LAKE_HYLIA = 11; // JA_BGM_WATER_FIELD (filed_w.bms)
const profile = mkdtempSync(join(out, "profile-"));
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  userDataDir: profile,
  args: ["--autoplay-policy=no-user-gesture-required"],
  defaultViewport: { width: 1200, height: 900, deviceScaleFactor: 1 },
});
const problems: string[] = [];
const check = (ok: boolean, message: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${message}`);
  if (!ok) problems.push(message);
};
try {
  const page = await browser.newPage();
  page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
  page.on("pageerror", (e) => problems.push(`page error: ${e instanceof Error ? e.message : String(e)}`));
  const started = Date.now();
  await openReady(page, url, () => soundTest.ready, 180_000);
  console.log(`load: ${((Date.now() - started) / 1000).toFixed(1)} s · ${await page.$eval("#data-status", (el) => el.textContent)}`);
  const bgm = await page.evaluate(() => soundTest.bgm);
  check(bgm.length === 49 && bgm[LAKE_HYLIA]?.file === "filed_w.bms", `${bgm.length} BGM entries, #${LAKE_HYLIA} = ${bgm[LAKE_HYLIA]?.name}`);

  const offline = await page.evaluate((i) => soundTest.renderOffline(i, 8), LAKE_HYLIA);
  check(
    offline.rms > 0.01 && (offline.stats?.notes ?? 0) > 100 && offline.stats?.missing === 0,
    `offline render 8 s: rms ${offline.rms.toFixed(3)}, peak ${offline.peak.toFixed(2)}, ${offline.stats?.notes} notes, ${offline.stats?.missing} missing`,
  );

  await page.evaluate((i) => soundTest.play(i), LAKE_HYLIA);
  await new Promise((r) => setTimeout(r, 3000));
  const live = await page.evaluate(() => ({ stats: soundTest.stats, state: soundTest.audioState }));
  check(
    live.state === "running" && (live.stats?.seconds ?? 0) > 1 && (live.stats?.notes ?? 0) > 0,
    `live AudioContext ${live.state}: ${live.stats?.seconds.toFixed(1)} s played, ${live.stats?.notes} notes, ${live.stats?.voices} voices, tempo ${live.stats?.tempo}`,
  );
  await page.evaluate(() => soundTest.playSe("JA_SE_OBJ_BOMB_BURST"));
  await new Promise((r) => setTimeout(r, 800));
  const se = await page.evaluate(() => soundTest.stats?.se);
  check((se?.notes ?? 0) >= 1 && se?.missing === 0, `sound effect over the BGM: ${se?.notes} notes, ${se?.missing} missing`);
  await page.screenshot({ path: join(out, "sound-test.png") });
  await page.evaluate(() => soundTest.stop());
  const playErrors = await page.evaluate(() => soundTest.errors);
  check(playErrors.length === 0, `errors while playing: ${playErrors.join("; ") || "none"}`);

  // Reload: the files now come from the HTTP cache; nothing is kept in OPFS.
  const reloaded = Date.now();
  await page.reload({ waitUntil: "networkidle0" });
  await waitReady(page, () => soundTest.ready, 30_000);
  check(true, `after reload (${((Date.now() - reloaded) / 1000).toFixed(1)} s): ${await page.$eval("#data-status", (el) => el.textContent)}`);
  const stored = await opfsEntries(page);
  check(stored.length === 0, `nothing in OPFS: ${stored.join(", ") || "empty"}`);
  const errors = await page.evaluate(() => soundTest.errors);
  check(errors.length === 0, `page errors: ${errors.join("; ") || "none"}`);
} finally {
  await browser.close();
  rmSync(profile, { recursive: true, force: true });
}
if (problems.length) {
  console.log(problems.join("\n"));
  process.exitCode = 1;
}
console.log(`screenshot in ${out}`);
