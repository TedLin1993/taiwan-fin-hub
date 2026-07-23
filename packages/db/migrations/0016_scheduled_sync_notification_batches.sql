CREATE TABLE IF NOT EXISTS scheduled_sync_batches (
  id TEXT PRIMARY KEY,
  schedule_key TEXT NOT NULL DEFAULT 'default' CHECK (schedule_key = 'default'),
  notification_claimed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scheduled_sync_batch_results (
  batch_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  status TEXT CHECK (status IN ('success', 'failed', 'needs_user_action')),
  completed_at TEXT,
  PRIMARY KEY (batch_id, job_id),
  FOREIGN KEY (batch_id) REFERENCES scheduled_sync_batches(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduled_sync_batches_open
  ON scheduled_sync_batches (schedule_key)
  WHERE notification_claimed_at IS NULL;
