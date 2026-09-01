import { describe, expect, it, beforeEach } from "vitest";
import { ExecutionService, ExecutionNotAuthorizedError } from "../../src/actions/execution-service.js";
import { ActionRegistry } from "../../src/governance/action-registry.js";
import { createPurchaseOrderAction, PurchaseOrderExecutor } from "../../src/actions/purchase-order-action.js";
import { InMemoryGovernanceRepository } from "../../src/db/repositories/governance-repository.js";
import { InMemoryActionExecutionRepository } from "../../src/db/repositories/action-execution-repository.js";
import { InMemoryAuditLedger } from "../../src/audit/audit-ledger.js";
import { InMemoryCaseRepository } from "../../src/db/repositories/case-repository.js";
import { InMemoryPurchaseOrderRepository } from "../../src/db/repositories/purchase-order-repository.js";
import { InMemorySupplierRepository } from "../../src/db/repositories/supplier-repository.js";

describe("ExecutionService", () => {
  let executionService: ExecutionService;
  let actionRegistry: ActionRegistry;
  let governanceRepo: InMemoryGovernanceRepository;
  let executionRepo: InMemoryActionExecutionRepository;
  let auditLedger: InMemoryAuditLedger;
  let caseRepo: InMemoryCaseRepository;
  let poRepo: InMemoryPurchaseOrderRepository;
  let supplierRepo: InMemorySupplierRepository;
  const supplierId = "d9f8e7c6-b5a4-3c2d-1e0f-9a8b7c6d5e4f";
  const validProductId = "9b2f1a34-1c4d-4e5f-8a9b-0c1d2e3f4a5b";

  beforeEach(async () => {
    poRepo = new InMemoryPurchaseOrderRepository();
    supplierRepo = new InMemorySupplierRepository();
    await supplierRepo.upsert({ id: supplierId, name: "Test Supplier" });

    actionRegistry = new ActionRegistry();
    actionRegistry.register(createPurchaseOrderAction({
      executor: new PurchaseOrderExecutor(poRepo, supplierRepo)
    }));

    governanceRepo = new InMemoryGovernanceRepository();
    executionRepo = new InMemoryActionExecutionRepository();
    auditLedger = new InMemoryAuditLedger();
    caseRepo = new InMemoryCaseRepository();

    executionService = new ExecutionService({
      actionRegistry,
      governanceRepo,
      executionRepo,
      auditLedger,
      caseRepo
    });
  });

  it("executes an ALLOWED action successfully", async () => {
    const caseId = "case-1";
    await caseRepo.create({ type: "inventory_replenishment", status: "ACTION_REQUIRED", priority: "high", title: "Test", subjectType: "product", subjectId: validProductId });
    const caseRecord = await caseRepo.findOpenBySubject("product", validProductId);

    const parameters = { productId: validProductId, quantity: 100, supplierId };
    
    // Create governance ALLOW
    const govEval = await governanceRepo.recordEvaluation(
      caseRecord!.id, null, "CREATE_PURCHASE_ORDER",
      { decision: "ALLOW", ruleId: "rule-1", reason: "Stock low" },
      parameters
    );

    const result = await executionService.executeAuthorizedAction(caseRecord!.id, govEval.id, parameters);
    
    expect(result.executed).toBe(true);
    expect(result.referenceId).toBeDefined();

    // Verify PO created
    const po = await poRepo.findById(result.referenceId!);
    expect(po?.status).toBe("created");
    expect(po?.items[0].quantity).toBe(100);

    // Verify execution record
    const execution = Array.from((executionRepo as any).records.values())[0] as any;
    expect(execution.status).toBe("SUCCEEDED");
    expect(execution.referenceId).toBe(result.referenceId);

    // Verify case status advanced
    const updatedCase = await caseRepo.findById(caseRecord!.id);
    expect(updatedCase?.status).toBe("VERIFYING");
  });

  it("refuses to execute if governance decision is DENY", async () => {
    const parameters = { productId: validProductId, quantity: 100, supplierId };
    const govEval = await governanceRepo.recordEvaluation(
      "case-1", null, "CREATE_PURCHASE_ORDER",
      { decision: "DENY", ruleId: "rule-2", reason: "Policy violation" },
      parameters
    );

    await expect(executionService.executeAuthorizedAction("case-1", govEval.id, parameters))
      .rejects.toThrowError(ExecutionNotAuthorizedError);
      
    // Verify no PO created
    const pos = await poRepo.listOpen();
    expect(pos.length).toBe(0);
  });

  it("refuses to execute if parameters mismatch (tampering check)", async () => {
    const authParameters = { productId: validProductId, quantity: 10, supplierId };
    const tamperedParameters = { productId: validProductId, quantity: 500, supplierId };

    const govEval = await governanceRepo.recordEvaluation(
      "case-1", null, "CREATE_PURCHASE_ORDER",
      { decision: "ALLOW", ruleId: "rule-1", reason: "Ok" },
      authParameters
    );

    await expect(executionService.executeAuthorizedAction("case-1", govEval.id, tamperedParameters))
      .rejects.toThrowError(/do not exactly match/);
      
    const pos = await poRepo.listOpen();
    expect(pos.length).toBe(0);
  });

  it("supports idempotent retries (process crash simulation)", async () => {
    const parameters = { productId: validProductId, quantity: 100, supplierId };
    const govEval = await governanceRepo.recordEvaluation(
      "case-1", null, "CREATE_PURCHASE_ORDER",
      { decision: "ALLOW", ruleId: "rule-1", reason: "Ok" },
      parameters
    );

    // First run
    const result1 = await executionService.executeAuthorizedAction("case-1", govEval.id, parameters);
    
    // Retry exact same execution
    const result2 = await executionService.executeAuthorizedAction("case-1", govEval.id, parameters);
    
    expect(result1.referenceId).toBe(result2.referenceId);
    expect((result2 as any).details.replay).toBe(true);

    const pos = await poRepo.listOpen();
    expect(pos.length).toBe(1); // Only 1 PO created
  });

  it("refuses missing governance evaluation", async () => {
    await expect(executionService.executeAuthorizedAction("case-1", "missing-id", {}))
      .rejects.toThrowError(/Governance evaluation not found/);
  });
});
