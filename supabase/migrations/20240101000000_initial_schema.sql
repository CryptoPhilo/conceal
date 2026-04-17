-- Enable pgvector extension (requires Supabase pgvector add-on)
CREATE EXTENSION IF NOT EXISTS vector;

-- Users
CREATE TABLE users (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email        TEXT NOT NULL UNIQUE,
  plan         TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'team')),
  byok_key_enc TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Row-level security (Supabase Auth integration)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_self" ON users
  USING (id = auth.uid());

-- Masking Addresses
CREATE TABLE masking_addresses (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  address    TEXT NOT NULL UNIQUE,
  label      TEXT,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX masking_addresses_address_idx ON masking_addresses(address);

ALTER TABLE masking_addresses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "masking_addresses_owner" ON masking_addresses
  USING (user_id = auth.uid());

-- Filtering Rules
CREATE TABLE filter_rules (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  priority       INT NOT NULL DEFAULT 0,
  rule_type      TEXT NOT NULL CHECK (rule_type IN ('regex', 'keyword', 'sender_domain', 'sieve_label')),
  pattern        TEXT NOT NULL,
  action         TEXT NOT NULL CHECK (action IN ('drop', 'batch', 'priority', 'reply')),
  reply_template TEXT,
  active         BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE filter_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "filter_rules_owner" ON filter_rules
  USING (user_id = auth.uid());

-- Processed Email Log (NO email content stored)
CREATE TABLE email_log (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  masking_address_id UUID REFERENCES masking_addresses(id),
  sender_hash        TEXT NOT NULL,
  subject_hash       TEXT NOT NULL,
  received_at        TIMESTAMPTZ NOT NULL,
  sieve_label        TEXT,
  priority_score     FLOAT,
  summary            TEXT,
  action_taken       TEXT NOT NULL CHECK (action_taken IN ('drop', 'delivered', 'replied', 'batched', 'bounced')),
  delivered_at       TIMESTAMPTZ
);
CREATE INDEX email_log_user_received_idx ON email_log(user_id, received_at DESC);

ALTER TABLE email_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "email_log_owner" ON email_log
  USING (user_id = auth.uid());

-- User Context Vectors (for RAG in The Brain — user-provided context only)
CREATE TABLE user_context_vectors (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content    TEXT NOT NULL,
  embedding  vector(1536),
  source     TEXT CHECK (source IN ('calendar', 'manual', 'integration')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX user_context_vectors_embedding_idx
  ON user_context_vectors USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

ALTER TABLE user_context_vectors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_context_vectors_owner" ON user_context_vectors
  USING (user_id = auth.uid());

-- Delivery Destinations
CREATE TABLE delivery_destinations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL CHECK (type IN ('slack', 'notion', 'todoist', 'email_digest')),
  config_enc JSONB NOT NULL,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE delivery_destinations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "delivery_destinations_owner" ON delivery_destinations
  USING (user_id = auth.uid());
