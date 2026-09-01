import type { CaseRecord, CaseStatus } from "./case.js";
import { assertTransition } from "./case-state-machine.js";
import type { OperationalEvent } from "../events/event.js";
import type { CaseRepository } from "../../db/repositories/case-repository.js";
import type { AuditLedger } from "../../audit/audit-ledger.js";

/**
 * CaseService defines the core business logic for the case lifecycle.
 * It is called by the EventPipeline to evaluate whether new operational
 * problems require tracking, and handles explicit state transitions.
 */
export class CaseService {
  constructor(
    private readonly deps: {
      caseRepository: CaseRepository;
      auditLedger: AuditLedger;
    }
  ) {}

  /**
   * Evaluates an ingested operational event to see if it requires creating a
   * new case, reopening a resolved case, or attaching to an active case.
   */
  async evaluateEvent(event: OperationalEvent): Promise<{ caseId: string | null; caseCreated: boolean; caseStatus: CaseStatus | null }> {
    const { caseRepository, auditLedger } = this.deps;

    if (event.eventType === "inventory.low") {
      const subjectType = "product";
      const subjectId = event.payload.productId;

      let activeCase = await caseRepository.findOpenBySubject(subjectType, subjectId);

      if (activeCase) {
        // Condition is already being tracked; just attach the event.
        await caseRepository.addEvent(activeCase.id, event.id);
        
        await auditLedger.append({
          type: "CASE_EVENT_ATTACHED",
          actor: "case-engine",
          caseId: activeCase.id,
          eventId: event.id,
          data: { eventType: event.eventType },
        });

        return { caseId: activeCase.id, caseCreated: false, caseStatus: activeCase.status };
      }

      // No active case exists; create a new one.
      const created = await caseRepository.create({
        type: "inventory_replenishment",
        status: "OPEN",
        priority: "MEDIUM",
        title: `Replenish inventory for product ${subjectId}`,
        subjectType,
        subjectId,
      });

      // Attach the triggering event
      await caseRepository.addEvent(created.id, event.id);

      await auditLedger.append({
        type: "CASE_CREATED",
        actor: "case-engine",
        caseId: created.id,
        eventId: event.id,
        data: { type: created.type, subjectType, subjectId },
      });

      return { caseId: created.id, caseCreated: true, caseStatus: created.status };
    }

    return { caseId: null, caseCreated: false, caseStatus: null };
  }

  /**
   * Explictly transitions a case from one status to another, enforcing legal boundaries.
   */
  async transitionStatus(caseId: string, toStatus: CaseStatus, reason?: string): Promise<CaseRecord> {
    const { caseRepository, auditLedger } = this.deps;

    const caseRecord = await caseRepository.findById(caseId);
    if (!caseRecord) {
      throw new Error(`Case ${caseId} not found`);
    }

    // This will throw IllegalCaseTransitionError if the move is invalid
    assertTransition(caseRecord.status, toStatus);

    const updated = await caseRepository.updateStatus(caseId, toStatus, reason);

    await auditLedger.append({
      type: toStatus === "RESOLVED" ? "CASE_RESOLVED" : 
            toStatus === "REOPENED" ? "CASE_REOPENED" : "CASE_STATE_CHANGED",
      actor: "case-engine",
      caseId: updated.id,
      eventId: null,
      data: { from: caseRecord.status, to: toStatus, reason },
    });

    return updated;
  }
}
