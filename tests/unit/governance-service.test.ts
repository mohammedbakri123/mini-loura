import { describe, expect, it, beforeEach } from "vitest";
import { GovernanceService } from "../../src/governance/governance-service.js";
import { DeterministicPolicyEngine } from "../../src/governance/policy-engine.js";
import { ActionRegistry } from "../../src/governance/action-registry.js";
import { createPurchaseOrderAction } from "../../src/actions/purchase-order-action.js";
import { InMemoryPolicyRepository } from "../../src/db/repositories/policy-repository.js";
import { InMemoryGovernanceRepository } from "../../src/db/repositories/governance-repository.js";
import { InMemoryAuditLedger } from "../../src/audit/audit-ledger.js";
import type { AgentDecision } from "../../src/agent/reasoning-model.js";

const productId = "9b2f1a34-1c4d-4e5f-8a9b-0c1d2e3f4a5b";

describe("GovernanceService", () => {
  let actionRegistry: ActionRegistry;
  let policyRepo: InMemoryPolicyRepository;
  let governanceRepo: InMemoryGovernanceRepository;
  let auditLedger: InMemoryAuditLedger;
  let service: GovernanceService;

  beforeEach(() => {
    actionRegistry = new ActionRegistry();
    actionRegistry.register(createPurchaseOrderAction());
    policyRepo = new InMemoryPolicyRepository();
    const policyEngine = new DeterministicPolicyEngine({ actionRegistry, policyRepository: policyRepo });

    governanceRepo = new InMemoryGovernanceRepository();
    auditLedger = new InMemoryAuditLedger();

    service = new GovernanceService({ policyEngine, governanceRepository: governanceRepo, auditLedger });
  });

  it("skips evaluation if decision is NO_ACTION", async () => {
    const decision: AgentDecision = { decision: "NO_ACTION", rationale: "Nothing to do" };
    const result = await service.evaluate(decision, "case-1", "run-1");
    expect(result).toBeNull();
  });

  it("evaluates a PROPOSE_ACTION and audits ALLOW", async () => {
    await policyRepo.create({
      actionType: "CREATE_PURCHASE_ORDER",
      name: "Allow rule",
      enabled: true,
      priority: 1,
      configuration: { maxAutoOrderQuantity: 100 }
    });

    const decision: AgentDecision = {
      decision: "PROPOSE_ACTION",
      rationale: "Need stock",
      action: { type: "CREATE_PURCHASE_ORDER", productId, quantity: 50 }
    };

    const result = await service.evaluate(decision, "case-1", "run-1");

    expect(result?.decision).toBe("ALLOW");

    // Check persistence
    const evaluations = (governanceRepo as any).records;
    expect(evaluations.length).toBe(1);
    expect(evaluations[0].decision).toBe("ALLOW");

    // Check audit events
    const emitted = await auditLedger.list({ caseId: "case-1" });
    expect(emitted.length).toBe(2);
    expect(emitted[0].type).toBe("POLICY_EVALUATED");
    expect(emitted[1].type).toBe("ACTION_ALLOWED");
  });

  it("evaluates a PROPOSE_ACTION and audits REQUIRE_HUMAN_APPROVAL", async () => {
    await policyRepo.create({
      actionType: "CREATE_PURCHASE_ORDER",
      name: "Allow rule",
      enabled: true,
      priority: 1,
      configuration: { maxAutoOrderQuantity: 10 }
    });

    const decision: AgentDecision = {
      decision: "PROPOSE_ACTION",
      rationale: "Need stock",
      action: { type: "CREATE_PURCHASE_ORDER", productId, quantity: 50 }
    };

    const result = await service.evaluate(decision, "case-1", "run-1");

    expect(result?.decision).toBe("REQUIRE_HUMAN_APPROVAL");

    const evaluations = (governanceRepo as any).records;
    expect(evaluations[0].decision).toBe("REQUIRE_HUMAN_APPROVAL");

    const emitted = await auditLedger.list({ caseId: "case-1" });
    expect(emitted[1].type).toBe("HUMAN_APPROVAL_REQUIRED");
  });

  it("fails closed on missing policies", async () => {
    // We intentionally don't create any policies
    const decision: AgentDecision = {
      decision: "PROPOSE_ACTION",
      rationale: "Need stock",
      action: { type: "CREATE_PURCHASE_ORDER", productId, quantity: 50 }
    };

    const result = await service.evaluate(decision, "case-1", "run-1");

    expect(result?.decision).toBe("DENY");

    const evaluations = (governanceRepo as any).records;
    expect(evaluations[0].decision).toBe("DENY");

    const emitted = await auditLedger.list({ caseId: "case-1" });
    expect(emitted[1].type).toBe("ACTION_DENIED");
  });
});
