-- 008_stage7_action_verifications.sql
-- Durable verification records: what was expected, what was observed, and why.

CREATE TABLE IF NOT EXISTS action_verifications (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id              UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  action_execution_id  UUID NOT NULL REFERENCES action_executions(id) ON DELETE CASCADE,
  status               TEXT NOT NULL CHECK (status IN ('VERIFIED', 'FAILED')),
  strategy             TEXT NOT NULL,
  expected             JSONB NOT NULL DEFAULT '{}'::jsonb,
  actual               JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason               TEXT NOT NULL DEFAULT '',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_action_verifications_case_id ON action_verifications (case_id);
CREATE INDEX idx_action_verifications_execution_id ON action_verifications (action_execution_id);

-- Verification is repeatable (FAILED attempts may accumulate), but a single
-- execution must never end up with more than one VERIFIED record.
CREATE UNIQUE INDEX idx_action_verifications_one_verified_per_execution
  ON action_verifications (action_execution_id)
  WHERE status = 'VERIFIED';
