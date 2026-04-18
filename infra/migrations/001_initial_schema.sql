-- Enable pgvector extension (supported natively on Neon)
CREATE EXTENSION IF NOT EXISTS vector;

-- Users
CREATE TABLE users (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email        TEXT NOT NULL UNIQUE,
  plan         TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'team')),
  byok_key_enc TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

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

-- Delivery Destinations
CREATE TABLE delivery_destinations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL CHECK (type IN ('slack', 'notion', 'todoist', 'email_digest')),
  config_enc JSONB NOT NULL,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
