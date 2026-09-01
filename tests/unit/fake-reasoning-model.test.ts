import { describe, expect, it } from "vitest";
import { FakeReasoningModel } from "../../src/agent/models/fake-reasoning-model.js";
import type { CaseContext } from "../../src/model/context-builder.js";
import type { CaseRecord } from "../../src/domain/cases/case.js";
import type { OperationalSnapshot } from "../../src/model/operational-model.js";
import type { ProductOperationalContext } from "../../src/model/context-builder.js";

describe("FakeReasoningModel", () => {
  const model = new FakeReasoningModel();

  const baseCase: CaseRecord = {
    id: "case-1",
    type: "inventory_replenishment",
    status: "OPEN",
    priority: "MEDIUM",
    title: "Test case",
    subjectType: "product",
    subjectId: "prod-1",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    resolvedAt: null,
  };

  const createFakeContext = (currentStock: number, minimumStock: number): CaseContext => {
    return {
      caseRecord: baseCase,
      relatedEvents: [],
      operationalContext: {
        product: { id: "prod-1", sku: "SKU-1", name: "Product 1" },
        inventory: { productId: "prod-1", currentStock, minimumStock },
        supplier: null,
        openPurchaseOrders: [],
      },
    };
  };

  it("proposes NO_ACTION when inventory is above minimum", async () => {
    const context = createFakeContext(20, 10);
    const decision = await model.reason(context);
    expect(decision.decision).toBe("NO_ACTION");
  });

  it("proposes CREATE_PURCHASE_ORDER when inventory is below minimum", async () => {
    const context = createFakeContext(5, 10);
    const decision = await model.reason(context);
    
    expect(decision.decision).toBe("PROPOSE_ACTION");
    expect(decision.action).toEqual({
      type: "CREATE_PURCHASE_ORDER",
      productId: "prod-1",
      quantity: 15,
    });
  });

  it("proposes NO_ACTION for an unknown case type", async () => {
    const context: CaseContext = {
      caseRecord: { ...baseCase, type: "generic" },
      relatedEvents: [],
      operationalContext: null,
    };
    const decision = await model.reason(context);
    expect(decision.decision).toBe("NO_ACTION");
  });
});
