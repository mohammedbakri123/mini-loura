-- 009_fix_policies.sql
-- Fix the schema of the policies table to match Stage 5 requirements.
-- 001_init.sql created it with an old definition, and 006_stage5_governance.sql
-- used IF NOT EXISTS, so existing databases might still have the old schema.

ALTER TABLE policies ADD COLUMN IF NOT EXISTS action_type TEXT;
ALTER TABLE policies ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 0;
ALTER TABLE policies ADD COLUMN IF NOT EXISTS configuration JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE policies ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Migrate data if any old data exists
UPDATE policies SET action_type = action WHERE action_type IS NULL AND action IS NOT NULL;
UPDATE policies SET configuration = config WHERE configuration = '{}'::jsonb AND config IS NOT NULL;

-- Remove old columns safely
ALTER TABLE policies DROP COLUMN IF EXISTS action;
ALTER TABLE policies DROP COLUMN IF EXISTS effect;
ALTER TABLE policies DROP COLUMN IF EXISTS config;

-- Drop the old unique constraint on name if it exists.
ALTER TABLE policies DROP CONSTRAINT IF EXISTS policies_name_key;

-- Now that action_type is populated, we can make it NOT NULL and create the index
ALTER TABLE policies ALTER COLUMN action_type SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_policies_action_type ON policies (action_type);
