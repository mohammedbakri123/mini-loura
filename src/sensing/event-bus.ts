import type { OperationalEvent } from "../domain/events/event.js";

/**
 * Event bus abstraction. The initial implementation is in-memory; the
 * interface is intentionally narrow so it can later be replaced by Redis
 * Streams, NATS, Kafka, etc. without touching callers.
 */
export type EventHandler = (event: OperationalEvent) => Promise<void>;

export interface EventBus {
  publish(event: OperationalEvent): Promise<void>;
  subscribe(handler: EventHandler): void;
}

export class InMemoryEventBus implements EventBus {
  private readonly handlers: EventHandler[] = [];

  subscribe(handler: EventHandler): void {
    this.handlers.push(handler);
  }

  async publish(event: OperationalEvent): Promise<void> {
    // Sequential dispatch keeps ordering guarantees simple and deterministic
    // for the in-memory implementation.
    for (const handler of this.handlers) {
      await handler(event);
    }
  }
}
