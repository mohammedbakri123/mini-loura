import type { InventoryLevel } from "../../domain/inventory/inventory.js";

export interface InventoryRepository {
  upsert(inventory: Omit<InventoryLevel, "updatedAt">): Promise<InventoryLevel>;
  findByProductId(productId: string): Promise<InventoryLevel | null>;
  listAll(): Promise<InventoryLevel[]>;
}

export class PostgresInventoryRepository implements InventoryRepository {
  constructor(private readonly db: import("../client.js").Database) {}

  async upsert(inventory: Omit<InventoryLevel, "updatedAt">): Promise<InventoryLevel> {
    const result = await this.db.query<InventoryRow>(
      `INSERT INTO inventory (product_id, current_stock, minimum_stock, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (product_id) DO UPDATE SET
         current_stock = EXCLUDED.current_stock,
         minimum_stock = EXCLUDED.minimum_stock,
         updated_at = EXCLUDED.updated_at
       RETURNING *`,
      [inventory.productId, inventory.currentStock, inventory.minimumStock],
    );
    return mapRow(result.rows[0]!);
  }

  async findByProductId(productId: string): Promise<InventoryLevel | null> {
    const result = await this.db.query<InventoryRow>(
      "SELECT * FROM inventory WHERE product_id = $1",
      [productId],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async listAll(): Promise<InventoryLevel[]> {
    const result = await this.db.query<InventoryRow>("SELECT * FROM inventory");
    return result.rows.map(mapRow);
  }
}

export class InMemoryInventoryRepository implements InventoryRepository {
  private readonly inventory = new Map<string, InventoryLevel>();

  async upsert(inventory: Omit<InventoryLevel, "updatedAt">): Promise<InventoryLevel> {
    const full: InventoryLevel = {
      ...inventory,
      updatedAt: new Date().toISOString(),
    };
    this.inventory.set(inventory.productId, full);
    return full;
  }

  async findByProductId(productId: string): Promise<InventoryLevel | null> {
    return this.inventory.get(productId) ?? null;
  }

  async listAll(): Promise<InventoryLevel[]> {
    return [...this.inventory.values()];
  }
}

interface InventoryRow {
  product_id: string;
  current_stock: number;
  minimum_stock: number;
  updated_at: Date;
}

function mapRow(row: InventoryRow): InventoryLevel {
  return {
    productId: row.product_id,
    currentStock: row.current_stock,
    minimumStock: row.minimum_stock,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}
