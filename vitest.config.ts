import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      // TS only: under vitest 4 the .py in src/ingestors logged a parse error
      // ("Failed to parse ... jinja-render.py. Excluding it from coverage"); v2 did not.
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts"],
    },
  },
});
