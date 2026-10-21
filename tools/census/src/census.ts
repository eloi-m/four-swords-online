// Catalogs every file of an extracted disc, recursing into Yaz0 and RARC containers, and writes
// out/census/catalog.json plus a human-readable out/census/report.md.
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { decompressYaz0, identify, isRarc, isYaz0, parseRarc } from "@fso/formats";

interface Entry {
  path: string; // disc path; files inside archives are "<archive path>/<path in archive>"
  size: number; // stored size
  rawSize: number; // size after Yaz0 decompression
  yaz0: boolean;
  type: string;
  head: string; // first 8 bytes (after decompression), hex
  archive?: { rootName: string; dirs: string[]; fileCount: number };
}

const [extractedArg = "extracted", outArg = "out/census"] = process.argv.slice(2);
const root = resolve(extractedArg, "files");
const outDir = resolve(outArg);
const entries: Entry[] = [];

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes.subarray(0, 8)).toString("hex");
}

function visit(path: string, stored: Uint8Array) {
  const yaz0 = isYaz0(stored);
  const bytes = yaz0 ? decompressYaz0(stored) : stored;
  const type = isRarc(bytes) ? "rarc" : identify(bytes, path);
  const entry: Entry = { path, size: stored.length, rawSize: bytes.length, yaz0, type, head: hex(bytes) };
  entries.push(entry);
  if (type === "rarc") {
    const archive = parseRarc(bytes);
    entry.archive = { rootName: archive.rootName, dirs: archive.dirs, fileCount: archive.files.length };
    for (const file of archive.files) visit(`${path}/${file.path}`, file.data);
  }
}

async function walk(dir: string) {
  for (const dirent of await readdir(dir, { withFileTypes: true })) {
    if (dirent.name === "CVS") continue; // leftover source-control metadata on the disc
    const full = join(dir, dirent.name);
    if (dirent.isDirectory()) await walk(full);
    else visit(relative(root, full), await readFile(full));
  }
}

await walk(root);
await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, "catalog.json"), JSON.stringify(entries, null, 1));
await writeFile(join(outDir, "report.md"), report());
console.log(`cataloged ${entries.length} entries -> ${outDir}`);

function report(): string {
  const lines: string[] = ["# Disc census", ""];
  const top = entries.filter((e) => !e.path.includes(".arc/"));
  lines.push(`${top.length} disc files, ${entries.length} entries including archive contents.`, "");

  lines.push("## Types (all entries)", "", "| type | count | raw bytes | example |", "|---|---|---|---|");
  const byType = new Map<string, Entry[]>();
  for (const e of entries) byType.set(e.type, [...(byType.get(e.type) ?? []), e]);
  for (const [type, list] of [...byType].sort((a, b) => b[1].length - a[1].length)) {
    const bytes = list.reduce((s, e) => s + e.rawSize, 0);
    lines.push(`| ${type} | ${list.length} | ${bytes} | \`${list[0]!.path}\` |`);
  }

  lines.push("", "## Top-level archives", "", "| archive | yaz0 | files | subfolders (file count) |", "|---|---|---|---|");
  for (const e of top.filter((e) => e.archive)) {
    const counts = new Map<string, number>();
    for (const inner of entries) {
      if (!inner.path.startsWith(`${e.path}/`) || inner.archive) continue;
      const rel = inner.path.slice(e.path.length + 1);
      const folder = rel.includes("/") ? rel.slice(0, rel.indexOf("/")) : ".";
      counts.set(folder, (counts.get(folder) ?? 0) + 1);
    }
    const summary = [...counts].map(([k, v]) => `${k}(${v})`).join(" ");
    lines.push(`| \`${e.path}\` | ${e.yaz0 ? "y" : ""} | ${e.archive!.fileCount} | ${summary} |`);
  }

  lines.push("", "## Non-archive disc files", "", "| file | type | size |", "|---|---|---|");
  for (const e of top.filter((e) => !e.archive)) lines.push(`| \`${e.path}\` | ${e.type} | ${e.size} |`);
  return `${lines.join("\n")}\n`;
}
