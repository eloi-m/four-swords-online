// The whole site in one build: the home page plus every app's own index.html (pages.ts), served from one origin.
// Vite's root is apps/, so each app page keeps working from its own sources; the `site` plugin maps the URLs (dev)
// and moves the built HTML (build) to the site's paths, points the apps' root-relative `/src/…` references at their
// own folder, and adds the home link (src/nav.ts) to the app pages and a web app manifest to every page (manifest.ts:
// Add to Home Screen opens the games fullscreen, in landscape).
//   pnpm build:site                 → apps/site/dist (static files; BASE=/sub/path/ to serve under a sub-path)
//   pnpm site:dev                   → the lobby server + this dev server on http://localhost:5191
// Every page loads the game files from <base>data/: in dev and preview the `gameData` plugin serves them from the
// repo's extracted/ folder; a deployment serves `pnpm bundle`'s output there. The build itself holds none.
// Online play reaches the lobby at ${BASE}signal on the page's own origin (a reverse proxy in production, see docs/deploy.md),
// or at VITE_SIGNAL_URL when set at build time. Dev and preview forward ${BASE}signal to FSO_SIGNAL_PORT (default 5185).
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { gameData } from "@fso/bundle/vite";
import { captures } from "@fso/capture/vite";
import { defineConfig, type Plugin } from "vite";
import { headTags, MANIFEST, manifestFor } from "./manifest.ts";
import { builtPath, PAGES, servedPath } from "./pages.ts";

const APPS = resolve(import.meta.dirname, "..");
const BASE = process.env.BASE ?? "/";
// The lobby answers at its root: keep only the query (?token=, tools/signal).
const signal = { target: `ws://127.0.0.1:${process.env.FSO_SIGNAL_PORT ?? 5185}`, ws: true, rewrite: (path: string) => path.replace(/^[^?]*/, "/") };

function site(): Plugin {
  let outDir = "", base = "/";
  const icon = () => readFileSync(resolve(import.meta.dirname, "src/icon.svg"));
  const byFile = new Map(PAGES.map((p) => [resolve(APPS, p.html), p]));
  // Dev URL prefixes → the folder under apps/ that holds the page (and the relative files it loads).
  const prefixes = PAGES.filter((p) => p.path).map((p) => ({ from: `/${p.path}`, to: `/${dirname(p.html)}/` }));
  const home = `/${PAGES.find((p) => !p.path)!.html}`;
  return {
    name: "fso-site",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
      base = config.base.endsWith("/") ? config.base : `${config.base}/`;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? "/";
        // The manifests and their icon (emitted as files by the build).
        const full = url.split("?")[0]!, path = full.startsWith(base) ? `/${full.slice(base.length)}` : full;
        const manifest = PAGES.find((p) => path === `/${p.path}${MANIFEST}`);
        if (manifest || path === "/icon.svg") {
          res.setHeader("Content-Type", manifest ? "application/manifest+json" : "image/svg+xml");
          res.end(manifest ? JSON.stringify(manifestFor(manifest, base)) : icon());
          return;
        }
        if (url === "/" || url.startsWith("/?") || url.startsWith("/index.html")) req.url = home + url.slice(url.indexOf("?") >= 0 ? url.indexOf("?") : url.length);
        else {
          const hit = prefixes.find((p) => url.startsWith(p.from) && p.from !== p.to);
          if (hit) req.url = hit.to + url.slice(hit.from.length);
        }
        next();
      });
    },
    transformIndexHtml: {
      order: "pre",
      handler(html, ctx) {
        const page = byFile.get(resolve(ctx.filename));
        if (!page) return html;
        const tags = headTags(page, base).map((t) => ({ ...t, injectTo: "head" as const }));
        if (!page.app) return { html, tags };
        // The apps load `/src/…` from their own root; here the root is apps/, so make those page-relative.
        const own = html.replace(/(\s(?:src|href)=")\/src\//g, "$1./src/");
        return {
          html: own,
          tags: [...tags, { tag: "script", attrs: { type: "module", src: "/site/src/nav.ts" }, injectTo: "head" }],
        };
      },
    },
    generateBundle() {
      for (const page of PAGES) this.emitFile({ type: "asset", fileName: `${page.path}${MANIFEST}`, source: JSON.stringify(manifestFor(page, base), null, 2) });
      this.emitFile({ type: "asset", fileName: "icon.svg", source: icon() });
    },
    writeBundle() {
      // Vite names each HTML output after its input under the root; move them to the site's paths.
      for (const page of PAGES) {
        const from = join(outDir, builtPath(page)), to = join(outDir, servedPath(page));
        if (from === to || !existsSync(from)) continue;
        mkdirSync(dirname(to), { recursive: true });
        renameSync(from, to);
      }
      pruneEmpty(outDir);
    },
  };
}

/** Removes empty folders under `dir` (left behind by the moved pages). */
function pruneEmpty(dir: string): boolean {
  let empty = true;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && pruneEmpty(join(dir, entry.name))) rmdirSync(join(dir, entry.name));
    else empty = false;
  }
  return empty;
}

export default defineConfig({
  root: APPS,
  base: process.env.BASE ?? "/",
  appType: "mpa",
  envDir: import.meta.dirname,
  cacheDir: resolve(import.meta.dirname, "node_modules/.vite"),
  plugins: [gameData(), captures(), site()], // captures: the dev server's F8 captures (tools/capture)
  worker: { format: "es" },
  build: {
    outDir: resolve(import.meta.dirname, "dist"),
    emptyOutDir: true,
    rolldownOptions: { input: Object.fromEntries(PAGES.map((p) => [p.name, resolve(APPS, p.html)])) },
  },
  server: { port: 5191, proxy: { [`${BASE}signal`]: signal } },
  preview: { port: 5191, proxy: { [`${BASE}signal`]: signal } },
});
