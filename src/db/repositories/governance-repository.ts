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
  parameters: unknown;
  createdAt: string;
}

export interface GovernanceRepository {
  recordEvaluation(
    caseId: string,
    agentRunId: string | null,
    actionType: string,
    evaluation: PolicyEvaluation,
    parameters: unknown
  ): Promise<GovernanceEvaluationRecord>;
  findById(id: string): Promise<GovernanceEvaluationRecord | null>;
}

interface GovernanceEvaluationRow {
  id: string;
  case_id: string;
  agent_run_id: string | null;
  action_type: string;
  decision: string;
  rule_id: string;
  reason: string;
  parameters: unknown;
  created_at: Date;
}

export class PostgresGovernanceRepository implements GovernanceRepository {
  constructor(private readonly db: Database) {}

  async recordEvaluation(
    caseId: string,
    agentRunId: string | null,
    actionType: string,
    evaluation: PolicyEvaluation,
    parameters: unknown
  ): Promise<GovernanceEvaluationRecord> {
    const result = await this.db.query<GovernanceEvaluationRow>(
      `INSERT INTO governance_evaluations (case_id, agent_run_id, action_type, decision, rule_id, reason, parameters)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [caseId, agentRunId, actionType, evaluation.decision, evaluation.ruleId, evaluation.reason, JSON.stringify(parameters)]
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
      parameters: row.parameters,
      createdAt: new Date(row.created_at).toISOString(),
    };
  }

  async findById(id: string): Promise<GovernanceEvaluationRecord | null> {
    const result = await this.db.query<GovernanceEvaluationRow>(
      `SELECT * FROM governance_evaluations WHERE id = $1`,
      [id]
    );
    if (!result.rows[0]) return null;
    const row = result.rows[0];
    return {
      id: row.id,
      caseId: row.case_id,
      agentRunId: row.agent_run_id,
      actionType: row.action_type,
      decision: row.decision,
      ruleId: row.rule_id,
      reason: row.reason,
      parameters: row.parameters,
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
    evaluation: PolicyEvaluation,
    parameters: unknown
  ): Promise<GovernanceEvaluationRecord> {
    const record: GovernanceEvaluationRecord = {
      id: crypto.randomUUID(),
      caseId,
      agentRunId,
      actionType,
      decision: evaluation.decision,
      ruleId: evaluation.ruleId,
      reason: evaluation.reason,
      parameters,
      createdAt: new Date().toISOString(),
    };
    this.records.push(record);
    return record;
  }

  async findById(id: string): Promise<GovernanceEvaluationRecord | null> {
    return this.records.find((r) => r.id === id) ?? null;
  }
}
