import { loadEnv, reasoningModelKind, type Env } from "./config/env.js";
import { PgDatabase, checkDatabaseHealth, type Database } from "./db/client.js";
import { PostgresEventRepository } from "./db/repositories/event-repository.js";
import { PostgresCaseRepository } from "./db/repositories/case-repository.js";
import { PostgresAuditLedger } from "./db/repositories/audit-repository.js";
import { EventValidator } from "./sensing/event-validator.js";
import { InMemoryEventBus } from "./sensing/event-bus.js";
import { EventIngestionService } from "./sensing/event-ingestion.js";
import { RepositoryOperationalModel } from "./model/operational-model.js";
import { PostgresProductRepository } from "./db/repositories/product-repository.js";
import { PostgresInventoryRepository } from "./db/repositories/inventory-repository.js";
import { CaseService } from "./domain/cases/case-service.js";
import { PostgresSupplierRepository } from "./db/repositories/supplier-repository.js";
import { PostgresPurchaseOrderRepository } from "./db/repositories/purchase-order-repository.js";
import { EventPipeline } from "./runtime/event-pipeline.js";
import { createDefaultToolRegistry } from "./agent/tools.js";
import { createPurchaseOrderAction } from "./actions/purchase-order-action.js";
import { ActionRegistry } from "./governance/action-registry.js";
import { FakeReasoningModel } from "./agent/models/fake-reasoning-model.js";
import { GeminiReasoningModel } from "./agent/models/gemini-reasoning-model.js";
import type { ReasoningModel } from "./agent/reasoning-model.js";
import { ImmediateVerifier } from "./verification/verifier.js";
import { PostgresVerificationRepository } from "./db/repositories/verification-repository.js";
import { PurchaseOrderVerificationStrategy } from "./verification/strategies/purchase-order-verification-strategy.js";
import { VerificationService } from "./verification/verification-service.js";
import { DeterministicPolicyEngine } from "./governance/policy-engine.js";
import { PostgresPolicyRepository } from "./db/repositories/policy-repository.js";
import { PostgresGovernanceRepository } from "./db/repositories/governance-repository.js";
import { GovernanceService } from "./governance/governance-service.js";
import type { EventBus } from "./sensing/event-bus.js";
import { OperationalAgent } from "./agent/agent.js";
import { PostgresAgentRunRepository } from "./db/repositories/agent-run-repository.js";
import { CaseContextBuilder, OperationalContextBuilder } from "./model/context-builder.js";
import { PostgresActionExecutionRepository } from "./db/repositories/action-execution-repository.js";
import { PurchaseOrderExecutor } from "./actions/purchase-order-action.js";
import { ExecutionService } from "./actions/execution-service.js";

/**
 * Composition root for the PostgreSQL-backed application.
 *
 * The dependency graph is explicit: sensing -> bus -> pipeline (model, cases,
 * audit). Agent, governance, actions, and verification are instantiated with
 * their default implementations here; they get *wired into the loop* in their
 * respective implementation stages.
 */
export interface AppRuntime {
  env: Env;
  db: Database;
  bus: EventBus;
  ingestion: EventIngestionService;
  pipeline: EventPipeline;
  toolRegistry: ReturnType<typeof createDefaultToolRegistry>;
  actionRegistry: ActionRegistry;
  verifier: ImmediateVerifier;
  policyEngine: DeterministicPolicyEngine;
  governanceService: GovernanceService;
  executionService: import("./actions/execution-service.js").ExecutionService;
  verificationService: VerificationService;
  reasoningModel: ReasoningModel;
  agent: OperationalAgent;
  caseRepository: import("./db/repositories/case-repository.js").PostgresCaseRepository;
  eventRepository: import("./db/repositories/event-repository.js").PostgresEventRepository;
  auditLedger: import("./domain/audit/audit-ledger.js").AuditLedger;
  governanceRepository: import("./db/repositories/governance-repository.js").PostgresGovernanceRepository;
  policyRepository: import("./db/repositories/policy-repository.js").PostgresPolicyRepository;
  productRepository: import("./db/repositories/product-repository.js").PostgresProductRepository;
  inventoryRepository: import("./db/repositories/inventory-repository.js").PostgresInventoryRepository;
  supplierRepository: import("./db/repositories/supplier-repository.js").PostgresSupplierRepository;
  agentRunRepository: import("./db/repositories/agent-run-repository.js").PostgresAgentRunRepository;
  databaseHealthCheck: () => Promise<boolean>;
  close(): Promise<void>;
}

