import { z } from "zod";

/**
 * Server-side environment, validated once at module load.
 *
 * Why validate at all: a missing DATABASE_URL should fail loudly at boot with
 * the variable name in the message, not as an unrelated connection error three
 * screens deep at 11pm. This module must never be imported from a client
 * component — it would leak the values into the browser bundle.
 */
const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required (pooled Neon URL)"),
  DATABASE_URL_UNPOOLED: z
    .string()
    .min(1, "DATABASE_URL_UNPOOLED is required (direct Neon URL, for migrations)"),
  AUTH_SECRET: z
    .string()
    .min(1, "AUTH_SECRET is required (generate with: openssl rand -base64 32)"),
});

const parsed = envSchema.safeParse({
  DATABASE_URL: process.env.DATABASE_URL,
  DATABASE_URL_UNPOOLED: process.env.DATABASE_URL_UNPOOLED,
  AUTH_SECRET: process.env.AUTH_SECRET,
});

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  throw new Error(`Invalid environment.\n${issues}\n\nSee .env.example.`);
}

export const env = parsed.data;
