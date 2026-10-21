import { gameData } from "@fso/bundle/vite";
import { captures } from "@fso/capture/vite";
import { defineConfig } from "vite";

// Online play: the page reaches the lobby server at signal under its base (here /) on its own origin (as behind a
// reverse proxy in production, docs/netcode.md "Hosting"); in dev and preview, Vite forwards it to tools/signal
// (FSO_SIGNAL_PORT, default 5185, set by `pnpm battle:online`), keeping the query (?token=).
const signal = { target: `ws://127.0.0.1:${process.env.FSO_SIGNAL_PORT ?? 5185}`, ws: true, rewrite: (path: string) => path.replace(/^[^?]*/, "/") };

export default defineConfig({
  plugins: [gameData(), captures()], // the game files at /data/ (tools/bundle); F8's captures (dev server, tools/capture)
  worker: { format: "es" },
  server: { port: 5181, proxy: { "/signal": signal } },
  preview: { proxy: { "/signal": signal } },
});
