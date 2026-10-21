import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "tools/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts"],
    // The routes played on the real disc take 5-7 s a test on a busy machine (vitest's default is 5 s).
    testTimeout: 30_000,
  },
});
