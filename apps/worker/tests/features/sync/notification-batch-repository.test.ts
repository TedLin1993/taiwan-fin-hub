import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import type { ConnectorId } from "@taiwan-fin-hub/core";
import type { SyncJobRow } from "@taiwan-fin-hub/db";
import { afterEach, describe, expect, it } from "vitest";
import {
  claimCompletedDefaultScheduleBatch,
  ensureDefaultScheduleBatch,
  recordDefaultScheduleBatchResult,
} from "../../../src/features/sync/notification-batch-repository";

class SqliteStatement {
  private values: unknown[] = [];

  constructor(private readonly database: DatabaseSync, private readonly sql: string) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...(this.values as never[]));
    return { success: true, meta: { changes: Number(result.changes) }, results: [] };
  }

  async first<T>() {
    return (this.database.prepare(this.sql).get(...(this.values as never[])) as T) ?? null;
  }

  async all<T>() {
    return {
      success: true,
      meta: {},
      results: this.database.prepare(this.sql).all(...(this.values as never[])) as T[],
    };
  }
}

function createDb(options: { failBatchAt?: number } = {}) {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  const migrationsDirectory = fileURLToPath(
    new URL("../../../../../packages/db/migrations/", import.meta.url),
  );
  for (const file of readdirSync(migrationsDirectory)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    database.exec(readFileSync(`${migrationsDirectory}/${file}`, "utf8"));
  }
  const db = {
    prepare(sql: string) {
      return new SqliteStatement(database, sql);
    },
    async batch(statements: D1PreparedStatement[]) {
      database.exec("BEGIN");
      try {
        const results = [];
        for (const [index, statement] of statements.entries()) {
          if (options.failBatchAt === index) {
            throw new Error("simulated D1 batch failure");
          }
          results.push(
            await (statement as unknown as SqliteStatement).run(),
          );
        }
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  } as unknown as D1Database;
  return { database, db };
}

const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("default schedule notification batches", () => {
  it("rolls back the header when member initialization fails", async () => {
    const { database, db } = createDb({ failBatchAt: 1 });
    databases.push(database);
    const scheduledFor = "2026-07-23T22:00:00.000Z";
    database
      .prepare(
        `UPDATE sync_jobs
         SET enabled = 1, schedule_mode = 'inherit', next_run_at = ?, last_status = NULL`,
      )
      .run(scheduledFor);
    const job = database
      .prepare("SELECT * FROM sync_jobs ORDER BY id LIMIT 1")
      .get() as unknown as SyncJobRow<ConnectorId>;

    await expect(ensureDefaultScheduleBatch(db, job)).rejects.toThrow(
      "simulated D1 batch failure",
    );
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM scheduled_sync_batches")
        .get(),
    ).toEqual({ count: 0 });
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM scheduled_sync_batch_results")
        .get(),
    ).toEqual({ count: 0 });
  });

  it("claims one summary only after every inherited job has a result", async () => {
    const { database, db } = createDb();
    databases.push(database);
    const scheduledFor = "2026-07-23T22:00:00.000Z";
    database
      .prepare(
        `UPDATE sync_jobs
         SET enabled = 1, schedule_mode = 'inherit', next_run_at = ?, last_status = NULL`,
      )
      .run(scheduledFor);
    const jobs = database
      .prepare("SELECT * FROM sync_jobs ORDER BY id")
      .all() as unknown as SyncJobRow<ConnectorId>[];
    const batchId = await ensureDefaultScheduleBatch(db, jobs[0]!);

    for (const [index, job] of jobs.entries()) {
      await recordDefaultScheduleBatchResult(db, {
        batchId,
        jobId: job.id,
        notification: {
          connectorId: job.connector_id,
          status: index === 0 ? "failed" : "success",
        },
      });
      if (index < jobs.length - 1) {
        await expect(
          claimCompletedDefaultScheduleBatch(db, batchId),
        ).resolves.toBeNull();
      }
    }

    const summary = await claimCompletedDefaultScheduleBatch(db, batchId);
    expect(summary).toHaveLength(jobs.length);
    expect(summary).toContainEqual({
      connectorId: jobs[0]!.connector_id,
      status: "failed",
    });
    await expect(
      claimCompletedDefaultScheduleBatch(db, batchId),
    ).resolves.toBeNull();
  });

  it("keeps staggered inherited jobs in the same open batch", async () => {
    const { database, db } = createDb();
    databases.push(database);
    const firstRun = "2026-07-23T22:00:00.000Z";
    const secondRun = "2026-07-23T22:10:00.000Z";
    database
      .prepare(
        `UPDATE sync_jobs
         SET enabled = 1, schedule_mode = 'inherit', next_run_at = ?, last_status = NULL`,
      )
      .run(firstRun);
    const jobs = database
      .prepare("SELECT * FROM sync_jobs ORDER BY id")
      .all() as unknown as SyncJobRow<ConnectorId>[];
    database
      .prepare("UPDATE sync_jobs SET next_run_at = ? WHERE id = ?")
      .run(secondRun, jobs[1]!.id);

    const firstBatch = await ensureDefaultScheduleBatch(db, jobs[0]!);
    const secondBatch = await ensureDefaultScheduleBatch(db, {
      ...jobs[1]!,
      next_run_at: secondRun,
    });

    expect(secondBatch).toBe(firstBatch);
  });

  it("reconciles a member disabled before its scheduled tick", async () => {
    const { database, db } = createDb();
    databases.push(database);
    const scheduledFor = "2026-07-23T22:00:00.000Z";
    database
      .prepare(
        `UPDATE sync_jobs
         SET enabled = 1, schedule_mode = 'inherit', next_run_at = ?, last_status = NULL`,
      )
      .run(scheduledFor);
    const jobs = database
      .prepare("SELECT * FROM sync_jobs ORDER BY id")
      .all() as unknown as SyncJobRow<ConnectorId>[];
    const batchId = await ensureDefaultScheduleBatch(db, jobs[0]!);
    database
      .prepare("UPDATE sync_jobs SET enabled = 0 WHERE id = ?")
      .run(jobs[1]!.id);

    for (const [index, job] of jobs.entries()) {
      if (index === 1) continue;
      await recordDefaultScheduleBatchResult(db, {
        batchId,
        jobId: job.id,
        notification: { connectorId: job.connector_id, status: "success" },
      });
    }

    const summary = await claimCompletedDefaultScheduleBatch(db, batchId);
    expect(summary).toHaveLength(jobs.length - 1);
    expect(summary?.every((event) => event.status === "success")).toBe(true);
  });

  it("does not claim when the persisted membership is incomplete", async () => {
    const { database, db } = createDb();
    databases.push(database);
    const scheduledFor = "2026-07-23T22:00:00.000Z";
    database
      .prepare(
        `UPDATE sync_jobs
         SET enabled = 1, schedule_mode = 'inherit', next_run_at = ?, last_status = NULL`,
      )
      .run(scheduledFor);
    const jobs = database
      .prepare("SELECT * FROM sync_jobs ORDER BY id")
      .all() as unknown as SyncJobRow<ConnectorId>[];
    const batchId = await ensureDefaultScheduleBatch(db, jobs[0]!);

    for (const job of jobs) {
      await recordDefaultScheduleBatchResult(db, {
        batchId,
        jobId: job.id,
        notification: { connectorId: job.connector_id, status: "success" },
      });
    }
    database
      .prepare(
        "DELETE FROM scheduled_sync_batch_results WHERE batch_id = ? AND job_id = ?",
      )
      .run(batchId, jobs[0]!.id);

    await expect(
      claimCompletedDefaultScheduleBatch(db, batchId),
    ).resolves.toBeNull();
  });

  it("keeps a recovered completed failure in the summary", async () => {
    const { database, db } = createDb();
    databases.push(database);
    const scheduledFor = "2026-07-23T22:00:00.000Z";
    database
      .prepare(
        `UPDATE sync_jobs
         SET enabled = 1, schedule_mode = 'inherit', next_run_at = ?, last_status = NULL`,
      )
      .run(scheduledFor);
    const jobs = database
      .prepare("SELECT * FROM sync_jobs ORDER BY id")
      .all() as unknown as SyncJobRow<ConnectorId>[];
    const batchId = await ensureDefaultScheduleBatch(db, jobs[0]!);

    for (const job of jobs.slice(1)) {
      await recordDefaultScheduleBatchResult(db, {
        batchId,
        jobId: job.id,
        notification: { connectorId: job.connector_id, status: "success" },
      });
    }

    const batch = database
      .prepare("SELECT created_at FROM scheduled_sync_batches WHERE id = ?")
      .get(batchId) as { created_at: string };
    const completedAt = new Date(
      new Date(batch.created_at).getTime() + 1_000,
    ).toISOString();
    const nextRunAt = new Date(
      new Date(scheduledFor).getTime() + 60_000,
    ).toISOString();
    database
      .prepare(
        `UPDATE sync_jobs
         SET last_status = 'failed', last_run_at = ?, next_run_at = ?, updated_at = ?, locked_until = NULL
         WHERE id = ?`,
      )
      .run(completedAt, nextRunAt, completedAt, jobs[0]!.id);

    const summary = await claimCompletedDefaultScheduleBatch(db, batchId);
    expect(summary).toContainEqual({
      connectorId: jobs[0]!.connector_id,
      status: "failed",
    });
  });
});
