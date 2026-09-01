import { describe, expect, it, beforeEach } from "vitest";
import { RepositoryOperationalModel } from "../../src/model/operational-model.js";
import { InMemoryProductRepository } from "../../src/db/repositories/product-repository.js";
import { InMemoryInventoryRepository } from "../../src/db/repositories/inventory-repository.js";
import { InMemorySupplierRepository } from "../../src/db/repositories/supplier-repository.js";
import { InMemoryPurchaseOrderRepository } from "../../src/db/repositories/purchase-order-repository.js";
import { OperationalContextBuilder } from "../../src/model/context-builder.js";

describe("RepositoryOperationalModel and ContextBuilder", () => {
  let productRepo: InMemoryProductRepository;
  let inventoryRepo: InMemoryInventoryRepository;
  let supplierRepo: InMemorySupplierRepository;
  let poRepo: InMemoryPurchaseOrderRepository;
  let model: RepositoryOperationalModel;
  let builder: OperationalContextBuilder;

  beforeEach(() => {
    productRepo = new InMemoryProductRepository();
    inventoryRepo = new InMemoryInventoryRepository();
    supplierRepo = new InMemorySupplierRepository();
    poRepo = new InMemoryPurchaseOrderRepository();

    const deps = {
      productRepository: productRepo,
      inventoryRepository: inventoryRepo,
      supplierRepository: supplierRepo,
      purchaseOrderRepository: poRepo,
    };

    model = new RepositoryOperationalModel(deps);
    builder = new OperationalContextBuilder(deps);
  });

  const productId = "9b2f1a34-1c4d-4e5f-8a9b-0c1d2e3f4a5b";
  const supplierId = "55555555-1c4d-4e5f-8a9b-0c1d2e3f4a5b";

  it("applies inventory.low and upserts product and inventory", async () => {
    await model.applyEvent({
      id: "evt-uuid-1",
      eventId: "ext-1",
      eventType: "inventory.low",
      source: "warehouse-a",
      entityType: "product",
      entityId: productId,
      occurredAt: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      schemaVersion: 1,
      payload: {
        productId,
        productSku: "SKU-123",
        currentStock: 8,
        minimumStock: 20,
      },
    });

    const product = await productRepo.findById(productId);
    expect(product).not.toBeNull();
    expect(product?.sku).toBe("SKU-123");

    const inventory = await inventoryRepo.findByProductId(productId);
    expect(inventory).not.toBeNull();
    expect(inventory?.currentStock).toBe(8);
    expect(inventory?.minimumStock).toBe(20);
  });

  it("applies purchase_order.created and upserts PO, Product, and Supplier", async () => {
    const poId = "order-uuid-1";

    await model.applyEvent({
      id: "evt-uuid-2",
      eventId: "ext-2",
      eventType: "purchase_order.created",
      source: "warehouse-a",
      entityType: "purchase_order",
      entityId: poId,
      occurredAt: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      schemaVersion: 1,
      payload: {
        purchaseOrderId: poId,
        productId,
        supplierId,
        quantity: 50,
      },
    });

    const po = await poRepo.findById(poId);
    expect(po).not.toBeNull();
    expect(po?.status).toBe("created");
    expect(po?.items[0]?.productId).toBe(productId);

    const supplier = await supplierRepo.findById(supplierId);
    expect(supplier).not.toBeNull();
    expect(supplier?.name).toContain(supplierId);
  });

  it("builds operational context correctly", async () => {
    // 1. Create product and inventory
    await model.applyEvent({
      id: "evt-uuid-1",
      eventId: "ext-1",
      eventType: "inventory.updated",
      source: "warehouse-a",
      entityType: "product",
      entityId: productId,
      occurredAt: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      schemaVersion: 1,
      payload: {
        productId,
        currentStock: 15,
        minimumStock: 50,
      },
    });

    // 2. Create a purchase order
    const poId = "order-uuid-99";
    await model.applyEvent({
      id: "evt-uuid-2",
      eventId: "ext-2",
      eventType: "purchase_order.created",
      source: "warehouse-a",
      entityType: "purchase_order",
      entityId: poId,
      occurredAt: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      schemaVersion: 1,
      payload: {
        purchaseOrderId: poId,
        productId,
        supplierId,
        quantity: 100,
      },
    });

    // 3. Build context
    const context = await builder.buildForProduct(productId);
    expect(context).not.toBeNull();
    expect(context?.product.id).toBe(productId);
    expect(context?.inventory?.currentStock).toBe(15);
    expect(context?.supplier?.id).toBe(supplierId);
    expect(context?.openPurchaseOrders).toHaveLength(1);
    expect(context?.openPurchaseOrders[0]?.id).toBe(poId);
  });
  it("builds case context correctly", async () => {
    await model.applyEvent({
      id: "evt-uuid-1",
      eventId: "ext-1",
      eventType: "inventory.updated",
      source: "warehouse-a",
      entityType: "product",
      entityId: productId,
      occurredAt: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      schemaVersion: 1,
      payload: { productId, currentStock: 15, minimumStock: 50 },
    });
    
    const caseRepo = new (await import("../../src/db/repositories/case-repository.js")).InMemoryCaseRepository();
    const createdCase = await caseRepo.create({
      type: "inventory_replenishment",
      status: "OPEN",
      priority: "HIGH",
      title: "Test Case",
      subjectType: "product",
      subjectId: productId,
    });
    await caseRepo.addEvent(createdCase.id, "evt-uuid-1");

    const caseBuilder = new (await import("../../src/model/context-builder.js")).CaseContextBuilder({
      caseRepository: caseRepo,
      operationalContextBuilder: builder,
    });

    const caseContext = await caseBuilder.build(createdCase.id);
    expect(caseContext).not.toBeNull();
    expect(caseContext?.caseRecord.subjectType).toBe("product");
    expect(caseContext?.relatedEvents).toContain("evt-uuid-1");
    expect(caseContext?.operationalContext?.product.id).toBe(productId);
    expect(caseContext?.operationalContext?.inventory?.currentStock).toBe(15);
  });
});
