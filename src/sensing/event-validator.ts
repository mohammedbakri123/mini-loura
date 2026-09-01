import { OperationalEventSchema, type OperationalEvent, type UnpersistedOperationalEvent } from "../domain/events/event.js";
import type { ZodIssue } from "zod";

/**
 * Validates raw external input into a well-formed operational event.
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
    const parsed = OperationalEventSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, issues: parsed.error.issues };
    }
    return {
      ok: true,
      event: {
        ...parsed.data,
        occurredAt: parsed.data.occurredAt ?? new Date().toISOString(),
      },
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
}
