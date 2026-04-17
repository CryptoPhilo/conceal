-- Covering index to speed up email_log lookups by (user_id, sender_hash, subject_hash)
-- ordered by received_at DESC for efficient time-based queries.
CREATE INDEX IF NOT EXISTS email_log_lookup_idx
  ON email_log(user_id, sender_hash, subject_hash, received_at DESC);
