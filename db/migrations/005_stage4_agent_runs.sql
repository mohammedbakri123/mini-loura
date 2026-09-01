-- 005_stage4_agent_runs.sql

CREATE TABLE IF NOT EXISTS agent_runs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id    UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  model      TEXT NOT NULL,
  decision   TEXT NOT NULL,
  rationale  TEXT NOT NULL,
  action_payload JSONB,
  confidence NUMERIC(4,3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_agent_runs_case_id ON agent_runs (case_id);
