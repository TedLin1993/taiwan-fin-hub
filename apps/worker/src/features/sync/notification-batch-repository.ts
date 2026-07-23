import type { ConnectorId } from "@taiwan-fin-hub/core";
import type { SyncJobRow } from "@taiwan-fin-hub/db";
import type { SyncNotificationEvent } from "../notifications/payload";

type BatchRow = {
  expected_jobs: number;
  notification_claimed_at: string | null;
};

type BatchResultRow = {
  connector_id: ConnectorId;
  status: SyncNotificationEvent["status"];
};

export async function ensureDefaultScheduleBatch(
  db: D1Database,
  job: SyncJobRow<ConnectorId>,
) {
  const batchId = `default:${job.next_run_at}`;
  const existing = await db
    .prepare("SELECT id FROM scheduled_sync_batches WHERE id = ?")
    .bind(batchId)
    .first<{ id: string }>();
  if (existing) return batchId;

  const count = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM sync_jobs
       WHERE enabled = 1
         AND schedule_mode = 'inherit'
         AND next_run_at = ?
         AND (last_status IS NULL OR last_status != 'needs_user_action')`,
    )
    .bind(job.next_run_at)
    .first<{ count: number }>();
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT OR IGNORE INTO scheduled_sync_batches (
         id, scheduled_for, expected_jobs, notification_claimed_at,
         created_at, updated_at
       ) VALUES (?, ?, ?, NULL, ?, ?)`,
    )
    .bind(batchId, job.next_run_at, Number(count?.count ?? 1), now, now)
    .run();
  return batchId;
}

export async function recordDefaultScheduleBatchResult(
  db: D1Database,
  input: {
    batchId: string;
    jobId: string;
    notification: SyncNotificationEvent;
  },
) {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO scheduled_sync_batch_results (
         batch_id, job_id, connector_id, status, completed_at
       ) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(batch_id, job_id) DO UPDATE SET
         connector_id = excluded.connector_id,
         status = excluded.status,
         completed_at = excluded.completed_at`,
    )
    .bind(
      input.batchId,
      input.jobId,
      input.notification.connectorId,
      input.notification.status,
      now,
    )
    .run();
  await db
    .prepare("UPDATE scheduled_sync_batches SET updated_at = ? WHERE id = ?")
    .bind(now, input.batchId)
    .run();
}

export async function claimCompletedDefaultScheduleBatch(
  db: D1Database,
  batchId: string,
): Promise<SyncNotificationEvent[] | null> {
  const batch = await db
    .prepare(
      `SELECT expected_jobs, notification_claimed_at
       FROM scheduled_sync_batches
       WHERE id = ?`,
    )
    .bind(batchId)
    .first<BatchRow>();
  if (!batch || batch.notification_claimed_at) return null;

  const completed = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM scheduled_sync_batch_results
       WHERE batch_id = ?`,
    )
    .bind(batchId)
    .first<{ count: number }>();
  if (Number(completed?.count ?? 0) < batch.expected_jobs) return null;

  const now = new Date().toISOString();
  const claim = await db
    .prepare(
      `UPDATE scheduled_sync_batches
       SET notification_claimed_at = ?, updated_at = ?
       WHERE id = ? AND notification_claimed_at IS NULL`,
    )
    .bind(now, now, batchId)
    .run();
  if (claim.meta.changes !== 1) return null;

  const results = await db
    .prepare(
      `SELECT connector_id, status
       FROM scheduled_sync_batch_results
       WHERE batch_id = ?
       ORDER BY job_id ASC`,
    )
    .bind(batchId)
    .all<BatchResultRow>();
  return results.results.map((row) => ({
    connectorId: row.connector_id,
    status: row.status,
  }));
}
