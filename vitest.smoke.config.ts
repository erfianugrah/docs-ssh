import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/smoke/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Smoke tests hit a single live SSH endpoint. Force serial
    // execution so a future second test file doesn't double-connect.
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
