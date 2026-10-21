// The game files, served over HTTP next to the pages (protocol.ts): the manifest is fetched once per page, then each
// file on demand under its content hash, so the browser's HTTP cache keeps it until the file changes.
import { DATA_DIR, EXPECTED_DISC, MANIFEST, type DataFile, type DataManifest, type Manifest } from "./protocol.ts";

export interface AssetStore {
  readonly manifest: Manifest;
  read(path: string): Promise<Uint8Array>;
}

/** Bytes received so far and bytes asked for so far, over every read of the store. */
export type LoadProgress = (loaded: number, total: number) => void;

export class HttpStore implements AssetStore {
  readonly manifest: Manifest;
  /** Called as file data arrives (boot screens show it); null to stop. */
  onProgress: LoadProgress | null = null;
  private readonly dir: string;
  private readonly entries: Map<string, DataFile>;
  private loaded = 0;
  private total = 0;

  constructor(dir: string, data: DataManifest) {
    this.dir = dir;
    this.entries = new Map(data.files.map((f) => [f.path, f]));
    const bytes = data.files.reduce((sum, f) => sum + f.size, 0);
    this.manifest = { gameId: data.gameId, revision: data.revision, files: data.files.map((f) => f.path), bytes };
  }

  async read(path: string): Promise<Uint8Array> {
    const entry = this.entries.get(path);
    if (!entry) throw new Error(`missing ${path}`);
    const url = `${this.dir}${path.split("/").map(encodeURIComponent).join("/")}?v=${entry.hash}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    this.total += entry.size;
    this.report();
    const bytes = await this.receive(response, entry.size);
    if (bytes.length !== entry.size) throw new Error(`${path}: got ${bytes.length} bytes, expected ${entry.size}`);
    return bytes;
  }

  /** The body into one buffer of the manifest's size (no copies), reporting progress on the way. */
  private async receive(response: Response, size: number): Promise<Uint8Array> {
    const reader = response.body?.getReader();
    if (!reader) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      this.loaded += bytes.length;
      this.report();
      return bytes;
    }
    let bytes = new Uint8Array(size), at = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (at + value.length > bytes.length) {
        const grown = new Uint8Array(Math.max(at + value.length, bytes.length * 2));
        grown.set(bytes.subarray(0, at));
        bytes = grown;
      }
      bytes.set(value, at);
      at += value.length;
      this.loaded += value.length;
      this.report();
    }
    return at === bytes.length ? bytes : bytes.slice(0, at);
  }

  private report(): void {
    this.onProgress?.(this.loaded, this.total);
  }
}

/** A status line for the tools: "G4SE01 rev 0 · 135 files, 40.9 MB". */
export const describeManifest = (m: Manifest): string => `${m.gameId} rev ${m.revision} · ${m.files.length} files, ${(m.bytes / 1e6).toFixed(1)} MB`;

/** The game files of this site: `<base>data/` (tools/bundle's output, or its Vite plugin in dev and preview). */
export async function openServerStore(base: string = import.meta.env.BASE_URL): Promise<HttpStore> {
  const dir = new URL(`${base.endsWith("/") ? base : `${base}/`}${DATA_DIR}/`, location.href).href;
  let response: Response;
  try {
    // Revalidated on every page load (whatever the server's caching headers): it names the current file versions.
    response = await fetch(`${dir}${MANIFEST}`, { cache: "no-cache" });
  } catch (error) {
    throw new Error(`Couldn't reach the game files at ${dir} (${(error as Error).message}).`);
  }
  if (!response.ok) {
    const detail = response.headers.get("content-type")?.startsWith("text/plain") ? ` ${(await response.text()).slice(0, 300)}` : "";
    throw new Error(`The game files aren't on this server (${dir}${MANIFEST}: HTTP ${response.status}).${detail}`);
  }
  // (A server's fallback page, e.g. an SPA's index.html for unknown paths, isn't a manifest.)
  const data = (await response.json().catch(() => null)) as DataManifest | null;
  if (!Array.isArray(data?.files)) throw new Error(`The game files aren't on this server (${dir}${MANIFEST} isn't a manifest).`);
  if (data.gameId !== EXPECTED_DISC.gameId || data.revision !== EXPECTED_DISC.revision) {
    throw new Error(`The server has files from ${data.gameId} rev ${data.revision}; only the USA disc (G4SE01 rev 0) is supported.`);
  }
  return new HttpStore(dir, data);
}
