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

export type ProposedAction = {
  type: "CREATE_PURCHASE_ORDER";
  productId: string;
  supplierId?: string | null;
  quantity: number;
};

export interface AgentDecision {
  decision: "NO_ACTION" | "PROPOSE_ACTION" | "ESCALATE";
  rationale: string;
  action?: ProposedAction;
  confidence?: number;
}

export interface ReasoningModel {
  reason(context: import("../model/context-builder.js").CaseContext): Promise<AgentDecision>;
}

// Re-exported so agent-layer modules can import AgentContext in one place.
export type { AgentContext } from "../model/context-builder.js";
