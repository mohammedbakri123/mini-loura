import { describe, expect, it } from "vitest";
import { DeterministicPolicyEngine } from "../../src/governance/policy-engine.js";

const engine = new DeterministicPolicyEngine();
const productId = "9b2f1a34-1c4d-4e5f-8a9b-0c1d2e3f4a5b";

describe("DeterministicPolicyEngine", () => {
  it("allows a purchase order within the auto-approval limit", async () => {
    const evaluation = await engine.evaluate(
      "create_purchase_order",
      { productId, quantity: 50 },
      { caseId: "case-1" },
    );
    expect(evaluation.decision).toBe("ALLOW");
  });

  it("requires human approval above the auto-approval limit", async () => {
    const evaluation = await engine.evaluate("create_purchase_order", {
      productId,
      quantity: 5000,
    });
    expect(evaluation.decision).toBe("REQUIRE_HUMAN_APPROVAL");
  });

  it("denies invalid parameters", async () => {
    const evaluation = await engine.evaluate("create_purchase_order", {
      productId,
      quantity: -5,
    });
    expect(evaluation.decision).toBe("DENY");
  });

  it("denies unknown actions (LLM cannot invent actions)", async () => {
    const evaluation = await engine.evaluate("wire_money_to_my_account", {});
    expect(evaluation.decision).toBe("DENY");
    expect(evaluation.ruleId).toBe("default.deny_unknown_action");
  });

  it("is deterministic: same input, same output", async () => {
    const input = { productId, quantity: 50 };
    const a = await engine.evaluate("create_purchase_order", input);
    const b = await engine.evaluate("create_purchase_order", input);
    expect(a).toEqual(b);
  });

  it("respects a custom auto-approval limit", async () => {
    const strict = new DeterministicPolicyEngine({ maxAutoOrderQuantity: 10 });
    const evaluation = await strict.evaluate("create_purchase_order", {
      productId,
      quantity: 50,
    });
    expect(evaluation.decision).toBe("REQUIRE_HUMAN_APPROVAL");
  });
});
