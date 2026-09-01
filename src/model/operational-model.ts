import type { OperationalEvent } from "../domain/events/event.js";
import type { InventoryLevel } from "../domain/inventory/inventory.js";

/**
 * Operational snapshot: a read-only view of "current operational reality".
 * Stage 2 (Operational Model) will expand this (products, suppliers, orders).
 */
export interface OperationalSnapshot {
  inventory: InventoryLevel[];
  capturedAt: string;
}

/**
 * The operational model applies validated events to maintain the current
 * state of the warehouse operation.
 */
export interface OperationalModel {
  applyEvent(event: OperationalEvent): Promise<void>;
  getSnapshot(): Promise<OperationalSnapshot>;
  getInventoryLevel(productId: string): Promise<InventoryLevel | null>;
}

/**
 * Initial in-memory implementation. It exists so the event pipeline works
 * end-to-end locally; persistence of the operational model arrives in Stage 2.
 */
export class InMemoryOperationalModel implements OperationalModel {
  private readonly inventory = new Map<string, InventoryLevel>();

  async applyEvent(event: OperationalEvent): Promise<void> {
    switch (event.type) {
      case "inventory.low":
      case "inventory.updated": {
        const existing = this.inventory.get(event.payload.productId);
        this.inventory.set(event.payload.productId, {
          productId: event.payload.productId,
          currentStock: event.payload.currentStock,
          minimumStock:
            event.payload.minimumStock ?? existing?.minimumStock ?? 0,
          updatedAt: event.receivedAt,
        });
        return;
      }
      case "purchase_order.created":
      case "purchase_order.received":
      case "purchase_order.cancelled":
        // Purchase order state tracking is part of Stage 2.
        return;
    }
  }

  async getSnapshot(): Promise<OperationalSnapshot> {
    return {
      inventory: [...this.inventory.values()],
      capturedAt: new Date().toISOString(),
    };
  }

  async getInventoryLevel(productId: string): Promise<InventoryLevel | null> {
    return this.inventory.get(productId) ?? null;
  }
}
