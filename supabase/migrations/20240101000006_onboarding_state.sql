-- Onboarding progress tracking
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS onboarding_step        INT         NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;

-- Update delivery_destinations type constraint to include web_dashboard
ALTER TABLE delivery_destinations
  DROP CONSTRAINT IF EXISTS delivery_destinations_type_check;
ALTER TABLE delivery_destinations
  ADD CONSTRAINT delivery_destinations_type_check
    CHECK (type IN ('slack', 'notion', 'todoist', 'email_digest', 'email', 'web_dashboard'));

-- anycode.com alias addresses (provisioned during onboarding Step 2)
CREATE TABLE IF NOT EXISTS anycode_addresses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  local_part  TEXT NOT NULL UNIQUE,
  address     TEXT GENERATED ALWAYS AS (local_part || '@anycode.com') STORED,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS anycode_addresses_user_idx ON anycode_addresses(user_id);
