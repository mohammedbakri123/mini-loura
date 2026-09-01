import { randomUUID } from "node:crypto";
import type { AuditEntry, AuditEventType, NewAuditEntry } from "../../domain/audit/audit.js";
import type { AuditLedger } from "../../audit/audit-ledger.js";

/** PostgreSQL-backed append-only audit ledger (audit_logs table). */
export class PostgresAuditLedger implements AuditLedger {
  constructor(private readonly db: import("../client.js").Database) {}

  async append(entry: NewAuditEntry): Promise<AuditEntry> {
    const result = await this.db.query<AuditRow>(
      `INSERT INTO audit_logs (id, type, actor, case_id, event_id, data)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        entry.id ?? randomUUID(),
        entry.type,
        entry.actor,
        entry.caseId,
        entry.eventId,
        JSON.stringify(entry.data ?? {}),
      ],
    );
    return mapRow(result.rows[0]!);
  }

  async list(filter?: {
    caseId?: string;
    eventId?: string;
    type?: AuditEventType;
  }): Promise<AuditEntry[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (filter?.caseId) {
      values.push(filter.caseId);
      conditions.push(`case_id = $${values.length}`);
    }
    if (filter?.eventId) {
      values.push(filter.eventId);
      conditions.push(`event_id = $${values.length}`);
    }
    if (filter?.type) {
      values.push(filter.type);
      conditions.push(`type = $${values.length}`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await this.db.query<AuditRow>(
      `SELECT * FROM audit_logs ${where} ORDER BY recorded_at ASC LIMIT 1000`,
      values,
    );
    return result.rows.map(mapRow);
  }
}

interface AuditRow {
  id: string;
  type: AuditEventType;
  actor: string;
  case_id: string | null;
  event_id: string | null;
  data: Record<string, unknown>;
  recorded_at: Date;
}

function mapRow(row: AuditRow): AuditEntry {
  return {
    id: row.id,
    type: row.type,
    actor: row.actor,
    caseId: row.case_id,
    eventId: row.event_id,
    data: row.data,
    recordedAt: new Date(row.recorded_at).toISOString(),
  };
}
