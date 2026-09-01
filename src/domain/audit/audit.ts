import { z } from "zod";

/**
 * Audit event types record *what happened* in the system. They never contain
 * private LLM chain-of-thought; at most a short structured reasoning summary.
 */
export const AuditEventType = z.enum([
  "EVENT_RECEIVED",
  "EVENT_REJECTED",
  "CASE_CREATED",
  "CASE_STATE_CHANGED",
  "CASE_EVENT_ATTACHED",
  "AGENT_DECISION",
  "POLICY_EVALUATED",
  "ACTION_REQUESTED",
  "ACTION_EXECUTED",
  "VERIFICATION_STARTED",
  "VERIFICATION_SUCCEEDED",
  "VERIFICATION_FAILED",
  "CASE_RESOLVED",
  "CASE_REOPENED",
  "DRIFT_DETECTED",
]);

export type AuditEventType = z.infer<typeof AuditEventType>;

export interface AuditEntry {
  id: string;
  type: AuditEventType;
  /** Who triggered this entry, e.g. "system", "agent", "policy-engine". */
  actor: string;
  caseId: string | null;
  eventId: string | null;
  data: Record<string, unknown>;
  recordedAt: string;
}

export type NewAuditEntry = Omit<AuditEntry, "id" | "recordedAt"> & {
  id?: string;
  recordedAt?: string;
};
