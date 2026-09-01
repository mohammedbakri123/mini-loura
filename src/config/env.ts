import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z
    .string()
    .default("postgres://mini_loura:mini_loura@localhost:5432/mini_loura"),
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().optional(),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Loads and validates environment configuration at startup.
 * LLM_API_KEY / LLM_MODEL are optional: without them the system uses the
 * FakeReasoningModel, so local development never requires an API key.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  return parsed.data;
}

/** Which reasoning model implementation to use, based on configuration. */
export function reasoningModelKind(env: Env): "fake" | "llm" {
  return env.LLM_API_KEY && env.LLM_API_KEY.length > 0 ? "llm" : "fake";
}
