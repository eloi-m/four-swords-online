// Minimal RFC 6455 WebSocket server side: the upgrade handshake, masked client frames (text, binary, fragments),
// ping/pong and the close handshake. No extensions (no permessage-deflate) and no subprotocols.
import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import type { Duplex } from "node:stream";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const Op = { Continuation: 0, Text: 1, Binary: 2, Close: 8, Ping: 9, Pong: 10 } as const;

export const MAX_MESSAGE = 64 * 1024;

export function acceptKey(key: string): string {
  return createHash("sha1").update(key + GUID).digest("base64");
}

export class WsConnection {
  onmessage: (data: string | Uint8Array) => void = () => {};
  onclose: () => void = () => {};
  /** Set by any frame from the peer; the server's heartbeat clears it and pings. */
  alive = true;
  readonly remoteAddress: string;
  private readonly socket: Duplex;
  private buffer: Buffer = Buffer.alloc(0);
  private fragments: Buffer[] = [];
  private fragmentOp = 0;
  private fragmentBytes = 0;
  private closing = false;
  private closed = false;
  private readonly decoder = new TextDecoder("utf-8", { fatal: true });

  constructor(socket: Duplex, remoteAddress: string, head: Buffer = Buffer.alloc(0)) {
    this.socket = socket;
    this.remoteAddress = remoteAddress;
    // Bytes that came with the upgrade request: parsed once the caller has installed onmessage.
    if (head.length > 0) queueMicrotask(() => this.receive(Buffer.from(head)));
    socket.on("data", (chunk: Buffer) => this.receive(chunk));
    socket.on("close", () => this.finish());
    socket.on("error", () => this.finish());
  }

  get open(): boolean {
    return !this.closing && !this.closed;
  }

  send(data: string | Uint8Array): void {
    if (!this.open) return;
    if (typeof data === "string") this.frame(Op.Text, Buffer.from(data, "utf8"));
    else this.frame(Op.Binary, Buffer.from(data.buffer, data.byteOffset, data.byteLength));
  }

  ping(): void {
    if (this.open) this.frame(Op.Ping, Buffer.alloc(0));
  }

  close(code = 1000, reason = ""): void {
    if (!this.open) return;
    const payload = Buffer.alloc(2 + Buffer.byteLength(reason));
    payload.writeUInt16BE(code, 0);
    payload.write(reason, 2);
    this.frame(Op.Close, payload);
    this.closing = true;
    this.socket.end();
    // A peer that never answers the close frame gets cut after a while.
    setTimeout(() => this.socket.destroy(), 2000).unref();
  }

  terminate(): void {
    this.socket.destroy();
    this.finish();
  }

  private finish(): void {
    if (this.closed) return;
    this.closed = true;
    this.onclose();
  }

  private frame(op: number, payload: Buffer): void {
    const n = payload.length;
    const header = Buffer.alloc(n < 126 ? 2 : n < 0x10000 ? 4 : 10);
    header[0] = 0x80 | op;
    if (n < 126) header[1] = n;
    else if (n < 0x10000) {
      header[1] = 126;
      header.writeUInt16BE(n, 2);
    } else {
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(n), 2);
    }
    this.socket.write(Buffer.concat([header, payload]));
  }

  private fail(code: number, reason: string): void {
    this.buffer = Buffer.alloc(0);
    this.close(code, reason);
  }

  private receive(chunk: Buffer): void {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    while (!this.closed) {
      const b = this.buffer;
      if (b.length < 2) return;
      const fin = (b[0]! & 0x80) !== 0, rsv = b[0]! & 0x70, op = b[0]! & 0x0f;
      const masked = (b[1]! & 0x80) !== 0;
      let len = b[1]! & 0x7f, offset = 2;
      if (len === 126) {
        if (b.length < 4) return;
        len = b.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (b.length < 10) return;
        const big = b.readBigUInt64BE(2);
        if (big > BigInt(MAX_MESSAGE)) return this.fail(1009, "message too big");
        len = Number(big);
        offset = 10;
      }
      if (rsv !== 0) return this.fail(1002, "no extensions negotiated");
      if (!masked) return this.fail(1002, "client frames must be masked");
      if (len > MAX_MESSAGE) return this.fail(1009, "message too big");
      if (b.length < offset + 4 + len) return;
      const mask = b.subarray(offset, offset + 4);
      const payload = Buffer.from(b.subarray(offset + 4, offset + 4 + len));
      for (let i = 0; i < len; i++) payload[i] = payload[i]! ^ mask[i & 3]!;
      this.buffer = b.subarray(offset + 4 + len);
      this.alive = true;
      if (op >= 8) {
        if (!fin || len > 125) return this.fail(1002, "bad control frame");
        if (op === Op.Ping) this.frame(Op.Pong, payload);
        else if (op === Op.Close) {
          if (!this.closing) {
            const code = len >= 2 ? payload.readUInt16BE(0) : 1000;
            this.close(code === 1005 || code === 1006 ? 1000 : code);
          }
          this.socket.end();
          return;
        } else if (op !== Op.Pong) return this.fail(1002, "unknown opcode");
        continue;
      }
      if (op === Op.Continuation) {
        if (this.fragments.length === 0) return this.fail(1002, "unexpected continuation");
      } else if (op === Op.Text || op === Op.Binary) {
        if (this.fragments.length > 0) return this.fail(1002, "expected a continuation");
        this.fragmentOp = op;
      } else return this.fail(1002, "unknown opcode");
      this.fragments.push(payload);
      this.fragmentBytes += len;
      if (this.fragmentBytes > MAX_MESSAGE) return this.fail(1009, "message too big");
      if (!fin) continue;
      const message = this.fragments.length === 1 ? this.fragments[0]! : Buffer.concat(this.fragments);
      this.fragments = [];
      this.fragmentBytes = 0;
      if (this.fragmentOp === Op.Text) {
        let text: string;
        try {
          text = this.decoder.decode(message);
        } catch {
          return this.fail(1007, "invalid utf-8");
        }
        this.onmessage(text);
      } else this.onmessage(new Uint8Array(message.buffer, message.byteOffset, message.length));
    }
  }
}

/** Completes the handshake of an HTTP upgrade request, or answers 400 and returns null. */
export function upgrade(req: IncomingMessage, socket: Duplex, head: Buffer, address = req.socket.remoteAddress ?? "?"): WsConnection | null {
  const key = req.headers["sec-websocket-key"];
  if (req.headers.upgrade?.toLowerCase() !== "websocket" || typeof key !== "string" || req.headers["sec-websocket-version"] !== "13") {
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    return null;
  }
  (socket as Socket).setNoDelay?.(true);
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`);
  return new WsConnection(socket, address, head);
}
