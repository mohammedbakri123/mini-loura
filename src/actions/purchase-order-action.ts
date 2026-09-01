import { z } from "zod";
import type { ActionExecutor, ExecutionResult } from "./action-executor.js";
import type { RegisteredAction } from "../governance/action-registry.js";

export const CreatePurchaseOrderInputSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().positive(),
  supplierId: z.string().uuid().optional(),
});

export type CreatePurchaseOrderInput = z.infer<typeof CreatePurchaseOrderInputSchema>;

/**
 * Purchase order executor.
 *
 * Intentionally left unimplemented: actual persistence and confirmation flow
 * arrive in the Action Execution stage (Stage 6). The definition, input schema,
 * idempotency rule, and verification strategy are fixed now so governance and
 * verification can be built against a stable action contract.
 */
export class UnimplementedPurchaseOrderExecutor implements ActionExecutor {
  async execute(
    _parameters: unknown,
    _idempotencyKey: string,
  ): Promise<ExecutionResult> {
    throw new Error(
      "create_purchase_order execution is not implemented yet (Stage 6: Action Execution).",
    );
  }
}

export function createPurchaseOrderAction(options?: {
  executor?: ActionExecutor;
}): RegisteredAction {
  return {
    name: "create_purchase_order",
    description: "Create a purchase order to replenish inventory for a product.",
    inputSchema: CreatePurchaseOrderInputSchema,
    expectedSideEffect:
      "A purchase order exists in state 'created' for the given product and quantity.",
    verificationStrategy: "immediate",
    idempotencyKey: (parameters) => {
      const parsed = CreatePurchaseOrderInputSchema.parse(parameters);
      return `create_purchase_order:${parsed.productId}:${parsed.quantity}:${
        parsed.supplierId ?? "any-supplier"
      }`;
    },
    executor: options?.executor ?? new UnimplementedPurchaseOrderExecutor(),
  };
}
