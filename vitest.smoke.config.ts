import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/smoke/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Smoke tests hit a single live SSH endpoint. Force serial
    // execution (one file at a time) so a future second test file
    // doesn't double-connect. vitest 4 removed poolOptions.forks.singleFork;
    // fileParallelism:false (= maxWorkers:1) is the documented replacement.
    pool: "forks",
    fileParallelism: false,
  },
});
