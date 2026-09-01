/**
 * Verification boundary.
 *
 * Verification NEVER asks the LLM whether an action succeeded. It queries
 * authoritative application state and compares it against the expected result.
 */

export type VerificationMode = "immediate" | "delayed" | "polling";

export type VerificationOutcome = "VERIFIED" | "FAILED";

export interface VerificationResult {
  outcome: VerificationOutcome;
  mode: VerificationMode;
  checkedAt: string;
  details: Record<string, unknown>;
}

export interface VerificationStrategy {
  mode: VerificationMode;
  /**
   * Check authoritative state. For "immediate" strategies this runs once right
   * after execution. "delayed" and "polling" strategies additionally declare
   * the timing parameters below (wired in Stage 7: Closed-Loop Verification).
   */
  check(input: {
    action: string;
    parameters: unknown;
    execution: { referenceId?: string };
  }): Promise<VerificationResult>;
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
  registerStrategy(action: string, strategy: VerificationStrategy): void;
  verify(input: {
    action: string;
    parameters: unknown;
    execution: { referenceId?: string };
  }): Promise<VerificationResult>;
}

/**
 * Immediate verification implementation: runs the registered strategy's check
 * exactly once. Polling/timeout/drift support is added in Stage 7.
 */
export class ImmediateVerifier implements Verifier {
  private readonly strategies = new Map<string, VerificationStrategy>();

  registerStrategy(action: string, strategy: VerificationStrategy): void {
    this.strategies.set(action, strategy);
  }

  async verify(input: {
    action: string;
    parameters: unknown;
    execution: { referenceId?: string };
  }): Promise<VerificationResult> {
    const strategy = this.strategies.get(input.action);
    if (!strategy) {
      throw new NoVerificationStrategyError(input.action);
    }
    return strategy.check(input);
  }
}
