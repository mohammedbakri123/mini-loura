import type { CaseStatus } from "./case.js";

/**
 * Explicit, closed set of legal case state transitions.
 *
 * Main flow:
 *   OPEN -> INVESTIGATING -> ACTION_REQUIRED -> ACTING -> VERIFYING -> RESOLVED
 *
 * Alternative transitions:
 *   ACTION_REQUIRED -> HUMAN_APPROVAL_REQUIRED
 *   VERIFYING       -> FAILED
 *   RESOLVED        -> REOPENED
 *   FAILED          -> INVESTIGATING (retry the investigation)
 *   REOPENED        -> INVESTIGATING | RESOLVED
 */
const LEGAL_TRANSITIONS: Readonly<Record<CaseStatus, readonly CaseStatus[]>> = {
  OPEN: ["INVESTIGATING", "RESOLVED"],
  INVESTIGATING: ["ACTION_REQUIRED", "RESOLVED"],
  ACTION_REQUIRED: ["ACTING", "HUMAN_APPROVAL_REQUIRED", "RESOLVED"],
  HUMAN_APPROVAL_REQUIRED: ["ACTING", "RESOLVED"],
  ACTING: ["VERIFYING"],
  VERIFYING: ["RESOLVED", "FAILED"],
  FAILED: ["INVESTIGATING", "RESOLVED"],
  RESOLVED: ["REOPENED"],
  REOPENED: ["INVESTIGATING", "RESOLVED"],
};

export class IllegalCaseTransitionError extends Error {
  constructor(
    public readonly from: CaseStatus,
    public readonly to: CaseStatus,
  ) {
    super(`Illegal case transition: ${from} -> ${to}`);
    this.name = "IllegalCaseTransitionError";
  }
}

export function canTransition(from: CaseStatus, to: CaseStatus): boolean {
  return LEGAL_TRANSITIONS[from].includes(to);
}

/** Pure transition check. Throws `IllegalCaseTransitionError` when illegal. */
export function assertTransition(from: CaseStatus, to: CaseStatus): void {
  if (!canTransition(from, to)) {
    throw new IllegalCaseTransitionError(from, to);
  }
}

export function isTerminalStatus(status: CaseStatus): boolean {
  // RESOLVED is terminal in practice; it can only move to REOPENED, which is
  // an explicit operator/verification action, not part of the normal flow.
  return status === "RESOLVED";
}

export function legalTransitionsFrom(status: CaseStatus): readonly CaseStatus[] {
  return LEGAL_TRANSITIONS[status];
}
