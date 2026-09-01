import { z } from "zod";
import type { Policy } from "../domain/policies/policy.js";

export type PolicyDecision = "ALLOW" | "DENY" | "REQUIRE_HUMAN_APPROVAL";

export interface PolicyEvaluation {
  decision: PolicyDecision;
  /** Which policy/rule produced the decision. */
  ruleId: string;
  reason: string;
}

export interface PolicyEngine {
  /**
   * Deterministically evaluate a proposed action. Must never call the LLM and
   * must produce the same output for the same input.
   */
  evaluate(
    action: string,
    parameters: unknown,
    context: { caseId?: string },
  ): Promise<PolicyEvaluation>;
}

interface ActionRule {
  /** Parses and narrows the parameters; returns null when they do not match. */
  parse: (parameters: unknown) => unknown;
  decide: (parameters: unknown) => { decision: PolicyDecision; reason: string };
}

const createPurchaseOrderParams = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().positive(),
  supplierId: z.string().uuid().optional(),
});

const DEFAULT_MAX_AUTO_ORDER_QUANTITY = 200;

/**
 * Deterministic policy engine.
 *
 * The initial rule set is hard-coded here; Stage 5 will load policies from the
 * `policies` table while keeping evaluation fully deterministic.
 */
export class DeterministicPolicyEngine implements PolicyEngine {
  private readonly rules: Map<string, ActionRule>;

  constructor(options?: { maxAutoOrderQuantity?: number }) {
    const maxAuto = options?.maxAutoOrderQuantity ?? DEFAULT_MAX_AUTO_ORDER_QUANTITY;
    this.rules = new Map<string, ActionRule>([
      [
        "create_purchase_order",
        {
          parse: (params) => createPurchaseOrderParams.safeParse(params),
          decide: (params) => {
            const parsed = createPurchaseOrderParams.parse(params);
            if (parsed.quantity > maxAuto) {
              return {
                decision: "REQUIRE_HUMAN_APPROVAL",
                reason: `Quantity ${parsed.quantity} exceeds auto-approval limit of ${maxAuto}.`,
              };
            }
            return {
              decision: "ALLOW",
              reason: `Quantity ${parsed.quantity} is within auto-approval limit of ${maxAuto}.`,
            };
          },
        },
      ],
    ]);
  }

  async evaluate(
    action: string,
    parameters: unknown,
    _context: { caseId?: string } = {},
  ): Promise<PolicyEvaluation> {
    const rule = this.rules.get(action);
    if (!rule) {
      // Unknown actions are denied by default: the LLM can never invent an
      // action and have it pass governance.
      return {
        decision: "DENY",
        ruleId: "default.deny_unknown_action",
        reason: `No policy registered for action "${action}".`,
      };
    }

    const parsed = rule.parse(parameters);
    if (parsed instanceof Object && "success" in parsed && !parsed.success) {
      return {
        decision: "DENY",
        ruleId: `action.${action}.invalid_parameters`,
        reason: "Proposed action parameters do not match the action schema.",
      };
    }

    const outcome = rule.decide(parameters);
    return {
      decision: outcome.decision,
      ruleId: `action.${action}`,
      reason: outcome.reason,
    };
  }
}
