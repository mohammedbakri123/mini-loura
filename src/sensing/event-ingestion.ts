import { randomUUID } from "node:crypto";
import type { OperationalEvent } from "../domain/events/event.js";
import { EventValidator } from "./event-validator.js";
import type { EventBus } from "./event-bus.js";
import { type EventRepository, DuplicateEventError } from "../db/repositories/event-repository.js";
import type { AuditLedger } from "../audit/audit-ledger.js";

export type IngestionResult =
  | { status: "accepted"; eventId: string }
  | { status: "duplicate"; source: string; eventId: string }
  | { status: "rejected"; issues: unknown[] }
  | { status: "error"; message: string };

/**
 * Ingestion pipeline:
 *
 *   validate -> normalize -> deduplicate (via DB constraint) -> persist -> publish
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

    // TypeScript narrowing: we know it is a full operational event now
    const event = {
      ...validated,
      id: randomUUID(),
      receivedAt: new Date().toISOString(),
    } as OperationalEvent;

    try {
      await eventRepository.insert(event);
    } catch (err) {
      if (err instanceof DuplicateEventError) {
        return { status: "duplicate", source: event.source, eventId: event.eventId };
      }
      // Re-throw any other database error so the HTTP layer correctly 500s.
      throw err;
    }

    // Persisted successfully, log to audit.
    await auditLedger.append({
      type: "EVENT_RECEIVED",
      actor: "sensing",
      caseId: null,
      eventId: event.id,
      data: { eventType: event.eventType, externalId: event.eventId },
    });

    // Publish to subscribers.
    // In our current semantics, this is process-local at-most-once delivery.
    // If a subscriber throws, we let the exception bubble up to log it,
    // but the event was already durably recorded.
    await bus.publish(event);

    return { status: "accepted", eventId: event.id };
  }
}
