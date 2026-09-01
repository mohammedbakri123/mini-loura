import type { OperationalEvent } from "../../domain/events/event.js";
import { DatabaseError } from "pg";

export class DuplicateEventError extends Error {
  constructor(public readonly source: string, public readonly eventId: string) {
    super(`Duplicate event: source=${source} eventId=${eventId}`);
    this.name = "DuplicateEventError";
  }
}

/**
 * Event persistence.
 */
export interface EventRepository {
  /**
   * Persists the event. Must throw DuplicateEventError if an event with the
   * same (source, eventId) already exists.
   */
  insert(event: OperationalEvent): Promise<void>;
  findById(id: string): Promise<OperationalEvent | null>;
  listRecent(limit: number): Promise<OperationalEvent[]>;
}

export class PostgresEventRepository implements EventRepository {
  constructor(private readonly db: import("../client.js").Database) {}

  async insert(event: OperationalEvent): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO events (
          id, event_id, event_type, source, entity_type, entity_id,
          occurred_at, received_at, correlation_id, schema_version, payload
        )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          event.id,
          event.eventId,
          event.eventType,
          event.source,
          event.entityType,
          event.entityId,
          event.occurredAt,
          event.receivedAt,
          event.correlationId ?? null,
          event.schemaVersion,
          JSON.stringify(event.payload),
        ],
      );
    } catch (err) {
      if (err instanceof DatabaseError && err.code === "23505") { // unique_violation
        throw new DuplicateEventError(event.source, event.eventId);
      }
      throw err;
    }
  }

  async findById(id: string): Promise<OperationalEvent | null> {
    const result = await this.db.query<EventRow>(
      "SELECT * FROM events WHERE id = $1",
      [id],
    );
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }

  async listRecent(limit: number): Promise<OperationalEvent[]> {
    const result = await this.db.query<EventRow>(
      "SELECT * FROM events ORDER BY received_at DESC LIMIT $1",
      [limit],
    );
    return result.rows.map(mapRow);
  }
}

interface EventRow {
  id: string;
  event_id: string;
  event_type: string;
  source: string;
  entity_type: string;
  entity_id: string;
  occurred_at: Date;
  received_at: Date;
  correlation_id: string | null;
  schema_version: number;
  payload: unknown;
}

function mapRow(row: EventRow): OperationalEvent {
  return {
    id: row.id,
    eventId: row.event_id,
    eventType: row.event_type as OperationalEvent["eventType"],
    source: row.source,
    entityType: row.entity_type,
    entityId: row.entity_id,
    occurredAt: new Date(row.occurred_at).toISOString(),
    receivedAt: new Date(row.received_at).toISOString(),
    correlationId: row.correlation_id ?? undefined,
    schemaVersion: row.schema_version,
    payload: row.payload,
  } as OperationalEvent;
}

/** In-memory implementation for local development and tests. */
export class InMemoryEventRepository implements EventRepository {
  private readonly events = new Map<string, OperationalEvent>();
  // Stores composite keys: "source:eventId"
  private readonly identityKeys = new Set<string>();

  async insert(event: OperationalEvent): Promise<void> {
    const key = `${event.source}:${event.eventId}`;
    if (this.identityKeys.has(key)) {
      throw new DuplicateEventError(event.source, event.eventId);
    }
    this.identityKeys.add(key);
    this.events.set(event.id, event);
  }

  async findById(id: string): Promise<OperationalEvent | null> {
    return this.events.get(id) ?? null;
  }

  async listRecent(limit: number): Promise<OperationalEvent[]> {
    return [...this.events.values()]
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
      .slice(0, limit);
  }
}
