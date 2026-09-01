import type { AgentDecision, ReasoningModel } from "./reasoning-model.js";
import { buildAgentContext, type AgentContext } from "../model/context-builder.js";
import type { ContextBuilderInput } from "../model/context-builder.js";

/**
 * The governed agent turns a case into a *proposed* decision.
 *
 * Responsibilities:
 *   - build an explicit context
 *   - ask the reasoning model for a structured decision
 *   - record the decision for audit
 *
 * It never executes anything and never self-authorizes.
 */
export class GovernedAgent {
  constructor(
    private readonly deps: {
      reasoningModel: ReasoningModel;
      onDecision?: (decision: AgentDecision, context: AgentContext) => Promise<void>;
    },
  ) {}

  async handleCase(input: ContextBuilderInput): Promise<AgentDecision> {
    const context = buildAgentContext(input);
    const decision = await this.deps.reasoningModel.decide(context);

    if (this.deps.onDecision) {
      await this.deps.onDecision(decision, context);
    }

    return decision;
  }
}
