import { describe, expect, it } from "vitest";
import {
  assertTransition,
  canTransition,
  isTerminalStatus,
  legalTransitionsFrom,
  IllegalCaseTransitionError,
} from "../../src/domain/cases/case-state-machine.js";

describe("case state machine", () => {
  it("allows the main happy-path transitions", () => {
    expect(canTransition("OPEN", "INVESTIGATING")).toBe(true);
    expect(canTransition("INVESTIGATING", "ACTION_REQUIRED")).toBe(true);
    expect(canTransition("ACTION_REQUIRED", "ACTING")).toBe(true);
    expect(canTransition("ACTING", "VERIFYING")).toBe(true);
    expect(canTransition("VERIFYING", "RESOLVED")).toBe(true);
  });

  it("allows alternative transitions", () => {
    expect(canTransition("ACTION_REQUIRED", "HUMAN_APPROVAL_REQUIRED")).toBe(true);
    expect(canTransition("HUMAN_APPROVAL_REQUIRED", "ACTING")).toBe(true);
    expect(canTransition("VERIFYING", "FAILED")).toBe(true);
    expect(canTransition("RESOLVED", "REOPENED")).toBe(true);
    expect(canTransition("FAILED", "INVESTIGATING")).toBe(true);
  });

  it("rejects arbitrary status changes", () => {
    expect(canTransition("OPEN", "ACTING")).toBe(false);
    expect(canTransition("OPEN", "VERIFYING")).toBe(false);
    expect(canTransition("ACTING", "OPEN")).toBe(false);
    expect(canTransition("VERIFYING", "ACTING")).toBe(false);
    expect(canTransition("OPEN", "RESOLVED")).toBe(true); // early resolution is legal
  });

  it("throws IllegalCaseTransitionError on illegal transition", () => {
    expect(() => assertTransition("ACTING", "OPEN")).toThrowError(IllegalCaseTransitionError);
    try {
      assertTransition("ACTING", "OPEN");
    } catch (error) {
      expect((error as IllegalCaseTransitionError).from).toBe("ACTING");
      expect((error as IllegalCaseTransitionError).to).toBe("OPEN");
    }
  });

  it("treats RESOLVED as terminal", () => {
    expect(isTerminalStatus("RESOLVED")).toBe(true);
    expect(isTerminalStatus("OPEN")).toBe(false);
    expect(isTerminalStatus("FAILED")).toBe(false);
  });

  it("exposes legal outgoing transitions", () => {
    expect(legalTransitionsFrom("VERIFYING")).toEqual(["RESOLVED", "FAILED"]);
  });
});
