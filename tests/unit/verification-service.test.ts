import { beforeEach, describe, expect, it } from "vitest";
import { VerificationService, ActionExecutionNotSuccessfulError, ExecutionCaseMismatchError } from "../../src/verification/verification-service.js";
import { PurchaseOrderVerificationStrategy } from "../../src/verification/strategies/purchase-order-verification-strategy.js";
import { ImmediateVerifier } from "../../src/verification/verifier.js";
import { InMemoryVerificationRepository } from "../../src/db/repositories/verification-repository.js";
import { InMemoryActionExecutionRepository } from "../../src/db/repositories/action-execution-repository.js";
import { InMemoryGovernanceRepository } from "../../src/db/repositories/governance-repository.js";
import { InMemoryCaseRepository } from "../../src/db/repositories/case-repository.js";
import { InMemoryPurchaseOrderRepository } from "../../src/db/repositories/purchase-order-repository.js";
import { InMemoryAuditLedger } from "../../src/audit/audit-ledger.js";
import { CaseService } from "../../src/domain/cases/case-service.js";

const productId = "9b2f1a34-1c4d-4e5f-8a9b-0c1d2e3f4a5b";
const supplierId = "d9f8e7c6-b5a4-3c2d-1e0f-9a8b7c6d5e4f";
const parameters = { productId, quantity: 20, supplierId };

