import type { PurchaseOrder, PurchaseOrderStatus } from "../../domain/purchase-orders/purchase-order.js";

export interface NewPurchaseOrder {
  productId: string;
  supplierId: string | null;
  quantity: number;
  status: PurchaseOrderStatus;
  idempotencyKey: string | null;
}

export interface PurchaseOrderRepository {
  create(input: NewPurchaseOrder): Promise<PurchaseOrder>;
  findById(id: string): Promise<PurchaseOrder | null>;
  findByIdempotencyKey(key: string): Promise<PurchaseOrder | null>;
  updateStatus(id: string, status: PurchaseOrderStatus): Promise<PurchaseOrder>;
  listOpen(): Promise<PurchaseOrder[]>;
}

/**
 * Interface only for now: the create/confirm flow is implemented in
 * Stage 6 (Action Execution). The table already exists via migration 001.
 */
