ALTER TABLE sync_jobs
  ADD COLUMN preferred_weekday INTEGER NOT NULL DEFAULT 1
  CHECK (preferred_weekday BETWEEN 0 AND 6);

-- Preserve the weekday represented by each job's existing next run.
UPDATE sync_jobs
SET preferred_weekday = CAST(
  strftime('%w', datetime(next_run_at, '+8 hours')) AS INTEGER
);

ALTER TABLE sync_schedule_settings
  ADD COLUMN preferred_weekday INTEGER NOT NULL DEFAULT 1
  CHECK (preferred_weekday BETWEEN 0 AND 6);
