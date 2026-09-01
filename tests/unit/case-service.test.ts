import { describe, expect, it, beforeEach } from "vitest";
import { CaseService } from "../../src/domain/cases/case-service.js";
import { InMemoryCaseRepository } from "../../src/db/repositories/case-repository.js";
import { InMemoryAuditLedger } from "../../src/audit/audit-ledger.js";
import { IllegalCaseTransitionError } from "../../src/domain/cases/case-state-machine.js";
import type { OperationalEvent } from "../../src/domain/events/event.js";

describe("CaseService", () => {
  let caseRepo: InMemoryCaseRepository;
  let auditLedger: InMemoryAuditLedger;
  let caseService: CaseService;

  beforeEach(() => {
    caseRepo = new InMemoryCaseRepository();
    auditLedger = new InMemoryAuditLedger();
    caseService = new CaseService({
      caseRepository: caseRepo,
      auditLedger,
    });
  });

  const productEvent = (id: string, eventId: string = "evt-1"): OperationalEvent => ({
    id: eventId,
    eventId: "ext-1",
    eventType: "inventory.low",
    source: "warehouse",
    entityType: "product",
    entityId: id,
    occurredAt: new Date().toISOString(),
    receivedAt: new Date().toISOString(),
    schemaVersion: 1,
    payload: {
      productId: id,
      currentStock: 5,
      minimumStock: 10,
    },
  });

  it("creates a new case for a low inventory event", async () => {
    const result = await caseService.evaluateEvent(productEvent("p-1", "evt-1"));
    expect(result.caseCreated).toBe(true);
    expect(result.caseStatus).toBe("OPEN");

    const caseRecord = await caseRepo.findById(result.caseId!);
    expect(caseRecord).not.toBeNull();
    expect(caseRecord?.subjectType).toBe("product");
    expect(caseRecord?.subjectId).toBe("p-1");

    const events = await caseRepo.getAssociatedEvents(result.caseId!);
    expect(events).toContain("evt-1");
  });

  it("does not create a duplicate case if one is OPEN, but attaches the event", async () => {
    const res1 = await caseService.evaluateEvent(productEvent("p-1", "evt-1"));
    const res2 = await caseService.evaluateEvent(productEvent("p-1", "evt-2"));

    expect(res1.caseId).toBe(res2.caseId);
    expect(res2.caseCreated).toBe(false);

    const events = await caseRepo.getAssociatedEvents(res2.caseId!);
    expect(events).toContain("evt-1");
    expect(events).toContain("evt-2");
  });

  it("transitions status legally", async () => {
    const result = await caseService.evaluateEvent(productEvent("p-1"));
    const caseId = result.caseId!;

    const updated = await caseService.transitionStatus(caseId, "INVESTIGATING", "Time to look");
    expect(updated.status).toBe("INVESTIGATING");

    const history = await caseRepo.listStatusHistory(caseId);
    expect(history.length).toBeGreaterThan(1);
    expect(history[history.length - 1]?.toStatus).toBe("INVESTIGATING");
    expect(history[history.length - 1]?.reason).toBe("Time to look");
  });

  it("rejects illegal transitions", async () => {
    const result = await caseService.evaluateEvent(productEvent("p-1"));
    const caseId = result.caseId!;

    await expect(caseService.transitionStatus(caseId, "VERIFYING")).rejects.toThrowError(IllegalCaseTransitionError);
  });

  it("allows REOPENED from RESOLVED", async () => {
    const result = await caseService.evaluateEvent(productEvent("p-1"));
    const caseId = result.caseId!;

    await caseService.transitionStatus(caseId, "INVESTIGATING");
    await caseService.transitionStatus(caseId, "RESOLVED");

    const updated = await caseService.transitionStatus(caseId, "REOPENED");
    expect(updated.status).toBe("REOPENED");
  });
});
