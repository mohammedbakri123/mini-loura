import type { OperationalEvent } from "../domain/events/event.js";
import type { OperationalModel } from "../model/operational-model.js";
import type { CaseService } from "../domain/cases/case-service.js";

export interface EventPipelineResult {
  caseId: string | null;
  caseCreated: boolean;
  caseStatus: string | null;
}

/**
 * The event pipeline is the reactive half of the sensing boundary:
 *
 *   published event -> update operational model -> evaluate case
 *
 * This is the *foundation* wiring.
 */
export class EventPipeline {
  constructor(
    private readonly deps: {
      operationalModel: OperationalModel;
      caseService: CaseService;
    },
  ) {}

  async handle(event: OperationalEvent): Promise<EventPipelineResult> {
    const { operationalModel, caseService } = this.deps;

    // 1. Maintain operational reality
    await operationalModel.applyEvent(event);

    // 2. Drive cases based on reality
    return await caseService.evaluateEvent(event);
  }
}
