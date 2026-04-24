import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/e2e/**/*.test.ts"],
    testTimeout: 180_000,
    hookTimeout: 180_000,
    // E2E tests share a single Docker container / SSH endpoint. Force
    // serial execution in a single fork so a future second test file
    // doesn't race the first for port bindings, logs, or cache state.
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
