import type { Supplier } from "../../domain/suppliers/supplier.js";

export interface SupplierRepository {
  upsert(supplier: Omit<Supplier, "createdAt" | "updatedAt">): Promise<Supplier>;
  findById(id: string): Promise<Supplier | null>;
}

export class PostgresSupplierRepository implements SupplierRepository {
  constructor(private readonly db: import("../client.js").Database) {}

  async upsert(supplier: Omit<Supplier, "createdAt" | "updatedAt">): Promise<Supplier> {
    const result = await this.db.query<SupplierRow>(
      `INSERT INTO suppliers (id, name, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         updated_at = EXCLUDED.updated_at
       RETURNING *`,
      [supplier.id, supplier.name],
    );
    return mapRow(result.rows[0]!);
  }

  async findById(id: string): Promise<Supplier | null> {
    const result = await this.db.query<SupplierRow>(
      "SELECT * FROM suppliers WHERE id = $1",
      [id],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }
}

export class InMemorySupplierRepository implements SupplierRepository {
  private readonly suppliers = new Map<string, Supplier>();

  async upsert(supplier: Omit<Supplier, "createdAt" | "updatedAt">): Promise<Supplier> {
    const existing = this.suppliers.get(supplier.id);
    const full: Supplier = {
      ...supplier,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.suppliers.set(supplier.id, full);
    return full;
  }

  async findById(id: string): Promise<Supplier | null> {
    return this.suppliers.get(id) ?? null;
  }
}

interface SupplierRow {
  id: string;
  name: string;
  created_at: Date;
  updated_at: Date;
}

function mapRow(row: SupplierRow): Supplier {
  return {
    id: row.id,
    name: row.name,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}
