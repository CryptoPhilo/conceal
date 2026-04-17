-- Connected email accounts (OAuth + IMAP)
CREATE TABLE connected_accounts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider          TEXT NOT NULL CHECK (provider IN ('gmail', 'outlook', 'yahoo', 'imap')),
  email_address     TEXT NOT NULL,
  -- Encrypted OAuth tokens (AES-256-GCM via app layer)
  access_token_enc  TEXT,
  refresh_token_enc TEXT,
  token_expires_at  TIMESTAMPTZ,
  -- IMAP/SMTP config (for non-OAuth providers)
  imap_host         TEXT,
  imap_port         INT,
  imap_tls          BOOLEAN NOT NULL DEFAULT true,
  smtp_host         TEXT,
  smtp_port         INT,
  -- Account status
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'error')),
  last_synced_at    TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, email_address)
);
CREATE INDEX connected_accounts_user_idx ON connected_accounts(user_id);

ALTER TABLE connected_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "connected_accounts_owner" ON connected_accounts
  USING (user_id = auth.uid());

-- Email analysis batch jobs: track which accounts have been analyzed
CREATE TABLE email_analysis_jobs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connected_account_id UUID NOT NULL REFERENCES connected_accounts(id) ON DELETE CASCADE,
  status               TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'done', 'error')),
  emails_scanned       INT NOT NULL DEFAULT 0,
  subscriptions_found  INT NOT NULL DEFAULT 0,
  newsletters_found    INT NOT NULL DEFAULT 0,
  error_message        TEXT,
  started_at           TIMESTAMPTZ,
  completed_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX email_analysis_jobs_account_idx ON email_analysis_jobs(connected_account_id);

ALTER TABLE email_analysis_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "email_analysis_jobs_owner" ON email_analysis_jobs
  USING (user_id = auth.uid());
