import "dotenv/config";
import { buildApp } from "./app.js";
import { loadEnv, reasoningModelKind } from "./config/env.js";
import { createRuntime } from "./composition.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const modelKind = reasoningModelKind(env);
  console.log(`mini-loura starting (reasoning model: ${modelKind})`);

  const runtime = createRuntime(env);
  const app = buildApp({
    ingestion: runtime.ingestion,
    executionService: runtime.executionService,
    databaseHealthCheck: runtime.databaseHealthCheck,
  });

  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}, shutting down...`);
    await app.close();
    await runtime.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  try {
    await app.listen({ port: env.PORT, host: "0.0.0.0" });
    console.log(`mini-loura listening on port ${env.PORT}`);
  } catch (error) {
    console.error("Failed to start server:", error);
    await runtime.close();
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("Fatal startup error:", error);
  process.exitCode = 1;
});
