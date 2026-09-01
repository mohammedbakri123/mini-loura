import { randomUUID } from "node:crypto";
import type { AuditEntry, AuditEventType, NewAuditEntry } from "../domain/audit/audit.js";

/**
 * Append-oriented audit ledger. Entries are immutable facts about what the
 * system did; nothing may update or delete an entry.
 */
export interface AuditLedger {
  append(entry: NewAuditEntry): Promise<AuditEntry>;
  list(filter?: { caseId?: string; eventId?: string; type?: AuditEventType }): Promise<AuditEntry[]>;
}

/**
 * In-memory implementation for local development and tests. The PostgreSQL
 * implementation (audit_logs table) lives in src/db/repositories/audit-repository.ts.
 */
export class InMemoryAuditLedger implements AuditLedger {
  private readonly entries: AuditEntry[] = [];

  async append(entry: NewAuditEntry): Promise<AuditEntry> {
    const full: AuditEntry = {
      ...entry,
      id: entry.id ?? randomUUID(),
      data: entry.data ?? {},
      recordedAt: entry.recordedAt ?? new Date().toISOString(),
    };
    this.entries.push(full);
    return full;
  }

  async list(filter?: {
    caseId?: string;
    eventId?: string;
    type?: AuditEventType;
  }): Promise<AuditEntry[]> {
    return this.entries.filter((entry) => {
      if (filter?.caseId && entry.caseId !== filter.caseId) return false;
      if (filter?.eventId && entry.eventId !== filter.eventId) return false;
      if (filter?.type && entry.type !== filter.type) return false;
      return true;
    });
  }
}
