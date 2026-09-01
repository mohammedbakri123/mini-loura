import { describe, expect, it } from "vitest";
import { EventValidator } from "../../src/sensing/event-validator.js";

const validator = new EventValidator();

const validInventoryLow = {
  type: "inventory.low",
  eventId: "evt-001",
  payload: {
    productId: "9b2f1a34-1c4d-4e5f-8a9b-0c1d2e3f4a5b",
    currentStock: 8,
    minimumStock: 20,
  },
};

describe("EventValidator", () => {
  it("accepts a valid inventory.low event", () => {
    const result = validator.validate(validInventoryLow);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.type).toBe("inventory.low");
      expect(result.event.eventId).toBe("evt-001");
    }
  });

  it("defaults occurredAt when not provided", () => {
    const result = validator.validate(validInventoryLow);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(() => new Date(result.event.occurredAt).toISOString()).not.toThrow();
    }
  });

  it("keeps a provided occurredAt", () => {
    const occurredAt = "2026-01-01T00:00:00.000Z";
    const result = validator.validate({ ...validInventoryLow, occurredAt });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.occurredAt).toBe(occurredAt);
    }
  });

  it("rejects an unknown event type", () => {
    const result = validator.validate({ ...validInventoryLow, type: "unknown.event" });
    expect(result.ok).toBe(false);
  });

  it("rejects negative stock", () => {
    const result = validator.validate({
      ...validInventoryLow,
      payload: { ...validInventoryLow.payload, currentStock: -1 },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a missing eventId", () => {
    const { eventId: _eventId, ...withoutEventId } = validInventoryLow;
    const result = validator.validate(withoutEventId);
    expect(result.ok).toBe(false);
  });

  it("rejects a non-uuid productId", () => {
    const result = validator.validate({
      ...validInventoryLow,
      payload: { ...validInventoryLow.payload, productId: "usb-c-charger" },
    });
    expect(result.ok).toBe(false);
  });

  it("validates purchase_order.received payload", () => {
    const result = validator.validate({
      type: "purchase_order.received",
      eventId: "evt-002",
      payload: {
        purchaseOrderId: "9b2f1a34-1c4d-4e5f-8a9b-0c1d2e3f4a5b",
        quantityReceived: 50,
      },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects purchase_order.received with zero quantity", () => {
    const result = validator.validate({
      type: "purchase_order.received",
      eventId: "evt-003",
      payload: {
        purchaseOrderId: "9b2f1a34-1c4d-4e5f-8a9b-0c1d2e3f4a5b",
        quantityReceived: 0,
      },
    });
    expect(result.ok).toBe(false);
  });

  it("validateOrThrow throws EventValidationError with issues", () => {
    expect(() => validator.validateOrThrow({ type: "nope" })).toThrowError(
      /Invalid operational event/,
    );
  });
});
