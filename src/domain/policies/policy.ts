/**
 * Policies are deterministic rules evaluated by the policy engine
 * (src/governance/policy-engine.ts). Policies never depend on the LLM and the
 * LLM can never override them.
 */
export type PolicyEffect = "ALLOW" | "DENY" | "REQUIRE_HUMAN_APPROVAL";

export interface Policy {
  id: string;
  name: string;
  /** The action name this policy applies to, e.g. "create_purchase_order". */
  action: string;
  effect: PolicyEffect;
  /** Free-form, action-specific configuration (limits, thresholds...). */
  config: Record<string, unknown>;
  enabled: boolean;
}