export function createRuntime(env: Env = loadEnv()): AppRuntime {
  const db = new PgDatabase(env.DATABASE_URL);

  const eventRepository = new PostgresEventRepository(db);
  const caseRepository = new PostgresCaseRepository(db);
  const auditLedger = new PostgresAuditLedger(db);
  
  const productRepository = new PostgresProductRepository(db);
  const inventoryRepository = new PostgresInventoryRepository(db);
  const supplierRepository = new PostgresSupplierRepository(db);
  const purchaseOrderRepository = new PostgresPurchaseOrderRepository(db);

  const operationalModel = new RepositoryOperationalModel({
    productRepository,
    inventoryRepository,
    supplierRepository,
    purchaseOrderRepository,
  });

  const bus = new InMemoryEventBus();

  const caseService = new CaseService({
    caseRepository,
    auditLedger,
  });

  const pipeline = new EventPipeline({ operationalModel, caseService });
  bus.subscribe(async (event) => {
    await pipeline.handle(event);
  });

  const ingestion = new EventIngestionService({
    validator: new EventValidator(),
    eventRepository,
    bus,
    auditLedger,
  });

  // Boundaries that exist now; wired into the closed loop in stages 4-7.
  const toolRegistry = createDefaultToolRegistry();
  const actionRegistry = new ActionRegistry();
  
  const executionRepository = new PostgresActionExecutionRepository(db);

  actionRegistry.register(createPurchaseOrderAction({
    executor: new PurchaseOrderExecutor(purchaseOrderRepository, supplierRepository)
  }));
  
  const verifier = new ImmediateVerifier();

  // Stage 7: closed-loop verification against authoritative state.
  const verificationRepository = new PostgresVerificationRepository(db);
  verifier.registerStrategy(
    "CREATE_PURCHASE_ORDER",
    new PurchaseOrderVerificationStrategy(purchaseOrderRepository),
  );

  const policyRepository = new PostgresPolicyRepository(db);
  const governanceRepository = new PostgresGovernanceRepository(db);

  const policyEngine = new DeterministicPolicyEngine({
    actionRegistry,
    policyRepository,
  });

  const governanceService = new GovernanceService({
    policyEngine,
    governanceRepository,
    auditLedger,
  });

  const executionService = new ExecutionService({
    actionRegistry,
    governanceRepo: governanceRepository,
    executionRepo: executionRepository,
    auditLedger,
    caseRepo: caseRepository,
  });

  const verificationService = new VerificationService({
    verifier,
    verificationRepo: verificationRepository,
    executionRepo: executionRepository,
    governanceRepo: governanceRepository,
    caseRepo: caseRepository,
    caseService,
    auditLedger,
  });

  const kind = reasoningModelKind(env);
  const reasoningModel = kind === "llm" && env.LLM_API_KEY
    ? new GeminiReasoningModel(env.LLM_API_KEY, env.LLM_MODEL || "gemini-2.5-flash")
    : new FakeReasoningModel();
  const agentRunRepository = new PostgresAgentRunRepository(db);

  const operationalContextBuilder = new OperationalContextBuilder({
    productRepository,
    inventoryRepository,
    supplierRepository,
    purchaseOrderRepository,
  });

  const caseContextBuilder = new CaseContextBuilder({
    caseRepository,
    operationalContextBuilder,
  });

  const agent = new OperationalAgent({
    reasoningModel,
    caseContextBuilder,
    toolRegistry,
    agentRunRepository,
    modelName: "fake-reasoning-model-v1",
  });

  return {
    env,
    db,
    bus,
    ingestion,
    pipeline,
    toolRegistry,
    actionRegistry,
    verifier,
    verificationService,
    policyEngine,
    governanceService,
    executionService,
    reasoningModel,
    agent,
    caseRepository,
    eventRepository,
    auditLedger,
    governanceRepository,
    policyRepository,
    productRepository,
    inventoryRepository,
    supplierRepository,
    agentRunRepository,
    databaseHealthCheck: () => checkDatabaseHealth(db),
    close: () => db.close(),
  };
}