describe("VerificationService", () => {
  let poRepo: InMemoryPurchaseOrderRepository;
  let executionRepo: InMemoryActionExecutionRepository;
  let governanceRepo: InMemoryGovernanceRepository;
  let verificationRepo: InMemoryVerificationRepository;
  let caseRepo: InMemoryCaseRepository;
  let auditLedger: InMemoryAuditLedger;
  let service: VerificationService;

  let caseId: string;
  let executionId: string;

  /** Seeds case (VERIFYING) + governance ALLOW + SUCCEEDED execution. */
  async function seed(options: { caseStatus?: "VERIFYING" | "FAILED"; actionType?: string; poId?: string; markSucceeded?: boolean } = {}) {
    const caseRecord = await caseRepo.create({
      type: "inventory_replenishment",
      status: options.caseStatus ?? "VERIFYING",
      priority: "MEDIUM",
      title: "Replenish",
      subjectType: "product",
      subjectId: productId,
    });
    caseId = caseRecord.id;

    const govEval = await governanceRepo.recordEvaluation(
      caseId, null, options.actionType ?? "CREATE_PURCHASE_ORDER",
      { decision: "ALLOW", ruleId: "rule-1", reason: "within limit" },
      parameters,
    );

    const { record: execution } = await executionRepo.createIfAbsent({
      caseId,
      governanceEvaluationId: govEval.id,
      actionType: options.actionType ?? "CREATE_PURCHASE_ORDER",
      idempotencyKey: `exec-${Math.random()}`,
      status: "STARTED",
    });
    executionId = execution.id;
    if (options.markSucceeded ?? true) {
      await executionRepo.updateStatus(executionId, "SUCCEEDED", options.poId ?? null);
    }
  }

  beforeEach(async () => {
    poRepo = new InMemoryPurchaseOrderRepository();
    executionRepo = new InMemoryActionExecutionRepository();
    governanceRepo = new InMemoryGovernanceRepository();
    verificationRepo = new InMemoryVerificationRepository();
    caseRepo = new InMemoryCaseRepository();
    auditLedger = new InMemoryAuditLedger();

    const verifier = new ImmediateVerifier();
    verifier.registerStrategy("CREATE_PURCHASE_ORDER", new PurchaseOrderVerificationStrategy(poRepo));

    service = new VerificationService({
      verifier,
      verificationRepo,
      executionRepo,
      governanceRepo,
      caseRepo,
      caseService: new CaseService({ caseRepository: caseRepo, auditLedger }),
      auditLedger,
    });
  });

  const createMatchingPo = (id = "po-1") =>
    poRepo.create({ supplierId, status: "created", items: [{ productId, quantity: 20 }], idempotencyKey: null, id });

  it("VERIFIED execution resolves the case through the state machine", async () => {
    await seed({ poId: "po-1" });
    await createMatchingPo();

    const record = await service.verifyExecution({ caseId, actionExecutionId: executionId });

    expect(record.status).toBe("VERIFIED");
    expect(record.expected).toEqual(parameters);
    expect(await caseRepo.findById(caseId)).toMatchObject({ status: "RESOLVED" });

    const types = (await auditLedger.list({ caseId })).map((e) => e.type);
    expect(types).toEqual(["VERIFICATION_STARTED", "VERIFICATION_SUCCEEDED", "CASE_RESOLVED"]);
  });

  it("does NOT trust the executor: SUCCEEDED execution without PO in state fails verification", async () => {
    await seed({ poId: "po-ghost" }); // executor claimed po-ghost, DB has nothing

    const record = await service.verifyExecution({ caseId, actionExecutionId: executionId });

    expect(record.status).toBe("FAILED");
    expect(record.reason).toMatch(/not found/);
    // Case must NOT be resolved.
    expect(await caseRepo.findById(caseId)).toMatchObject({ status: "FAILED" });
    const types = (await auditLedger.list({ caseId })).map((e) => e.type);
    expect(types).toContain("VERIFICATION_FAILED");
    expect(types).not.toContain("CASE_RESOLVED");
  });

  it("rejects verification of an execution that never succeeded (action failure ≠ verification failure)", async () => {
    await seed({ markSucceeded: false });
    // Execution stays STARTED — the action itself failed.
    await expect(service.verifyExecution({ caseId, actionExecutionId: executionId }))
      .rejects.toThrowError(ActionExecutionNotSuccessfulError);

    // No verification record, no case transition.
    expect(await verificationRepo.findByExecutionId(executionId)).toHaveLength(0);
    expect(await caseRepo.findById(caseId)).toMatchObject({ status: "VERIFYING" });
  });

  it("refuses to verify an execution that belongs to a different case", async () => {
    await seed({ poId: "po-1" });
    await createMatchingPo();

    const otherCase = await caseRepo.create({
      type: "inventory_replenishment", status: "VERIFYING", priority: "MEDIUM",
      title: "Other", subjectType: "product", subjectId: "f1e2d3c4-b5a6-4789-8a9b-0c1d2e3f4a5b",
    });

    await expect(service.verifyExecution({ caseId: otherCase.id, actionExecutionId: executionId }))
      .rejects.toThrowError(ExecutionCaseMismatchError);
  });

  it("expected state comes from the governance record, not the caller", async () => {
    await seed({ poId: "po-1" });
    // PO actually holds quantity 50, governance authorized 20.
    await poRepo.create({ supplierId, status: "created", items: [{ productId, quantity: 50 }], idempotencyKey: null, id: "po-1" });

    const record = await service.verifyExecution({ caseId, actionExecutionId: executionId });

    expect(record.status).toBe("FAILED");
    expect(record.expected).toEqual(parameters); // governance-authorized values
    expect(record.actual).toMatchObject({ items: [{ quantity: 50 }] });
  });

  it("is repeatable: FAILED attempt then VERIFIED attempt keeps a coherent trail", async () => {
    await seed({ poId: "po-1" });
    // Attempt 1: authoritative state not updated yet.
    const first = await service.verifyExecution({ caseId, actionExecutionId: executionId });
    expect(first.status).toBe("FAILED");
    expect(await caseRepo.findById(caseId)).toMatchObject({ status: "FAILED" });

    // Attempt 2: state caught up (e.g. delayed write).
    await createMatchingPo();
    const second = await service.verifyExecution({ caseId, actionExecutionId: executionId });
    expect(second.status).toBe("VERIFIED");
    expect(await caseRepo.findById(caseId)).toMatchObject({ status: "RESOLVED" });

    // Both records exist; exactly one VERIFIED; audit trail ordered and clear.
    const records = await verificationRepo.findByExecutionId(executionId);
    expect(records.map((r) => r.status)).toEqual(["FAILED", "VERIFIED"]);
    const types = (await auditLedger.list({ caseId })).map((e) => e.type);
    expect(types).toEqual([
      "VERIFICATION_STARTED", "VERIFICATION_FAILED", "CASE_STATE_CHANGED",
      "VERIFICATION_STARTED", "VERIFICATION_SUCCEEDED", "CASE_RESOLVED",
    ]);
  });

  it("fails closed on an unknown action type (no strategy registered)", async () => {
    await seed({ actionType: "MYSTERY_ACTION", poId: "po-1" });

    const record = await service.verifyExecution({ caseId, actionExecutionId: executionId });

    expect(record.status).toBe("FAILED");
    expect(record.strategy).toBe("unknown");
    expect(record.reason).toMatch(/could not be performed/);
    expect(await caseRepo.findById(caseId)).toMatchObject({ status: "FAILED" });
  });

  it("re-verifying an already-verified execution returns the existing record", async () => {
    await seed({ poId: "po-1" });
    await createMatchingPo();

    const first = await service.verifyExecution({ caseId, actionExecutionId: executionId });
    const second = await service.verifyExecution({ caseId, actionExecutionId: executionId });

    expect(second.id).toBe(first.id);
    expect(await verificationRepo.findByExecutionId(executionId)).toHaveLength(1);
  });
});
