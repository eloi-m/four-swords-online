import { gameData } from "@fso/bundle/vite";
import { defineConfig } from "vite";

// The page's default lobby is /signal on its own origin: forwarded to tools/signal (FSO_SIGNAL_PORT, default 5185).
const signal = { target: `ws://127.0.0.1:${process.env.FSO_SIGNAL_PORT ?? 5185}`, ws: true, rewrite: (path: string) => path.replace(/^[^?]*/, "/") };

export default defineConfig({
  plugins: [gameData()], // the game files at /data/ (tools/bundle)
  worker: { format: "es" },
  server: { port: 5184, strictPort: true, proxy: { "/signal": signal } },
  preview: { proxy: { "/signal": signal } },
});
