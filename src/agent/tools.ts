import type { ToolDefinition } from "./reasoning-model.js";

/**
 * Agent tools are explicitly registered capabilities. The agent can only
 * interact with the system through these tools — never through SQL, shell,
 * HTTP, or the filesystem.
 *
 * Handlers are optional: a tool can be *declared* before it is *implemented*.
 * Invoking a declared-but-unimplemented tool fails loudly.
 */
export interface Tool {
  definition: ToolDefinition;
  handler?: (params: unknown) => Promise<unknown>;
}

export class ToolNotRegisteredError extends Error {
  constructor(name: string) {
    super(`Tool not registered: ${name}`);
    this.name = "ToolNotRegisteredError";
  }
}

export class ToolNotImplementedError extends Error {
  constructor(name: string) {
    super(`Tool registered but not yet implemented: ${name}`);
    this.name = "ToolNotImplementedError";
  }
}

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.definition.name, tool);
  }

  getDefinition(name: string): ToolDefinition | undefined {
    return this.tools.get(name)?.definition;
  }

  listDefinitions(): ToolDefinition[] {
    return [...this.tools.values()].map((t) => t.definition);
  }

  /** Invoke a registered tool. Throws if the tool is unknown or not implemented. */
  async invoke(name: string, params: unknown): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new ToolNotRegisteredError(name);
    }
    if (!tool.handler) {
      throw new ToolNotImplementedError(name);
    }
    return tool.handler(params);
  }
}

/**
 * The initial tool surface. Handlers are wired in the Governed Reasoning Agent
 * stage (Stage 4); declaring them now fixes the agent boundary early.
 */
export function createDefaultToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();

  const declare = (name: string, description: string, inputExample: Record<string, unknown>) =>
    registry.register({ definition: { name, description, inputExample } });

  declare(
    "getInventory",
    "Read the current inventory level for a product.",
    { productId: "uuid" },
  );
  declare(
    "getProduct",
    "Read product details by id.",
    { productId: "uuid" },
  );
  declare(
    "getSuppliers",
    "List suppliers able to fulfil orders for a product.",
    { productId: "uuid" },
  );
  declare(
    "getOpenOrders",
    "List open purchase orders for a product.",
    { productId: "uuid" },
  );
  declare(
    "getPolicy",
    "Read the deterministic policies that apply to a proposed action.",
    { action: "CREATE_PURCHASE_ORDER" },
  );
  declare(
    "createPurchaseOrder",
    "Propose creation of a purchase order. Requires policy authorization; the tool itself cannot authorize anything.",
    { productId: "uuid", quantity: 50, supplierId: "uuid (optional)" },
  );

  return registry;
}
