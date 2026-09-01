import Fastify, { type FastifyInstance } from "fastify";
import type { EventIngestionService } from "./sensing/event-ingestion.js";
import type { VerificationService } from "./verification/verification-service.js";
import type { VerificationRecord } from "./domain/verification/verification.js";

export interface AppDependencies {
  ingestion: EventIngestionService;
  executionService?: import("./actions/execution-service.js").ExecutionService;
  verificationService?: VerificationService;
  databaseHealthCheck: () => Promise<boolean>;
  caseRepository?: import("./db/repositories/case-repository.js").CaseRepository;
  eventRepository?: import("./db/repositories/event-repository.js").EventRepository;
  auditLedger?: import("./audit/audit-ledger.js").AuditLedger;
  governanceRepository?: import("./db/repositories/governance-repository.js").GovernanceRepository;
  governanceService?: import("./governance/governance-service.js").GovernanceService;
  policyRepository?: import("./db/repositories/policy-repository.js").PolicyRepository;
  productRepository?: import("./db/repositories/product-repository.js").ProductRepository;
  inventoryRepository?: import("./db/repositories/inventory-repository.js").InventoryRepository;
  supplierRepository?: import("./db/repositories/supplier-repository.js").SupplierRepository;
  agentRunRepository?: import("./db/repositories/agent-run-repository.js").AgentRunRepository;
  agent?: import("./agent/agent.js").OperationalAgent;
}

import fastifyStatic from "@fastify/static";
import fastifyCors from "@fastify/cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

