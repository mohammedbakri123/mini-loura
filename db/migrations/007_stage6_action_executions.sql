-- 007_stage6_action_executions.sql

-- Add parameters to governance evaluations to cryptographically/structurally bind the proposal
ALTER TABLE governance_evaluations
  ADD COLUMN parameters JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS action_executions (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id                   UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  governance_evaluation_id  UUID NOT NULL REFERENCES governance_evaluations(id) ON DELETE RESTRICT,
  action_type               TEXT NOT NULL,
  idempotency_key           TEXT NOT NULL UNIQUE,
  status                    TEXT NOT NULL,
  reference_id              TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_action_executions_case_id ON action_executions (case_id);
