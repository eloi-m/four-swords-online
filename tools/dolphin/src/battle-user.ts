// A private Dolphin user folder for Shadow Battle: the four controller ports as integrated GBAs (Dolphin's mGBA, SI
// device 13 = SIDEVICE_GC_GBA_EMULATED in Source/Core/Core/HW/SI/SI_Device.h), the real GBA BIOS (the GBAs boot
// FSA's client program by JoyBus multiboot, which needs it; the GBA ROM paths stay empty), no live input on any pad
// (movies drive them), and a savestate hotkey bound to a pipe device so that tools can save states on demand
// (`hotkey.ts`). Idempotent: re-running rewrites the config and keeps everything else (memory card, states).
//   node tools/dolphin/src/battle-user.ts [ref/dolphin-user-battle] [--bios disc/gba_bios.bin]
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { HOTKEY_PIPE } from "./hotkey.ts";

export const BATTLE_USER = "ref/dolphin-user-battle";
export const GBA_BIOS = "disc/gba_bios.bin";
export const SIDEVICE_GC_CONTROLLER = 6;
export const SIDEVICE_GC_GBA_EMULATED = 13;

export function setupBattleUser(dir: string, bios: string): void {
  if (!existsSync(bios) || statSync(bios).size !== 0x4000) throw new Error(`${bios}: not a 16 KiB GBA BIOS`);
  for (const d of ["Config", "GC/USA/Card A", "GBA/Saves", "Pipes", "StateSaves", "Dump/Frames"]) mkdirSync(join(dir, d), { recursive: true });
  const ini = (name: string, sections: Record<string, Record<string, string | number | boolean>>) =>
    writeFileSync(
      join(dir, "Config", name),
      Object.entries(sections)
        .map(([s, kv]) => `[${s}]\n` + Object.entries(kv).map(([k, v]) => `${k} = ${v === true ? "True" : v === false ? "False" : v}\n`).join(""))
        .join(""),
    );
  ini("Dolphin.ini", {
    Analytics: { PermissionAsked: true },
    Core: {
      // Movies re-plug the ports from their header (Movie::ChangePads); this is the layout for runs without one.
      SIDevice0: SIDEVICE_GC_GBA_EMULATED,
      SIDevice1: SIDEVICE_GC_GBA_EMULATED,
      SIDevice2: SIDEVICE_GC_GBA_EMULATED,
      SIDevice3: SIDEVICE_GC_GBA_EMULATED,
      CPUThread: false,
    },
    GBA: { BIOS: realpathSync(bios), Rom1: "", Rom2: "", Rom3: "", Rom4: "" },
    General: { HotkeysRequireFocus: false },
    Input: { BackgroundInput: false },
    DSP: { Backend: "No Audio Output" },
  });
  ini("GFX.ini", { Settings: { InternalResolution: 1, DumpFramesAsImages: true, InternalResolutionFrameDumps: true } });
  // No device on any pad: without a movie every port reads neutral, whatever the keyboard does.
  const none = (prefix: string) => Object.fromEntries([1, 2, 3, 4].map((i) => [`${prefix}${i}`, { Device: "" }]));
  ini("GBA.ini", none("GBA"));
  ini("GCPadNew.ini", none("GCPad"));
  ini("Hotkeys.ini", {
    Hotkeys: {
      Device: `Pipe/0/${HOTKEY_PIPE}`,
      "Save State/Save State Slot 1": "`Button A`",
      "General/Toggle Pause": "`Button START`",
    },
  });
  const pipe = join(dir, "Pipes", HOTKEY_PIPE);
  if (!existsSync(pipe)) execFileSync("mkfifo", [pipe]);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { bios: { type: "string", default: GBA_BIOS } } });
  const dir = positionals[0] ?? BATTLE_USER;
  setupBattleUser(dir, values.bios!);
  console.log(`${dir}: 4 integrated GBAs, BIOS ${values.bios}, savestate hotkey on Pipes/${HOTKEY_PIPE}`);
}
