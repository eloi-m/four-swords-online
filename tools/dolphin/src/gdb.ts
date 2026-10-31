// Minimal GDB Remote Serial Protocol client for Dolphin's built-in stub (Source/Core/Core/PowerPC/GDBStub.cpp),
// enabled with `[General] GDBPort`. Dolphin then waits for us at boot with the CPU paused. Quirks of that stub:
// no acks are expected from us, memory reads are capped at ~4.9 KB per packet, only GPRs come back from `g`, and an
// interrupt (0x03) may produce two stop replies. Packets: `$<data>#<2-hex checksum>`.
import { connect, type Socket } from "node:net";

export interface StopReply {
  signal: number;
  pc: number;
}

const MAX_READ = 0x1000;
const DEBUG = !!process.env.GDB_DEBUG;

export class GdbClient {
  private socket: Socket;
  private buffer = "";
  private packets: string[] = [];
  private waiters: ((packet: string) => void)[] = [];
  private closed: Error | null = null;

  private constructor(socket: Socket) {
    this.socket = socket;
    socket.setNoDelay(true);
    socket.setEncoding("latin1");
    socket.on("data", (chunk: string) => this.receive(chunk));
    socket.on("close", () => this.fail(new Error("GDB connection closed")));
    socket.on("error", (error) => this.fail(error));
  }

