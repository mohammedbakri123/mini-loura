# mini-loura

A small, production-minded prototype of a **governed agentic operational system** for a simulated warehouse domain — inspired by the architecture of modern autonomous operational systems such as Loura.

> **This is not a chatbot.** The LLM here is a replaceable reasoning dependency whose proposals are always governed by deterministic policies. The AI is never the authority.

The loop:

```text
Sense → Understand → Decide → Govern → Act → Verify → Audit
```

## Architecture

Modular monolith. No microservices, Kafka, Redis, or Kubernetes.

```text
External Systems (warehouse / ERP)
       │
       ▼
Sensing / Ingestion           src/sensing/       validate → dedupe → persist → publish
       │
       ▼
Event Bus (in-memory)         src/sensing/event-bus.ts
       │
       ▼
Operational Model             src/model/         current operational reality
       │
       ▼
Case Engine (foundation)      src/runtime/       long-running operational problems
       │
       ▼
Governed Agent                src/agent/         reasons & proposes; NEVER authorizes
       │
       ▼
Policy Engine (deterministic) src/governance/    ALLOW / DENY / REQUIRE_HUMAN_APPROVAL
       │
       ▼
Action Executor               src/actions/       registered actions only
       │
       ▼
Verification                  src/verification/  checks authoritative state, never asks the LLM
       │
       ▼
Audit Ledger (append-only)    src/audit/
```

### Domain boundaries

| Boundary | Responsibility | Key files |
|---|---|---|
| Sensing | Receive + validate events | `src/sensing/` |
| Operational Model | Represent current reality | `src/model/` |
| Cases | Long-running problems, explicit state machine | `src/domain/cases/` |
| Agent | Reasoning + proposals via a `ReasoningModel` interface | `src/agent/` |
| Governance | Deterministic authorization | `src/governance/` |
| Actions | Executing approved side effects | `src/actions/` |
| Verification | Checking reality against expected results | `src/verification/` |
| Audit | Recording what happened | `src/audit/` |

### Security principle

The AI **never** gets SQL, shell, HTTP, database credentials, or unrestricted tool access. It interacts only through explicitly registered tools (`src/agent/tools.ts`), and every proposed action must pass the deterministic policy engine. The application never interprets an LLM response as authorization. No chain-of-thought is stored — only a short structured reasoning summary for audit purposes.

## Tech stack

- **Node.js + TypeScript** (ESM)
- **Fastify** — HTTP
- **PostgreSQL** via `pg` (no ORM — explicit SQL, easy to audit)
- **Zod** — runtime validation
- **Vitest** — tests
- **Docker Compose** — local PostgreSQL

## Local development

### 1. Start PostgreSQL

```bash
docker compose up -d
```

### 2. Configure environment

```bash
cp .env.example .env
# Defaults work out of the box against the docker compose database.
```

### 3. Install, migrate, run

```bash
npm install
npm run db:migrate
npm run dev          # http://localhost:3000
```

The server starts and reports `database: down` on `/health` if PostgreSQL is unreachable — the process does not crash.

### Running without an LLM API key

`LLM_API_KEY` is optional. Without it, the system uses **FakeReasoningModel**, a deterministic model that inspects the agent context and produces realistic decisions — so the entire architecture runs with zero external dependencies. A real `LLMReasoningModel` can later implement the same `ReasoningModel` interface.

### API

```bash
# Health
curl http://localhost:3000/health

# Ingest an operational event (202 accepted, 200 duplicate, 400 invalid, 503 storage down)
curl -X POST http://localhost:3000/events \
  -H 'content-type: application/json' \
  -d '{
    "type": "inventory.low",
    "eventId": "wh-evt-000123",
    "payload": {
      "productId": "9b2f1a34-1c4d-4e5f-8a9b-0c1d2e3f4a5b",
      "currentStock": 8,
      "minimumStock": 20
    }
  }'
```

Currently ingested `inventory.low` events are persisted, published, applied to the operational model, and open an `OPEN` `inventory_replenishment` case (one open case per product). The audit trail records `EVENT_RECEIVED` / `CASE_CREATED`.

