import { CreatePurchaseOrderInputSchema } from "../../actions/purchase-order-action.js";
import type { PurchaseOrderRepository } from "../../db/repositories/purchase-order-repository.js";
import type {
  VerificationInput,
  VerificationResult,
  VerificationStrategy,
} from "../verifier.js";

const STRATEGY_NAME = "purchase-order-immediate";

function result(
  outcome: "VERIFIED" | "FAILED",
  expected: unknown,
  actual: unknown,
  reason: string,
): VerificationResult {
  return {
    outcome,
    strategy: STRATEGY_NAME,
    expected,
    actual,
    reason,
    mode: "immediate",
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Verifies CREATE_PURCHASE_ORDER executions against the authoritative
 * purchase-order repository.
 *
 * It never trusts the executor's claim: it loads the purchase order from the
 * repository and checks that it exists and matches what governance authorized:
 *
 *   PO exists
 *     AND expected product matches
 *     AND expected quantity matches
 *     AND supplier matches when one was authorized
 *     AND the order is in the expected 'created' state
 *
 * Every mismatch or uncertainty fails closed.
 */
export class PurchaseOrderVerificationStrategy implements VerificationStrategy {
  readonly mode = "immediate" as const;

  constructor(private readonly purchaseOrderRepository: PurchaseOrderRepository) {}

  async check(input: VerificationInput): Promise<VerificationResult> {
    const referenceId = input.execution.referenceId;
    if (!referenceId) {
      return result("FAILED", input.parameters, null, "Missing reference id: cannot verify without a purchase order id.");
    }

    const parsed = CreatePurchaseOrderInputSchema.safeParse(input.parameters);
    if (!parsed.success) {
      return result(
        "FAILED",
        input.parameters,
        null,
        `Authorized parameters do not match the action schema: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
      );
    }
    const expected = parsed.data;

    const po = await this.purchaseOrderRepository.findById(referenceId);
    if (!po) {
      return result(
        "FAILED",
        expected,
        null,
        `Purchase order ${referenceId} not found in authoritative state.`,
      );
    }

    const actual = {
      purchaseOrderId: po.id,
      status: po.status,
      supplierId: po.supplierId,
      items: po.items,
    };

    // The action's declared side effect is "a purchase order exists in state
    // 'created'". Anything else (cancelled, received, confirmed, draft) does
    // not match what was authorized.
    if (po.status !== "created") {
      return result("FAILED", expected, actual, `Purchase order status is '${po.status}', expected 'created'.`);
    }

    if (expected.supplierId && po.supplierId !== expected.supplierId) {
      return result(
        "FAILED",
        expected,
        actual,
        `Supplier mismatch: expected ${expected.supplierId}, found ${po.supplierId ?? "none"}.`,
      );
    }

    if (po.items.length !== 1) {
      return result(
        "FAILED",
        expected,
        actual,
        `Expected exactly 1 order item for product ${expected.productId}, found ${po.items.length}.`,
      );
    }

    const item = po.items[0]!;
    if (item.productId !== expected.productId) {
      return result(
        "FAILED",
        expected,
        actual,
        `Product mismatch: expected ${expected.productId}, found ${item.productId}.`,
      );
    }

    if (item.quantity !== expected.quantity) {
      return result(
        "FAILED",
        expected,
        actual,
        `Quantity mismatch: expected ${expected.quantity}, found ${item.quantity}.`,
      );
    }

    return result("VERIFIED", expected, actual, "Purchase order exists and matches the authorized action.");
  }
}
