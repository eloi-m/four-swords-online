// Savestates on demand. Dolphin's Pipes input backend (InputCommon/ControllerInterface/Pipes) turns each FIFO in the
// user folder's Pipes/ into a device (`Pipe/0/<name>`) whose buttons follow lines like "PRESS A" / "RELEASE A";
// battle-user.ts binds the "Save State Slot 1" hotkey to that device's A (with HotkeysRequireFocus off). A press while
// the CPU sits at a GDB breakpoint queues the save as a CPU-thread job, which runs as soon as the tracer continues,
// before any instruction: the state is the machine at that breakpoint. Dolphin writes it to StateSaves/<id>.s01
// (atomically, by rename, from its compression thread).
import { closeSync, constants, copyFileSync, existsSync, openSync, rmSync, statSync, writeSync } from "node:fs";
import { join } from "node:path";

export const HOTKEY_PIPE = "fso";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class HotkeyPipe {
  private fd: number;

  /** Opens the FIFO for writing; Dolphin must already hold it open (it does from startup). */
  constructor(userDir: string) {
    this.fd = openSync(join(userDir, "Pipes", HOTKEY_PIPE), constants.O_WRONLY | constants.O_NONBLOCK);
  }

  /** Holds a button long enough for the hotkey thread (it polls every 5 ms) to see the press, then releases it. */
  async tap(button: string, holdMs = 150): Promise<void> {
    writeSync(this.fd, `PRESS ${button}\n`);
    await sleep(holdMs);
    writeSync(this.fd, `RELEASE ${button}\n`);
    await sleep(50);
  }

  close(): void {
    closeSync(this.fd);
  }
}

/** Where the slot-1 hotkey saves. Dolphin writes `<slot>.dtm` next to it when a movie was playing: such a state keeps
 *  the movie position, so a new movie from it wouldn't start at its first input. */
export function slotFile(userDir: string, gameId = "G4SE01"): string {
  return join(userDir, "StateSaves", `${gameId}.s01`);
}

/** Presses the save hotkey; `resume` must let the CPU run (the save happens then). Waits for the file, copies it, and
 *  says whether a movie was still playing. */
export async function saveState(pipe: HotkeyPipe, userDir: string, dest: string, resume: () => Promise<void>): Promise<{ movieActive: boolean }> {
  const slot = slotFile(userDir);
  rmSync(slot, { force: true });
  rmSync(`${slot}.dtm`, { force: true });
  await pipe.tap("A");
  await sleep(250); // the Qt thread queues the job (State::Save → RunOnCPUThread)
  await resume();
  for (let waited = 0; !existsSync(slot); waited += 50) {
    if (waited > 20000) throw new Error(`no savestate at ${slot} (is the hotkey bound? run battle-user.ts)`);
    await sleep(50);
  }
  await sleep(100);
  if (statSync(slot).size < 1024) throw new Error(`${slot}: truncated savestate`);
  copyFileSync(slot, dest);
  return { movieActive: existsSync(`${slot}.dtm`) };
}
