import type { PurchaseOrder, PurchaseOrderStatus, PurchaseOrderItem } from "../../domain/purchase-orders/purchase-order.js";

export interface NewPurchaseOrder {
  id?: string; // Optional for idempotency explicitly passed
  supplierId: string | null;
  items: PurchaseOrderItem[];
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
