import type { OperationalEvent } from "../domain/events/event.js";
import type { OperationalModel } from "../model/operational-model.js";
import type { CaseRepository } from "../db/repositories/case-repository.js";
import type { AuditLedger } from "../audit/audit-ledger.js";
import { assertTransition } from "../domain/cases/case-state-machine.js";

export interface EventPipelineResult {
  caseId: string | null;
  caseCreated: boolean;
  caseStatus: string | null;
}

/**
 * The event pipeline is the reactive half of the sensing boundary:
 *
 *   published event -> update operational model -> create/update case -> audit
 *
 * This is the *foundation* wiring. The full case engine (investigation,
 * agent loop, governance, execution, verification) is implemented in stages 3-7.
 */
export class EventPipeline {
  constructor(
    private readonly deps: {
      operationalModel: OperationalModel;
      caseRepository: CaseRepository;
      auditLedger: AuditLedger;
    },
  ) {}

  async handle(event: OperationalEvent): Promise<EventPipelineResult> {
    const { operationalModel, caseRepository, auditLedger } = this.deps;

    await operationalModel.applyEvent(event);

    if (event.eventType === "inventory.low") {
      const existing = await caseRepository.findOpenBySubject(event.payload.productId);
      if (existing) {
        // One open case per subject; repeated low-stock events do not spawn duplicates.
        return { caseId: existing.id, caseCreated: false, caseStatus: existing.status };
      }

      // Opening a case starts in OPEN; the case engine moves it forward.
      const created = await caseRepository.create({
        type: "inventory_replenishment",
        status: "OPEN",
        title: `Replenish inventory for product ${event.payload.productId}`,
        subjectId: event.payload.productId,
      });
      // Sanity-check that OPEN is a valid starting state for future transitions.
      assertTransition(created.status, "INVESTIGATING");

      await auditLedger.append({
        type: "CASE_CREATED",
        actor: "case-engine",
        caseId: created.id,
        eventId: event.id,
        data: { type: created.type, subjectId: created.subjectId },
      });

      return { caseId: created.id, caseCreated: true, caseStatus: created.status };
    }

    return { caseId: null, caseCreated: false, caseStatus: null };
  }
}
