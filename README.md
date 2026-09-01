# Mini-Loura

A governed AI operations system where AI can reason about
operational problems and propose actions, while deterministic
policy controls authorization and an independent verification
loop confirms the resulting state.

## Live Demo

[Live Demo URL to be deployed on Vercel soon]

## What it demonstrates

```text
Event
→ Operational Model
→ Case
→ AI Reasoning
→ Governance
→ Action
→ Verification
→ Audit
```

## Architecture

Mini-Loura is built as a modular monolith demonstrating an operational AI loop.

1. **Sensing Layer (Events & Pipeline):** Ingests operational events (e.g. `inventory.low`) and builds a real-time operational context.
2. **Case Engine:** Tracks operational problems and attaches events to cases.
3. **AI Reasoning:** The AI Agent is passed the context and proposes a structured operational action.
4. **Governance Layer:** Deterministic policies evaluate the AI's proposal based strictly on the parameters.
5. **Execution Layer:** If allowed by Governance, the system executes the action idempotently.
6. **Verification Layer:** A closed-loop check ensures the authoritative system state actually reflects the expected side-effect.
7. **Audit:** Every step of the way is recorded in an append-only ledger for observability.

## Security model

* **AI is not authority:** The AI produces a *proposal*, not a side-effect.
* **Registered tools only:** The system maps the proposal to predefined schemas.
* **Deterministic governance:** Configuration sets hard boundaries (e.g., maximum auto-approve quantities).
* **Exact structural parameter binding:** The parameters evaluated by governance are structurally bound to the executor; they cannot be tampered with between evaluation and execution.
* **Idempotent action execution:** Double execution is mitigated durably.
* **Independent verification:** We don't ask the AI if it succeeded. We verify the actual underlying state.
* **Audit trail:** An append-only log of every state transition.

## Demo scenarios

1. **Happy path:** Simulates a standard low inventory event. The AI proposes a purchase order which is within the automatic approval limit. Governance allows it, the action executes, and is independently verified.
2. **Governance protection:** Simulates a massive inventory deficit. The AI proposes a very large purchase order. Deterministic governance blocks it because it exceeds the max auto-order policy.
3. **Parameter tampering protection:** Demonstrates exact structural parameter binding. The AI proposes a valid action and Governance allows it. Before execution, the quantity is tampered with. Execution is rejected.

---

### Running Locally

```bash
npm install
npm run dev
```

Then visit `http://localhost:5173` for the UI, or `http://localhost:3000` for the backend.
