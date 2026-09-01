import Fastify, { type FastifyInstance } from "fastify";
import type { EventIngestionService } from "./sensing/event-ingestion.js";
import type { VerificationService } from "./verification/verification-service.js";
import type { VerificationRecord } from "./domain/verification/verification.js";

export interface AppDependencies {
  ingestion: EventIngestionService;
  executionService?: import("./actions/execution-service.js").ExecutionService;
  verificationService?: VerificationService;
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

  app.post("/cases/:id/execute", async (request, reply) => {
    if (!deps.executionService) {
      return reply.code(501).send({ error: "Execution service not configured" });
    }
    const caseId = (request.params as any).id;
    const body = request.body as any;
    
    if (!body?.governanceEvaluationId) {
      return reply.code(400).send({ error: "governanceEvaluationId is required" });
    }

    try {
      const result = await deps.executionService.executeAuthorizedAction(
        caseId,
        body.governanceEvaluationId,
        body.parameters
      );

      // Stage 7: close the loop. Execution success is only the executor's
      // claim; verification independently checks authoritative state.
      let verification: VerificationRecord | null = null;
      let verificationError: string | null = null;
      if (deps.verificationService && typeof result.executionId === "string") {
        try {
          verification = await deps.verificationService.verifyExecution({
            caseId,
            actionExecutionId: result.executionId,
          });
        } catch (error: any) {
          // Verification can be retried via POST /cases/:id/verify.
          request.log.error(error, "verification after execution failed");
          verificationError = error.message;
        }
      }

      return reply.code(200).send({ ...result, verification, verificationError });
    } catch (error: any) {
      if (error.name === "ExecutionNotAuthorizedError" || error.name === "ActionNotRegisteredError") {
        return reply.code(403).send({ error: error.message });
      }
      request.log.error(error, "action execution failed");
      return reply.code(500).send({ error: error.message });
    }
  });

  app.post("/cases/:id/verify", async (request, reply) => {
    if (!deps.verificationService) {
      return reply.code(501).send({ error: "Verification service not configured" });
    }
    const caseId = (request.params as any).id;
    const body = request.body as any;

    if (!body?.actionExecutionId) {
      return reply.code(400).send({ error: "actionExecutionId is required" });
    }

    try {
      const record = await deps.verificationService.verifyExecution({
        caseId,
        actionExecutionId: body.actionExecutionId,
      });
      return reply.code(200).send(record);
    } catch (error: any) {
      switch (error.name) {
        case "ExecutionCaseMismatchError":
          return reply.code(403).send({ error: error.message });
        case "ActionExecutionNotSuccessfulError":
          return reply.code(409).send({ error: error.message });
        case "IllegalCaseTransitionError":
          return reply.code(409).send({ error: error.message });
      }
      if (error.message?.includes("not found")) {
        return reply.code(404).send({ error: error.message });
      }
      request.log.error(error, "verification failed");
      return reply.code(500).send({ error: error.message });
    }
  });

  return app;
}
