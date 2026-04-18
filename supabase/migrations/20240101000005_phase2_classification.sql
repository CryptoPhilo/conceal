-- Phase 2: informational classification + work type multi-label columns
ALTER TABLE email_log
  ADD COLUMN IF NOT EXISTS informational_category TEXT
    CHECK (informational_category IN ('informational', 'action_required', 'uncertain')),
  ADD COLUMN IF NOT EXISTS work_types TEXT[] NOT NULL DEFAULT '{}';

-- Index for dashboard filtering by informational_category and work_types
CREATE INDEX IF NOT EXISTS email_log_informational_category_idx
  ON email_log (user_id, informational_category);

CREATE INDEX IF NOT EXISTS email_log_work_types_idx
  ON email_log USING gin (work_types);