Supported event types: `inventory.low`, `inventory.updated`, `purchase_order.created`, `purchase_order.received`, `purchase_order.cancelled`.

Execute + verify (Stage 7 closes the loop automatically after execution):

```bash
# Executes an authorized action, then verifies it against authoritative state.
curl -X POST http://localhost:3000/cases/<caseId>/execute \
  -H 'content-type: application/json' \
  -d '{ "governanceEvaluationId": "<id>", "parameters": { "productId": "...", "quantity": 20, "supplierId": "..." } }'
# -> { "executed": true, "executionId": "...", "verification": { "status": "VERIFIED", ... } }

# Repeat/retry verification for a specific execution.
curl -X POST http://localhost:3000/cases/<caseId>/verify \
  -H 'content-type: application/json' \
  -d '{ "actionExecutionId": "<id>" }'
```

### Tests

```bash
npm test             # unit + integration (in-memory adapters, no DB required)
npm run typecheck
npm run build
```

## Implementation status (honest)

**Fully implemented (foundation):**

- HTTP server with `/health` and `POST /events`
- Event validation (Zod), deduplication, persistence, in-memory event bus
- Case state machine with legal-transition enforcement
- Minimal event pipeline: model update + case creation on `inventory.low`
- `FakeReasoningModel` + governed agent boundary
- Deterministic policy engine (`ALLOW` / `DENY` / `REQUIRE_HUMAN_APPROVAL`)
- Append-only audit ledger (in-memory + PostgreSQL)
- PostgreSQL repositories for events, cases, audit, execution, verification; SQL migration runner
- 94 tests (unit + integration), TypeScript strict mode
- `create_purchase_order` executor with exact structural parameter binding and idempotency
- **Closed-loop verification** (Stage 7): strategies, durable records, case transitions, audit events

**Interfaces/stubs only (intentionally not yet implemented):**

- Agent tool *handlers* (`getInventory`, `getProduct`, …) — declared, invocation fails loudly
- Delayed/polling verification strategies — `ImmediateVerifier` covers the current action set; timing parameters reserved
- Operational model — in-memory only; DB persistence in Stage 2
- Case engine — only `OPEN` creation; full lifecycle in Stage 3
- `LLMReasoningModel` — interface ready, implementation deferred

## Roadmap (implementation order)

1. **Sensing & Integration** — tool handlers against real repos, more event types
2. **Operational Model** — DB-backed products/inventory/suppliers/purchase orders
3. **Operational Cases** — full case lifecycle + state transitions in the pipeline
4. **Governed Reasoning Agent** — wire tools + context into the loop; optional `LLMReasoningModel`
5. **Governance & Policy Engine** — DB-loaded policies, richer rules
6. **Action Execution** — implement `create_purchase_order` executor with idempotency
7. **Closed-Loop Verification** — immediate/delayed/polling strategies, drift detection
8. **Audit Ledger** — full event coverage, query API

### Event Identity Scope & Delivery Semantics
- **Identity:** Event identity is strictly defined by the composite tuple `(source, eventId)`. The database enforces this with a composite unique constraint to guarantee idempotent deduplication across restarts.
- **Delivery:** The internal EventBus currently implements process-local, at-most-once delivery. Subscribing components react *after* the event is durably recorded.

### Stage 2: Operational Model (Source of Truth)
- **Historical Events vs Derived State:** Events stored in `events` are the historical facts. The tables `products`, `inventory`, `suppliers`, and `purchase_orders` represent the derived current operational reality. 
- **Context Builder:** The `OperationalContextBuilder` pulls together related operational state (like a product and its open purchase orders) to give the agent accurate context without making it hallucinate reality. The LLM is NEVER the source of truth for the warehouse's current state.

