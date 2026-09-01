import Fastify, { type FastifyInstance } from "fastify";
import type { EventIngestionService } from "./sensing/event-ingestion.js";

export interface AppDependencies {
  ingestion: EventIngestionService;
  /** Cheap connectivity probe; /health reports but never throws. */
  databaseHealthCheck: () => Promise<boolean>;
}

export function buildApp(deps: AppDependencies): FastifyInstance {
  const app = Fastify({
    logger: {
      level: process.env.NODE_ENV === "test" ? "error" : "info",
    },
  });

  app.get("/health", async () => {
    const databaseOk = await deps.databaseHealthCheck();
    return {
      status: "ok",
      service: "mini-loura",
      database: databaseOk ? "up" : "down",
      timestamp: new Date().toISOString(),
    };
  });

  app.post("/events", async (request, reply) => {
    let result;
    try {
      result = await deps.ingestion.ingest(request.body);
    } catch (error) {
      // Persistence/infrastructure failures are reported cleanly, not leaked.
      request.log.error(error, "event ingestion failed");
      return reply.code(503).send({
        status: "error",
        message: "Event ingestion is temporarily unavailable",
      });
    }

    switch (result.status) {
      case "accepted":
        return reply.code(202).send({
          status: "accepted",
          eventId: result.eventId,
        });
      case "duplicate":
        return reply.code(200).send({
          status: "duplicate",
          eventId: result.eventId,
        });
      case "rejected":
        return reply.code(400).send({
          status: "rejected",
          issues: result.issues,
        });
    }
  });

  return app;
}
