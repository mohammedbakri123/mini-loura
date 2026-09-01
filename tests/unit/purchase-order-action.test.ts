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

  it("produces a stable idempotency key for identical parameters and distinct for different ones", () => {
    const action = createPurchaseOrderAction();
    const params1 = { productId, quantity: 50 };
    const params2 = { productId, quantity: 51 };
    const key1 = action.idempotencyKey(params1);
    const key2 = action.idempotencyKey(params2);

    expect(key1).toBe(action.idempotencyKey(params1)); // stable
    expect(key1).toContain("CREATE_PURCHASE_ORDER:");
    expect(key1).not.toBe(key2); // distinct parameters give distinct keys
  });

  it("declares its verification strategy and expected side effect", () => {
    const action = createPurchaseOrderAction();
    expect(action.verificationStrategy).toBe("immediate");
    expect(action.expectedSideEffect).toContain("purchase order exists");
  });

  it("executor successfully creates a PO when valid", async () => {
    const { InMemoryPurchaseOrderRepository } = await import("../../src/db/repositories/purchase-order-repository.js");
    const { InMemorySupplierRepository } = await import("../../src/db/repositories/supplier-repository.js");
    const { PurchaseOrderExecutor } = await import("../../src/actions/purchase-order-action.js");
    
    const poRepo = new InMemoryPurchaseOrderRepository();
    const supplierRepo = new InMemorySupplierRepository();
    
    // Add supplier
    const supplierId = "d9f8e7c6-b5a4-3c2d-1e0f-9a8b7c6d5e4f";
    await supplierRepo.upsert({ id: supplierId, name: "Test Supplier" });

    const executor = new PurchaseOrderExecutor(poRepo, supplierRepo);
    const action = createPurchaseOrderAction({ executor });

    const params = { productId, quantity: 50, supplierId };
    const result = await action.executor.execute(params, action.idempotencyKey(params));
    
    expect(result.executed).toBe(true);
    expect(result.referenceId).toBeDefined();

    const po = await poRepo.findById(result.referenceId!);
    expect(po?.status).toBe("created");
    expect(po?.supplierId).toBe(supplierId);
  });

  it("executor fails if supplierId is missing (no default)", async () => {
    const { InMemoryPurchaseOrderRepository } = await import("../../src/db/repositories/purchase-order-repository.js");
    const { InMemorySupplierRepository } = await import("../../src/db/repositories/supplier-repository.js");
    const { PurchaseOrderExecutor } = await import("../../src/actions/purchase-order-action.js");
    
    const poRepo = new InMemoryPurchaseOrderRepository();
    const supplierRepo = new InMemorySupplierRepository();

    const executor = new PurchaseOrderExecutor(poRepo, supplierRepo);
    const action = createPurchaseOrderAction({ executor });

    const params = { productId, quantity: 50 };
    await expect(action.executor.execute(params, action.idempotencyKey(params))).rejects.toThrowError(
      /supplierId is required/
    );
  });

  it("unknown actions cannot be fetched from the registry", () => {
    const registry = new ActionRegistry();
    registry.register(createPurchaseOrderAction());
    expect(registry.has("CREATE_PURCHASE_ORDER")).toBe(true);
    expect(() => registry.get("deleteEverything")).toThrowError(ActionNotRegisteredError);
  });
});
