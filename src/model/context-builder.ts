import type { CaseRecord } from "../domain/cases/case.js";
import type { OperationalEvent } from "../domain/events/event.js";
import type { Policy } from "../domain/policies/policy.js";
import type { OperationalSnapshot } from "./operational-model.js";
import type { ToolDefinition } from "../agent/reasoning-model.js";

/**
 * AgentContext is the *only* information channel into the reasoning model.
 * Everything the agent is allowed to know must be explicitly included here.
 */
export type AgentContext = {
  case: CaseRecord;
  operationalState: OperationalSnapshot;
  relevantEvents: OperationalEvent[];
  policies: Policy[];
  availableTools: ToolDefinition[];
};

export interface ContextBuilderInput {
  case: CaseRecord;
  operationalState: OperationalSnapshot;
  relevantEvents: OperationalEvent[];
  policies: Policy[];
  availableTools: ToolDefinition[];
}

/**
 * Builds the agent context. In later stages this will select only the relevant
 * slice of events and policies for the case; today it passes through what the
 * caller provides.
 */
export function buildAgentContext(input: ContextBuilderInput): AgentContext {
  return {
    case: input.case,
    operationalState: input.operationalState,
    relevantEvents: input.relevantEvents,
    policies: input.policies,
    availableTools: input.availableTools,
  };
}
