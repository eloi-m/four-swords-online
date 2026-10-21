// Vite plugin for the dev server and `vite preview`: serves the game files at <base>data/ as a deployment does
// (tools/bundle/src/main.ts's output behind a web server), so every page loads them without a build step. The
// source is the repo's extracted/ folder (its manifest computed on the fly), or FSO_DATA: another extracted disc or a
// bundle folder. Builds are untouched: no game file ever enters the build output.
import { createReadStream } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import type { Plugin } from "vite";
import { DATA_DIR, MANIFEST, type DataFile } from "@fso/web/protocol";
import { hashBytes, isBundle, manifestJson, readBundle, scanExtracted, type DataSet } from "./data.ts";

const REPO = resolve(import.meta.dirname, "../../..");
const LOBBY_TOKEN = "lobby-token";

/** The folder served at <base>data/: FSO_DATA, else the repo's extracted/. */
export const dataSource = (): string => resolve(REPO, process.env.FSO_DATA ?? "extracted");

export function gameData(): Plugin {
  const source = dataSource();
  const hashes = new Map<string, { key: string; file: DataFile }>();
  let current: { set: DataSet; json: string; byPath: Map<string, DataFile> } | null = null;
  // Rescanned on every manifest request (cheap: hashes are kept while a file's size and date don't change).
  const load = () => {
    const set = isBundle(source) ? readBundle(source) : scanExtracted(source, {}, hashes);
    const json = manifestJson(set.manifest);
    if (current?.json !== json) current = { set, json, byPath: new Map(set.manifest.files.map((f) => [f.path, f])) };
    return current;
  };

  const handle = (base: string) => (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const prefix = `${base}${DATA_DIR}/`;
    const url = req.url ?? "";
    if (!url.startsWith(prefix) || (req.method !== "GET" && req.method !== "HEAD")) return next();
    const query = url.indexOf("?");
    const version = new URLSearchParams(query < 0 ? "" : url.slice(query)).get("v");
    let path: string, data;
    try {
      path = decodeURIComponent(url.slice(prefix.length, query < 0 ? undefined : query));
    } catch {
      return fail(res, 400, "malformed path");
    }
    // The lobby's shared secret (apps/battle/src/online.ts withLobbyToken; a deployment writes it next to the game
    // files): LOBBY_TOKEN when this dev server's lobby was started with one, else none (an open lobby, no 404).
    if (path === LOBBY_TOKEN) {
      const token = process.env.LOBBY_TOKEN?.trim();
      res.setHeader("Cache-Control", "no-store");
      if (!token) return void res.writeHead(204).end();
      return send(req, res, "text/plain", token, `"${hashBytes(new TextEncoder().encode(token))}"`, "no-store");
    }
    try {
      data = path === MANIFEST || !current ? load() : current;
    } catch (error) {
      const hint = "Extract the disc first (pnpm --filter @fso/extract extract <disc.rvz> extracted) or point FSO_DATA at a bundle (pnpm bundle).";
      return fail(res, 404, `No game files in ${source}: ${(error as Error).message}. ${hint}`);
    }
    if (path === MANIFEST) return send(req, res, "application/json", data.json, `"${hashBytes(new TextEncoder().encode(data.json))}"`, "no-cache");
    const file = data.byPath.get(path);
    if (!file) return fail(res, 404, `${path} isn't one of the game files`);
    const etag = `"${file.hash}"`;
    res.setHeader("Cache-Control", version === file.hash ? "max-age=31536000, immutable" : "no-cache");
    res.setHeader("ETag", etag);
    if (req.headers["if-none-match"] === etag) return void res.writeHead(304).end();
    res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": file.size });
    if (req.method === "HEAD") return void res.end();
    createReadStream(data.set.sources.get(path)!).on("error", () => res.destroy()).pipe(res);
  };

  return {
    name: "fso-game-data",
    configureServer(server) {
      server.middlewares.use(handle(server.config.base));
    },
    configurePreviewServer(server) {
      server.middlewares.use(handle(server.config.base));
    },
  };
}

function send(req: IncomingMessage, res: ServerResponse, type: string, body: string, etag: string, cache: string): void {
  res.setHeader("Cache-Control", cache);
  res.setHeader("ETag", etag);
  if (req.headers["if-none-match"] === etag) return void res.writeHead(304).end();
  res.writeHead(200, { "Content-Type": type, "Content-Length": Buffer.byteLength(body) });
  res.end(req.method === "HEAD" ? undefined : body);
}

function fail(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" });
  res.end(message);
}
