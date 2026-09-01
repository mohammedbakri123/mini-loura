-- 004_stage3_cases.sql

-- Modify existing cases table
ALTER TABLE cases ADD COLUMN subject_type TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE cases ADD COLUMN priority TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL'));

-- Create concurrent safe partial unique index for active cases per subject
-- This enforces that you cannot have two active cases for the same subject simultaneously.
CREATE UNIQUE INDEX idx_cases_active_subject ON cases (subject_type, subject_id) WHERE status != 'RESOLVED';

-- Create case_events association table
CREATE TABLE IF NOT EXISTS case_events (
  case_id    UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  event_id   UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (case_id, event_id)
);
