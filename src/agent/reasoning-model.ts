/**
 * Reasoning model boundary.
 *
 * The reasoning model receives an explicit context and returns a structured
 * decision. It NEVER executes anything by itself, never receives database
 * credentials, shell, or network access, and its output is never treated as
 * authorization — the policy engine decides that.
 */

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON-schema-like description of tool input; concrete schemas live in the registry. */
  inputExample: Record<string, unknown>;
}

export interface AgentDecision {
  /** The registered action the agent proposes, e.g. "create_purchase_order". */
  action: string;
  parameters: unknown;
  /** Short structured explanation for audit/debug purposes. No hidden CoT. */
  reasoningSummary?: string;
}

export interface ReasoningModel {
  decide(context: import("../model/context-builder.js").AgentContext): Promise<AgentDecision>;
}

// Re-exported so agent-layer modules can import AgentContext in one place.
export type { AgentContext } from "../model/context-builder.js";
