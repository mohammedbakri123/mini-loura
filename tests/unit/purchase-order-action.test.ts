import { describe, expect, it } from "vitest";
import { createPurchaseOrderAction, CreatePurchaseOrderInputSchema } from "../../src/actions/purchase-order-action.js";
import { ActionRegistry, ActionNotRegisteredError } from "../../src/governance/action-registry.js";

const productId = "9b2f1a34-1c4d-4e5f-8a9b-0c1d2e3f4a5b";

describe("CREATE_PURCHASE_ORDER action definition", () => {
  it("rejects invalid input via its schema", () => {
    const bad = CreatePurchaseOrderInputSchema.safeParse({ productId: "not-a-uuid", quantity: 0 });
    expect(bad.success).toBe(false);

    const good = CreatePurchaseOrderInputSchema.safeParse({ productId, quantity: 50 });
    expect(good.success).toBe(true);
  });

  it("produces a stable idempotency key for identical parameters", () => {
    const action = createPurchaseOrderAction();
    const params = { productId, quantity: 50 };
    expect(action.idempotencyKey(params)).toBe(action.idempotencyKey(params));
    expect(action.idempotencyKey(params)).toBe(
      `CREATE_PURCHASE_ORDER:${productId}:50:any-supplier`,
    );
  });

  it("declares its verification strategy and expected side effect", () => {
    const action = createPurchaseOrderAction();
    expect(action.verificationStrategy).toBe("immediate");
    expect(action.expectedSideEffect).toContain("purchase order exists");
  });

  it("executor is explicitly unimplemented until Stage 6", async () => {
    const action = createPurchaseOrderAction();
    await expect(action.executor.execute({ productId, quantity: 50 }, "key-1")).rejects.toThrowError(
      /Stage 6/,
    );
  });

  it("unknown actions cannot be fetched from the registry", () => {
    const registry = new ActionRegistry();
    registry.register(createPurchaseOrderAction());
    expect(registry.has("CREATE_PURCHASE_ORDER")).toBe(true);
    expect(() => registry.get("deleteEverything")).toThrowError(ActionNotRegisteredError);
  });
});
