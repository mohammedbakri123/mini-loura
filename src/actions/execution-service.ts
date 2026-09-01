import assert from "node:assert";
import type { ActionRegistry } from "../governance/action-registry.js";
import type { GovernanceRepository } from "../db/repositories/governance-repository.js";
import type { ActionExecutionRepository } from "../db/repositories/action-execution-repository.js";
import type { AuditLedger } from "../audit/audit-ledger.js";
import type { CaseRepository } from "../db/repositories/case-repository.js";

export class ExecutionNotAuthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExecutionNotAuthorizedError";
  }
}

export class ExecutionService {
  constructor(
    private readonly deps: {
      actionRegistry: ActionRegistry;
      governanceRepo: GovernanceRepository;
      executionRepo: ActionExecutionRepository;
      auditLedger: AuditLedger;
      caseRepo: CaseRepository; // Just to update or check case state if needed
    },
  ) {}

  async executeAuthorizedAction(
    caseId: string,
    governanceEvaluationId: string,
    parameters: unknown,
  ) {
    const govEval = await this.deps.governanceRepo.findById(governanceEvaluationId);
    if (!govEval) {
      throw new ExecutionNotAuthorizedError(`Governance evaluation not found: ${governanceEvaluationId}`);
    }
    if (govEval.caseId !== caseId) {
      throw new ExecutionNotAuthorizedError("Governance evaluation does not belong to this case.");
    }
    if (govEval.decision !== "ALLOW") {
      throw new ExecutionNotAuthorizedError(`Action not authorized. Decision was: ${govEval.decision}`);
    }

    // Exact structural parameter binding check
    try {
      assert.deepStrictEqual(parameters, govEval.parameters);
    } catch {
      throw new ExecutionNotAuthorizedError("Action parameters do not exactly match the authorized proposal.");
    }

    const actionDef = this.deps.actionRegistry.get(govEval.actionType);
    const idempotencyKey = actionDef.idempotencyKey(parameters);

    // Concurrency safe execution creation
    const { record: execution, created } = await this.deps.executionRepo.createIfAbsent({
      caseId,
      governanceEvaluationId,
      actionType: govEval.actionType,
      idempotencyKey,
      status: "STARTED",
    });

    if (execution.status === "SUCCEEDED") {
      return {
        executed: true,
        referenceId: execution.referenceId!,
        details: { replay: true },
      };
    }

    if (execution.status === "FAILED") {
      throw new Error("Action execution previously failed and cannot be automatically retried. A new proposal is required.");
    }

    if (created) {
      await this.deps.auditLedger.append({
        type: "ACTION_REQUESTED",
        actor: "execution-service",
        caseId,
        eventId: null,
        data: { actionType: govEval.actionType, idempotencyKey },
      });
    } else if (execution.status === "STARTED") {
      // It's a safe retry for a previously abandoned/crashed STARTED execution
      await this.deps.auditLedger.append({
        type: "ACTION_REQUESTED",
        actor: "execution-service",
        caseId,
        eventId: null,
        data: { actionType: govEval.actionType, idempotencyKey, retry: true },
      });
    }

    try {
      // Actually execute side effect
      const result = await actionDef.executor.execute(parameters, idempotencyKey);
      
      // Update execution status
      await this.deps.executionRepo.updateStatus(execution.id, "SUCCEEDED", result.referenceId);

      await this.deps.auditLedger.append({
        type: "ACTION_EXECUTED",
        actor: "execution-service",
        caseId,
        eventId: null,
        data: { actionType: govEval.actionType, referenceId: result.referenceId },
      });

      // Integrate with Case Lifecycle
      // If we are ACTING and it succeeded, we move to VERIFYING
      const caseRecord = await this.deps.caseRepo.findById(caseId);
      if (caseRecord?.status === "ACTING" || caseRecord?.status === "ACTION_REQUIRED") {
        await this.deps.caseRepo.updateStatus(caseId, "VERIFYING", "Action executed, awaiting verification");
      }

      return result;
    } catch (error: unknown) {
      // Note: If error happens after DB commit but before this block, 
      // the next retry will replay the executor and succeed safely thanks to idempotent repo methods.
      await this.deps.executionRepo.updateStatus(execution.id, "FAILED");

      const errorMessage = error instanceof Error ? error.message : "Unknown error occurred during execution";

      await this.deps.auditLedger.append({
        type: "ACTION_FAILED",
        actor: "execution-service",
        caseId,
        eventId: null,
        data: { actionType: govEval.actionType, error: errorMessage },
      });

      const caseRecord = await this.deps.caseRepo.findById(caseId);
      if (caseRecord?.status === "ACTING" || caseRecord?.status === "ACTION_REQUIRED") {
        await this.deps.caseRepo.updateStatus(caseId, "FAILED", `Action failed: ${errorMessage}`);
      }

      throw error;
    }
  }
}
