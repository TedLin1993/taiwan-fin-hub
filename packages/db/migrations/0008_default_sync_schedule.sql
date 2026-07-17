ALTER TABLE sync_jobs
  ADD COLUMN schedule_mode TEXT NOT NULL DEFAULT 'inherit'
  CHECK (schedule_mode IN ('inherit', 'custom'));

ALTER TABLE sync_jobs
  ADD COLUMN preferred_time TEXT NOT NULL DEFAULT '06:00';

-- Preserve every existing user's current schedule during the upgrade.
UPDATE sync_jobs
SET schedule_mode = 'custom',
    preferred_time = strftime('%H:%M', datetime(next_run_at, '+8 hours'));

CREATE TABLE IF NOT EXISTS sync_schedule_settings (
  id TEXT PRIMARY KEY CHECK (id = 'default'),
  interval_minutes INTEGER NOT NULL,
  preferred_time TEXT NOT NULL,
  timezone TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO sync_schedule_settings (
  id,
  interval_minutes,
  preferred_time,
  timezone,
  updated_at
) VALUES (
  'default',
  1440,
  '06:00',
  'Asia/Taipei',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);
