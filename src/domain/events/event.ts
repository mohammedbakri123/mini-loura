import { z } from "zod";

/**
 * Domain events emitted by external operational systems (warehouses, ERPs...).
 *
 * The Zod schemas here define the expected shape of the incoming external payloads.
 */

export const InventoryLowPayloadSchema = z.object({
  productId: z.string().uuid(),
  productSku: z.string().min(1).optional(),
  currentStock: z.number().int().min(0),
  minimumStock: z.number().int().min(0),
});

export const InventoryUpdatedPayloadSchema = z.object({
  productId: z.string().uuid(),
  productSku: z.string().min(1).optional(),
  currentStock: z.number().int().min(0),
  minimumStock: z.number().int().min(0).optional(),
});

export const PurchaseOrderCreatedPayloadSchema = z.object({
  purchaseOrderId: z.string().uuid(),
  productId: z.string().uuid(),
  supplierId: z.string().uuid().optional(),
  quantity: z.number().int().positive(),
});

export const PurchaseOrderReceivedPayloadSchema = z.object({
  purchaseOrderId: z.string().uuid(),
  quantityReceived: z.number().int().positive(),
});

export const PurchaseOrderCancelledPayloadSchema = z.object({
  purchaseOrderId: z.string().uuid(),
  reason: z.string().min(1).optional(),
});

/**
 * Validated external event envelopes before normalization.
 */
export const ExternalWarehouseEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("inventory.low"),
    eventId: z.string().min(1),
    occurredAt: z.string().datetime().optional(),
    payload: InventoryLowPayloadSchema,
  }),
  z.object({
    type: z.literal("inventory.updated"),
    eventId: z.string().min(1),
    occurredAt: z.string().datetime().optional(),
    payload: InventoryUpdatedPayloadSchema,
  }),
  z.object({
    type: z.literal("purchase_order.created"),
    eventId: z.string().min(1),
    occurredAt: z.string().datetime().optional(),
    payload: PurchaseOrderCreatedPayloadSchema,
  }),
  z.object({
    type: z.literal("purchase_order.received"),
    eventId: z.string().min(1),
    occurredAt: z.string().datetime().optional(),
    payload: PurchaseOrderReceivedPayloadSchema,
  }),
  z.object({
    type: z.literal("purchase_order.cancelled"),
    eventId: z.string().min(1),
    occurredAt: z.string().datetime().optional(),
    payload: PurchaseOrderCancelledPayloadSchema,
  }),
]);

export type ExternalWarehouseEvent = z.infer<typeof ExternalWarehouseEventSchema>;

type ExternalEventType = ExternalWarehouseEvent["type"];
type ExternalPayload<T extends ExternalEventType> = Extract<ExternalWarehouseEvent, { type: T }>["payload"];

/**
 * The canonical operational event model used internally by Mini-Loura.
 *
 * Event identity is defined strictly by the composite key `(source, eventId)`.
 * A repeating `(source, eventId)` pair represents the same event and will be
 * rejected as a duplicate.
 */
export type OperationalEvent = {
  [K in ExternalEventType]: {
    id: string;              // Internal unique ID
    eventId: string;         // External ID (unique within the source)
    eventType: K;            // E.g., 'inventory.low'
    source: string;          // E.g., 'warehouse-a'
    entityType: string;      // E.g., 'product', 'purchase_order'
    entityId: string;        // The ID of the affected entity
    occurredAt: string;      // When it happened in the external system
    receivedAt: string;      // When we ingested it
    correlationId?: string;
    schemaVersion: number;
    payload: ExternalPayload<K>;
  }
}[ExternalEventType];

/** A canonical event before it has been persisted (missing internal ID and receivedAt). */
export type UnpersistedOperationalEvent = {
  [K in ExternalEventType]: Omit<Extract<OperationalEvent, { eventType: K }>, "id" | "receivedAt">;
}[ExternalEventType];
