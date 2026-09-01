import type { CaseRecord } from "../domain/cases/case.js";
import type { OperationalEvent } from "../domain/events/event.js";
import type { Policy } from "../domain/policies/policy.js";
import type { OperationalSnapshot } from "./operational-model.js";
import type { ToolDefinition } from "../agent/reasoning-model.js";
import type { Product } from "../domain/products/product.js";
import type { InventoryLevel } from "../domain/inventory/inventory.js";
import type { Supplier } from "../domain/suppliers/supplier.js";
import type { PurchaseOrder } from "../domain/purchase-orders/purchase-order.js";

/**
 * AgentContext is the *only* information channel into the reasoning model.
 * Everything the agent is allowed to know must be explicitly included here.
 */
export type AgentContext = {
  case: CaseRecord;
  operationalState: OperationalSnapshot;
  relevantEvents: OperationalEvent[];
  policies: Policy[];
  availableTools: ToolDefinition[];
};

export interface ContextBuilderInput {
  case: CaseRecord;
  operationalState: OperationalSnapshot;
  relevantEvents: OperationalEvent[];
  policies: Policy[];
  availableTools: ToolDefinition[];
}

/**
 * Builds the agent context. In later stages this will select only the relevant
 * slice of events and policies for the case; today it passes through what the
 * caller provides.
 */
export function buildAgentContext(input: ContextBuilderInput): AgentContext {
  return {
    case: input.case,
    operationalState: input.operationalState,
    relevantEvents: input.relevantEvents,
    policies: input.policies,
    availableTools: input.availableTools,
  };
}

/**
 * Stage 2 Context output.
 */
export interface ProductOperationalContext {
  product: Product;
  inventory: InventoryLevel | null;
  supplier: Supplier | null;
  openPurchaseOrders: PurchaseOrder[];
}

/**
 * OperationalContextBuilder pulls together structured operational truth from
 * the Postgres repositories without invoking any LLMs or guessing state.
 */
export class OperationalContextBuilder {
  constructor(
    private readonly deps: {
      productRepository: import("../db/repositories/product-repository.js").ProductRepository;
      inventoryRepository: import("../db/repositories/inventory-repository.js").InventoryRepository;
      supplierRepository: import("../db/repositories/supplier-repository.js").SupplierRepository;
      purchaseOrderRepository: import("../db/repositories/purchase-order-repository.js").PurchaseOrderRepository;
    }
  ) {}

  async buildForProduct(productId: string): Promise<ProductOperationalContext | null> {
    const product = await this.deps.productRepository.findById(productId);
    if (!product) return null;

    const inventory = await this.deps.inventoryRepository.findByProductId(productId);
    
    // Simplistic supplier retrieval for now, perhaps linked via POs or Inventory in reality
    // In our simplified model, we'll try to find an active PO and see its supplier.
    const allPos = await this.deps.purchaseOrderRepository.listOpen();
    const productPos = allPos.filter(po => po.items.some(i => i.productId === productId));
    
    let supplier = null;
    if (productPos.length > 0 && productPos[0]!.supplierId) {
      supplier = await this.deps.supplierRepository.findById(productPos[0]!.supplierId);
    }

    return {
      product,
      inventory,
      supplier,
      openPurchaseOrders: productPos,
    };
  }
}
