import type {
  ConnectorId,
  SyncNotificationStatus,
} from "@taiwan-fin-hub/core";
import type { SyncJobRow } from "@taiwan-fin-hub/db";
import type { SyncNotificationEvent } from "../notifications/payload";

type BatchRow = {
  id: string;
  scheduled_for: string;
  expected_jobs: number;
  created_at: string;
  notification_claimed_at: string | null;
};

type BatchMemberRow = {
  job_id: string;
  connector_id: ConnectorId;
  status: SyncNotificationStatus | null;
  state: "pending" | "completed" | "skipped";
  completed_at: string | null;
  enabled: number | null;
  schedule_mode: "inherit" | "custom" | null;
  last_run_at: string | null;
  last_status: SyncNotificationStatus | null;
  updated_at: string | null;
  locked_until: string | null;
};

type BatchResultRow = {
  connector_id: ConnectorId;
  status: SyncNotificationStatus;
};

export async function ensureDefaultScheduleBatch(
  db: D1Database,
  job: SyncJobRow<ConnectorId>,
) {
  const openBatch = await findOpenDefaultScheduleBatch(db);
  if (openBatch) {
    await ensureBatchMember(db, openBatch.id, job);
    return openBatch.id;
  }

  const jobs = await db
    .prepare(
      `SELECT id, connector_id
       FROM sync_jobs
       WHERE enabled = 1
         AND schedule_mode = 'inherit'
         AND (last_status IS NULL OR last_status != 'needs_user_action')`,
    )
    .all<{ id: string; connector_id: ConnectorId }>();
  const batchId = `default:${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const inserted = await db
    .prepare(
      `INSERT OR IGNORE INTO scheduled_sync_batches (
         id, schedule_key, scheduled_for, expected_jobs,
         notification_claimed_at, created_at, updated_at
       ) VALUES (?, 'default', ?, ?, NULL, ?, ?)`,
    )
    .bind(batchId, job.next_run_at, Math.max(jobs.results.length, 1), now, now)
    .run();

  if (inserted.meta.changes !== 1) {
    const existing = await findOpenDefaultScheduleBatch(db);
    if (!existing) throw new Error("Unable to create default sync batch.");
    await ensureBatchMember(db, existing.id, job);
    return existing.id;
  }

  await db.batch(
    jobs.results.map((member) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO scheduled_sync_batch_results (
             batch_id, job_id, connector_id, status, state, completed_at
           ) VALUES (?, ?, ?, NULL, 'pending', NULL)`,
        )
        .bind(batchId, member.id, member.connector_id),
    ),
  );
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
      `UPDATE scheduled_sync_batch_results
       SET connector_id = ?, status = ?, state = 'completed', completed_at = ?
       WHERE batch_id = ? AND job_id = ? AND state = 'pending'`,
    )
    .bind(
      input.notification.connectorId,
      input.notification.status,
      now,
      input.batchId,
      input.jobId,
    )
    .run();
  await db
    .prepare("UPDATE scheduled_sync_batches SET updated_at = ? WHERE id = ?")
    .bind(now, input.batchId)
    .run();
}

export async function finalizeOpenDefaultScheduleBatch(
  db: D1Database,
) {
  const batch = await findOpenDefaultScheduleBatch(db);
  if (!batch) return null;
  return claimCompletedDefaultScheduleBatch(db, batch.id);
}

export async function claimCompletedDefaultScheduleBatch(
  db: D1Database,
  batchId: string,
): Promise<SyncNotificationEvent[] | null> {
  await reconcileDefaultScheduleBatchMembers(db, batchId);
  const batch = await db
    .prepare(
      `SELECT id, scheduled_for, expected_jobs, created_at,
              notification_claimed_at
       FROM scheduled_sync_batches
       WHERE id = ?`,
    )
    .bind(batchId)
    .first<BatchRow>();
  if (!batch || batch.notification_claimed_at) return null;

  const pending = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM scheduled_sync_batch_results
       WHERE batch_id = ? AND state = 'pending'`,
    )
    .bind(batchId)
    .first<{ count: number }>();
  if (Number(pending?.count ?? 0) > 0) return null;

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
       WHERE batch_id = ? AND state = 'completed' AND status IS NOT NULL
       ORDER BY job_id ASC`,
    )
    .bind(batchId)
    .all<BatchResultRow>();
  return results.results.map((row) => ({
    connectorId: row.connector_id,
    status: row.status,
  }));
}

async function findOpenDefaultScheduleBatch(db: D1Database) {
  return db
    .prepare(
      `SELECT id, scheduled_for, expected_jobs, created_at,
              notification_claimed_at
       FROM scheduled_sync_batches
       WHERE schedule_key = 'default' AND notification_claimed_at IS NULL
       ORDER BY created_at ASC
       LIMIT 1`,
    )
    .first<BatchRow>();
}

async function ensureBatchMember(
  db: D1Database,
  batchId: string,
  job: SyncJobRow<ConnectorId>,
) {
  const inserted = await db
    .prepare(
      `INSERT OR IGNORE INTO scheduled_sync_batch_results (
         batch_id, job_id, connector_id, status, state, completed_at
       ) VALUES (?, ?, ?, NULL, 'pending', NULL)`,
    )
    .bind(batchId, job.id, job.connector_id)
    .run();
  if (inserted.meta.changes !== 1) return;
  await db
    .prepare(
      `UPDATE scheduled_sync_batches
       SET expected_jobs = expected_jobs + 1, updated_at = ?
       WHERE id = ?`,
    )
    .bind(new Date().toISOString(), batchId)
    .run();
}

async function reconcileDefaultScheduleBatchMembers(
  db: D1Database,
  batchId: string,
) {
  const rows = await db
    .prepare(
      `SELECT
         r.job_id,
         r.connector_id,
         r.status,
         r.state,
         r.completed_at,
         j.enabled,
         j.schedule_mode,
         j.last_run_at,
         j.last_status,
         j.updated_at,
         j.locked_until
       FROM scheduled_sync_batch_results r
       LEFT JOIN sync_jobs j ON j.id = r.job_id
       WHERE r.batch_id = ? AND r.state = 'pending'`,
    )
    .bind(batchId)
    .all<BatchMemberRow>();
  const batch = await db
    .prepare("SELECT created_at FROM scheduled_sync_batches WHERE id = ?")
    .bind(batchId)
    .first<{ created_at: string }>();
  if (!batch) return;

  for (const row of rows.results) {
    const jobRemoved =
      row.enabled === null ||
      row.enabled !== 1 ||
      row.schedule_mode === null ||
      row.schedule_mode !== "inherit";
    const hasCompletedRun =
      row.last_run_at !== null &&
      row.last_run_at > batch.created_at &&
      row.last_status !== null;
    const scheduleChangedWhilePending =
      row.updated_at !== null &&
      row.updated_at > batch.created_at &&
      (row.locked_until === null ||
        new Date(row.locked_until).getTime() <= Date.now());

    if (!jobRemoved && !hasCompletedRun && !scheduleChangedWhilePending) {
      continue;
    }

    const state = jobRemoved || scheduleChangedWhilePending ? "skipped" : "completed";
    await db
      .prepare(
        `UPDATE scheduled_sync_batch_results
         SET status = ?, state = ?, completed_at = ?
         WHERE batch_id = ? AND job_id = ? AND state = 'pending'`,
      )
      .bind(
        state === "completed" ? row.last_status : null,
        state,
        new Date().toISOString(),
        batchId,
        row.job_id,
      )
      .run();
  }
}