### Stage 3: Operational Cases
- **Case Lifecycle:** Established a durable `CaseService` taking over from the foundation wiring to formally track problems (e.g., `inventory_replenishment`). 
- **Identity & Concurrency:** Case deduplication is mathematically guaranteed by the `cases` table's partial unique index on `(subject_type, subject_id)` where `status != 'RESOLVED'`.
- **Case Context:** The `CaseContextBuilder` packages the `CaseRecord`, associated events (`case_events`), and the authoritative `OperationalContext` for future reasoning.

### Stage 4: Governed Reasoning Agent
- **Reasoning Loop & Case Investigation:** `OperationalAgent` wraps a `ReasoningModel` dependency. Upon investigating a case, it builds context, queries the model, and validates the `AgentDecision`. 
- **Decisions without Authority:** The agent is mathematically locked into producing `PROPOSE_ACTION`, `NO_ACTION`, or `ESCALATE` along with a strictly formatted `ProposedAction`. Execution is **prohibited** inside the reasoning layer. 
- **Security:** Model runs operate entirely on pre-loaded structure. The agent executes zero side effects. The loop natively persists each decision context into `agent_runs` for accountability.

### Stage 5: Governance & Policy Engine
- **Deterministic Evaluation:** `AgentDecision` proposals are processed by a `GovernanceService` acting as a gateway before action execution.
- **Rule Engine:** Built the `DeterministicPolicyEngine` which fetches constraints dynamically from the new `policies` PostgreSQL table, filtering by priority.
- **Strict Verification:** Unregistered actions or invalid parameters correctly fail closed (`DENY`). Authorized thresholds successfully dictate `ALLOW` vs `REQUIRE_HUMAN_APPROVAL`.
- **Audit Compliance:** Emits dedicated immutable ledger entries (`POLICY_EVALUATED`, `ACTION_ALLOWED`, `ACTION_DENIED`) for robust traceability into the `governance_evaluations` history.

### Stage 6: Action Execution
- **Strict Execution Boundary:** An execution attempt requires explicit exact structural parameter binding back to a `governance_evaluations` record containing an `ALLOW` decision.
- **Fail Closed:** Unknown actions, missing governance records, parameter mismatches (tampering attempts), or `DENY`/`REQUIRE_HUMAN_APPROVAL` states result in instant rejection without execution.
- **Database-Enforced Idempotency:** The `action_executions` table tracks all side-effect executions against a deterministic `idempotency_key` via a unique constraint, protecting against network/process retries and duplicate operations.
- **Case Lifecycle:** Successfully executing an action automatically transitions the Case to `VERIFYING`, waiting for closed-loop confirmation (Stage 7).

### Stage 7: Closed-Loop Verification
- **Independence Principle:** An action is not considered successful merely because the executor says it succeeded. The `VerificationService` re-derives the *authorized* expected state from the `governance_evaluations` record bound to the execution and independently queries the authoritative repository (`purchase_orders`).
- **Strategy Abstraction:** `VerificationStrategy` implementations own the per-action rules; the service only orchestrates. `CREATE_PURCHASE_ORDER` is verified by `PurchaseOrderVerificationStrategy`: PO exists AND product/quantity/supplier match AND status is `created`. Any mismatch, missing reference, or unknown action **fails closed**.
- **Durable Records:** Every attempt is persisted in `action_verifications` (expected/actual JSONB, strategy, reason). Verification is repeatable — `FAILED` attempts accumulate, but a partial unique index guarantees at most one `VERIFIED` record per execution.
- **Action Failure ≠ Verification Failure:** Verifications only apply to `SUCCEEDED` executions; a failed *execution* throws `ActionExecutionNotSuccessfulError` and never produces a verification record.
- **Case Lifecycle:** Stage 7 owns the transition out of `VERIFYING` via the case state machine: `VERIFYING → RESOLVED` on success, `VERIFYING → FAILED` on failure, and `FAILED → RESOLVED` is supported on a later successful re-verification. No direct SQL status writes.
- **API:** `POST /cases/:id/execute` auto-verifies after execution; `POST /cases/:id/verify` (body: `actionExecutionId`) triggers or repeats verification. The audit ledger records `VERIFICATION_STARTED`, `VERIFICATION_SUCCEEDED`, `VERIFICATION_FAILED`.

