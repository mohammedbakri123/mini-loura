import { z } from "zod";

/**
 * Domain events emitted by external operational systems (warehouses, ERPs...).
 *
 * The Zod schemas here are the single source of truth for the shape of an
 * operational event. They are used by the sensing layer to validate raw input
 * before anything is persisted or published.
 */

export const InventoryLowEventSchema = z.object({
  type: z.literal("inventory.low"),
  eventId: z.string().min(1),
  occurredAt: z.string().datetime().optional(),
  payload: z.object({
    productId: z.string().uuid(),
    productSku: z.string().min(1).optional(),
    currentStock: z.number().int().min(0),
    minimumStock: z.number().int().min(0),
  }),
});

export const InventoryUpdatedEventSchema = z.object({
  type: z.literal("inventory.updated"),
  eventId: z.string().min(1),
  occurredAt: z.string().datetime().optional(),
  payload: z.object({
    productId: z.string().uuid(),
    productSku: z.string().min(1).optional(),
    currentStock: z.number().int().min(0),
    minimumStock: z.number().int().min(0).optional(),
  }),
});

export const PurchaseOrderCreatedEventSchema = z.object({
  type: z.literal("purchase_order.created"),
  eventId: z.string().min(1),
  occurredAt: z.string().datetime().optional(),
  payload: z.object({
    purchaseOrderId: z.string().uuid(),
    productId: z.string().uuid(),
    supplierId: z.string().uuid().optional(),
    quantity: z.number().int().positive(),
  }),
});

export const PurchaseOrderReceivedEventSchema = z.object({
  type: z.literal("purchase_order.received"),
  eventId: z.string().min(1),
  occurredAt: z.string().datetime().optional(),
  payload: z.object({
    purchaseOrderId: z.string().uuid(),
    quantityReceived: z.number().int().positive(),
  }),
});

export const PurchaseOrderCancelledEventSchema = z.object({
  type: z.literal("purchase_order.cancelled"),
  eventId: z.string().min(1),
  occurredAt: z.string().datetime().optional(),
  payload: z.object({
    purchaseOrderId: z.string().uuid(),
    reason: z.string().min(1).optional(),
  }),
});

export const OperationalEventSchema = z.discriminatedUnion("type", [
  InventoryLowEventSchema,
  InventoryUpdatedEventSchema,
  PurchaseOrderCreatedEventSchema,
  PurchaseOrderReceivedEventSchema,
  PurchaseOrderCancelledEventSchema,
]);

export type ValidatedOperationalEvent = z.infer<typeof OperationalEventSchema>;

export type OperationalEventType = ValidatedOperationalEvent["type"];

export type OperationalEventPayload = ValidatedOperationalEvent["payload"];

/**
 * An event after validation, enriched with system-side metadata:
 * - `id`: internal UUID assigned by this system at ingestion time
 * - `receivedAt`: when this system received the event
 * - `occurredAt`: made required after validation (defaults to now)
 *
 * Defined as a distributive mapped type so that narrowing on `type` keeps the
 * `payload` correlated with the event type.
 */
export type OperationalEvent = {
  [K in OperationalEventType]: Extract<ValidatedOperationalEvent, { type: K }> & {
    id: string;
    receivedAt: string;
    occurredAt: string;
  };
}[OperationalEventType];

/** A validated event before it has been persisted (no internal id yet). */
export type UnpersistedOperationalEvent = {
  [K in OperationalEventType]: Extract<ValidatedOperationalEvent, { type: K }> & {
    occurredAt: string;
  };
}[OperationalEventType];

