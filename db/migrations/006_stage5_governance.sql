-- 006_stage5_governance.sql

CREATE TABLE IF NOT EXISTS policies (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type   TEXT NOT NULL,
  name          TEXT NOT NULL,
  enabled       BOOLEAN NOT NULL DEFAULT true,
  priority      INTEGER NOT NULL DEFAULT 0,
  configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_policies_action_type ON policies (action_type);

CREATE TABLE IF NOT EXISTS governance_evaluations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id       UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  agent_run_id  UUID REFERENCES agent_runs(id) ON DELETE CASCADE,
  action_type   TEXT NOT NULL,
  decision      TEXT NOT NULL,
  rule_id       TEXT NOT NULL,
  reason        TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_governance_evaluations_case_id ON governance_evaluations (case_id);
