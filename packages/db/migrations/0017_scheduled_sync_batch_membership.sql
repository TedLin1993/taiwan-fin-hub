-- Rebuild the result table for environments that applied the first version of
-- migration 0016 before pending/skipped batch members were introduced.
CREATE TABLE IF NOT EXISTS scheduled_sync_batches_v2 (
  id TEXT PRIMARY KEY,
  schedule_key TEXT NOT NULL DEFAULT 'default',
  scheduled_for TEXT NOT NULL,
  expected_jobs INTEGER NOT NULL CHECK (expected_jobs > 0),
  notification_claimed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO scheduled_sync_batches_v2 (
  id, schedule_key, scheduled_for, expected_jobs,
  notification_claimed_at, created_at, updated_at
)
SELECT
  id, 'default', scheduled_for, expected_jobs,
  notification_claimed_at, created_at, updated_at
FROM scheduled_sync_batches;

CREATE TABLE scheduled_sync_batch_results_v2 (
  batch_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  status TEXT CHECK (status IN ('success', 'failed', 'needs_user_action')),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'completed', 'skipped')),
  completed_at TEXT,
  PRIMARY KEY (batch_id, job_id),
  FOREIGN KEY (batch_id) REFERENCES scheduled_sync_batches_v2(id) ON DELETE CASCADE
);

INSERT INTO scheduled_sync_batch_results_v2 (
  batch_id, job_id, connector_id, status, state, completed_at
)
SELECT batch_id, job_id, connector_id, status, 'completed', completed_at
FROM scheduled_sync_batch_results;

DROP TABLE scheduled_sync_batch_results;
DROP TABLE scheduled_sync_batches;
ALTER TABLE scheduled_sync_batches_v2 RENAME TO scheduled_sync_batches;
ALTER TABLE scheduled_sync_batch_results_v2 RENAME TO scheduled_sync_batch_results;

-- The first implementation did not enforce one open default batch. Close
-- older open rows before adding the unique partial index; the newest row is
-- kept as the active batch for reconciliation.
UPDATE scheduled_sync_batches
SET notification_claimed_at = COALESCE(updated_at, created_at)
WHERE schedule_key = 'default'
  AND notification_claimed_at IS NULL
  AND id NOT IN (
    SELECT id
    FROM scheduled_sync_batches
    WHERE schedule_key = 'default'
      AND notification_claimed_at IS NULL
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduled_sync_batches_open
  ON scheduled_sync_batches (schedule_key)
  WHERE notification_claimed_at IS NULL;
