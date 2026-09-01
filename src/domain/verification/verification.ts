/**
 * Verification domain types.
 *
 * A verification record is the durable, independent answer to the question:
 * "did the authoritative state actually end up matching what governance
 * authorized?" — it is never derived from the executor's own claim.
 */

export type VerificationStatus = "VERIFIED" | "FAILED";

export interface VerificationRecord {
  id: string;
  caseId: string;
  actionExecutionId: string;
  status: VerificationStatus;
  /** Which strategy produced this record, e.g. "purchase-order-immediate". */
  strategy: string;
  /** What governance authorized (structured). */
  expected: unknown;
  /** What the authoritative state actually showed (structured). */
  actual: unknown;
  /** Concise human/audit-readable explanation of the outcome. */
  reason: string;
  createdAt: string;
}

export type NewVerificationRecord = Omit<VerificationRecord, "id" | "createdAt">;
