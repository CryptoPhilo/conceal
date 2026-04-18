-- Add columns needed for post-classification grouping (CON-68)
ALTER TABLE email_log
  ADD COLUMN IF NOT EXISTS work_types         TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS informational_category TEXT,
  ADD COLUMN IF NOT EXISTS sender_domain      TEXT;

-- GIN index for work_types array queries (GROUP BY unnest / ANY operator)
CREATE INDEX IF NOT EXISTS email_log_work_types_idx
  ON email_log USING gin(work_types);

-- Composite index for sender-domain grouping per user
CREATE INDEX IF NOT EXISTS email_log_sender_domain_idx
  ON email_log(user_id, sender_domain);

-- Covering index for sieve_label lookups (urgent group)
CREATE INDEX IF NOT EXISTS email_log_sieve_label_idx
  ON email_log(user_id, sieve_label, received_at DESC);
