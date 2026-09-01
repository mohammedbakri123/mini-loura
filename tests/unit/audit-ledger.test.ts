import { describe, expect, it } from "vitest";
import { InMemoryAuditLedger } from "../../src/audit/audit-ledger.js";

describe("InMemoryAuditLedger", () => {
  it("appends entries with generated id and timestamp", async () => {
    const ledger = new InMemoryAuditLedger();
    const entry = await ledger.append({
      type: "EVENT_RECEIVED",
      actor: "sensing",
      caseId: null,
      eventId: "evt-1",
      data: { eventType: "inventory.low" },
    });

    expect(entry.id).toBeTruthy();
    expect(entry.recordedAt).toBeTruthy();
    expect(entry.type).toBe("EVENT_RECEIVED");
  });

  it("lists entries filtered by type", async () => {
    const ledger = new InMemoryAuditLedger();
    await ledger.append({ type: "EVENT_RECEIVED", actor: "sensing", caseId: null, eventId: null, data: {} });
    await ledger.append({ type: "CASE_CREATED", actor: "case-engine", caseId: "c1", eventId: null, data: {} });

    const received = await ledger.list({ type: "EVENT_RECEIVED" });
    expect(received).toHaveLength(1);
  });

  it("lists entries filtered by caseId", async () => {
    const ledger = new InMemoryAuditLedger();
    await ledger.append({ type: "CASE_CREATED", actor: "case-engine", caseId: "case-a", eventId: null, data: {} });
    await ledger.append({ type: "CASE_CREATED", actor: "case-engine", caseId: "case-b", eventId: null, data: {} });

    const forCaseA = await ledger.list({ caseId: "case-a" });
    expect(forCaseA).toHaveLength(1);
    expect(forCaseA[0]?.caseId).toBe("case-a");
  });

  it("preserves insertion order (append-oriented history)", async () => {
    const ledger = new InMemoryAuditLedger();
    await ledger.append({ type: "EVENT_RECEIVED", actor: "sensing", caseId: null, eventId: null, data: {} });
    await ledger.append({ type: "CASE_CREATED", actor: "case-engine", caseId: null, eventId: null, data: {} });
    await ledger.append({ type: "AGENT_DECISION", actor: "agent", caseId: null, eventId: null, data: {} });

    const all = await ledger.list();
    expect(all.map((e) => e.type)).toEqual([
      "EVENT_RECEIVED",
      "CASE_CREATED",
      "AGENT_DECISION",
    ]);
  });
});
