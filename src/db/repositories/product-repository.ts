import type { Product } from "../../domain/products/product.js";

export interface ProductRepository {
  upsert(product: Omit<Product, "createdAt" | "updatedAt">): Promise<Product>;
  findById(id: string): Promise<Product | null>;
  findBySku(sku: string): Promise<Product | null>;
}

export class PostgresProductRepository implements ProductRepository {
  constructor(private readonly db: import("../client.js").Database) {}

  async upsert(product: Omit<Product, "createdAt" | "updatedAt">): Promise<Product> {
    const result = await this.db.query<ProductRow>(
      `INSERT INTO products (id, sku, name, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (id) DO UPDATE SET
         sku = EXCLUDED.sku,
         name = EXCLUDED.name,
         updated_at = EXCLUDED.updated_at
       RETURNING *`,
      [product.id, product.sku, product.name],
    );
    return mapRow(result.rows[0]!);
  }

  async findById(id: string): Promise<Product | null> {
    const result = await this.db.query<ProductRow>(
      "SELECT * FROM products WHERE id = $1",
      [id],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async findBySku(sku: string): Promise<Product | null> {
    const result = await this.db.query<ProductRow>(
      "SELECT * FROM products WHERE sku = $1",
      [sku],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }
}

export class InMemoryProductRepository implements ProductRepository {
  private readonly products = new Map<string, Product>();

  async upsert(product: Omit<Product, "createdAt" | "updatedAt">): Promise<Product> {
    const existing = this.products.get(product.id);
    const full: Product = {
      ...product,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.products.set(product.id, full);
    return full;
  }

  async findById(id: string): Promise<Product | null> {
    return this.products.get(id) ?? null;
  }

  async findBySku(sku: string): Promise<Product | null> {
    for (const p of this.products.values()) {
      if (p.sku === sku) return p;
    }
    return null;
  }
}

interface ProductRow {
  id: string;
  sku: string;
  name: string;
  created_at: Date;
  updated_at: Date;
}

function mapRow(row: ProductRow): Product {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}
