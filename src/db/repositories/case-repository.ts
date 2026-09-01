import type {
  CaseRecord,
  CaseStatus,
  CaseType,
  NewCaseRecord,
} from "../../domain/cases/case.js";

export interface CaseStatusChange {
  fromStatus: CaseStatus | null;
  toStatus: CaseStatus;
  reason?: string;
  changedAt: string;
}

export interface CaseRepository {
  create(input: NewCaseRecord): Promise<CaseRecord>;
  findById(id: string): Promise<CaseRecord | null>;
  /** Find the open (non-terminal) case for a subject, e.g. an open replenishment case for a product. */
  findOpenBySubject(subjectId: string): Promise<CaseRecord | null>;
  /** Transition status; the caller must have validated via the case state machine. */
  updateStatus(id: string, to: CaseStatus, reason?: string): Promise<CaseRecord>;
  listStatusHistory(caseId: string): Promise<CaseStatusChange[]>;
  listRecent(limit: number): Promise<CaseRecord[]>;
}

const OPEN_STATUSES: readonly CaseStatus[] = [
  "OPEN",
  "INVESTIGATING",
  "ACTION_REQUIRED",
  "HUMAN_APPROVAL_REQUIRED",
  "ACTING",
  "VERIFYING",
  "FAILED",
  "REOPENED",
];

export class PostgresCaseRepository implements CaseRepository {
  constructor(private readonly db: import("../client.js").Database) {}

  async create(input: NewCaseRecord): Promise<CaseRecord> {
    const result = await this.db.query<CaseRow>(
      `INSERT INTO cases (type, status, title, subject_id)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [input.type, input.status, input.title, input.subjectId],
    );
    return mapRow(result.rows[0]!);
  }

  async findById(id: string): Promise<CaseRecord | null> {
    const result = await this.db.query<CaseRow>("SELECT * FROM cases WHERE id = $1", [id]);
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async findOpenBySubject(subjectId: string): Promise<CaseRecord | null> {
    const result = await this.db.query<CaseRow>(
      `SELECT * FROM cases
       WHERE subject_id = $1 AND status = ANY($2::text[])
       ORDER BY created_at DESC
       LIMIT 1`,
      [subjectId, [...OPEN_STATUSES]],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async updateStatus(id: string, to: CaseStatus, reason?: string): Promise<CaseRecord> {
    return this.db.transaction(async (client) => {
      const current = await client.query<CaseRow>("SELECT * FROM cases WHERE id = $1", [id]);
      const row = current.rows[0];
      if (!row) throw new Error(`Case not found: ${id}`);

      const resolvedAt = to === "RESOLVED" ? new Date().toISOString() : null;
      const updated = await client.query<CaseRow>(
        `UPDATE cases
         SET status = $2, resolved_at = COALESCE($3::timestamptz, resolved_at), updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [id, to, resolvedAt],
      );
      await client.query(
        `INSERT INTO case_status_history (case_id, from_status, to_status, reason)
         VALUES ($1, $2, $3, $4)`,
        [id, row.status, to, reason ?? null],
      );
      return mapRow(updated.rows[0]!);
    });
  }

  async listStatusHistory(caseId: string): Promise<CaseStatusChange[]> {
    const result = await this.db.query<HistoryRow>(
      `SELECT from_status, to_status, reason, changed_at
       FROM case_status_history WHERE case_id = $1 ORDER BY changed_at ASC`,
      [caseId],
    );
    return result.rows.map((row) => ({
      fromStatus: (row.from_status as CaseStatus | null) ?? null,
      toStatus: row.to_status as CaseStatus,
      reason: row.reason ?? undefined,
      changedAt: new Date(row.changed_at).toISOString(),
    }));
  }

  async listRecent(limit: number): Promise<CaseRecord[]> {
    const result = await this.db.query<CaseRow>(
      "SELECT * FROM cases ORDER BY created_at DESC LIMIT $1",
      [limit],
    );
    return result.rows.map(mapRow);
  }
}

interface CaseRow {
  id: string;
  type: CaseType;
  status: CaseStatus;
  title: string;
  subject_id: string | null;
  created_at: Date;
  updated_at: Date;
  resolved_at: Date | null;
}

interface HistoryRow {
  from_status: string | null;
  to_status: string;
  reason: string | null;
  changed_at: Date;
}

/** In-memory implementation for local development and tests. */
export class InMemoryCaseRepository implements CaseRepository {
  private readonly cases = new Map<string, CaseRecord>();
  private readonly history = new Map<string, CaseStatusChange[]>();

  async create(input: NewCaseRecord): Promise<CaseRecord> {
    const now = new Date().toISOString();
    const record: CaseRecord = {
      id: crypto.randomUUID(),
      type: input.type,
      status: input.status,
      title: input.title,
      subjectId: input.subjectId,
      createdAt: now,
      updatedAt: now,
      resolvedAt: null,
    };
    this.cases.set(record.id, record);
    this.history.set(record.id, [
      { fromStatus: null, toStatus: record.status, changedAt: now },
    ]);
    return record;
  }

  async findById(id: string): Promise<CaseRecord | null> {
    return this.cases.get(id) ?? null;
  }

  async findOpenBySubject(subjectId: string): Promise<CaseRecord | null> {
    const matches = [...this.cases.values()]
      .filter((c) => c.subjectId === subjectId && OPEN_STATUSES.includes(c.status))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return matches[0] ?? null;
  }

  async updateStatus(id: string, to: CaseStatus, reason?: string): Promise<CaseRecord> {
    const record = this.cases.get(id);
    if (!record) throw new Error(`Case not found: ${id}`);
    const now = new Date().toISOString();
    const updated: CaseRecord = {
      ...record,
      status: to,
      updatedAt: now,
      resolvedAt: to === "RESOLVED" ? now : record.resolvedAt,
    };
    this.cases.set(id, updated);
    this.history.get(id)?.push({
      fromStatus: record.status,
      toStatus: to,
      reason,
      changedAt: now,
    });
    return updated;
  }

  async listStatusHistory(caseId: string): Promise<CaseStatusChange[]> {
    return [...(this.history.get(caseId) ?? [])];
  }

  async listRecent(limit: number): Promise<CaseRecord[]> {
    return [...this.cases.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }
}

function mapRow(row: CaseRow): CaseRecord {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    title: row.title,
    subjectId: row.subject_id ?? "",
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    resolvedAt: row.resolved_at ? new Date(row.resolved_at).toISOString() : null,
  };
}
