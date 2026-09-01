import type { AgentContext, AgentDecision, ReasoningModel } from "../reasoning-model.js";
import { isBelowMinimum } from "../../domain/inventory/inventory.js";

/**
 * Deterministic fake reasoning model. It inspects the agent context and
 * produces a plausible decision so the whole system runs without any external
 * LLM or API key. Swap in an LLMReasoningModel later behind the same
 * ReasoningModel interface.
 */
export class FakeReasoningModel implements ReasoningModel {
  async decide(context: AgentContext): Promise<AgentDecision> {
    if (context.case.type === "inventory_replenishment") {
      const level = context.operationalState.inventory.find(
        (i) => i.productId === context.case.subjectId,
      );

      if (level && isBelowMinimum(level)) {
        // Deterministic replenishment rule: order enough to reach twice the
        // minimum stock level, with a floor of the minimum stock itself.
        const quantity = Math.max(level.minimumStock * 2 - level.currentStock, level.minimumStock);
        return {
          action: "create_purchase_order",
          parameters: {
            productId: level.productId,
            quantity,
          },
          reasoningSummary:
            `Stock ${level.currentStock} is below minimum ${level.minimumStock}; ` +
            `proposing purchase order of ${quantity} units.`,
        };
      }

      return {
        action: "no_action",
        parameters: {},
        reasoningSummary: "Inventory is at or above minimum stock; no action needed.",
      };
    }

    return {
      action: "no_action",
      parameters: {},
      reasoningSummary: `No reasoning strategy for case type "${context.case.type}".`,
    };
  }
}
