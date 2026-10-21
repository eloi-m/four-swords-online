// Vite plugin, dev server only (captures and replays, docs/tools.md): receives the apps' captures (F8,
// packages/web/src/capture.ts) at <base>__fso/capture and writes them under captures/ (captures.ts), one line per
// capture appended to captures/index.jsonl for a watcher. Serves a capture's replay.json back at
// <base>__fso/captures/<id|latest>/replay.json for the apps' #replay=. `vite build` and `vite preview` don't use it.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import type { Plugin } from "vite";
import { captureFolder, capturesDir, indexFile, repoRelative, type IndexEntry } from "./captures.ts";

interface Posted {
  app: string;
  url: string;
  time: string;
  note: string;
  png: string;
  viewport: unknown;
  info: Record<string, unknown>;
  state: unknown;
  replay: { tick?: number } | null;
}

/** A sortable, readable id: 20261009-143205-123-battle. */
function newId(app: string): string {
  const d = new Date(), p = (n: number, w = 2) => String(n).padStart(w, "0");
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${p(d.getMilliseconds(), 3)}`;
  return `${stamp}-${app.replace(/\W/g, "")}`;
}

/** Writes a posted capture; returns its index line. */
export function writeCapture(posted: Posted): IndexEntry {
  const id = newId(posted.app || "page"), dir = join(capturesDir(), id);
  mkdirSync(dir, { recursive: true });
  const png = /^data:image\/png;base64,(.*)$/s.exec(posted.png ?? "");
  if (png) writeFileSync(join(dir, "frame.png"), Buffer.from(png[1]!, "base64"));
  const { png: _, state, replay, ...meta } = posted;
  writeFileSync(join(dir, "capture.json"), `${JSON.stringify({ id, ...meta }, null, 2)}\n`);
  writeFileSync(join(dir, "state.json"), JSON.stringify(state));
  if (replay) writeFileSync(join(dir, "replay.json"), JSON.stringify(replay));
  const tick = typeof posted.info?.tick === "number" ? posted.info.tick : null;
  const entry: IndexEntry = { id, time: posted.time, app: posted.app, note: posted.note ?? "", tick, url: posted.url, frame: repoRelative(join(dir, "frame.png")), replay: !!replay };
  appendFileSync(indexFile(), `${JSON.stringify(entry)}\n`);
  return entry;
}

export function captures(): Plugin {
  const handle = (base: string) => (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = (req.url ?? "").split("?")[0]!;
    if (url === `${base}__fso/capture` && req.method === "POST") {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        try {
          const entry = writeCapture(JSON.parse(Buffer.concat(chunks).toString("utf8")) as Posted);
          console.log(`[capture] ${entry.id}${entry.note ? `: ${entry.note}` : ""} -> ${entry.frame}`);
          reply(res, 200, JSON.stringify({ id: entry.id, dir: repoRelative(join(capturesDir(), entry.id)) }));
        } catch (error) {
          reply(res, 500, (error as Error).message);
        }
      });
      return;
    }
    const replay = new RegExp(`^${base}__fso/captures/([\\w-]+)/replay\\.json$`).exec(url);
    if (replay && req.method === "GET") {
      try {
        const file = join(captureFolder(replay[1]), "replay.json");
        if (!existsSync(file)) return reply(res, 404, `capture ${replay[1]} has no replay`);
        return reply(res, 200, readFileSync(file, "utf8"));
      } catch (error) {
        return reply(res, 404, (error as Error).message);
      }
    }
    next();
  };
  return {
    name: "fso-captures",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(handle(server.config.base));
    },
  };
}

function reply(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { "Content-Type": status === 200 ? "application/json" : "text/plain; charset=utf-8", "Cache-Control": "no-store" });
  res.end(body);
}
