// The game files as the server publishes them, shared by the pages (HttpStore) and the node side that writes them
// (tools/bundle: `pnpm bundle` for a deployment, its Vite plugin in dev and preview). No DOM or node APIs here.
//   <base>data/manifest.json    the DataManifest below, always revalidated
//   <base>data/<path>?v=<hash>  a file, cached for good (the hash changes with its content)

export const EXPECTED_DISC = { gameId: "G4SE01", revision: 0 } as const;
/** The folder under the site's base URL. */
export const DATA_DIR = "data";
export const MANIFEST = "manifest.json";
export const SYS_DOL = "sys/main.dol";

export interface DataFile {
  path: string; // e.g. "GC4Sword_usa/data.arc"
  size: number;
  hash: string; // the first 16 hex digits of the content's SHA-256
}

/** manifest.json: the disc the files come from and every file, sorted by path. Deterministic (no dates). */
export interface DataManifest {
  gameId: string;
  revision: number;
  files: DataFile[];
}

/** What a page sees of the manifest (AssetStore.manifest). */
export interface Manifest {
  gameId: string;
  revision: number;
  files: string[]; // disc paths, e.g. "GC4Sword_usa/data.arc", plus SYS_DOL
  bytes: number;
}

/** The files a page may need: every disc file but the THP videos (220 MB) and leftover CVS metadata, plus main.dol
 * (game tables read directly: tile types, …). `path` is a disc path or SYS_DOL. */
export function wantedFile(path: string): boolean {
  if (path === SYS_DOL) return true;
  if (path.startsWith("sys/")) return false;
  return !/\.thp$/i.test(path) && !path.split("/").includes("CVS");
}
