// Records the game's audio in Dolphin from a savestate (Dolphin.DSP.DumpAudio), for comparing with our renders.
// Uses its own Dolphin user folder (ref/dolphin-user-audio, seeded from ref/dolphin-user) so other captures and the
// user's own config are left alone. After the given time Dolphin gets SIGINT (stops emulation and closes the dump),
// then a second SIGINT to quit; the dump's WAV header sizes may stay unset, which compare.ts tolerates.
//   node tools/audio/src/capture.ts <disc.rvz> [savestate=ref/save-lake-hylia.sav] [seconds=14]
// Output: ref/dolphin-user-audio/Dump/Audio/<game>_<date>_dspdump.wav (16-bit stereo, 32028 Hz).
import { spawn } from "node:child_process";
import { cpSync, existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DOLPHIN =
  process.env.DOLPHIN ?? (process.platform === "darwin" ? "/Applications/Dolphin.app/Contents/MacOS/Dolphin" : "dolphin-emu");
const repo = fileURLToPath(new URL("../../../", import.meta.url));
const [disc, save = join(repo, "ref/save-lake-hylia.sav"), seconds = "14"] = process.argv.slice(2);
if (!disc) {
  console.error("usage: capture <disc.rvz> [savestate] [seconds]");
  process.exit(1);
}
const user = join(repo, "ref/dolphin-user-audio");
if (!existsSync(user)) cpSync(join(repo, "ref/dolphin-user"), user, { recursive: true });
const dumps = join(user, "Dump/Audio");
const before = new Set(existsSync(dumps) ? readdirSync(dumps) : []);
const args = ["-u", user, "-b", "-e", resolve(disc), "-s", resolve(save)];
for (const c of ["Dolphin.DSP.DumpAudio=True", "Dolphin.DSP.Backend=No Audio Output", "Dolphin.Analytics.PermissionAsked=True", "GFX.Settings.InternalResolution=1"]) {
  args.push("-C", c);
}
const dolphin = spawn(DOLPHIN, args, { stdio: "ignore" });
const ms = Number(seconds) * 1000;
const timers = [
  setTimeout(() => dolphin.kill("SIGINT"), ms),
  setTimeout(() => dolphin.kill("SIGINT"), ms + 3000),
  setTimeout(() => dolphin.kill("SIGKILL"), ms + 10000),
];
await new Promise((done) => dolphin.on("exit", done));
timers.forEach(clearTimeout);
const fresh = (existsSync(dumps) ? readdirSync(dumps) : []).filter((f) => !before.has(f));
// Dolphin also writes a DTK (disc streaming audio) dump, which the comparison doesn't use: drop it to save disk.
for (const f of fresh.filter((f) => f.endsWith("dtkdump.wav"))) rmSync(join(dumps, f));
const created = fresh.filter((f) => f.endsWith("dspdump.wav"));
for (const f of created) console.log(`${join(dumps, f)} (${(statSync(join(dumps, f)).size / 128112).toFixed(1)} s)`);
if (!created.length) {
  console.error("no DSP dump was written");
  process.exitCode = 1;
}
