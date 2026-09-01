import type { Verifier, VerificationResult } from "./verifier.js";
import type { VerificationRepository } from "../db/repositories/verification-repository.js";
import type { ActionExecutionRepository } from "../db/repositories/action-execution-repository.js";
import type { GovernanceRepository } from "../db/repositories/governance-repository.js";
import type { CaseRepository } from "../db/repositories/case-repository.js";
import type { CaseService } from "../domain/cases/case-service.js";
import type { AuditLedger } from "../audit/audit-ledger.js";
import type { VerificationRecord } from "../domain/verification/verification.js";

/** The executor could not perform the action — not a verification failure. */
export class ActionExecutionNotSuccessfulError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActionExecutionNotSuccessfulError";
  }
}

/** The execution does not belong to the given case (security binding). */
export class ExecutionCaseMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExecutionCaseMismatchError";
  }
}

/**
 * Orchestrates closed-loop verification:
 *
 *   ActionExecution (SUCCEEDED)
 *     → bind execution to case + governance record (expected state)
 *     → VERIFICATION_STARTED audit
 *     → run the action's VerificationStrategy against authoritative state
 *     → persist durable verification record
 *     → VERIFICATION_SUCCEEDED / VERIFICATION_FAILED audit
 *     → case transition via the case state machine (VERIFYING → RESOLVED/FAILED)
 *
 * Invariants:
 *   - Expected state comes from the governance evaluation bound to the
 *     execution, never from an arbitrary caller.
 *   - Uncertainty always fails closed (unknown strategy, strategy errors,
 *     missing state → FAILED, never VERIFIED).
 *   - Action failure (executor threw) is distinct from verification failure;
 *     this service only verifies executions recorded as SUCCEEDED.
 *   - Verification is repeatable: FAILED attempts accumulate, VERIFIED is
 *     unique per execution (enforced by repository + migration 008).
 */
export class VerificationService {
  constructor(
    private readonly deps: {
      verifier: Verifier;
      verificationRepo: VerificationRepository;
      executionRepo: ActionExecutionRepository;
      governanceRepo: GovernanceRepository;
      caseRepo: CaseRepository;
      caseService: CaseService;
      auditLedger: AuditLedger;
    },
  ) {}

  async verifyExecution(input: {
    caseId: string;
    actionExecutionId: string;
  }): Promise<VerificationRecord> {
    const deps = this.deps;

    // 1. Bind the execution to the case (a caller cannot verify a foreign
    //    execution against this case).
    const execution = await deps.executionRepo.findById(input.actionExecutionId);
    if (!execution) {
      throw new Error(`Action execution not found: ${input.actionExecutionId}`);
    }
    if (execution.caseId !== input.caseId) {
      throw new ExecutionCaseMismatchError(
        "Action execution does not belong to this case; refusing to verify.",
      );
    }

    // 2. Action failure ≠ verification failure. Only SUCCEEDED executions
    //    (the executor *believes* it worked) are subject to verification.
    if (execution.status !== "SUCCEEDED") {
      throw new ActionExecutionNotSuccessfulError(
        `Action execution ${execution.id} status is '${execution.status}'; verification only applies to SUCCEEDED executions.`,
      );
    }

    // 3. Repeatability + idempotency: an already-verified execution returns
    //    its existing VERIFIED record.
    const latest = await deps.verificationRepo.findLatestByExecutionId(execution.id);
    if (latest?.status === "VERIFIED") {
      return latest;
    }

    // 4. Expected state originates from the governed evaluation — the chain
    //    proposal → governance → execution → verification stays unbroken.
    const govEval = await deps.governanceRepo.findById(execution.governanceEvaluationId);
    const expectedParameters = govEval?.parameters ?? null;

    await deps.auditLedger.append({
      type: "VERIFICATION_STARTED",
      actor: "verification-service",
      caseId: input.caseId,
      eventId: null,
      data: {
        actionExecutionId: execution.id,
        actionType: execution.actionType,
        referenceId: execution.referenceId,
      },
    });

    // 5. Run the strategy. Any error (unknown action type, strategy crash)
    //    fails closed — it must never be interpreted as success.
    let result: VerificationResult;
    try {
      result = await deps.verifier.verify({
        caseId: input.caseId,
        actionExecutionId: execution.id,
        actionType: execution.actionType,
        parameters: expectedParameters,
        execution: { referenceId: execution.referenceId ?? undefined },
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown verification error";
      result = {
        outcome: "FAILED",
        strategy: "unknown",
        expected: expectedParameters,
        actual: null,
        reason: `Verification could not be performed: ${reason}`,
        mode: "immediate",
        checkedAt: new Date().toISOString(),
      };
    }

    return this.recordOutcome(input.caseId, execution.id, result);
  }

  private async recordOutcome(
    caseId: string,
    actionExecutionId: string,
    result: VerificationResult,
  ): Promise<VerificationRecord> {
    const deps = this.deps;

    // 6. Persist the durable verification record.
    const record = await deps.verificationRepo.create({
      caseId,
      actionExecutionId,
      status: result.outcome === "VERIFIED" ? "VERIFIED" : "FAILED",
      strategy: result.strategy,
      expected: result.expected,
      actual: result.actual,
      reason: result.reason,
    });

    // 7. Audit the outcome with concise structured metadata.
    await deps.auditLedger.append({
      type: result.outcome === "VERIFIED" ? "VERIFICATION_SUCCEEDED" : "VERIFICATION_FAILED",
      actor: "verification-service",
      caseId,
      eventId: null,
      data: {
        actionExecutionId,
        strategy: result.strategy,
        reason: result.reason,
      },
    });

    // 8. Case lifecycle: Stage 7 owns the transition OUT of VERIFYING, always
    //    through CaseService (the state machine rejects illegal moves).
    const caseRecord = await deps.caseRepo.findById(caseId);
    if (caseRecord) {
      if (result.outcome === "VERIFIED" && (caseRecord.status === "VERIFYING" || caseRecord.status === "FAILED")) {
        await deps.caseService.transitionStatus(caseId, "RESOLVED", `Verification succeeded: ${result.reason}`);
      } else if (result.outcome === "FAILED" && caseRecord.status === "VERIFYING") {
        await deps.caseService.transitionStatus(caseId, "FAILED", `Verification failed: ${result.reason}`);
      }
      // Re-verifying an already-RESOLVED case or re-failing an already-FAILED
      // case needs no transition; records + audit still accumulate.
    }

    return record;
  }
}
