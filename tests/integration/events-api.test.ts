import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { EventValidator } from "../../src/sensing/event-validator.js";
import { InMemoryEventBus } from "../../src/sensing/event-bus.js";
import { EventIngestionService } from "../../src/sensing/event-ingestion.js";
import { InMemoryAuditLedger } from "../../src/audit/audit-ledger.js";
import { InMemoryEventRepository } from "../../src/db/repositories/event-repository.js";
import { InMemoryCaseRepository } from "../../src/db/repositories/case-repository.js";
import { RepositoryOperationalModel } from "../../src/model/operational-model.js";
import { InMemoryProductRepository } from "../../src/db/repositories/product-repository.js";
import { InMemoryInventoryRepository } from "../../src/db/repositories/inventory-repository.js";
import { InMemorySupplierRepository } from "../../src/db/repositories/supplier-repository.js";
import { InMemoryPurchaseOrderRepository } from "../../src/db/repositories/purchase-order-repository.js";
import { CaseService } from "../../src/domain/cases/case-service.js";
import { EventPipeline } from "../../src/runtime/event-pipeline.js";

/**
 * End-to-end foundation test without PostgreSQL:
 *
 *   POST /events -> validate -> deduplicate -> persist -> publish
 *     -> operational model updated -> case created -> audit recorded
 */
describe("events API (integration)", () => {
  let app: FastifyInstance;
  let eventRepository: InMemoryEventRepository;
  let caseRepository: InMemoryCaseRepository;
  let auditLedger: InMemoryAuditLedger;
  let operationalModel: RepositoryOperationalModel;
  let bus: InMemoryEventBus;

  const productId = "9b2f1a34-1c4d-4e5f-8a9b-0c1d2e3f4a5b";

  const inventoryLowEvent = () => ({
    type: "inventory.low",
    eventId: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    payload: {
      productId,
      currentStock: 8,
      minimumStock: 20,
    },
  });

  beforeAll(async () => {
    eventRepository = new InMemoryEventRepository();
    caseRepository = new InMemoryCaseRepository();
    auditLedger = new InMemoryAuditLedger();
    bus = new InMemoryEventBus();

    operationalModel = new RepositoryOperationalModel({
      productRepository: new InMemoryProductRepository(),
      inventoryRepository: new InMemoryInventoryRepository(),
      supplierRepository: new InMemorySupplierRepository(),
      purchaseOrderRepository: new InMemoryPurchaseOrderRepository(),
    });

    const caseService = new CaseService({
      caseRepository,
      auditLedger,
    });

    const pipeline = new EventPipeline({
      operationalModel,
      caseService,
    });
    bus.subscribe((event) => pipeline.handle(event));

    const ingestion = new EventIngestionService({
      validator: new EventValidator(),
      eventRepository,
      bus,
      auditLedger,
    });

    app = buildApp({
      ingestion,
      databaseHealthCheck: async () => true,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /health returns ok", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe("ok");
    expect(body.database).toBe("up");
  });

  it("POST /events accepts a valid event, creates a case, updates the model, and audits", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/events",
      payload: inventoryLowEvent(),
    });

    expect(response.statusCode).toBe(202);
    const { status, eventId } = response.json();
    expect(status).toBe("accepted");
    expect(eventId).toBeTruthy();

    // Event persisted
    const stored = await eventRepository.findById(eventId);
    expect(stored).not.toBeNull();
    expect(stored?.eventType).toBe("inventory.low");

    // Case created
    const cases = await caseRepository.listRecent(10);
    expect(cases).toHaveLength(1);
    expect(cases[0]?.type).toBe("inventory_replenishment");
    expect(cases[0]?.status).toBe("OPEN");
    expect(cases[0]?.subjectId).toBe(productId);

    // Operational model updated
    const level = await operationalModel.getInventoryLevel(productId);
    expect(level).toEqual(
      expect.objectContaining({ productId, currentStock: 8, minimumStock: 20 }),
    );

    // Audit trail recorded
    const auditTypes = (await auditLedger.list()).map((e) => e.type);
    expect(auditTypes).toContain("EVENT_RECEIVED");
    expect(auditTypes).toContain("CASE_CREATED");
  });

  it("POST /events deduplicates by composite identity (source, eventId)", async () => {
    const event = inventoryLowEvent();
    
    // First attempt -> accepted
    const first = await app.inject({ method: "POST", url: "/events", payload: event });
    expect(first.statusCode).toBe(202);

    // Second attempt -> duplicate
    const second = await app.inject({ method: "POST", url: "/events", payload: event });
    expect(second.statusCode).toBe(200);
    expect(second.json().status).toBe("duplicate");

    // We only expect one case created for this event flow
    const cases = await caseRepository.listRecent(10);
    expect(cases.filter((c) => c.subjectId === productId)).toHaveLength(1);
  });

  it("does not create duplicate cases for repeated low-stock events", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/events",
      payload: inventoryLowEvent(),
    });
    const second = await app.inject({
      method: "POST",
      url: "/events",
      payload: inventoryLowEvent(),
    });

    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(202);

    const cases = await caseRepository.listRecent(10);
    // Even though multiple low-stock events came through, only one case should remain OPEN
    expect(cases.filter((c) => c.subjectId === productId)).toHaveLength(1);
  });

  it("POST /events rejects an invalid event with 400", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/events",
      payload: { type: "not.a.real.event", eventId: "x", payload: {} },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().status).toBe("rejected");
    expect(response.json().issues.length).toBeGreaterThan(0);

    const rejected = (await auditLedger.list()).filter((e) => e.type === "EVENT_REJECTED");
    expect(rejected).toHaveLength(1);
  });

  it("POST /events handles database failures gracefully with 503", async () => {
    // We simulate a database failure by mocking the insert method
    const originalInsert = eventRepository.insert;
    eventRepository.insert = async () => {
      throw new Error("Simulated Database Failure");
    };

    const response = await app.inject({
      method: "POST",
      url: "/events",
      payload: inventoryLowEvent(),
    });

    expect(response.statusCode).toBe(503);
    expect(response.json().status).toBe("error");

    // Restore the original method
    eventRepository.insert = originalInsert.bind(eventRepository);
  });
});
