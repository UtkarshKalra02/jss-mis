import { config } from "dotenv";

// Runs before any test module is imported, so src/lib/env.ts validates a
// populated environment rather than an empty one.
config({ path: ".env.local" });
