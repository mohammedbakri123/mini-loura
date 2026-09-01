import crypto from "node:crypto";
import type { CaseRecord, CaseStatus, CaseType, NewCaseRecord, CasePriority } from "../../domain/cases/case.js";

export interface CaseStatusChange {
  fromStatus: CaseStatus | null;
  toStatus: CaseStatus;
  reason?: string;
  changedAt: string;
}

export interface CaseRepository {
  create(input: NewCaseRecord): Promise<CaseRecord>;
  findById(id: string): Promise<CaseRecord | null>;
  findOpenBySubject(subjectType: string, subjectId: string): Promise<CaseRecord | null>;
  updateStatus(id: string, to: CaseStatus, reason?: string): Promise<CaseRecord>;
  listStatusHistory(caseId: string): Promise<CaseStatusChange[]>;
  listRecent(limit: number): Promise<CaseRecord[]>;
  addEvent(caseId: string, eventId: string): Promise<void>;
  getAssociatedEvents(caseId: string): Promise<string[]>;
}

const OPEN_STATUSES = [
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
    try {
      const result = await this.db.query<CaseRow>(
        `INSERT INTO cases (type, status, priority, title, subject_type, subject_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [input.type, input.status, input.priority, input.title, input.subjectType, input.subjectId],
      );
      
      const record = mapRow(result.rows[0]!);
      
      await this.db.query(
        `INSERT INTO case_status_history (case_id, from_status, to_status, reason)
         VALUES ($1, $2, $3, $4)`,
        [record.id, null, record.status, "Case opened"],
      );
      
      return record;
    } catch (err: any) {
      if (err.code === "23505" && err.constraint === "idx_cases_active_subject") {
        const existing = await this.findOpenBySubject(input.subjectType, input.subjectId);
        if (existing) return existing;
      }
      throw err;
    }
  }

  async findById(id: string): Promise<CaseRecord | null> {
    const result = await this.db.query<CaseRow>("SELECT * FROM cases WHERE id = $1", [id]);
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async findOpenBySubject(subjectType: string, subjectId: string): Promise<CaseRecord | null> {
    const result = await this.db.query<CaseRow>(
      `SELECT * FROM cases
       WHERE subject_type = $1 AND subject_id = $2 AND status = ANY($3::text[])
       ORDER BY created_at DESC
       LIMIT 1`,
      [subjectType, subjectId, [...OPEN_STATUSES]],
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

  async addEvent(caseId: string, eventId: string): Promise<void> {
    await this.db.query(
      `INSERT INTO case_events (case_id, event_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [caseId, eventId]
    );
  }

  async getAssociatedEvents(caseId: string): Promise<string[]> {
    const result = await this.db.query<{event_id: string}>(
      `SELECT event_id FROM case_events WHERE case_id = $1 ORDER BY created_at ASC`,
      [caseId]
    );
    return result.rows.map(r => r.event_id);
  }
}

interface CaseRow {
  id: string;
  type: CaseType;
  status: CaseStatus;
  priority: CasePriority;
  title: string;
  subject_type: string;
  subject_id: string;
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
  private readonly events = new Map<string, Set<string>>();

  async create(input: NewCaseRecord): Promise<CaseRecord> {
    const existing = await this.findOpenBySubject(input.subjectType, input.subjectId);
    if (existing) return existing;

    const now = new Date().toISOString();
    const record: CaseRecord = {
      id: crypto.randomUUID(),
      type: input.type,
      status: input.status,
      priority: input.priority,
      title: input.title,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      createdAt: now,
      updatedAt: now,
      resolvedAt: null,
    };
    this.cases.set(record.id, record);
    this.history.set(record.id, [
      { fromStatus: null, toStatus: record.status, changedAt: now },
    ]);
    this.events.set(record.id, new Set());
    return record;
  }

  async findById(id: string): Promise<CaseRecord | null> {
    return this.cases.get(id) ?? null;
  }

  async findOpenBySubject(subjectType: string, subjectId: string): Promise<CaseRecord | null> {
    const matches = [...this.cases.values()]
      .filter((c) => c.subjectType === subjectType && c.subjectId === subjectId && OPEN_STATUSES.includes(c.status))
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

  async addEvent(caseId: string, eventId: string): Promise<void> {
    const caseEvents = this.events.get(caseId);
    if (caseEvents) {
      caseEvents.add(eventId);
    }
  }

  async getAssociatedEvents(caseId: string): Promise<string[]> {
    const caseEvents = this.events.get(caseId);
    return caseEvents ? Array.from(caseEvents) : [];
  }
}

function mapRow(row: CaseRow): CaseRecord {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    priority: row.priority,
    title: row.title,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    resolvedAt: row.resolved_at ? new Date(row.resolved_at).toISOString() : null,
  };
}
