import crypto from "node:crypto";
import type { Database } from "../client.js";

export type ActionExecutionStatus = "STARTED" | "SUCCEEDED" | "FAILED";

export interface ActionExecutionRecord {
  id: string;
  caseId: string;
  governanceEvaluationId: string;
  actionType: string;
  idempotencyKey: string;
  status: ActionExecutionStatus;
  referenceId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewActionExecution {
  caseId: string;
  governanceEvaluationId: string;
  actionType: string;
  idempotencyKey: string;
  status: ActionExecutionStatus;
}

export interface ActionExecutionRepository {
  createIfAbsent(input: NewActionExecution): Promise<{ record: ActionExecutionRecord; created: boolean }>;
  findByIdempotencyKey(key: string): Promise<ActionExecutionRecord | null>;
  updateStatus(id: string, status: ActionExecutionStatus, referenceId?: string): Promise<ActionExecutionRecord>;
}

interface ActionExecutionRow {
  id: string;
  case_id: string;
  governance_evaluation_id: string;
  action_type: string;
  idempotency_key: string;
  status: string;
  reference_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export class PostgresActionExecutionRepository implements ActionExecutionRepository {
  constructor(private readonly db: Database) {}

  async createIfAbsent(input: NewActionExecution): Promise<{ record: ActionExecutionRecord; created: boolean }> {
    const result = await this.db.query<ActionExecutionRow>(
      `INSERT INTO action_executions (case_id, governance_evaluation_id, action_type, idempotency_key, status)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING *`,
      [input.caseId, input.governanceEvaluationId, input.actionType, input.idempotencyKey, input.status]
    );
    
    if (result.rows[0]) {
      return { record: mapRow(result.rows[0]), created: true };
    }
    
    const existing = await this.findByIdempotencyKey(input.idempotencyKey);
    if (!existing) {
      throw new Error(`Failed to create or find action execution for idempotency key: ${input.idempotencyKey}`);
    }
    return { record: existing, created: false };
  }

  async findByIdempotencyKey(key: string): Promise<ActionExecutionRecord | null> {
    const result = await this.db.query<ActionExecutionRow>(
      `SELECT * FROM action_executions WHERE idempotency_key = $1`,
      [key]
    );
    if (!result.rows[0]) return null;
    return mapRow(result.rows[0]);
  }

  async updateStatus(id: string, status: ActionExecutionStatus, referenceId?: string): Promise<ActionExecutionRecord> {
    const result = await this.db.query<ActionExecutionRow>(
      `UPDATE action_executions SET status = $2, reference_id = COALESCE($3, reference_id), updated_at = now() WHERE id = $1 RETURNING *`,
      [id, status, referenceId ?? null]
    );
    if (!result.rows[0]) {
      throw new Error(`Action execution ${id} not found`);
    }
    return mapRow(result.rows[0]);
  }
}

export class InMemoryActionExecutionRepository implements ActionExecutionRepository {
  private readonly records = new Map<string, ActionExecutionRecord>();

  async createIfAbsent(input: NewActionExecution): Promise<{ record: ActionExecutionRecord; created: boolean }> {
    for (const rec of this.records.values()) {
      if (rec.idempotencyKey === input.idempotencyKey) {
        return { record: rec, created: false };
      }
    }
    
    const record: ActionExecutionRecord = {
      id: crypto.randomUUID(),
      caseId: input.caseId,
      governanceEvaluationId: input.governanceEvaluationId,
      actionType: input.actionType,
      idempotencyKey: input.idempotencyKey,
      status: input.status,
      referenceId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.records.set(record.id, record);
    return { record, created: true };
  }

  async findByIdempotencyKey(key: string): Promise<ActionExecutionRecord | null> {
    for (const record of this.records.values()) {
      if (record.idempotencyKey === key) return record;
    }
    return null;
  }

  async updateStatus(id: string, status: ActionExecutionStatus, referenceId?: string): Promise<ActionExecutionRecord> {
    const record = this.records.get(id);
    if (!record) {
      throw new Error(`Action execution ${id} not found`);
    }
    record.status = status;
    if (referenceId !== undefined) {
      record.referenceId = referenceId;
    }
    record.updatedAt = new Date().toISOString();
    return record;
  }
}

function mapRow(row: ActionExecutionRow): ActionExecutionRecord {
  return {
    id: row.id,
    caseId: row.case_id,
    governanceEvaluationId: row.governance_evaluation_id,
    actionType: row.action_type,
    idempotencyKey: row.idempotency_key,
    status: row.status as ActionExecutionStatus,
    referenceId: row.reference_id,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}
