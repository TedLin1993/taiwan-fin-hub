export type SyncTrigger = "manual" | "scheduled";
export type SyncStatus = "success" | "failed" | "needs_user_action";

export interface SyncJobRow<TConnectorId extends string = string> {
  id: string;
  connector_id: TConnectorId;
  scope: string;
  enabled: number;
  interval_minutes: number;
  next_run_at: string;
  locked_until: string | null;
  locked_by: string | null;
  lock_trigger: SyncTrigger | null;
  lock_scope: string | null;
  last_run_at: string | null;
  last_success_at: string | null;
  last_status: SyncStatus | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export async function findNextDueSyncJob<TConnectorId extends string>(db: D1Database, now = new Date()) {
  return await db.prepare(
    `SELECT *
     FROM sync_jobs
     WHERE enabled = 1
       AND next_run_at <= ?
       AND (locked_until IS NULL OR locked_until < ?)
     ORDER BY next_run_at ASC, id ASC
     LIMIT 1`
  ).bind(now.toISOString(), now.toISOString()).first<SyncJobRow<TConnectorId>>() ?? null;
}

export async function acquireSyncJobLock(
  db: D1Database,
  input: {
    lockRowId: string;
    scope: string;
    trigger: SyncTrigger;
    runId: string;
    leaseMs: number;
  }
) {
  const now = new Date();
  const lockedUntil = new Date(now.getTime() + input.leaseMs).toISOString();
  const result = await db.prepare(
    `UPDATE sync_jobs
     SET locked_by = ?,
         locked_until = ?,
         lock_trigger = ?,
         lock_scope = ?,
         updated_at = ?
     WHERE id = ?
       AND (locked_until IS NULL OR locked_until < ?)`
  ).bind(
    input.runId,
    lockedUntil,
    input.trigger,
    input.scope,
    now.toISOString(),
    input.lockRowId,
    now.toISOString()
  ).run();
  return result.meta.changes === 1;
}

export async function renewSyncJobLock(
  db: D1Database,
  input: { lockRowId: string; runId: string; leaseMs: number }
) {
  const now = new Date();
  const result = await db.prepare(
    `UPDATE sync_jobs
     SET locked_until = ?, updated_at = ?
     WHERE id = ? AND locked_by = ?`
  ).bind(
    new Date(now.getTime() + input.leaseMs).toISOString(),
    now.toISOString(),
    input.lockRowId,
    input.runId
  ).run();
  return result.meta.changes === 1;
}

export async function releaseSyncJobLock(db: D1Database, lockRowId: string, runId: string) {
  await db.prepare(
    `UPDATE sync_jobs
     SET locked_by = NULL,
         locked_until = NULL,
         lock_trigger = NULL,
         lock_scope = NULL,
         updated_at = ?
     WHERE id = ? AND locked_by = ?`
  ).bind(new Date().toISOString(), lockRowId, runId).run();
}

export async function completeSyncJob(db: D1Database, job: SyncJobRow) {
  const now = new Date();
  const nextRunAt = new Date(now.getTime() + job.interval_minutes * 60_000).toISOString();
  await db.prepare(
    `UPDATE sync_jobs
     SET last_status = 'success',
         last_error = NULL,
         last_run_at = ?,
         last_success_at = ?,
         next_run_at = ?,
         updated_at = ?
     WHERE id = ?`
  ).bind(now.toISOString(), now.toISOString(), nextRunAt, now.toISOString(), job.id).run();
}

export async function failSyncJob(
  db: D1Database,
  job: SyncJobRow,
  input: { status: SyncStatus; errorMessage: string }
) {
  const now = new Date();
  const enabled = input.status === "needs_user_action" ? 0 : 1;
  const nextRunAt = input.status === "failed"
    ? new Date(now.getTime() + job.interval_minutes * 60_000).toISOString()
    : job.next_run_at;
  await db.prepare(
    `UPDATE sync_jobs
     SET last_status = ?,
         last_error = ?,
         last_run_at = ?,
         next_run_at = ?,
         enabled = ?,
         updated_at = ?
     WHERE id = ?`
  ).bind(
    input.status,
    input.errorMessage,
    now.toISOString(),
    nextRunAt,
    enabled,
    now.toISOString(),
    job.id
  ).run();
}

export async function markManualSyncSuccess(
  db: D1Database,
  connectorId: string,
  scope: string
) {
  const jobId = `${connectorId}:${scope}`;
  const job = await db.prepare("SELECT * FROM sync_jobs WHERE id = ?")
    .bind(jobId)
    .first<SyncJobRow>();
  if (!job) return;

  const now = new Date();
  const nextRunAt = new Date(now.getTime() + job.interval_minutes * 60_000).toISOString();
  await db.prepare(
    `UPDATE sync_jobs
     SET last_status = 'success',
         last_error = NULL,
         last_run_at = ?,
         last_success_at = ?,
         next_run_at = ?,
         updated_at = ?
     WHERE id = ?`
  ).bind(now.toISOString(), now.toISOString(), nextRunAt, now.toISOString(), jobId).run();
}

export async function markManualSyncFailure(
  db: D1Database,
  connectorId: string,
  scope: string,
  input: { status: SyncStatus; errorMessage: string }
) {
  const now = new Date().toISOString();
  await db.prepare(
    `UPDATE sync_jobs
     SET last_status = ?,
         last_error = ?,
         last_run_at = ?,
         enabled = CASE WHEN ? = 'needs_user_action' THEN 0 ELSE enabled END,
         updated_at = ?
     WHERE connector_id = ? AND scope = ?`
  ).bind(input.status, input.errorMessage, now, input.status, now, connectorId, scope).run();
}
