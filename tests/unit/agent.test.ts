import { describe, expect, it, beforeEach } from "vitest";
import { OperationalAgent } from "../../src/agent/agent.js";
import { FakeReasoningModel } from "../../src/agent/models/fake-reasoning-model.js";
import { CaseContextBuilder, OperationalContextBuilder } from "../../src/model/context-builder.js";
import { createDefaultToolRegistry } from "../../src/agent/tools.js";
import { InMemoryCaseRepository } from "../../src/db/repositories/case-repository.js";
import { InMemoryAgentRunRepository } from "../../src/db/repositories/agent-run-repository.js";
import { InMemoryProductRepository } from "../../src/db/repositories/product-repository.js";
import { InMemoryInventoryRepository } from "../../src/db/repositories/inventory-repository.js";
import { InMemorySupplierRepository } from "../../src/db/repositories/supplier-repository.js";
import { InMemoryPurchaseOrderRepository } from "../../src/db/repositories/purchase-order-repository.js";
import type { AgentDecision } from "../../src/agent/reasoning-model.js";

describe("OperationalAgent", () => {
  let agent: OperationalAgent;
  let caseRepo: InMemoryCaseRepository;
  let productRepo: InMemoryProductRepository;
  let inventoryRepo: InMemoryInventoryRepository;
  let runRepo: InMemoryAgentRunRepository;

  beforeEach(() => {
    productRepo = new InMemoryProductRepository();
    inventoryRepo = new InMemoryInventoryRepository();
    const supplierRepo = new InMemorySupplierRepository();
    const poRepo = new InMemoryPurchaseOrderRepository();

    const operationalContextBuilder = new OperationalContextBuilder({
      productRepository: productRepo,
      inventoryRepository: inventoryRepo,
      supplierRepository: supplierRepo,
      purchaseOrderRepository: poRepo,
    });

    caseRepo = new InMemoryCaseRepository();
    const caseContextBuilder = new CaseContextBuilder({
      caseRepository: caseRepo,
      operationalContextBuilder,
    });

    runRepo = new InMemoryAgentRunRepository();

    agent = new OperationalAgent({
      reasoningModel: new FakeReasoningModel(),
      caseContextBuilder,
      toolRegistry: createDefaultToolRegistry(),
      agentRunRepository: runRepo,
      modelName: "fake",
    });
  });

  it("investigates a low inventory case and proposes an action", async () => {
    // Set up state
    await productRepo.upsert({ id: "prod-1", sku: "SKU-1", name: "Prod 1" });
    await inventoryRepo.upsert({ productId: "prod-1", currentStock: 5, minimumStock: 20 });
    const createdCase = await caseRepo.create({
      type: "inventory_replenishment",
      status: "OPEN",
      priority: "HIGH",
      title: "Test",
      subjectType: "product",
      subjectId: "prod-1",
    });

    // Act
    const decision = await agent.investigate(createdCase.id);

    // Assert decision
    expect(decision.decision).toBe("PROPOSE_ACTION");
    expect(decision.action?.type).toBe("CREATE_PURCHASE_ORDER");
    expect(decision.action?.productId).toBe("prod-1");
    expect(decision.action?.quantity).toBe(35);

    // Ensure NO execution happened! (Case is still OPEN, PO is not actually created).
    const caseAfter = await caseRepo.findById(createdCase.id);
    expect(caseAfter?.status).toBe("OPEN"); // The agent did NOT transition it.

    // Run was recorded
    const runs = await runRepo.listByCase(createdCase.id);
    expect(runs.length).toBe(1);
    expect(runs[0]?.decision).toBe("PROPOSE_ACTION");
    expect(runs[0]?.actionPayload?.type).toBe("CREATE_PURCHASE_ORDER");
  });

  it("investigates a healthy inventory case and proposes NO_ACTION", async () => {
    await productRepo.upsert({ id: "prod-1", sku: "SKU-1", name: "Prod 1" });
    await inventoryRepo.upsert({ productId: "prod-1", currentStock: 25, minimumStock: 20 });
    const createdCase = await caseRepo.create({
      type: "inventory_replenishment",
      status: "OPEN",
      priority: "HIGH",
      title: "Test",
      subjectType: "product",
      subjectId: "prod-1",
    });

    const decision = await agent.investigate(createdCase.id);

    expect(decision.decision).toBe("NO_ACTION");
    
    const runs = await runRepo.listByCase(createdCase.id);
    expect(runs[0]?.decision).toBe("NO_ACTION");
  });

  it("fails if the case context cannot be built", async () => {
    await expect(agent.investigate("bad-id")).rejects.toThrow("not found");
  });

  it("validates that a PROPOSE_ACTION decision has a valid action payload", async () => {
    const badModelAgent = new OperationalAgent({
      reasoningModel: {
        reason: async () => ({
          decision: "PROPOSE_ACTION",
          rationale: "Because",
        } as unknown as AgentDecision) // Force missing action
      },
      caseContextBuilder: new CaseContextBuilder({
        caseRepository: caseRepo,
        operationalContextBuilder: {
          buildForProduct: async () => null,
        } as any,
      }),
      toolRegistry: createDefaultToolRegistry(),
      agentRunRepository: runRepo,
      modelName: "bad",
    });

    const createdCase = await caseRepo.create({
      type: "inventory_replenishment",
      status: "OPEN",
      priority: "HIGH",
      title: "Test",
      subjectType: "product",
      subjectId: "prod-1",
    });

    await expect(badModelAgent.investigate(createdCase.id)).rejects.toThrow("requires an 'action' payload");
  });
});
