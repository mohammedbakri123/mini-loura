/**
 * Cases represent long-running operational problems, e.g. "product X is below
 * its minimum stock level". A case is opened when an event creates an
 * operational problem and is resolved when the loop closes successfully.
 */

export type CaseStatus =
  | "OPEN"
  | "INVESTIGATING"
  | "ACTION_REQUIRED"
  | "HUMAN_APPROVAL_REQUIRED"
  | "ACTING"
  | "VERIFYING"
  | "FAILED"
  | "RESOLVED"
  | "REOPENED";

export type CaseType = "inventory_replenishment" | "generic";

export interface CaseRecord {
  id: string;
  type: CaseType;
  status: CaseStatus;
  title: string;
  /** The domain entity the case is about (e.g. a productId). */
  subjectId: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface NewCaseRecord {
  type: CaseType;
  status: CaseStatus;
  title: string;
  subjectId: string;
}
