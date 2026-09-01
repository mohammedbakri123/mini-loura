import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../../src/app.js";
import type { FastifyInstance } from "fastify";
import { InMemoryCaseRepository } from "../../src/db/repositories/case-repository.js";
import { InMemoryEventRepository } from "../../src/db/repositories/event-repository.js";
import { InMemoryAuditLedger } from "../../src/audit/audit-ledger.js";

describe("Web API Integration (In-Memory)", () => {
  let app: FastifyInstance;
  let caseRepo: InMemoryCaseRepository;
  let eventRepo: InMemoryEventRepository;
  let auditLedger: InMemoryAuditLedger;

  beforeAll(async () => {
    caseRepo = new InMemoryCaseRepository();
    eventRepo = new InMemoryEventRepository();
    auditLedger = new InMemoryAuditLedger();

    app = buildApp({
      // We only test the view endpoints here to avoid full pipeline setup complexity in memory.
      // Demo scenarios test the pipeline via API, but we'd need mock execution services etc.
      // We will just test the /cases and /audit endpoints since they are pure reads.
      ingestion: {} as any,
      databaseHealthCheck: async () => true,
      caseRepository: caseRepo,
      eventRepository: eventRepo,
      auditLedger: auditLedger,
    });
    
    await caseRepo.create({ type: "inventory_replenishment", status: "OPEN", priority: "MEDIUM", title: "Test", subjectType: "product", subjectId: "123" });
    await auditLedger.append({ type: "CASE_CREATED", actor: "test", caseId: "case-1", eventId: null, data: {} });

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("should return cases list", async () => {
    const res = await app.inject({ method: "GET", url: "/api/cases" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(1);
  });

  it("should return audit events list", async () => {
    const res = await app.inject({ method: "GET", url: "/api/audit" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(1);
  });
});
