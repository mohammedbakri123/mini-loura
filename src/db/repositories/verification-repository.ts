import crypto from "node:crypto";
import type { Database } from "../client.js";
import type {
  NewVerificationRecord,
  VerificationRecord,
  VerificationStatus,
} from "../../domain/verification/verification.js";

export interface VerificationRepository {
  create(input: NewVerificationRecord): Promise<VerificationRecord>;
  findByExecutionId(actionExecutionId: string): Promise<VerificationRecord[]>;
  findLatestByExecutionId(actionExecutionId: string): Promise<VerificationRecord | null>;
}

export class PostgresVerificationRepository implements VerificationRepository {
  constructor(private readonly db: Database) {}

  async create(input: NewVerificationRecord): Promise<VerificationRecord> {
    const result = await this.db.query<VerificationRow>(
      `INSERT INTO action_verifications
         (case_id, action_execution_id, status, strategy, expected, actual, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        input.caseId,
        input.actionExecutionId,
        input.status,
        input.strategy,
        JSON.stringify(input.expected ?? {}),
        JSON.stringify(input.actual ?? {}),
        input.reason,
      ],
    );
    return mapRow(result.rows[0]!);
  }

  async findByExecutionId(actionExecutionId: string): Promise<VerificationRecord[]> {
    const result = await this.db.query<VerificationRow>(
      `SELECT * FROM action_verifications
       WHERE action_execution_id = $1
       ORDER BY created_at ASC`,
      [actionExecutionId],
    );
    return result.rows.map(mapRow);
  }

  async findLatestByExecutionId(actionExecutionId: string): Promise<VerificationRecord | null> {
    const result = await this.db.query<VerificationRow>(
      `SELECT * FROM action_verifications
       WHERE action_execution_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [actionExecutionId],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }
}

export class InMemoryVerificationRepository implements VerificationRepository {
  private readonly records: VerificationRecord[] = [];

  async create(input: NewVerificationRecord): Promise<VerificationRecord> {
    // Mirror the partial unique index from migration 008: at most one VERIFIED
    // record per execution; FAILED attempts may accumulate.
    if (input.status === "VERIFIED") {
      const existing = await this.findVerifiedByExecutionId(input.actionExecutionId);
      if (existing) {
        throw new Error(
          `duplicate key value violates unique constraint "idx_action_verifications_one_verified_per_execution"`,
        );
      }
    }

    const record: VerificationRecord = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };
    this.records.push(record);
    return record;
  }

  private async findVerifiedByExecutionId(actionExecutionId: string): Promise<VerificationRecord | null> {
    const matches = this.records.filter(
      (r) => r.actionExecutionId === actionExecutionId && r.status === "VERIFIED",
    );
    return matches.at(-1) ?? null;
  }

  async findByExecutionId(actionExecutionId: string): Promise<VerificationRecord[]> {
    return this.records
      .filter((r) => r.actionExecutionId === actionExecutionId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async findLatestByExecutionId(actionExecutionId: string): Promise<VerificationRecord | null> {
    const all = await this.findByExecutionId(actionExecutionId);
    return all.at(-1) ?? null;
  }
}

interface VerificationRow {
  id: string;
  case_id: string;
  action_execution_id: string;
  status: VerificationStatus;
  strategy: string;
  expected: unknown;
  actual: unknown;
  reason: string;
  created_at: Date;
}

function mapRow(row: VerificationRow): VerificationRecord {
  return {
    id: row.id,
    caseId: row.case_id,
    actionExecutionId: row.action_execution_id,
    status: row.status,
    strategy: row.strategy,
    expected: row.expected,
    actual: row.actual,
    reason: row.reason,
    createdAt: new Date(row.created_at).toISOString(),
  };
}
