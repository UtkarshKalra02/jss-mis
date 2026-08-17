import path from "node:path";

import { config } from "dotenv";
import { defineConfig } from "vitest/config";

config({ path: ".env.local" });

export default defineConfig({
  test: {
    environment: "node",
    // Loads .env.local inside the worker, before any test module is imported.
    setupFiles: ["./tests/setup.ts"],
    // These tests talk to the real Neon database over a WebSocket, which is
    // slower than a local Postgres and occasionally cold.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // One database, shared. Running files in parallel would let one test's
    // uncommitted transaction block another's.
    fileParallelism: false,
  },
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
});
