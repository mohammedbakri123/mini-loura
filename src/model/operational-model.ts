import type { OperationalEvent } from "../domain/events/event.js";
import type { InventoryLevel } from "../domain/inventory/inventory.js";
import type { ProductRepository } from "../db/repositories/product-repository.js";
import type { InventoryRepository } from "../db/repositories/inventory-repository.js";
import type { SupplierRepository } from "../db/repositories/supplier-repository.js";
import type { PurchaseOrderRepository } from "../db/repositories/purchase-order-repository.js";

/**
 * Operational snapshot: a read-only view of "current operational reality".
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

export class PostgresOperationalModel implements OperationalModel {
  constructor(
    private readonly deps: {
      productRepository: ProductRepository;
      inventoryRepository: InventoryRepository;
      supplierRepository: SupplierRepository;
      purchaseOrderRepository: PurchaseOrderRepository;
    }
  ) {}

  async applyEvent(event: OperationalEvent): Promise<void> {
    switch (event.eventType) {
      case "inventory.low":
      case "inventory.updated": {
        // Ensure product exists
        await this.deps.productRepository.upsert({
          id: event.payload.productId,
          sku: event.payload.productSku ?? event.payload.productId,
          name: `Product ${event.payload.productSku ?? event.payload.productId}`,
        });

        const existing = await this.deps.inventoryRepository.findByProductId(event.payload.productId);
        await this.deps.inventoryRepository.upsert({
          productId: event.payload.productId,
          currentStock: event.payload.currentStock,
          minimumStock: event.payload.minimumStock ?? existing?.minimumStock ?? 0,
        });
        return;
      }
      
      case "purchase_order.created": {
        // We ensure supplier exists
        if (event.payload.supplierId) {
          await this.deps.supplierRepository.upsert({
            id: event.payload.supplierId,
            name: `Supplier ${event.payload.supplierId}`,
          });
        }
        
        // Ensure product exists
        await this.deps.productRepository.upsert({
          id: event.payload.productId,
          sku: event.payload.productId,
          name: `Product ${event.payload.productId}`,
        });

        await this.deps.purchaseOrderRepository.create({
          id: event.payload.purchaseOrderId,
          supplierId: event.payload.supplierId ?? null,
          status: "created",
          items: [
            {
              productId: event.payload.productId,
              quantity: event.payload.quantity,
            }
          ],
          idempotencyKey: null,
        });
        return;
      }

      case "purchase_order.received": {
        await this.deps.purchaseOrderRepository.updateStatus(event.payload.purchaseOrderId, "received");
        return;
      }

      case "purchase_order.cancelled": {
        await this.deps.purchaseOrderRepository.updateStatus(event.payload.purchaseOrderId, "cancelled");
        return;
      }
    }
  }

  async getSnapshot(): Promise<OperationalSnapshot> {
    const inventory = await this.deps.inventoryRepository.listAll();
    return {
      inventory,
      capturedAt: new Date().toISOString(),
    };
  }

  async getInventoryLevel(productId: string): Promise<InventoryLevel | null> {
    return this.deps.inventoryRepository.findByProductId(productId);
  }
}

export class InMemoryOperationalModel implements OperationalModel {
  private readonly inventory = new Map<string, InventoryLevel>();

  async applyEvent(event: OperationalEvent): Promise<void> {
    switch (event.eventType) {
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
