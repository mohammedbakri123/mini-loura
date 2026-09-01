-- 001_init.sql — initial schema for mini-loura.
-- UUID primary keys, TIMESTAMPTZ everywhere, FKs where appropriate.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS products (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku         TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS suppliers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inventory (
  product_id    UUID PRIMARY KEY REFERENCES products(id),
  current_stock INTEGER NOT NULL DEFAULT 0 CHECK (current_stock >= 0),
  minimum_stock INTEGER NOT NULL DEFAULT 0 CHECK (minimum_stock >= 0),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      UUID NOT NULL REFERENCES products(id),
  supplier_id     UUID REFERENCES suppliers(id),
  quantity        INTEGER NOT NULL CHECK (quantity > 0),
  status          TEXT NOT NULL
                  CHECK (status IN ('draft', 'created', 'confirmed', 'received', 'cancelled')),
  idempotency_key TEXT UNIQUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id TEXT NOT NULL UNIQUE,
  type        TEXT NOT NULL,
  payload     JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_type ON events (type);
CREATE INDEX IF NOT EXISTS idx_events_received_at ON events (received_at DESC);

CREATE TABLE IF NOT EXISTS cases (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type        TEXT NOT NULL,
  status      TEXT NOT NULL,
  title       TEXT NOT NULL,
  subject_id  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_cases_subject_status ON cases (subject_id, status);

CREATE TABLE IF NOT EXISTS case_status_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id     UUID NOT NULL REFERENCES cases(id),
  from_status TEXT,
  to_status   TEXT NOT NULL,
  reason      TEXT,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS policies (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL UNIQUE,
  action     TEXT NOT NULL,
  effect     TEXT NOT NULL CHECK (effect IN ('ALLOW', 'DENY', 'REQUIRE_HUMAN_APPROVAL')),
  config     JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled    BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type        TEXT NOT NULL,
  actor       TEXT NOT NULL,
  case_id     UUID REFERENCES cases(id),
  event_id    UUID REFERENCES events(id),
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_case_id ON audit_logs (case_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_type ON audit_logs (type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_recorded_at ON audit_logs (recorded_at DESC);
