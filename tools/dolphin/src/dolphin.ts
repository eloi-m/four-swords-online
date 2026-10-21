// Launches Dolphin (2606: $DOLPHIN, else the macOS app or `dolphin-emu` on the PATH) in batch mode with its GDB stub
// enabled, from a savestate or an input movie. `Interface.DebugModeEnabled` makes the JIT honour breakpoints; audio is
// off so nothing waits on it.
// Graphics dump switches (e.g. texture dumping) only take effect from the user folder's GFX.ini, not from -C.
import { spawn, type ChildProcess } from "node:child_process";
import { openSync } from "node:fs";

export const DOLPHIN =
  process.env.DOLPHIN ?? (process.platform === "darwin" ? "/Applications/Dolphin.app/Contents/MacOS/Dolphin" : "dolphin-emu");

export interface LaunchOptions {
  userDir: string;
  disc: string;
  gdbPort: number;
  savestate?: string;
  /** DTM to play; with bFromSaveState its state must sit next to it as `<movie>.sav`. */
  movie?: string;
  /** Extra `System.Section.Key=Value` overrides. */
  config?: string[];
  log?: string;
}

export function launchDolphin(o: LaunchOptions): ChildProcess {
  const config = [
    `Dolphin.General.GDBPort=${o.gdbPort}`,
    "Dolphin.Interface.DebugModeEnabled=True",
    "Dolphin.Analytics.PermissionAsked=True",
    "Dolphin.DSP.Backend=No Audio Output",
    "Dolphin.Core.CPUThread=False", // single core: deterministic, and movies stay in sync
    ...(o.config ?? []),
  ];
  const args = ["-u", o.userDir, "-b", "-e", o.disc];
  if (o.savestate) args.push("-s", o.savestate);
  if (o.movie) args.push("-m", o.movie);
  for (const c of config) args.push("-C", c);
  const out = o.log ? openSync(o.log, "w") : "ignore";
  return spawn(DOLPHIN, args, { stdio: ["ignore", out, out] });
}
