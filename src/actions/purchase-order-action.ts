import { z } from "zod";
import type { ActionExecutor, ExecutionResult } from "./action-executor.js";
import type { RegisteredAction } from "../governance/action-registry.js";
import type { PurchaseOrderRepository } from "../db/repositories/purchase-order-repository.js";
import type { SupplierRepository } from "../db/repositories/supplier-repository.js";

export const CreatePurchaseOrderInputSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().positive(),
  supplierId: z.string().uuid().optional(),
});

export type CreatePurchaseOrderInput = z.infer<typeof CreatePurchaseOrderInputSchema>;

export class PurchaseOrderExecutor implements ActionExecutor {
  constructor(
    private readonly poRepo: PurchaseOrderRepository,
    private readonly supplierRepo: SupplierRepository,
  ) {}

  async execute(
    parameters: unknown,
    idempotencyKey: string,
  ): Promise<ExecutionResult> {
    const input = CreatePurchaseOrderInputSchema.parse(parameters);

    if (input.supplierId) {
      const supplier = await this.supplierRepo.findById(input.supplierId);
      if (!supplier) {
        throw new Error(`Supplier not found: ${input.supplierId}`);
      }
    } else {
      // In a real system, you might look up a primary supplier.
      // If we cannot deterministically pick one, execution fails.
      throw new Error("Cannot execute: supplierId is required but was not provided, and no deterministic default exists.");
    }

    const po = await this.poRepo.create({
      supplierId: input.supplierId,
      items: [{ productId: input.productId, quantity: input.quantity }],
      status: "created",
      idempotencyKey,
    });

    return {
      executed: true,
      referenceId: po.id,
      details: {
        poId: po.id,
        supplierId: po.supplierId,
        status: po.status,
      },
    };
  }
}

export function createPurchaseOrderAction(options?: {
  executor?: ActionExecutor;
}): RegisteredAction {
  return {
    name: "CREATE_PURCHASE_ORDER",
    description: "Create a purchase order to replenish inventory for a product.",
    inputSchema: CreatePurchaseOrderInputSchema,
    expectedSideEffect:
      "A purchase order exists in state 'created' for the given product and quantity.",
    verificationStrategy: "immediate",
    idempotencyKey: (parameters) => {
      const parsed = CreatePurchaseOrderInputSchema.parse(parameters);
      const crypto = require("node:crypto");
      const hash = crypto.createHash("sha256").update(JSON.stringify({
        action: "CREATE_PURCHASE_ORDER",
        productId: parsed.productId,
        quantity: parsed.quantity,
        supplierId: parsed.supplierId ?? null
      })).digest("hex");
      return `CREATE_PURCHASE_ORDER:${hash}`;
    },
    // We throw an error if called without an executor, rather than providing an unimplemented one,
    // to ensure Stage 6 composition provides a real executor.
    executor: options?.executor ?? {
      execute: async () => {
        throw new Error("No executor provided for CREATE_PURCHASE_ORDER");
      }
    },
  };
}
