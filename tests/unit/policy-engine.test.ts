import { describe, expect, it, beforeEach } from "vitest";
import { DeterministicPolicyEngine } from "../../src/governance/policy-engine.js";
import { ActionRegistry } from "../../src/governance/action-registry.js";
import { InMemoryPolicyRepository } from "../../src/db/repositories/policy-repository.js";
import { createPurchaseOrderAction } from "../../src/actions/purchase-order-action.js";

const productId = "9b2f1a34-1c4d-4e5f-8a9b-0c1d2e3f4a5b";

describe("DeterministicPolicyEngine", () => {
  let actionRegistry: ActionRegistry;
  let policyRepo: InMemoryPolicyRepository;
  let engine: DeterministicPolicyEngine;

  beforeEach(() => {
    actionRegistry = new ActionRegistry();
    actionRegistry.register(createPurchaseOrderAction());
    policyRepo = new InMemoryPolicyRepository();
    engine = new DeterministicPolicyEngine({ actionRegistry, policyRepository: policyRepo });
  });

  it("allows a purchase order within the auto-approval limit", async () => {
    await policyRepo.create({
      actionType: "CREATE_PURCHASE_ORDER",
      name: "Standard reorder",
      enabled: true,
      priority: 10,
      configuration: { maxAutoOrderQuantity: 200 }
    });

    const evaluation = await engine.evaluate(
      "CREATE_PURCHASE_ORDER",
      { type: "CREATE_PURCHASE_ORDER", productId, quantity: 50 },
      { caseId: "case-1" },
    );
    expect(evaluation.decision).toBe("ALLOW");
  });

  it("requires human approval above the auto-approval limit", async () => {
    await policyRepo.create({
      actionType: "CREATE_PURCHASE_ORDER",
      name: "Standard reorder",
      enabled: true,
      priority: 10,
      configuration: { maxAutoOrderQuantity: 200 }
    });

    const evaluation = await engine.evaluate("CREATE_PURCHASE_ORDER", {
      type: "CREATE_PURCHASE_ORDER",
      productId,
      quantity: 5000,
    });
    expect(evaluation.decision).toBe("REQUIRE_HUMAN_APPROVAL");
  });

  it("denies invalid parameters (quantity < 0)", async () => {
    const evaluation = await engine.evaluate("CREATE_PURCHASE_ORDER", {
      type: "CREATE_PURCHASE_ORDER",
      productId,
      quantity: -5,
    });
    expect(evaluation.decision).toBe("DENY");
  });

  it("denies unknown actions (LLM cannot invent actions)", async () => {
    const evaluation = await engine.evaluate("DELETE_WAREHOUSE", {});
    expect(evaluation.decision).toBe("DENY");
    expect(evaluation.ruleId).toBe("default.deny_unknown_action");
  });

  it("denies when no matching policies exist", async () => {
    const evaluation = await engine.evaluate("CREATE_PURCHASE_ORDER", {
      type: "CREATE_PURCHASE_ORDER",
      productId,
      quantity: 50,
    });
    expect(evaluation.decision).toBe("DENY");
    expect(evaluation.ruleId).toBe("default.deny_unconfigured_action");
  });

  it("ignores disabled policies", async () => {
    await policyRepo.create({
      actionType: "CREATE_PURCHASE_ORDER",
      name: "Disabled limit",
      enabled: false,
      priority: 10,
      configuration: { maxAutoOrderQuantity: 200 }
    });

    const evaluation = await engine.evaluate("CREATE_PURCHASE_ORDER", {
      type: "CREATE_PURCHASE_ORDER",
      productId,
      quantity: 50,
    });
    expect(evaluation.decision).toBe("DENY");
  });

  it("evaluates multiple policies deterministically by priority DESC", async () => {
    // strict policy but lower priority
    await policyRepo.create({
      actionType: "CREATE_PURCHASE_ORDER",
      name: "Low priority strict limit",
      enabled: true,
      priority: 5,
      configuration: { maxAutoOrderQuantity: 10 }
    });
    // loose policy but higher priority
    await policyRepo.create({
      actionType: "CREATE_PURCHASE_ORDER",
      name: "High priority loose limit",
      enabled: true,
      priority: 10,
      configuration: { maxAutoOrderQuantity: 500 }
    });

    // 50 is > 10 (which would require human approval), but < 500 (which ALLOWs it).
    // Because priority 10 runs first, it matches and ALLOWs.
    const evaluation = await engine.evaluate("CREATE_PURCHASE_ORDER", {
      type: "CREATE_PURCHASE_ORDER",
      productId,
      quantity: 50,
    });
    expect(evaluation.decision).toBe("ALLOW");
  });

  it("supports explicit ALLOW configuration effect", async () => {
    await policyRepo.create({
      actionType: "CREATE_PURCHASE_ORDER",
      name: "Always allow",
      enabled: true,
      priority: 10,
      configuration: { effect: "ALLOW" }
    });

    const evaluation = await engine.evaluate("CREATE_PURCHASE_ORDER", {
      type: "CREATE_PURCHASE_ORDER",
      productId,
      quantity: 50,
    });
    expect(evaluation.decision).toBe("ALLOW");
  });
});
