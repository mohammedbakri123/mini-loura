import type { OperationalEvent } from "../../domain/events/event.js";

/**
 * Event persistence. `insert` must enforce deduplication on `external_id`.
 */
export interface EventRepository {
  insert(event: OperationalEvent): Promise<void>;
  existsByExternalId(externalId: string): Promise<boolean>;
  findById(id: string): Promise<OperationalEvent | null>;
  listRecent(limit: number): Promise<OperationalEvent[]>;
}

export class PostgresEventRepository implements EventRepository {
  constructor(private readonly db: import("../client.js").Database) {}

  async insert(event: OperationalEvent): Promise<void> {
    await this.db.query(
      `INSERT INTO events (id, external_id, type, payload, occurred_at, received_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        event.id,
        event.eventId,
        event.type,
        JSON.stringify(event.payload),
        event.occurredAt,
        event.receivedAt,
      ],
    );
  }

  async existsByExternalId(externalId: string): Promise<boolean> {
    const result = await this.db.query<{ exists: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM events WHERE external_id = $1) AS exists",
      [externalId],
    );
    return result.rows[0]?.exists === true;
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
  external_id: string;
  type: OperationalEvent["type"];
  payload: unknown;
  occurred_at: Date;
  received_at: Date;
}

function mapRow(row: EventRow): OperationalEvent {
  // The row's type/payload correlation is re-established from the database's
  // validated record; the cast is scoped to this mapping boundary.
  return {
    id: row.id,
    eventId: row.external_id,
    type: row.type,
    payload: row.payload,
    occurredAt: new Date(row.occurred_at).toISOString(),
    receivedAt: new Date(row.received_at).toISOString(),
  } as OperationalEvent;
}

/** In-memory implementation for local development and tests. */
export class InMemoryEventRepository implements EventRepository {
  private readonly events = new Map<string, OperationalEvent>();
  private readonly externalIds = new Set<string>();

  async insert(event: OperationalEvent): Promise<void> {
    if (this.externalIds.has(event.eventId)) {
      throw new Error(`Duplicate external event id: ${event.eventId}`);
    }
    this.externalIds.add(event.eventId);
    this.events.set(event.id, event);
  }

  async existsByExternalId(externalId: string): Promise<boolean> {
    return this.externalIds.has(externalId);
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