export function buildApp(deps: AppDependencies): FastifyInstance {
  const app = Fastify({
    logger: {
      level: process.env.NODE_ENV === "test" ? "error" : "info",
    },
  });

  async function ensureDemoDataSeeded() {
    if (!deps.productRepository || !deps.inventoryRepository || !deps.policyRepository) return;
    
    // Seed product
    const productId = "9b2f1a34-1c4d-4e5f-8a9b-0c1d2e3f4a5b";
    await deps.productRepository.upsert({ id: productId, sku: "SKU-1042", name: "Paracetamol" });
    
    // Seed policy
    const policyFound = await deps.policyRepository.findEnabledPoliciesForAction("CREATE_PURCHASE_ORDER");
    if (policyFound.length === 0) {
      await deps.policyRepository.create({
        actionType: "CREATE_PURCHASE_ORDER",
        name: "Automatic Purchase Order Policy",
        enabled: true,
        priority: 100,
        configuration: { maxAutoOrderQuantity: 100 }
      });
    }
  }

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  // Use any to bypass fastify typing mismatch on some setups
  app.register(fastifyCors as any, { origin: true });

  // Serve static web app if it exists (in local dev)
  // Vercel serverless functions do not have access to the frontend dist folder.
  const webDistPath = path.join(__dirname, "../../web/dist");
  if (fs.existsSync(webDistPath)) {
    app.register(fastifyStatic as any, {
      root: webDistPath,
      prefix: "/",
      wildcard: false,
    });
  }

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api/")) {
      reply.code(404).send({ error: "Not Found" });
    } else if (reply.sendFile) {
      reply.sendFile("index.html");
    } else {
      reply.code(404).send({ error: "Not Found" });
    }
  });

  app.get("/api/health", async () => {
    const databaseOk = await deps.databaseHealthCheck();
    return {
      status: "ok",
      service: "mini-loura",
      database: databaseOk ? "up" : "down",
      timestamp: new Date().toISOString(),
    };
  });

  app.post("/api/events", async (request, reply) => {
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

  app.post("/api/cases/:id/execute", async (request, reply) => {
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

  app.post("/api/cases/:id/verify", async (request, reply) => {
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

  app.get("/api/cases", async () => {
    if (!deps.caseRepository) return [];
    return deps.caseRepository.listRecent(100);
  });

  app.get("/api/cases/:id", async (request, reply) => {
    if (!deps.caseRepository) return reply.code(404).send();
    const caseId = (request.params as any).id;
    const c = await deps.caseRepository.findById(caseId);
    if (!c) return reply.code(404).send({ error: "Case not found" });
    return c;
  });

  app.get("/api/audit", async () => {
    if (!deps.auditLedger) return [];
    // Just return the last 100 for the UI
    const all = await deps.auditLedger.list();
    return all.slice(0, 100);
  });

  app.get("/api/events", async () => {
    if (!deps.eventRepository) return [];
    const all = await deps.eventRepository.listRecent(100);
    return all;
  });

  // Helper for demo orchestration
  async function runDemoPipeline(eventData: any) {
    if (!deps.ingestion || !deps.agent || !deps.executionService || !deps.governanceRepository || !deps.governanceService) {
      throw new Error("Services not configured");
    }

    // 1. Ingest Event (synchronously creates Case via EventBus -> Pipeline)
    const eventRes = await deps.ingestion.ingest({
      source: "demo-ui",
      type: "inventory.low",
      data: eventData
    });
    
    if (eventRes.status !== "accepted") {
      throw new Error("Failed to ingest event");
    }

    // Give it a tiny tick for async bus handlers if they were async, 
    // though in our current setup InMemoryEventBus is fully awaited.
    await new Promise(r => setTimeout(r, 50));

    // Find the case that was just created for this product
    const cases = await deps.caseRepository!.listRecent(100);
    const activeCase = cases.find(c => c.subjectId === eventData.productId);
    if (!activeCase) {
      throw new Error("Case was not created");
    }

    // 2. AI Reasoning
    let decision;
    try {
      decision = await deps.agent.investigate(activeCase.id);
    } catch (err: any) {
      throw new Error(`AI investigation failed: ${err.message}`);
    }

    // 3. Governance
    let evaluation;
    if (decision.decision === "PROPOSE_ACTION" && decision.action) {
      // Find the agent run ID we just created
      const agentRun = (await deps.agentRunRepository?.listByCase(activeCase.id))?.[0];
      evaluation = await deps.governanceService.evaluate(decision, activeCase.id, agentRun?.id ?? null);
      
      // 4. Execution
      if (evaluation?.decision === "ALLOW") {
        try {
          const execResult = await deps.executionService.executeAuthorizedAction(
            activeCase.id,
            evaluation.id,
            decision.action
          );

          // 5. Verification
          if (deps.verificationService && execResult.executionId) {
             await deps.verificationService.verifyExecution({
               caseId: activeCase.id,
               actionExecutionId: execResult.executionId
             });
          }
        } catch (execErr: any) {
           console.error("Execution or Verification failed in demo:", execErr);
           // Not throwing so UI can render the timeline failure
        }
      }
    }

    return { caseId: activeCase.id, eventId: eventRes.eventId, decision, evaluation };
  }

  app.post("/api/demo/low-inventory", async (request, reply) => {
    try {
      await ensureDemoDataSeeded();
      const res = await runDemoPipeline({ productId: "9b2f1a34-1c4d-4e5f-8a9b-0c1d2e3f4a5b", currentStock: 10, minimumStock: 20 });
      return res;
    } catch (e: any) {
      return reply.code(500).send({ error: e.message });
    }
  });

  app.post("/api/demo/governance", async (request, reply) => {
    try {
      await ensureDemoDataSeeded();
      // Current stock 10, min 60 => order 110 (limit is 100). Should require approval.
      const res = await runDemoPipeline({ productId: "9b2f1a34-1c4d-4e5f-8a9b-0c1d2e3f4a5b", currentStock: 10, minimumStock: 60 });
      return res;
    } catch (e: any) {
      return reply.code(500).send({ error: e.message });
    }
  });

  app.post("/api/demo/tampering", async (request, reply) => {
    try {
      await ensureDemoDataSeeded();
      // Happy path params
      const eventData = { productId: "9b2f1a34-1c4d-4e5f-8a9b-0c1d2e3f4a5b", currentStock: 10, minimumStock: 20 };
      const res = await runDemoPipeline(eventData);
      
      // Now tamper and execute
      if (res.evaluation?.decision === "ALLOW") {
         const tamperedAction = { ...res.decision.action, quantity: 350 };
         try {
            await deps.executionService!.executeAuthorizedAction(
              res.caseId,
              res.evaluation.id,
              tamperedAction
            );
         } catch (err: any) {
            // Expected to fail!
            return { ...res, tamperingResult: "blocked", reason: err.message };
         }
      }

      return { ...res, tamperingResult: "failed to block" };
    } catch (e: any) {
      return reply.code(500).send({ error: e.message });
    }
  });

  return app;
}
