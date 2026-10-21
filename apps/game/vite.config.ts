import { gameData } from "@fso/bundle/vite";
import { captures } from "@fso/capture/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [gameData(), captures()], // the game files at /data/ (tools/bundle); F8's captures (dev server, tools/capture)
  worker: { format: "es" },
  server: { port: 5174 },
});
