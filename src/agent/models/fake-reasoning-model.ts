import type { AgentDecision, ReasoningModel } from "../reasoning-model.js";
import { isBelowMinimum } from "../../domain/inventory/inventory.js";
import type { CaseContext } from "../../model/context-builder.js";

/**
 * Deterministic fake reasoning model. It inspects the case context and
 * produces a plausible decision so the whole system runs without any external
 * LLM or API key. Swap in an LLMReasoningModel later behind the same
 * ReasoningModel interface.
 */
export class FakeReasoningModel implements ReasoningModel {
  async reason(context: CaseContext): Promise<AgentDecision> {
    if (context.caseRecord.type === "inventory_replenishment") {
      const level = context.operationalContext?.inventory;

      if (level && isBelowMinimum(level)) {
        // Deterministic replenishment rule: order enough to reach twice the
        // minimum stock level, with a floor of the minimum stock itself.
        const quantity = Math.max(level.minimumStock * 2 - level.currentStock, level.minimumStock);
        return {
          decision: "PROPOSE_ACTION",
          rationale: `Stock ${level.currentStock} is below minimum ${level.minimumStock}; proposing purchase order of ${quantity} units.`,
          action: {
            type: "CREATE_PURCHASE_ORDER",
            productId: level.productId,
            quantity,
          },
          confidence: 1.0,
        };
      }

      return {
        decision: "NO_ACTION",
        rationale: "Inventory is at or above minimum stock; no action needed.",
        confidence: 1.0,
      };
    }

    return {
      decision: "NO_ACTION",
      rationale: `No reasoning strategy for case type "${context.caseRecord.type}".`,
      confidence: 1.0,
    };
  }
}
