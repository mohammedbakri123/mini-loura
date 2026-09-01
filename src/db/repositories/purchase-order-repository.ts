import type { PurchaseOrder, PurchaseOrderStatus, PurchaseOrderItem } from "../../domain/purchase-orders/purchase-order.js";
import { randomUUID } from "node:crypto";

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

export class PostgresPurchaseOrderRepository implements PurchaseOrderRepository {
  constructor(private readonly db: import("../client.js").Database) {}

  async create(input: NewPurchaseOrder): Promise<PurchaseOrder> {
    const id = input.id ?? randomUUID();
    
    // We must execute this in a transaction because it involves two tables
    return this.db.transaction(async (tx) => {
      // If an idempotencyKey is provided, check first to return existing
      if (input.idempotencyKey) {
        const existing = await this.findByIdempotencyKeyInsideTx(tx, input.idempotencyKey);
        if (existing) return existing;
      }

      const poResult = await tx.query<PurchaseOrderRow>(
        `INSERT INTO purchase_orders (id, supplier_id, status, idempotency_key)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [id, input.supplierId, input.status, input.idempotencyKey]
      );
      
      const poRow = poResult.rows[0]!;
      
      const items: PurchaseOrderItem[] = [];
      for (const item of input.items) {
        const itemResult = await tx.query<PurchaseOrderItemRow>(
          `INSERT INTO purchase_order_items (purchase_order_id, product_id, quantity)
           VALUES ($1, $2, $3)
           RETURNING *`,
          [poRow.id, item.productId, item.quantity]
        );
        items.push({
          productId: itemResult.rows[0]!.product_id,
          quantity: itemResult.rows[0]!.quantity,
        });
      }

      return mapPurchaseOrder(poRow, items);
    });
  }

  async findById(id: string): Promise<PurchaseOrder | null> {
    const poResult = await this.db.query<PurchaseOrderRow>(
      "SELECT * FROM purchase_orders WHERE id = $1",
      [id]
    );
    if (!poResult.rows[0]) return null;
    
    const itemsResult = await this.db.query<PurchaseOrderItemRow>(
      "SELECT * FROM purchase_order_items WHERE purchase_order_id = $1",
      [id]
    );

    return mapPurchaseOrder(poResult.rows[0], itemsResult.rows.map(mapItemRow));
  }

  async findByIdempotencyKey(key: string): Promise<PurchaseOrder | null> {
    return this.db.transaction(async (tx) => this.findByIdempotencyKeyInsideTx(tx, key));
  }

  private async findByIdempotencyKeyInsideTx(tx: any, key: string): Promise<PurchaseOrder | null> {
    const poResult = await tx.query(
      "SELECT * FROM purchase_orders WHERE idempotency_key = $1",
      [key]
    );
    if (!poResult.rows[0]) return null;
    
    const itemsResult = await tx.query(
      "SELECT * FROM purchase_order_items WHERE purchase_order_id = $1",
      [poResult.rows[0].id]
    );

    return mapPurchaseOrder(poResult.rows[0], itemsResult.rows.map(mapItemRow));
  }

  async updateStatus(id: string, status: PurchaseOrderStatus): Promise<PurchaseOrder> {
    const poResult = await this.db.query<PurchaseOrderRow>(
      `UPDATE purchase_orders SET status = $2, updated_at = now() WHERE id = $1 RETURNING *`,
      [id, status]
    );
    if (!poResult.rows[0]) {
      throw new Error(`PurchaseOrder ${id} not found`);
    }
    
    const itemsResult = await this.db.query<PurchaseOrderItemRow>(
      "SELECT * FROM purchase_order_items WHERE purchase_order_id = $1",
      [id]
    );

    return mapPurchaseOrder(poResult.rows[0], itemsResult.rows.map(mapItemRow));
  }

  async listOpen(): Promise<PurchaseOrder[]> {
    const poResult = await this.db.query<PurchaseOrderRow>(
      `SELECT * FROM purchase_orders WHERE status IN ('draft', 'created', 'confirmed') ORDER BY created_at DESC`
    );
    
    if (poResult.rows.length === 0) return [];
    
    const ids = poResult.rows.map(r => r.id);
    // Secure interpolation via ANY($1)
    const itemsResult = await this.db.query<PurchaseOrderItemRow>(
      `SELECT * FROM purchase_order_items WHERE purchase_order_id = ANY($1)`,
      [ids]
    );

    const itemsByPoId = new Map<string, PurchaseOrderItem[]>();
    for (const item of itemsResult.rows) {
      if (!itemsByPoId.has(item.purchase_order_id)) {
        itemsByPoId.set(item.purchase_order_id, []);
      }
      itemsByPoId.get(item.purchase_order_id)!.push(mapItemRow(item));
    }

    return poResult.rows.map(row => mapPurchaseOrder(row, itemsByPoId.get(row.id) ?? []));
  }
}

export class InMemoryPurchaseOrderRepository implements PurchaseOrderRepository {
  private readonly pos = new Map<string, PurchaseOrder>();

  async create(input: NewPurchaseOrder): Promise<PurchaseOrder> {
    if (input.idempotencyKey) {
      for (const po of this.pos.values()) {
        if (po.idempotencyKey === input.idempotencyKey) return po;
      }
    }

    const full: PurchaseOrder = {
      id: input.id ?? randomUUID(),
      supplierId: input.supplierId,
      status: input.status,
      items: input.items,
      idempotencyKey: input.idempotencyKey,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.pos.set(full.id, full);
    return full;
  }

  async findById(id: string): Promise<PurchaseOrder | null> {
    return this.pos.get(id) ?? null;
  }

  async findByIdempotencyKey(key: string): Promise<PurchaseOrder | null> {
    for (const po of this.pos.values()) {
      if (po.idempotencyKey === key) return po;
    }
    return null;
  }

  async updateStatus(id: string, status: PurchaseOrderStatus): Promise<PurchaseOrder> {
    const po = this.pos.get(id);
    if (!po) throw new Error(`PurchaseOrder ${id} not found`);
    po.status = status;
    po.updatedAt = new Date().toISOString();
    return po;
  }

  async listOpen(): Promise<PurchaseOrder[]> {
    return [...this.pos.values()]
      .filter(po => po.status === "draft" || po.status === "created" || po.status === "confirmed")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

interface PurchaseOrderRow {
  id: string;
  supplier_id: string | null;
  status: PurchaseOrderStatus;
  idempotency_key: string | null;
  created_at: Date;
  updated_at: Date;
}

interface PurchaseOrderItemRow {
  purchase_order_id: string;
  product_id: string;
  quantity: number;
}

function mapPurchaseOrder(row: PurchaseOrderRow, items: PurchaseOrderItem[]): PurchaseOrder {
  return {
    id: row.id,
    supplierId: row.supplier_id,
    status: row.status,
    items,
    idempotencyKey: row.idempotency_key,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function mapItemRow(row: PurchaseOrderItemRow): PurchaseOrderItem {
  return {
    productId: row.product_id,
    quantity: row.quantity,
  };
}