  /** Connects, retrying until Dolphin's stub listens (it only opens the port once the game boots). */
  static async connect(port: number, host = "127.0.0.1", timeoutMs = 30000): Promise<GdbClient> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        const socket = await new Promise<Socket>((resolve, reject) => {
          const s = connect(port, host, () => resolve(s));
          s.once("error", reject);
        });
        return new GdbClient(socket);
      } catch (error) {
        if (Date.now() > deadline) throw error;
        await new Promise((r) => setTimeout(r, 200));
      }
    }
  }

  private receive(chunk: string): void {
    if (DEBUG) console.error("<-", JSON.stringify(chunk.slice(0, 200)));
    this.buffer += chunk;
    for (;;) {
      // Skip acks/naks and stray bytes up to the next packet start.
      const start = this.buffer.indexOf("$");
      if (start < 0) {
        this.buffer = "";
        return;
      }
      const end = this.buffer.indexOf("#", start);
      if (end < 0 || end + 3 > this.buffer.length) {
        this.buffer = this.buffer.slice(start);
        return;
      }
      const data = this.buffer.slice(start + 1, end);
      this.buffer = this.buffer.slice(end + 3);
      const waiter = this.waiters.shift();
      if (waiter) waiter(data);
      else this.packets.push(data);
    }
  }

  private fail(error: Error): void {
    this.closed ??= error;
    for (const w of this.waiters.splice(0)) w("\0" + error.message);
  }

  private next(timeoutMs: number): Promise<string> {
    const queued = this.packets.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    if (this.closed) return Promise.reject(this.closed);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        reject(new Error(`GDB reply timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      const waiter = (packet: string) => {
        clearTimeout(timer);
        if (packet.startsWith("\0")) reject(new Error(packet.slice(1)));
        else resolve(packet);
      };
      this.waiters.push(waiter);
    });
  }

  private send(data: string): void {
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum = (sum + data.charCodeAt(i)) & 0xff;
    if (DEBUG) console.error("->", data.slice(0, 200));
    this.socket.write(`$${data}#${sum.toString(16).padStart(2, "0")}`, "latin1");
  }

  /** Sends a command and returns its reply, skipping stale stop replies (`T..`/`S..`) left over from interrupts. */
  async command(data: string, timeoutMs = 10000): Promise<string> {
    this.send(data);
    for (;;) {
      const reply = await this.next(timeoutMs);
      if (!/^[TS][0-9a-fA-F]{2}/.test(reply)) return reply;
    }
  }

  async readMemory(address: number, length: number): Promise<Uint8Array> {
    const out = new Uint8Array(length);
    for (let o = 0; o < length; o += MAX_READ) {
      const n = Math.min(MAX_READ, length - o);
      const reply = await this.command(`m${(address + o).toString(16)},${n.toString(16)}`);
      if (reply.length !== n * 2) throw new Error(`read ${hex(address + o)}+${n}: ${reply || "empty reply"}`);
      for (let i = 0; i < n; i++) out[o + i] = parseInt(reply.substr(i * 2, 2), 16);
    }
    return out;
  }

  async writeMemory(address: number, data: Uint8Array): Promise<void> {
    const body = Array.from(data, (b) => b.toString(16).padStart(2, "0")).join("");
    const reply = await this.command(`M${address.toString(16)},${data.length.toString(16)}:${body}`);
    if (reply !== "OK") throw new Error(`write ${hex(address)}: ${reply}`);
  }

  /** r0–r31. */
  async readGprs(): Promise<number[]> {
    const reply = await this.command("g");
    return Array.from({ length: 32 }, (_, i) => parseInt(reply.substr(i * 8, 8), 16) >>> 0);
  }

  /** GDB register numbering: 0–31 GPRs, 64 pc, 65 msr, 66 cr, 67 lr, 68 ctr. */
  async readRegister(id: number): Promise<number> {
    const reply = await this.command(`p${id.toString(16)}`);
    return parseInt(reply.slice(0, 8), 16) >>> 0;
  }

  async addBreakpoint(address: number): Promise<void> {
    await this.expectOk(`Z0,${address.toString(16)},4`);
  }

  async removeBreakpoint(address: number): Promise<void> {
    await this.expectOk(`z0,${address.toString(16)},4`);
  }

  /** Memory watchpoint; kind 2 = write, 3 = read, 4 = access. Slow: Dolphin single-steps while one is set. */
  async addWatchpoint(address: number, length: number, kind: 2 | 3 | 4 = 2): Promise<void> {
    await this.expectOk(`Z${kind},${address.toString(16)},${length.toString(16)}`);
  }

  async removeWatchpoint(address: number, length: number, kind: 2 | 3 | 4 = 2): Promise<void> {
    await this.expectOk(`z${kind},${address.toString(16)},${length.toString(16)}`);
  }

  /** Resumes and waits for the next stop (breakpoint, watchpoint or interrupt); `GDB_CONTINUE_MS` lengthens the wait
   *  on a loaded machine, where loading a savestate can take longer than the default. */
  async continue(timeoutMs = Number(process.env.GDB_CONTINUE_MS ?? 30000)): Promise<StopReply> {
    this.send("c");
    return this.waitStop(timeoutMs);
  }

  /** Stops a running CPU. Dolphin 2606 answers an interrupt with a stop reply, a stray empty packet (the stub
   *  re-dispatches its own reply buffer) and a second stop reply once the CPU thread parks; all three are drained. */
  async interrupt(timeoutMs = 10000): Promise<StopReply> {
    this.socket.write("\x03", "latin1");
    const stop = await this.waitStop(timeoutMs);
    for (let extra = 0; extra < 2; extra++) {
      try {
        await this.next(1000);
      } catch {
        break;
      }
    }
    return stop;
  }

  private async waitStop(timeoutMs: number): Promise<StopReply> {
    for (;;) {
      const reply = await this.next(timeoutMs);
      const m = /^T([0-9a-fA-F]{2})(.*)$/.exec(reply);
      if (!m) continue;
      const pc = /(?:^|;)40:([0-9a-fA-F]{8})/.exec(m[2]!);
      return { signal: parseInt(m[1]!, 16), pc: pc ? parseInt(pc[1]!, 16) >>> 0 : 0 };
    }
  }

  private async expectOk(data: string): Promise<void> {
    const reply = await this.command(data);
    if (reply !== "OK") throw new Error(`${data}: ${reply || "unsupported"}`);
  }

  /** Detaches (the stub shuts its socket; Dolphin keeps running). */
  close(): void {
    if (!this.closed) this.send("k");
    this.socket.end();
    this.closed ??= new Error("GDB connection closed");
  }
}

export const hex = (v: number, width = 8) => "0x" + (v >>> 0).toString(16).toUpperCase().padStart(width, "0");
