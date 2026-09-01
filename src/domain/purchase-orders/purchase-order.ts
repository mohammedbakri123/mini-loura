/**
 * Purchase order domain shape.
 *
 * The purchase order lifecycle (draft -> created -> confirmed -> received / cancelled) is
 * owned by the operational model and the action execution layer (Stage 6).
 */
export type PurchaseOrderStatus =
  | "draft"
  | "created"
  | "confirmed"
  | "received"
  | "cancelled";

export interface PurchaseOrderItem {
  productId: string;
  quantity: number;
}

export interface PurchaseOrder {
  id: string;
  supplierId: string | null;
  status: PurchaseOrderStatus;
  items: PurchaseOrderItem[];
  idempotencyKey: string | null;
  createdAt: string;
  updatedAt: string;
}
