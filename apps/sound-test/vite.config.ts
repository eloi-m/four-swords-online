import { gameData } from "@fso/bundle/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [gameData()], // the game files at /data/ (tools/bundle)
  worker: { format: "es" },
  server: { port: 5178 },
});
