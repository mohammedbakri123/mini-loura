import crypto from "node:crypto";
import type { Database } from "../client.js";
import type { PolicyEvaluation } from "../../governance/policy-engine.js";

export interface GovernanceEvaluationRecord {
  id: string;
  caseId: string;
  agentRunId: string | null;
  actionType: string;
  decision: string;
  ruleId: string;
  reason: string;
  createdAt: string;
}

export interface GovernanceRepository {
  recordEvaluation(
    caseId: string,
    agentRunId: string | null,
    actionType: string,
    evaluation: PolicyEvaluation
  ): Promise<GovernanceEvaluationRecord>;
}

interface GovernanceEvaluationRow {
  id: string;
  case_id: string;
  agent_run_id: string | null;
  action_type: string;
  decision: string;
  rule_id: string;
  reason: string;
  created_at: Date;
}

export class PostgresGovernanceRepository implements GovernanceRepository {
  constructor(private readonly db: Database) {}

  async recordEvaluation(
    caseId: string,
    agentRunId: string | null,
    actionType: string,
    evaluation: PolicyEvaluation
  ): Promise<GovernanceEvaluationRecord> {
    const result = await this.db.query<GovernanceEvaluationRow>(
      `INSERT INTO governance_evaluations (case_id, agent_run_id, action_type, decision, rule_id, reason)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [caseId, agentRunId, actionType, evaluation.decision, evaluation.ruleId, evaluation.reason]
    );

    const row = result.rows[0]!;
    return {
      id: row.id,
      caseId: row.case_id,
      agentRunId: row.agent_run_id,
      actionType: row.action_type,
      decision: row.decision,
      ruleId: row.rule_id,
      reason: row.reason,
      createdAt: new Date(row.created_at).toISOString(),
    };
  }
}

export class InMemoryGovernanceRepository implements GovernanceRepository {
  private records: GovernanceEvaluationRecord[] = [];

  async recordEvaluation(
    caseId: string,
    agentRunId: string | null,
    actionType: string,
    evaluation: PolicyEvaluation
  ): Promise<GovernanceEvaluationRecord> {
    const record: GovernanceEvaluationRecord = {
      id: crypto.randomUUID(),
      caseId,
      agentRunId,
      actionType,
      decision: evaluation.decision,
      ruleId: evaluation.ruleId,
      reason: evaluation.reason,
      createdAt: new Date().toISOString(),
    };
    this.records.push(record);
    return record;
  }
}
