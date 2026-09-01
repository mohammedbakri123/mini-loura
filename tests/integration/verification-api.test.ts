import { beforeAll, afterAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { EventValidator } from "../../src/sensing/event-validator.js";
import { InMemoryEventBus } from "../../src/sensing/event-bus.js";
import { EventIngestionService } from "../../src/sensing/event-ingestion.js";
import { InMemoryAuditLedger } from "../../src/audit/audit-ledger.js";
import { InMemoryEventRepository } from "../../src/db/repositories/event-repository.js";
import { InMemoryCaseRepository } from "../../src/db/repositories/case-repository.js";
import { InMemorySupplierRepository } from "../../src/db/repositories/supplier-repository.js";
import { InMemoryPurchaseOrderRepository } from "../../src/db/repositories/purchase-order-repository.js";
import { InMemoryActionExecutionRepository } from "../../src/db/repositories/action-execution-repository.js";
import { InMemoryGovernanceRepository } from "../../src/db/repositories/governance-repository.js";
import { CaseService } from "../../src/domain/cases/case-service.js";
import { ExecutionService } from "../../src/actions/execution-service.js";
import { createPurchaseOrderAction, PurchaseOrderExecutor } from "../../src/actions/purchase-order-action.js";
import { ActionRegistry } from "../../src/governance/action-registry.js";
import { ImmediateVerifier } from "../../src/verification/verifier.js";
import { PurchaseOrderVerificationStrategy } from "../../src/verification/strategies/purchase-order-verification-strategy.js";
import { InMemoryVerificationRepository } from "../../src/db/repositories/verification-repository.js";
import { VerificationService } from "../../src/verification/verification-service.js";

const productId = "9b2f1a34-1c4d-4e5f-8a9b-0c1d2e3f4a5b";
const supplierId = "d9f8e7c6-b5a4-3c2d-1e0f-9a8b7c6d5e4f";
const parameters = { productId, quantity: 20, supplierId };

/**
 * Closed-loop HTTP test:
 *   execute -> case VERIFYING -> auto verification -> RESOLVED / FAILED
 */
describe("verification API (integration)", () => {
  let app: FastifyInstance;
  let caseRepo: InMemoryCaseRepository;
  let executionRepo: InMemoryActionExecutionRepository;
  let governanceRepo: InMemoryGovernanceRepository;
  let poRepo: InMemoryPurchaseOrderRepository;
  let auditLedger: InMemoryAuditLedger;

  beforeAll(async () => {
    poRepo = new InMemoryPurchaseOrderRepository();
    caseRepo = new InMemoryCaseRepository();
    executionRepo = new InMemoryActionExecutionRepository();
    governanceRepo = new InMemoryGovernanceRepository();
    auditLedger = new InMemoryAuditLedger();
    const supplierRepo = new InMemorySupplierRepository();
    await supplierRepo.upsert({ id: supplierId, name: "Test Supplier" });

    const actionRegistry = new ActionRegistry();
    actionRegistry.register(
      createPurchaseOrderAction({ executor: new PurchaseOrderExecutor(poRepo, supplierRepo) }),
    );

    const verifier = new ImmediateVerifier();
    verifier.registerStrategy("CREATE_PURCHASE_ORDER", new PurchaseOrderVerificationStrategy(poRepo));

    const caseService = new CaseService({ caseRepository: caseRepo, auditLedger });

    const executionService = new ExecutionService({
      actionRegistry,
      governanceRepo,
      executionRepo,
      auditLedger,
      caseRepo,
    });

    const verificationService = new VerificationService({
      verifier,
      verificationRepo: new InMemoryVerificationRepository(),
      executionRepo,
      governanceRepo,
      caseRepo,
      caseService,
      auditLedger,
    });

    const ingestion = new EventIngestionService({
      validator: new EventValidator(),
      eventRepository: new InMemoryEventRepository(),
      bus: new InMemoryEventBus(),
      auditLedger,
    });

    app = buildApp({
      ingestion,
      executionService,
      verificationService,
      databaseHealthCheck: async () => true,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  /** Creates a case + ALLOW governance evaluation; returns ids. */
  async function seedCaseWithAllowance(status: "ACTION_REQUIRED" | "VERIFYING" = "ACTION_REQUIRED") {
    const caseRecord = await caseRepo.create({
      type: "inventory_replenishment", status, priority: "MEDIUM",
      title: "Replenish", subjectType: "product", subjectId: productId,
    });
    const govEval = await governanceRepo.recordEvaluation(
      caseRecord.id, null, "CREATE_PURCHASE_ORDER",
      { decision: "ALLOW", ruleId: "rule-1", reason: "within limit" },
      parameters,
    );
    return { caseId: caseRecord.id, governanceEvaluationId: govEval.id };
  }

  /** Seeds a SUCCEEDED execution record directly (executor's claim). */
  async function seedSucceededExecution(caseId: string, governanceEvaluationId: string, key: string, referenceId: string | null) {
    const { record: execution } = await executionRepo.createIfAbsent({
      caseId, governanceEvaluationId, actionType: "CREATE_PURCHASE_ORDER",
      idempotencyKey: key, status: "STARTED",
    });
    await executionRepo.updateStatus(execution.id, "SUCCEEDED", referenceId);
    return execution;
  }

  it("execute auto-verifies against authoritative state and resolves the case", async () => {
    const { caseId, governanceEvaluationId } = await seedCaseWithAllowance();

    const response = await app.inject({
      method: "POST",
      url: `/cases/${caseId}/execute`,
      payload: { governanceEvaluationId, parameters },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.executed).toBe(true);
    expect(body.verificationError).toBeNull();
    expect(body.verification.status).toBe("VERIFIED");

    // The loop is closed: RESOLVED only after verification succeeded.
    expect(await caseRepo.findById(caseId)).toMatchObject({ status: "RESOLVED" });
  });

  it("verification failure leaves the case unresolved (drift simulation)", async () => {
    const { caseId, governanceEvaluationId } = await seedCaseWithAllowance("VERIFYING");

    // Executor *claims* success, but no PO exists in authoritative state.
    const execution = await seedSucceededExecution(caseId, governanceEvaluationId, "drift-exec-1", "po-that-does-not-exist");

    const response = await app.inject({
      method: "POST",
      url: `/cases/${caseId}/verify`,
      payload: { actionExecutionId: execution.id },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe("FAILED");
    // Case is NOT resolved.
    expect(await caseRepo.findById(caseId)).toMatchObject({ status: "FAILED" });
  });

  it("supports repeat verification via the API (FAILED then VERIFIED)", async () => {
    const { caseId, governanceEvaluationId } = await seedCaseWithAllowance("VERIFYING");
    const execution = await seedSucceededExecution(caseId, governanceEvaluationId, "repeat-exec-1", "po-late");

    // Attempt 1: no PO in authoritative state yet.
    const first = await app.inject({
      method: "POST", url: `/cases/${caseId}/verify`,
      payload: { actionExecutionId: execution.id },
    });
    expect(first.json().status).toBe("FAILED");

    // State catches up.
    await poRepo.create({
      id: "po-late", supplierId, status: "created",
      items: [{ productId, quantity: 20 }], idempotencyKey: null,
    });

    // Attempt 2: authoritative state now matches.
    const second = await app.inject({
      method: "POST", url: `/cases/${caseId}/verify`,
      payload: { actionExecutionId: execution.id },
    });
    expect(second.json().status).toBe("VERIFIED");
    expect(await caseRepo.findById(caseId)).toMatchObject({ status: "RESOLVED" });

    // Audit trail records the full story.
    const types = (await auditLedger.list({ caseId })).map((e) => e.type);
    expect(types).toContain("VERIFICATION_FAILED");
    expect(types).toContain("VERIFICATION_SUCCEEDED");
    expect(types).toContain("CASE_RESOLVED");
  });

  it("refuses to verify an execution belonging to a different case (403)", async () => {
    const { caseId, governanceEvaluationId } = await seedCaseWithAllowance("VERIFYING");
    const execution = await seedSucceededExecution(caseId, governanceEvaluationId, "cross-exec-1", null);

    const attackerCase = await caseRepo.create({
      type: "inventory_replenishment", status: "VERIFYING", priority: "MEDIUM",
      title: "Other", subjectType: "product", subjectId: "f1e2d3c4-b5a6-4789-8a9b-0c1d2e3f4a5b",
    });

    const response = await app.inject({
      method: "POST", url: `/cases/${attackerCase.id}/verify`,
      payload: { actionExecutionId: execution.id },
    });
    expect(response.statusCode).toBe(403);
  });

  it("returns 409 when verifying an execution that never succeeded", async () => {
    const { caseId, governanceEvaluationId } = await seedCaseWithAllowance("VERIFYING");
    const { record: execution } = await executionRepo.createIfAbsent({
      caseId, governanceEvaluationId, actionType: "CREATE_PURCHASE_ORDER",
      idempotencyKey: "started-exec-1", status: "STARTED",
    });

    const response = await app.inject({
      method: "POST", url: `/cases/${caseId}/verify`,
      payload: { actionExecutionId: execution.id },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toMatch(/only applies to SUCCEEDED/);
  });

  it("returns 400 when actionExecutionId is missing", async () => {
    const { caseId } = await seedCaseWithAllowance("VERIFYING");
    const response = await app.inject({
      method: "POST", url: `/cases/${caseId}/verify`,
      payload: {},
    });
    expect(response.statusCode).toBe(400);
  });
});
