import { loadEnv, type Env } from "./config/env.js";
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
import type { ReasoningModel } from "./agent/reasoning-model.js";
import { ImmediateVerifier } from "./verification/verifier.js";
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
  reasoningModel: ReasoningModel;
  agent: OperationalAgent;
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

  const reasoningModel = new FakeReasoningModel();
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
    policyEngine,
    governanceService,
    executionService,
    reasoningModel,
    agent,
    databaseHealthCheck: () => checkDatabaseHealth(db),
    close: () => db.close(),
  };
}
