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
- PostgreSQL repositories for events, cases, audit; SQL migration runner
- 45 tests (unit + integration), TypeScript strict mode

**Interfaces/stubs only (intentionally not yet implemented):**

- Agent tool *handlers* (`getInventory`, `getProduct`, …) — declared, invocation fails loudly
- `create_purchase_order` executor — action contract (schema, idempotency, verification strategy) fixed; execution throws until Stage 6
- Verification strategies — `ImmediateVerifier` exists; no checks registered until Stage 7
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

