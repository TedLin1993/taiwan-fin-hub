CREATE TABLE IF NOT EXISTS scheduled_sync_batches (
  id TEXT PRIMARY KEY,
  scheduled_for TEXT NOT NULL,
  expected_jobs INTEGER NOT NULL CHECK (expected_jobs > 0),
  notification_claimed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scheduled_sync_batch_results (
  batch_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'needs_user_action')),
  completed_at TEXT NOT NULL,
  PRIMARY KEY (batch_id, job_id),
  FOREIGN KEY (batch_id) REFERENCES scheduled_sync_batches(id) ON DELETE CASCADE
);
