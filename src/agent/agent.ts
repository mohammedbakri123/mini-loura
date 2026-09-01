import type { AgentDecision, ReasoningModel } from "./reasoning-model.js";
import type { CaseContextBuilder, CaseContext } from "../model/context-builder.js";
import type { ToolRegistry } from "./tools.js";

/**
 * The governed agent turns an operational case into a *proposed* decision.
 *
 * Responsibilities:
 *   - build an explicit context for the case
 *   - ask the reasoning model for a structured decision
 *   - validate the decision structure
 *   - record the decision for audit
 *
 * It never executes operational actions and never self-authorizes.
 */
export class OperationalAgent {
  constructor(
    private readonly deps: {
      reasoningModel: ReasoningModel;
      caseContextBuilder: CaseContextBuilder;
      toolRegistry: ToolRegistry;
      agentRunRepository: import("../db/repositories/agent-run-repository.js").AgentRunRepository;
      modelName: string;
      onDecision?: (decision: AgentDecision, context: CaseContext) => Promise<void>;
    }
  ) {}

  async investigate(caseId: string): Promise<AgentDecision> {
    const context = await this.deps.caseContextBuilder.build(caseId);
    if (!context) {
      throw new Error(`Cannot investigate: Case ${caseId} not found or context could not be built.`);
    }

    // In a full implementation, this might loop MAX_STEPS times interacting with tools.
    // For MVP, we pass the pre-built rich Context to the ReasoningModel.
    let decision = await this.deps.reasoningModel.reason(context);

    // Validate structured output
    this.validateDecision(decision);

    // Record the run
    await this.deps.agentRunRepository.recordRun(caseId, this.deps.modelName, decision);

    if (this.deps.onDecision) {
      await this.deps.onDecision(decision, context);
    }

    return decision;
  }

  private validateDecision(decision: AgentDecision): void {
    if (!["NO_ACTION", "PROPOSE_ACTION", "ESCALATE"].includes(decision.decision)) {
      throw new Error(`Invalid agent decision type: ${decision.decision}`);
    }
    
    if (decision.decision === "PROPOSE_ACTION") {
      if (!decision.action) {
        throw new Error("PROPOSE_ACTION requires an 'action' payload.");
      }
      if (decision.action.type !== "CREATE_PURCHASE_ORDER") {
        throw new Error(`Unsupported action type proposed: ${decision.action.type}`);
      }
    }
  }
}
