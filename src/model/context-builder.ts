import type { CaseRecord } from "../domain/cases/case.js";
import type { OperationalEvent } from "../domain/events/event.js";
import type { Policy } from "../domain/policies/policy.js";
import type { OperationalSnapshot } from "./operational-model.js";
import type { ToolDefinition } from "../agent/reasoning-model.js";
import type { Product } from "../domain/products/product.js";
import type { InventoryLevel } from "../domain/inventory/inventory.js";
import type { Supplier } from "../domain/suppliers/supplier.js";
import type { PurchaseOrder } from "../domain/purchase-orders/purchase-order.js";

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

export function buildAgentContext(input: ContextBuilderInput): AgentContext {
  return {
    case: input.case,
    operationalState: input.operationalState,
    relevantEvents: input.relevantEvents,
    policies: input.policies,
    availableTools: input.availableTools,
  };
}

export interface ProductOperationalContext {
  product: Product;
  inventory: InventoryLevel | null;
  supplier: Supplier | null;
  openPurchaseOrders: PurchaseOrder[];
}

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

export interface CaseContext {
  caseRecord: CaseRecord;
  relatedEvents: string[]; // Event IDs
  operationalContext: ProductOperationalContext | null; // Expandable for other subject types
}

export class CaseContextBuilder {
  constructor(
    private readonly deps: {
      caseRepository: import("../db/repositories/case-repository.js").CaseRepository;
      operationalContextBuilder: OperationalContextBuilder;
    }
  ) {}

  async build(caseId: string): Promise<CaseContext | null> {
    const caseRecord = await this.deps.caseRepository.findById(caseId);
    if (!caseRecord) return null;

    const relatedEvents = await this.deps.caseRepository.getAssociatedEvents(caseId);

    let operationalContext: ProductOperationalContext | null = null;
    if (caseRecord.subjectType === "product") {
      operationalContext = await this.deps.operationalContextBuilder.buildForProduct(caseRecord.subjectId);
    }

    return {
      caseRecord,
      relatedEvents,
      operationalContext,
    };
  }
}
