import { Pool, type PoolClient } from "pg";

/**
 * PostgreSQL access. `pg` is used directly (no ORM) on purpose: the data model
 * is small, explicit SQL is easy to audit, and it keeps dependencies minimal.
 */
export interface Database {
  query<T = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
  transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export class PgDatabase implements Database {
  private readonly pool: Pool;

  constructor(connectionString: string) {
    const isLocalhost = connectionString.includes("localhost") || connectionString.includes("127.0.0.1");
    this.pool = new Pool({ 
      connectionString, 
      max: 10,
      ssl: isLocalhost ? false : { rejectUnauthorized: false }
    });
    
    // Prevent unhandled promise rejections on background connection errors
    this.pool.on("error", (err) => {
      console.error("Unexpected error on idle database client", err);
    });
  }

  query<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: T[] }> {
    return this.pool.query(text, values as never[]) as unknown as Promise<{ rows: T[] }>;
  }

  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

/** Cheap connectivity probe used by /health. Never throws. */
export async function checkDatabaseHealth(db: Database): Promise<boolean> {
  try {
    await db.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
