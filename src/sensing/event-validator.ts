import { ExternalWarehouseEventSchema, type ExternalWarehouseEvent, type UnpersistedOperationalEvent } from "../domain/events/event.js";
import type { ZodIssue } from "zod";

/**
 * Validates raw external input into a well-formed canonical operational event.
 * Nothing unvalidated ever reaches the event bus or the database.
 */
export class EventValidationError extends Error {
  constructor(public readonly issues: ZodIssue[]) {
    super(`Invalid operational event: ${issues.map((i) => i.message).join("; ")}`);
    this.name = "EventValidationError";
  }
}

export type EventValidationResult =
  | { ok: true; event: UnpersistedOperationalEvent }
  | { ok: false; issues: ZodIssue[] };

export class EventValidator {
  /** Parse raw input; returns a discriminated result instead of throwing. */
  validate(raw: unknown): EventValidationResult {
    const parsed = ExternalWarehouseEventSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, issues: parsed.error.issues };
    }

    const event = this.normalize(parsed.data);

    return {
      ok: true,
      event,
    };
  }

  /** Parse raw input; throws `EventValidationError` on invalid input. */
  validateOrThrow(raw: unknown): UnpersistedOperationalEvent {
    const result = this.validate(raw);
    if (!result.ok) {
      throw new EventValidationError(result.issues);
    }
    return result.event;
  }

  private normalize(external: ExternalWarehouseEvent): UnpersistedOperationalEvent {
    let entityType = "unknown";
    let entityId = "unknown";

    switch (external.type) {
      case "inventory.low":
      case "inventory.updated":
        entityType = "product";
        entityId = external.payload.productId;
        break;
      case "purchase_order.created":
      case "purchase_order.received":
      case "purchase_order.cancelled":
        entityType = "purchase_order";
        entityId = external.payload.purchaseOrderId;
        break;
    }

    // Because TypeScript's mapped type can't infer the specific payload from `external`
    // dynamically inside the normalization boundary, we safely cast it.
    return {
      eventId: external.eventId,
      eventType: external.type,
      source: "warehouse",
      entityType,
      entityId,
      occurredAt: external.occurredAt ?? new Date().toISOString(),
      schemaVersion: 1,
      payload: external.payload,
    } as UnpersistedOperationalEvent;
  }
}
