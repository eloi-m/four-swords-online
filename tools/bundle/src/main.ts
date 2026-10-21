// Copies the game files the pages load from an extracted disc into a folder a web server publishes as <base>data/
// (packages/web/src/protocol.ts): manifest.json plus the files under their disc paths. Re-running only rewrites
// what changed and removes files that are no longer wanted, so the folder can be synced as is.
//   node tools/bundle/src/main.ts [extractedDir=extracted] [outDir=out/fso-data] [--decompress]
// --decompress stores Yaz0 archives decompressed (measured: 41 → 86 MB for ~200 ms less decoding over every archive
// on a desktop CPU; not worth it by default). The output holds Nintendo data: it must stay out of git and out of any
// Docker build context, so inside the repo only out/ (gitignored, not in .dockerignore's allowlist) is accepted.
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { bundledBytes, hashBytes, manifestJson, scanExtracted } from "./data.ts";
import { MANIFEST } from "@fso/web/protocol";

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const [extractedArg = "extracted", outArg = "out/fso-data"] = args.filter((a) => !a.startsWith("--"));
if (flags.has("--help") || [...flags].some((f) => f !== "--decompress")) {
  console.error("usage: bundle [extractedDir=extracted] [outDir=out/fso-data] [--decompress]");
  process.exit(1);
}
const decompress = flags.has("--decompress");
const extracted = resolve(extractedArg), out = resolve(outArg);
const repo = resolve(import.meta.dirname, "../../..");

const inside = (dir: string, parent: string) => dir === parent || dir.startsWith(parent + sep);
if (inside(out, repo) && !inside(out, join(repo, "out"))) {
  console.error(`refusing to write game files to ${out}: inside the repository only out/ is kept out of git and Docker`);
  process.exit(1);
}
if (inside(out, extracted) || inside(extracted, out)) {
  console.error(`the output folder (${out}) and the extracted disc (${extracted}) must not contain each other`);
  process.exit(1);
}

const started = performance.now();
const { manifest, sources } = scanExtracted(extracted, { decompress });
let written = 0, removed = 0, bytes = 0;
for (const file of manifest.files) {
  const target = join(out, ...file.path.split("/"));
  bytes += file.size;
  if (sameFile(target, file.size, file.hash)) continue;
  mkdirSync(dirname(target), { recursive: true });
  writeAtomically(target, bundledBytes(sources.get(file.path)!, { decompress }));
  written++;
}

// Whatever else is in the folder (files that are no longer wanted, a previous --decompress run's leftovers) goes.
const keep = new Set([MANIFEST, ...manifest.files.map((f) => f.path)]);
const prune = (dir: string): boolean => {
  let empty = true;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory() && prune(path)) rmdirSync(path);
    else if (entry.isDirectory() || keep.has(relative(out, path).split(sep).join("/"))) empty = false;
    else {
      unlinkSync(path);
      removed++;
    }
  }
  return empty;
};
prune(out);

const json = manifestJson(manifest);
const manifestPath = join(out, MANIFEST);
if (readText(manifestPath) !== json) writeAtomically(manifestPath, new TextEncoder().encode(json));
const manifestHash = createHash("sha256").update(json).digest("hex").slice(0, 16);
console.log(
  `${manifest.gameId} rev ${manifest.revision}: ${manifest.files.length} files, ${(bytes / 1e6).toFixed(1)} MB${decompress ? " (Yaz0 decompressed)" : ""} → ${out}\n` +
    `${written} written, ${removed} removed, manifest ${manifestHash} (${((performance.now() - started) / 1000).toFixed(1)} s)`,
);

function sameFile(path: string, size: number, hash: string): boolean {
  try {
    return statSync(path).size === size && hashBytes(new Uint8Array(readFileSync(path))) === hash;
  } catch {
    return false;
  }
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function writeAtomically(path: string, bytes: Uint8Array): void {
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, bytes);
  renameSync(temp, path);
}
