/**
 * Purchase order domain shape.
 *
 * The purchase order lifecycle (draft -> confirmed -> received / cancelled) is
 * owned by the operational model and the action execution layer (Stage 6).
 */
export type PurchaseOrderStatus =
  | "draft"
  | "created"
  | "confirmed"
  | "received"
  | "cancelled";

export interface PurchaseOrder {
  id: string;
  productId: string;
  supplierId: string | null;
  quantity: number;
  status: PurchaseOrderStatus;
  idempotencyKey: string | null;
  createdAt: string;
  updatedAt: string;
}
