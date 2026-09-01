/**
 * Verification boundary.
 *
 * Verification NEVER asks the LLM whether an action succeeded, never trusts
 * `ExecutionResult.executed`, and never treats an execution record's status as
 * proof. It queries authoritative application state and compares it against
 * the expected outcome.
 */

export type VerificationMode = "immediate" | "delayed" | "polling";

export type VerificationOutcome = "VERIFIED" | "FAILED";

/**
 * Everything a strategy needs to independently verify an execution.
 * `parameters` is the *authorized* expected state — it originates from the
 * governance evaluation bound to the execution, never from an arbitrary caller.
 */
export interface VerificationInput {
  caseId: string;
  actionExecutionId: string;
  actionType: string;
  parameters: unknown;
  execution: { referenceId?: string };
}

export interface VerificationResult {
  outcome: VerificationOutcome;
  /** Which strategy produced this result. */
  strategy: string;
  /** What was expected (the authorized parameters / expected side effect). */
  expected: unknown;
  /** What authoritative state actually showed. */
  actual: unknown;
  /** Concise reason for the outcome (audit/debug; no chain-of-thought). */
  reason: string;
  mode: VerificationMode;
  checkedAt: string;
}

export interface VerificationStrategy {
  mode: VerificationMode;
  /**
   * Check authoritative state. For "immediate" strategies this runs once right
   * after execution. "delayed" and "polling" strategies additionally declare
   * the timing parameters below.
   */
  check(input: VerificationInput): Promise<VerificationResult>;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export class NoVerificationStrategyError extends Error {
  constructor(action: string) {
    super(`No verification strategy registered for action: ${action}`);
    this.name = "NoVerificationStrategyError";
  }
}

export interface Verifier {
  registerStrategy(actionType: string, strategy: VerificationStrategy): void;
  verify(input: VerificationInput): Promise<VerificationResult>;
}

/**
 * Immediate verification implementation: runs the registered strategy's check
 * exactly once. Re-running verification (repeatability) is handled by the
 * VerificationService, which may invoke this verifier multiple times.
 */
export class ImmediateVerifier implements Verifier {
  private readonly strategies = new Map<string, VerificationStrategy>();

  registerStrategy(actionType: string, strategy: VerificationStrategy): void {
    this.strategies.set(actionType, strategy);
  }

  async verify(input: VerificationInput): Promise<VerificationResult> {
    const strategy = this.strategies.get(input.actionType);
    if (!strategy) {
      throw new NoVerificationStrategyError(input.actionType);
    }
    return strategy.check(input);
  }
}
