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

function createDb() {
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
  } as unknown as D1Database;
  return { database, db };
}

const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("default schedule notification batches", () => {
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
});
