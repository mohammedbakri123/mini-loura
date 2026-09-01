import type { ActionRegistry } from "./action-registry.js";
import type { PolicyRepository } from "../db/repositories/policy-repository.js";
import type { PolicyRecord } from "../db/repositories/policy-repository.js";

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
    context?: { caseId?: string },
  ): Promise<PolicyEvaluation>;
}

/**
 * Type guard for the specific maxAutoOrderQuantity check we want to implement dynamically.
 */
function isConfigWithMaxQuantity(config: unknown): config is { maxAutoOrderQuantity: number } {
  return (
    typeof config === "object" &&
    config !== null &&
    "maxAutoOrderQuantity" in config &&
    typeof (config as any).maxAutoOrderQuantity === "number"
  );
}

/**
 * Deterministic policy engine that loads configuration from a database repository
 * and verifies action structure using the action registry.
 */
export class DeterministicPolicyEngine implements PolicyEngine {
  constructor(
    private readonly deps: {
      actionRegistry: ActionRegistry;
      policyRepository: PolicyRepository;
    }
  ) {}

  async evaluate(
    actionType: string,
    parameters: unknown,
    _context: { caseId?: string } = {},
  ): Promise<PolicyEvaluation> {
    // 1. Unknown action -> DENY
    if (!this.deps.actionRegistry.has(actionType)) {
      return {
        decision: "DENY",
        ruleId: "default.deny_unknown_action",
        reason: `No policy registered for action "${actionType}".`,
      };
    }

    const action = this.deps.actionRegistry.get(actionType);

    // 2. Invalid parameters -> DENY
    const parsed = action.inputSchema.safeParse(parameters);
    if (!parsed.success) {
      return {
        decision: "DENY",
        ruleId: `action.${actionType}.invalid_parameters`,
        reason: "Proposed action parameters do not match the action schema.",
      };
    }

    // 3. Load enabled policies from DB
    const policies = await this.deps.policyRepository.findEnabledPoliciesForAction(actionType);

    // 4. If no policies exist for this action -> DENY (default deny)
    if (policies.length === 0) {
      return {
        decision: "DENY",
        ruleId: "default.deny_unconfigured_action",
        reason: `No enabled policies found for action "${actionType}".`,
      };
    }

    // 5. Evaluate deterministic rules sequentially by priority
    for (const policy of policies) {
      const evaluation = this.evaluatePolicy(policy, parsed.data);
      if (evaluation) {
        return evaluation;
      }
    }

    // Fallback if policies were loaded but none matched explicitly
    return {
      decision: "DENY",
      ruleId: "default.deny_no_matching_rules",
      reason: "No rules explicitly allowed this action.",
    };
  }

  private evaluatePolicy(policy: PolicyRecord, parameters: any): PolicyEvaluation | null {
    // Implement deterministic evaluation logic based on policy configuration.
    // For MVP, handle specific CREATE_PURCHASE_ORDER constraints if configured.
    
    if (policy.actionType === "CREATE_PURCHASE_ORDER" && isConfigWithMaxQuantity(policy.configuration)) {
      const maxAuto = policy.configuration.maxAutoOrderQuantity;
      if (parameters.quantity > maxAuto) {
        return {
          decision: "REQUIRE_HUMAN_APPROVAL",
          ruleId: policy.id,
          reason: `Quantity ${parameters.quantity} exceeds auto-approval limit of ${maxAuto}.`,
        };
      } else {
        return {
          decision: "ALLOW",
          ruleId: policy.id,
          reason: `Quantity ${parameters.quantity} is within auto-approval limit of ${maxAuto}.`,
        };
      }
    }

    // For generic policies that might just explicitly ALLOW or DENY based on their configuration 'effect'
    if (typeof policy.configuration.effect === "string") {
      const effect = policy.configuration.effect as PolicyDecision;
      if (["ALLOW", "DENY", "REQUIRE_HUMAN_APPROVAL"].includes(effect)) {
         return {
           decision: effect,
           ruleId: policy.id,
           reason: `Policy explicit rule hit: ${policy.name}`,
         };
      }
    }

    return null; // Skip to next policy if no condition matched
  }
}
