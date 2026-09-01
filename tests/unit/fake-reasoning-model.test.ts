import { describe, expect, it } from "vitest";
import { FakeReasoningModel } from "../../src/agent/models/fake-reasoning-model.js";
import { buildAgentContext } from "../../src/model/context-builder.js";
import { createDefaultToolRegistry } from "../../src/agent/tools.js";
import type { CaseRecord } from "../../src/domain/cases/case.js";

const productId = "9b2f1a34-1c4d-4e5f-8a9b-0c1d2e3f4a5b";

function makeCase(overrides: Partial<CaseRecord> = {}): CaseRecord {
  return {
    id: "case-1",
    type: "inventory_replenishment",
    status: "OPEN",
    title: "Replenish inventory",
    subjectId: productId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    resolvedAt: null,
    ...overrides,
  };
}

describe("FakeReasoningModel", () => {
  it("proposes a purchase order when stock is below minimum", async () => {
    const model = new FakeReasoningModel();
    const context = buildAgentContext({
      case: makeCase(),
      operationalState: {
        inventory: [
          { productId, currentStock: 8, minimumStock: 20, updatedAt: new Date().toISOString() },
        ],
        capturedAt: new Date().toISOString(),
      },
      relevantEvents: [],
      policies: [],
      availableTools: createDefaultToolRegistry().listDefinitions(),
    });

    const decision = await model.decide(context);

    expect(decision.action).toBe("create_purchase_order");
    expect(decision.parameters).toEqual({ productId, quantity: 32 }); // 2*20 - 8
    expect(decision.reasoningSummary).toBeTruthy();
  });

  it("proposes no action when stock is sufficient", async () => {
    const model = new FakeReasoningModel();
    const context = buildAgentContext({
      case: makeCase(),
      operationalState: {
        inventory: [
          { productId, currentStock: 50, minimumStock: 20, updatedAt: new Date().toISOString() },
        ],
        capturedAt: new Date().toISOString(),
      },
      relevantEvents: [],
      policies: [],
      availableTools: createDefaultToolRegistry().listDefinitions(),
    });

    const decision = await model.decide(context);
    expect(decision.action).toBe("no_action");
  });

  it("proposes no action for unsupported case types", async () => {
    const model = new FakeReasoningModel();
    const context = buildAgentContext({
      case: makeCase({ type: "generic", subjectId: "unknown" }),
      operationalState: { inventory: [], capturedAt: new Date().toISOString() },
      relevantEvents: [],
      policies: [],
      availableTools: [],
    });

    const decision = await model.decide(context);
    expect(decision.action).toBe("no_action");
  });

  it("is deterministic for identical contexts", async () => {
    const model = new FakeReasoningModel();
    const base = {
      case: makeCase(),
      operationalState: {
        inventory: [
          { productId, currentStock: 8, minimumStock: 20, updatedAt: new Date().toISOString() },
        ],
        capturedAt: new Date().toISOString(),
      },
      relevantEvents: [],
      policies: [],
      availableTools: [],
    };
    const a = await model.decide(buildAgentContext(base));
    const b = await model.decide(buildAgentContext(base));
    expect(a).toEqual(b);
  });
});
