// The game files the pages load (packages/web/src/protocol.ts), taken from a Dolphin-style extracted/ folder
// (tools/extract: sys/boot.bin, sys/main.dol, files/<disc paths>) or from a bundle this tool wrote.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { decompressYaz0, isYaz0 } from "@fso/formats";
import { EXPECTED_DISC, MANIFEST, SYS_DOL, wantedFile, type DataFile, type DataManifest } from "@fso/web/protocol";

export interface DataSet {
  manifest: DataManifest;
  /** Each manifest path's bytes on disk. */
  sources: Map<string, string>;
}

export interface ScanOptions {
  /** Store Yaz0 archives decompressed (off by default: 3.4× the bytes for a few ms of decoding per archive). */
  decompress?: boolean;
}

export const hashBytes = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex").slice(0, 16);

/** The game ID and revision from sys/boot.bin (the disc header). */
export function readDiscId(extracted: string): { gameId: string; revision: number } {
  const boot = readFileSync(join(extracted, "sys", "boot.bin"));
  return { gameId: boot.subarray(0, 6).toString("latin1"), revision: boot[7]! };
}

/** Every wanted file of an extracted disc: manifest path → file on disk (disc paths under files/, plus main.dol). */
export function listFiles(extracted: string): Map<string, string> {
  const sources = new Map<string, string>();
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = `${prefix}${entry.name}`;
      if (entry.isDirectory()) walk(join(dir, entry.name), `${path}/`);
      else if (wantedFile(path)) sources.set(path, join(dir, entry.name));
    }
  };
  walk(join(extracted, "files"), "");
  sources.set(SYS_DOL, join(extracted, SYS_DOL));
  return new Map([...sources].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** A file's bytes as the bundle stores them. */
export function bundledBytes(source: string, options: ScanOptions = {}): Uint8Array {
  const bytes = new Uint8Array(readFileSync(source));
  return options.decompress && isYaz0(bytes) ? decompressYaz0(bytes) : bytes;
}

/**
 * Scans an extracted disc into a manifest. `cache` keeps the hashes between calls (the dev server rescans on every
 * manifest request): a file whose size and modification time didn't change isn't read again.
 */
export function scanExtracted(extracted: string, options: ScanOptions = {}, cache = new Map<string, { key: string; file: DataFile }>()): DataSet {
  const { gameId, revision } = readDiscId(extracted);
  if (gameId !== EXPECTED_DISC.gameId || revision !== EXPECTED_DISC.revision) {
    throw new Error(`${extracted} holds ${gameId} rev ${revision}; only the USA disc (G4SE01 rev 0) is supported`);
  }
  const sources = listFiles(extracted);
  const files: DataFile[] = [];
  for (const [path, source] of sources) {
    const stat = statSync(source);
    const key = `${stat.size}:${stat.mtimeMs}:${options.decompress ? 1 : 0}`;
    let hit = cache.get(source);
    if (hit?.key !== key) {
      const bytes = bundledBytes(source, options);
      hit = { key, file: { path, size: bytes.length, hash: hashBytes(bytes) } };
      cache.set(source, hit);
    }
    files.push(hit.file);
  }
  return { manifest: { gameId, revision, files }, sources };
}

/** A bundle written by `pnpm bundle`: its manifest, files next to it. */
export function readBundle(dir: string): DataSet {
  const manifest = JSON.parse(readFileSync(join(dir, MANIFEST), "utf8")) as DataManifest;
  return { manifest, sources: new Map(manifest.files.map((f) => [f.path, join(dir, ...f.path.split("/"))])) };
}

/** Whether `dir` is a bundle (it has a manifest.json) rather than an extracted disc. */
export function isBundle(dir: string): boolean {
  try {
    return statSync(join(dir, MANIFEST)).isFile();
  } catch {
    return false;
  }
}

/** manifest.json's text: one file per line, so that two bundles diff well. */
export const manifestJson = ({ files, ...disc }: DataManifest): string =>
  `${JSON.stringify(disc).slice(0, -1)},"files":[\n${files.map((f) => JSON.stringify(f)).join(",\n")}\n]}\n`;
