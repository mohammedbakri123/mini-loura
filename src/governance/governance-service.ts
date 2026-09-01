import type { AgentDecision } from "../agent/reasoning-model.js";
import type { PolicyEngine, PolicyEvaluation } from "./policy-engine.js";
import type { GovernanceRepository } from "../db/repositories/governance-repository.js";
import type { AuditLedger } from "../audit/audit-ledger.js";

export class GovernanceService {
  constructor(
    private readonly deps: {
      policyEngine: PolicyEngine;
      governanceRepository: GovernanceRepository;
      auditLedger: AuditLedger;
    }
  ) {}

  async evaluate(
    decision: AgentDecision,
    caseId: string,
    agentRunId: string | null
  ): Promise<PolicyEvaluation | null> {
    if (decision.decision === "NO_ACTION" || decision.decision === "ESCALATE") {
      return null;
    }

    if (!decision.action) {
      throw new Error("PROPOSE_ACTION requires an action payload.");
    }

    // 1. Deterministic Evaluation
    const evaluation = await this.deps.policyEngine.evaluate(
      decision.action.type,
      decision.action,
      { caseId }
    );

    // 2. Persist Governance Evaluation
    await this.deps.governanceRepository.recordEvaluation(
      caseId,
      agentRunId,
      decision.action.type,
      evaluation,
      decision.action
    );

    // 3. Emit Audit Events
    await this.deps.auditLedger.append({
      type: "POLICY_EVALUATED",
      actor: "governance-service",
      caseId,
      eventId: null,
      data: {
        actionType: decision.action.type,
        decision: evaluation.decision,
        ruleId: evaluation.ruleId,
        reason: evaluation.reason,
      },
    });

    if (evaluation.decision === "ALLOW") {
      await this.deps.auditLedger.append({
        type: "ACTION_ALLOWED",
        actor: "governance-service",
        caseId,
        eventId: null,
        data: { actionType: decision.action.type },
      });
    } else if (evaluation.decision === "DENY") {
      await this.deps.auditLedger.append({
        type: "ACTION_DENIED",
        actor: "governance-service",
        caseId,
        eventId: null,
        data: { actionType: decision.action.type },
      });
    } else if (evaluation.decision === "REQUIRE_HUMAN_APPROVAL") {
      await this.deps.auditLedger.append({
        type: "HUMAN_APPROVAL_REQUIRED",
        actor: "governance-service",
        caseId,
        eventId: null,
        data: { actionType: decision.action.type },
      });
    }

    return evaluation;
  }
}
