-- Phase 3: recipient classification columns
ALTER TABLE email_log
  ADD COLUMN IF NOT EXISTS recipient_type       TEXT CHECK (recipient_type IN ('direct_to', 'cc', 'team_group', 'unknown')),
  ADD COLUMN IF NOT EXISTS recipient_confidence FLOAT;
