-- Add LLM 2nd-pass urgency verification column (CON-74)
ALTER TABLE email_log
  ADD COLUMN IF NOT EXISTS urgent_verified BOOLEAN;

-- Index for fast urgent-verified dashboard queries
CREATE INDEX IF NOT EXISTS email_log_urgent_verified_idx
  ON email_log(user_id, urgent_verified, received_at DESC)
  WHERE urgent_verified = true;

-- Domain trust stats: tracks per-domain urgent flagging history to detect spoofers
CREATE TABLE IF NOT EXISTS domain_trust_stats (
  domain           TEXT PRIMARY KEY,
  total_seen       INTEGER NOT NULL DEFAULT 0,
  urgent_flagged   INTEGER NOT NULL DEFAULT 0,
  urgent_verified  INTEGER NOT NULL DEFAULT 0,
  last_updated     TIMESTAMPTZ NOT NULL DEFAULT now()
);
