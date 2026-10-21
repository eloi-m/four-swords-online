// Node-only helpers: file-backed byte sources and native decompressors.
import { open } from "node:fs/promises";
import { zstdDecompressSync } from "node:zlib";
import { openDisc, type GameCubeDisc } from "./gcdisc.ts";
import { Compression, type Decompressor } from "./rvz.ts";
import type { ByteSource } from "./source.ts";

export const nodeDecompressors: Partial<Record<number, Decompressor>> = {
  [Compression.Zstd]: (input) => zstdDecompressSync(input),
};

export async function openFileSource(path: string): Promise<ByteSource & { close(): Promise<void> }> {
  const handle = await open(path, "r");
  const { size } = await handle.stat();
  return {
    size,
    async read(offset, length) {
      const buffer = new Uint8Array(length);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      return bytesRead === length ? buffer : buffer.subarray(0, bytesRead);
    },
    close: () => handle.close(),
  };
}

export async function openDiscFile(path: string): Promise<GameCubeDisc & { close(): Promise<void> }> {
  const source = await openFileSource(path);
  const disc = await openDisc(source, nodeDecompressors);
  return Object.assign(disc, { close: () => source.close() });
}
