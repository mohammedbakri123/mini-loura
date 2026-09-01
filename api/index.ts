import { buildApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";
import { createRuntime } from "../src/composition.js";

const env = loadEnv();
const runtime = createRuntime(env);
const app = buildApp({
  ingestion: runtime.ingestion,
  executionService: runtime.executionService,
  verificationService: runtime.verificationService,
  databaseHealthCheck: runtime.databaseHealthCheck,
  caseRepository: runtime.caseRepository,
  eventRepository: runtime.eventRepository,
  auditLedger: runtime.auditLedger,
  governanceRepository: runtime.governanceRepository,
  governanceService: runtime.governanceService,
  policyRepository: runtime.policyRepository,
  productRepository: runtime.productRepository,
  inventoryRepository: runtime.inventoryRepository,
  supplierRepository: runtime.supplierRepository,
  agentRunRepository: runtime.agentRunRepository,
  agent: runtime.agent,
});

export default async function handler(req: any, res: any) {
  await app.ready();
  app.server.emit('request', req, res);
}
