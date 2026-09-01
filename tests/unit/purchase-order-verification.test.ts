import { describe, expect, it } from "vitest";
import { PurchaseOrderVerificationStrategy } from "../../src/verification/strategies/purchase-order-verification-strategy.js";
import { InMemoryPurchaseOrderRepository } from "../../src/db/repositories/purchase-order-repository.js";
import type { VerificationInput } from "../../src/verification/verifier.js";

const productId = "9b2f1a34-1c4d-4e5f-8a9b-0c1d2e3f4a5b";
const supplierId = "d9f8e7c6-b5a4-3c2d-1e0f-9a8b7c6d5e4f";
const otherSupplierId = "a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d";
const otherProductId = "f1e2d3c4-b5a6-4789-8a9b-0c1d2e3f4a5b";

function input(overrides: Partial<VerificationInput> = {}): VerificationInput {
  return {
    caseId: "case-1",
    actionExecutionId: "exec-1",
    actionType: "CREATE_PURCHASE_ORDER",
    parameters: { productId, quantity: 20, supplierId },
    execution: { referenceId: "po-123" },
    ...overrides,
  };
}

describe("PurchaseOrderVerificationStrategy", () => {
  let poRepo: InMemoryPurchaseOrderRepository;
  const strategy = () => new PurchaseOrderVerificationStrategy(poRepo);

  async function seedPo(overrides: {
    id?: string;
    supplierId?: string | null;
    status?: "draft" | "created" | "confirmed" | "received" | "cancelled";
    items?: { productId: string; quantity: number }[];
  } = {}) {
    return poRepo.create({
      id: overrides.id ?? "po-123",
      supplierId: overrides.supplierId !== undefined ? overrides.supplierId : supplierId,
      status: overrides.status ?? "created",
      items: overrides.items ?? [{ productId, quantity: 20 }],
      idempotencyKey: null,
    });
  }

  it("VERIFIED when the PO exists and matches expectations", async () => {
    poRepo = new InMemoryPurchaseOrderRepository();
    await seedPo();

    const outcome = await strategy().check(input());

    expect(outcome.outcome).toBe("VERIFIED");
    expect(outcome.reason).toMatch(/matches the authorized action/);
    expect(outcome.actual).toMatchObject({ purchaseOrderId: "po-123", status: "created" });
  });

  it("FAILED when the reference id is missing", async () => {
    poRepo = new InMemoryPurchaseOrderRepository();
    const outcome = await strategy().check(input({ execution: {} }));
    expect(outcome.outcome).toBe("FAILED");
    expect(outcome.reason).toMatch(/Missing reference id/);
  });

  it("FAILED when the PO does not exist in authoritative state", async () => {
    poRepo = new InMemoryPurchaseOrderRepository();
    const outcome = await strategy().check(input());
    expect(outcome.outcome).toBe("FAILED");
    expect(outcome.reason).toMatch(/not found/);
  });

  it("FAILED when the product does not match", async () => {
    poRepo = new InMemoryPurchaseOrderRepository();
    await seedPo({ items: [{ productId: otherProductId, quantity: 20 }] });

    const outcome = await strategy().check(input());
    expect(outcome.outcome).toBe("FAILED");
    expect(outcome.reason).toMatch(/Product mismatch/);
  });

  it("FAILED when the quantity does not match", async () => {
    poRepo = new InMemoryPurchaseOrderRepository();
    await seedPo({ items: [{ productId, quantity: 99 }] });

    const outcome = await strategy().check(input());
    expect(outcome.outcome).toBe("FAILED");
    expect(outcome.reason).toMatch(/Quantity mismatch/);
  });

  it("FAILED when the supplier does not match", async () => {
    poRepo = new InMemoryPurchaseOrderRepository();
    await seedPo({ supplierId: otherSupplierId });

    const outcome = await strategy().check(input());
    expect(outcome.outcome).toBe("FAILED");
    expect(outcome.reason).toMatch(/Supplier mismatch/);
  });

  it("FAILED when the PO was created for a different single product set", async () => {
    poRepo = new InMemoryPurchaseOrderRepository();
    await seedPo({
      items: [
        { productId, quantity: 20 },
        { productId: otherProductId, quantity: 5 },
      ],
    });

    const outcome = await strategy().check(input());
    expect(outcome.outcome).toBe("FAILED");
    expect(outcome.reason).toMatch(/Expected exactly 1 order item/);
  });

  it("FAILED when the PO is not in 'created' status (e.g. cancelled)", async () => {
    poRepo = new InMemoryPurchaseOrderRepository();
    await seedPo({ status: "cancelled" });

    const outcome = await strategy().check(input());
    expect(outcome.outcome).toBe("FAILED");
    expect(outcome.reason).toMatch(/status is 'cancelled'/);
  });

  it("FAILED (fail closed) when expected parameters are invalid", async () => {
    poRepo = new InMemoryPurchaseOrderRepository();
    await seedPo();

    const outcome = await strategy().check(
      input({ parameters: { productId: "not-a-uuid", quantity: -1 } }),
    );
    expect(outcome.outcome).toBe("FAILED");
    expect(outcome.reason).toMatch(/do not match the action schema/);
  });
});
