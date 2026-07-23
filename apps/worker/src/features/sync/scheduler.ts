import type { ConnectorId } from "@taiwan-fin-hub/core";
import {
  acquireSyncJobLock,
  completeSyncJob,
  failSyncJob,
  findNextDueSyncJob,
  releaseSyncJobLock,
  type SyncJobRow,
  type SyncStatus,
} from "@taiwan-fin-hub/db";
import type { Env } from "../../platform/env";
import {
  canonicalSyncLockRowId,
  isUserActionError,
  NeedsUserActionError,
  safeErrorMessage,
  startSyncLockHeartbeat,
  syncCathaybk,
  syncEinvoice,
  syncEsun,
  syncSinopac,
  syncTdcc,
  SYNC_LOCK_LEASE_MS,
} from "./service";
import {
  safelySendScheduledSyncSummary,
  safelySendSyncNotification,
} from "../notifications/service";
import type { SyncNotificationEvent } from "../notifications/payload";
import {
  claimCompletedDefaultScheduleBatch,
  ensureDefaultScheduleBatch,
  recordDefaultScheduleBatchResult,
} from "./notification-batch-repository";

const MAX_SCHEDULED_JOBS_PER_TICK = 3;

export async function runSchedulerTick(
  env: Env,
  controller: ScheduledController,
) {
  for (let index = 0; index < MAX_SCHEDULED_JOBS_PER_TICK; index += 1) {
    const due = await findNextDueSyncJob<ConnectorId>(env.DB);
    if (!due) return;
    const batchId =
      due.schedule_mode === "inherit"
        ? await ensureDefaultScheduleBatch(env.DB, due)
        : null;
    const notification = await runScheduledJob(env, controller, due);
    if (!notification) continue;

    if (!batchId) {
      await safelySendSyncNotification(env, notification);
      continue;
    }

    await recordDefaultScheduleBatchResult(env.DB, {
      batchId,
      jobId: due.id,
      notification,
    });
    const summary = await claimCompletedDefaultScheduleBatch(env.DB, batchId);
    if (summary) await safelySendScheduledSyncSummary(env, summary);
  }
}

async function runScheduledJob(
  env: Env,
  controller: ScheduledController,
  due: SyncJobRow<ConnectorId>,
) {
  const runId = crypto.randomUUID();
  const lockRowId = canonicalSyncLockRowId(due.connector_id);
  const locked = await acquireSyncJobLock(env.DB, {
    lockRowId,
    scope: due.scope,
    trigger: "scheduled",
    runId,
    leaseMs: SYNC_LOCK_LEASE_MS,
  });
  if (!locked) return;

  const stopHeartbeat = startSyncLockHeartbeat(env.DB, lockRowId, runId);
  const startedAt = Date.now();
  let notification: SyncNotificationEvent | undefined;
  try {
    const outcome = await runDueSyncJob(env, due);
    await completeSyncJob(env.DB, due);
    console.log(
      JSON.stringify({
        event: "sync_run_finished",
        runId,
        cron: controller.cron,
        connectorId: outcome.connectorId,
        scope: outcome.scope,
        trigger: "scheduled",
        status: "success",
        records: outcome.records,
        durationMs: Date.now() - startedAt,
      }),
    );
    notification = {
      connectorId: outcome.connectorId,
      status: "success",
    };
  } catch (error) {
    const status: SyncStatus = isUserActionError(error)
      ? "needs_user_action"
      : "failed";
    await failSyncJob(env.DB, due, {
      status,
      errorMessage: safeErrorMessage(error),
    });
    console.error(
      JSON.stringify({
        event: "sync_run_failed",
        runId,
        cron: controller.cron,
        connectorId: due.connector_id,
        scope: due.scope,
        trigger: "scheduled",
        status,
        message: safeErrorMessage(error),
        durationMs: Date.now() - startedAt,
      }),
    );
    notification = {
      connectorId: due.connector_id,
      status,
    };
  } finally {
    stopHeartbeat();
    await releaseSyncJobLock(env.DB, lockRowId, runId);
  }

  return notification;
}

async function runDueSyncJob(env: Env, job: SyncJobRow<ConnectorId>) {
  if (job.connector_id === "einvoice") {
    return syncEinvoice(env, "scheduled", { fetchDetails: true });
  }
  if (job.connector_id === "tdcc") {
    return syncTdcc(env, "scheduled", {}, [job.scope]);
  }
  if (job.connector_id === "esun") return syncEsun(env, "scheduled");
  if (job.connector_id === "cathaybk") return syncCathaybk(env, "scheduled");
  if (job.connector_id === "sinopac") return syncSinopac(env, "scheduled");
  throw new NeedsUserActionError("Scheduled connector is not supported.");
}
