import crypto from "node:crypto";
import type { AgentDecision } from "../../agent/reasoning-model.js";

export interface AgentRunRecord {
  id: string;
  caseId: string;
  model: string;
  decision: string;
  rationale: string;
  actionPayload: any | null;
  confidence: number | null;
  createdAt: string;
}

export interface AgentRunRepository {
  recordRun(caseId: string, model: string, decision: AgentDecision): Promise<AgentRunRecord>;
  listByCase(caseId: string): Promise<AgentRunRecord[]>;
}

interface AgentRunRow {
  id: string;
  case_id: string;
  model: string;
  decision: string;
  rationale: string;
  action_payload: any | null;
  confidence: string | null;
  created_at: Date;
}

export class PostgresAgentRunRepository implements AgentRunRepository {
  constructor(private readonly db: import("../client.js").Database) {}

  async recordRun(caseId: string, model: string, decision: AgentDecision): Promise<AgentRunRecord> {
    const result = await this.db.query<AgentRunRow>(
      `INSERT INTO agent_runs (case_id, model, decision, rationale, action_payload, confidence)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        caseId,
        model,
        decision.decision,
        decision.rationale,
        decision.action ? JSON.stringify(decision.action) : null,
        decision.confidence ?? null,
      ]
    );
    const row = result.rows[0]!;
    return {
      id: row.id,
      caseId: row.case_id,
      model: row.model,
      decision: row.decision,
      rationale: row.rationale,
      actionPayload: row.action_payload,
      confidence: row.confidence ? parseFloat(row.confidence) : null,
      createdAt: new Date(row.created_at).toISOString(),
    };
  }

  async listByCase(caseId: string): Promise<AgentRunRecord[]> {
    const result = await this.db.query<AgentRunRow>(
      `SELECT * FROM agent_runs WHERE case_id = $1 ORDER BY created_at DESC`,
      [caseId]
    );
    return result.rows.map(row => ({
      id: row.id,
      caseId: row.case_id,
      model: row.model,
      decision: row.decision,
      rationale: row.rationale,
      actionPayload: row.action_payload,
      confidence: row.confidence ? parseFloat(row.confidence) : null,
      createdAt: new Date(row.created_at).toISOString(),
    }));
  }
}

export class InMemoryAgentRunRepository implements AgentRunRepository {
  private readonly runs: AgentRunRecord[] = [];

  async recordRun(caseId: string, model: string, decision: AgentDecision): Promise<AgentRunRecord> {
    const record: AgentRunRecord = {
      id: crypto.randomUUID(),
      caseId,
      model,
      decision: decision.decision,
      rationale: decision.rationale,
      actionPayload: decision.action ?? null,
      confidence: decision.confidence ?? null,
      createdAt: new Date().toISOString(),
    };
    this.runs.push(record);
    return record;
  }

  async listByCase(caseId: string): Promise<AgentRunRecord[]> {
    return this.runs.filter(r => r.caseId === caseId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
