import crypto from "node:crypto";
import type { Database } from "../client.js";

export interface PolicyRecord {
  id: string;
  actionType: string;
  name: string;
  enabled: boolean;
  priority: number;
  configuration: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface PolicyRepository {
  findEnabledPoliciesForAction(actionType: string): Promise<PolicyRecord[]>;
  create(policy: Omit<PolicyRecord, "id" | "createdAt" | "updatedAt">): Promise<PolicyRecord>;
}

interface PolicyRow {
  id: string;
  action_type: string;
  name: string;
  enabled: boolean;
  priority: number;
  configuration: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export class PostgresPolicyRepository implements PolicyRepository {
  constructor(private readonly db: Database) {}

  async findEnabledPoliciesForAction(actionType: string): Promise<PolicyRecord[]> {
    const result = await this.db.query<PolicyRow>(
      `SELECT * FROM policies WHERE action_type = $1 AND enabled = true ORDER BY priority DESC`,
      [actionType]
    );

    return result.rows.map((row) => ({
      id: row.id,
      actionType: row.action_type,
      name: row.name,
      enabled: row.enabled,
      priority: row.priority,
      configuration: row.configuration,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    }));
  }

  async create(policy: Omit<PolicyRecord, "id" | "createdAt" | "updatedAt">): Promise<PolicyRecord> {
    const result = await this.db.query<PolicyRow>(
      `INSERT INTO policies (action_type, name, enabled, priority, configuration)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [
        policy.actionType,
        policy.name,
        policy.enabled,
        policy.priority,
        JSON.stringify(policy.configuration),
      ]
    );

    const row = result.rows[0]!;
    return {
      id: row.id,
      actionType: row.action_type,
      name: row.name,
      enabled: row.enabled,
      priority: row.priority,
      configuration: row.configuration,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }
}

export class InMemoryPolicyRepository implements PolicyRepository {
  private policies: PolicyRecord[] = [];

  async findEnabledPoliciesForAction(actionType: string): Promise<PolicyRecord[]> {
    return this.policies
      .filter((p) => p.actionType === actionType && p.enabled)
      .sort((a, b) => b.priority - a.priority);
  }

  async create(policy: Omit<PolicyRecord, "id" | "createdAt" | "updatedAt">): Promise<PolicyRecord> {
    const newPolicy: PolicyRecord = {
      id: crypto.randomUUID(),
      ...policy,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.policies.push(newPolicy);
    return newPolicy;
  }
}
