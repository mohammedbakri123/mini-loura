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
import { PostgresSupplierRepository } from "./db/repositories/supplier-repository.js";
import { PostgresPurchaseOrderRepository } from "./db/repositories/purchase-order-repository.js";
import { EventPipeline } from "./runtime/event-pipeline.js";
import { createDefaultToolRegistry } from "./agent/tools.js";
import { createPurchaseOrderAction } from "./actions/purchase-order-action.js";
import { ActionRegistry } from "./governance/action-registry.js";
import { ImmediateVerifier } from "./verification/verifier.js";
import { DeterministicPolicyEngine } from "./governance/policy-engine.js";
import { FakeReasoningModel } from "./agent/models/fake-reasoning-model.js";
import type { ReasoningModel } from "./agent/reasoning-model.js";
import type { EventBus } from "./sensing/event-bus.js";

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
  reasoningModel: ReasoningModel;
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

  const pipeline = new EventPipeline({ operationalModel, caseRepository, auditLedger });
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
  actionRegistry.register(createPurchaseOrderAction());
  const verifier = new ImmediateVerifier();
  const policyEngine = new DeterministicPolicyEngine();
  const reasoningModel = new FakeReasoningModel();

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
    reasoningModel,
    databaseHealthCheck: () => checkDatabaseHealth(db),
    close: () => db.close(),
  };
}
