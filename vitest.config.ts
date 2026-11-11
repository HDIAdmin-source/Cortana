import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Each test boots a fresh in-memory Postgres and applies every migration.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
