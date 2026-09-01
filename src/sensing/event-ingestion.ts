import { randomUUID } from "node:crypto";
import type { OperationalEvent } from "../domain/events/event.js";
import { EventValidator } from "./event-validator.js";
import type { EventBus } from "./event-bus.js";
import type { EventRepository } from "../db/repositories/event-repository.js";
import type { AuditLedger } from "../audit/audit-ledger.js";

export type IngestionResult =
  | { status: "accepted"; eventId: string }
  | { status: "duplicate"; eventId: string }
  | { status: "rejected"; issues: unknown[] };

/**
 * Ingestion pipeline:
 *
 *   validate -> deduplicate -> persist -> publish
 *
 * The event bus subscribers (operational model, cases, ...) react *after* the
 * event is durably recorded.
 */
export class EventIngestionService {
  constructor(
    private readonly deps: {
      validator: EventValidator;
      eventRepository: EventRepository;
      bus: EventBus;
      auditLedger: AuditLedger;
    },
  ) {}

  async ingest(raw: unknown): Promise<IngestionResult> {
    const { validator, eventRepository, bus, auditLedger } = this.deps;

    const validation = validator.validate(raw);
    if (!validation.ok) {
      await auditLedger.append({
        type: "EVENT_REJECTED",
        actor: "sensing",
        caseId: null,
        eventId: null,
        data: { issues: validation.issues },
      });
      return { status: "rejected", issues: validation.issues };
    }

    const validated = validation.event;

    // Deduplicate on the external event id before persisting anything.
    if (await eventRepository.existsByExternalId(validated.eventId)) {
      return { status: "duplicate", eventId: validated.eventId };
    }

    const event: OperationalEvent = {
      ...validated,
      id: randomUUID(),
      receivedAt: new Date().toISOString(),
    };

    await eventRepository.insert(event);
    await auditLedger.append({
      type: "EVENT_RECEIVED",
      actor: "sensing",
      caseId: null,
      eventId: event.id,
      data: { eventType: event.type, externalId: event.eventId },
    });

    await bus.publish(event);

    return { status: "accepted", eventId: event.id };
  }
}
