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
  maintainSinopacSession,
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

const MAX_SCHEDULED_JOBS_PER_TICK = 3;

export async function runSchedulerTick(
  env: Env,
  controller: ScheduledController,
) {
  try {
    await maintainSinopacSession(env);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "sinopac_session_keep_alive_failed",
        cron: controller.cron,
        message: safeErrorMessage(error),
      }),
    );
  }
  for (let index = 0; index < MAX_SCHEDULED_JOBS_PER_TICK; index += 1) {
    const due = await findNextDueSyncJob<ConnectorId>(env.DB);
    if (!due) return;
    await runScheduledJob(env, controller, due);
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
  } finally {
    stopHeartbeat();
    await releaseSyncJobLock(env.DB, lockRowId, runId);
  }
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
