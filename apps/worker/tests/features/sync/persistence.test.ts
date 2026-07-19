import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  persistStagedSyncWrite,
  type SyncWriteRecord,
} from "../../../src/features/sync/persistence";

class SqliteStatement {
  private values: unknown[] = [];

  constructor(
    private readonly owner: SqliteD1,
    readonly sql: string,
  ) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async run() {
    return this.execute();
  }

  execute() {
    this.owner.executedSql.push(this.sql);
    const result = this.owner.database
      .prepare(this.sql)
      .run(...(this.values as never[]));
    return {
      success: true,
      meta: { changes: Number(result.changes) },
      results: [],
    };
  }
}

class SqliteD1 {
  readonly database = new DatabaseSync(":memory:");
  readonly executedSql: string[] = [];

  constructor() {
    this.database.exec("PRAGMA foreign_keys = ON");
    const migrationsDirectory = fileURLToPath(
      new URL("../../../../../packages/db/migrations/", import.meta.url),
    );
    for (const file of readdirSync(migrationsDirectory)
      .filter((name) => name.endsWith(".sql"))
      .sort()) {
      this.database.exec(
        readFileSync(`${migrationsDirectory}/${file}`, "utf8"),
      );
    }
  }

  prepare(sql: string) {
    return new SqliteStatement(this, sql);
  }

  async batch(statements: D1PreparedStatement[]) {
    this.database.exec("BEGIN");
    try {
      const results = statements.map((statement) =>
        (statement as unknown as SqliteStatement).execute(),
      );
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  close() {
    this.database.close();
  }
}

const databases: SqliteD1[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function createDb() {
  const db = new SqliteD1();
  databases.push(db);
  db.database
    .prepare(
      `INSERT INTO connector_settings
      (id, connector_id, encrypted_config, sync_cursor, created_at, updated_at)
     VALUES ('tdcc-settings', 'tdcc', 'encrypted', 'old-cursor', '2026-01-01', '2026-01-01')`,
    )
    .run();
  return db;
}

function bankAccountRecord(index: number): SyncWriteRecord {
  const id = `tdcc:account-${index}`;
  return {
    entityType: "bank_account",
    recordKey: id,
    payload: {
      id,
      connector_id: "tdcc",
      source_id: `account-${index}`,
      institution_name: "測試銀行",
      account_name: `測試帳戶 ${index}`,
      account_type: "savings",
      currency: "TWD",
      credit_limit: null,
      bank_code: "004",
      account_last4: String(index).padStart(4, "0").slice(-4),
      raw_payload: "{}",
      created_at: "2026-07-19T00:00:00.000Z",
      updated_at: "2026-07-19T00:00:00.000Z",
    },
  };
}

describe("staged sync persistence", () => {
  it("stages records in bounded JSON chunks and advances the cursor only after promotion", async () => {
    const db = createDb();
    const records = Array.from({ length: 205 }, (_, index) =>
      bankAccountRecord(index),
    );
    records.push({
      entityType: "bank_transaction",
      recordKey: "tdcc:account-0:transaction-1",
      payload: {
        id: "tdcc:account-0:transaction-1",
        connector_id: "tdcc",
        account_id: "tdcc:account-0",
        source_id: "transaction-1",
        posted_date: "2026-07-19",
        authorized_at: null,
        amount: 100,
        currency: "TWD",
        description: null,
        counterparty: null,
        raw_payload: "{}",
        created_at: "2026-07-19T00:00:00.000Z",
        updated_at: "2026-07-19T00:00:00.000Z",
      },
    });

    await persistStagedSyncWrite(db as unknown as D1Database, {
      records,
      finalizeStatements: [
        db
          .prepare(
            "UPDATE connector_settings SET sync_cursor = ? WHERE connector_id = ?",
          )
          .bind("new-cursor", "tdcc") as unknown as D1PreparedStatement,
      ],
    });

    expect(
      db.executedSql.filter((sql) =>
        sql.includes("INSERT INTO sync_write_staging"),
      ),
    ).toHaveLength(3);
    expect(
      db.database.prepare("SELECT COUNT(*) AS count FROM bank_accounts").get(),
    ).toMatchObject({ count: 205 });
    expect(
      db.database
        .prepare(
          "SELECT effective_date AS effectiveDate FROM bank_transactions",
        )
        .get(),
    ).toMatchObject({ effectiveDate: "2026-07-19" });
    expect(
      db.database
        .prepare("SELECT COUNT(*) AS count FROM sync_write_staging")
        .get(),
    ).toMatchObject({ count: 0 });
    expect(
      db.database
        .prepare(
          "SELECT sync_cursor AS cursor FROM connector_settings WHERE connector_id = 'tdcc'",
        )
        .get(),
    ).toMatchObject({ cursor: "new-cursor" });
  });

  it("rolls back promotion and leaves the cursor unchanged when a staged record is invalid", async () => {
    const db = createDb();
    const invalidTransaction: SyncWriteRecord = {
      entityType: "bank_transaction",
      recordKey: "missing-account:transaction",
      payload: {
        id: "missing-account:transaction",
        connector_id: "tdcc",
        account_id: "missing-account",
        source_id: "transaction",
        posted_date: "2026-07-19",
        authorized_at: null,
        amount: 100,
        currency: "TWD",
        description: null,
        counterparty: null,
        raw_payload: "{}",
        created_at: "2026-07-19T00:00:00.000Z",
        updated_at: "2026-07-19T00:00:00.000Z",
      },
    };

    await expect(
      persistStagedSyncWrite(db as unknown as D1Database, {
        records: [invalidTransaction],
        finalizeStatements: [
          db
            .prepare(
              "UPDATE connector_settings SET sync_cursor = ? WHERE connector_id = ?",
            )
            .bind("new-cursor", "tdcc") as unknown as D1PreparedStatement,
        ],
      }),
    ).rejects.toThrow();

    expect(
      db.database
        .prepare("SELECT COUNT(*) AS count FROM bank_transactions")
        .get(),
    ).toMatchObject({ count: 0 });
    expect(
      db.database
        .prepare("SELECT COUNT(*) AS count FROM sync_write_staging")
        .get(),
    ).toMatchObject({ count: 0 });
    expect(
      db.database
        .prepare(
          "SELECT sync_cursor AS cursor FROM connector_settings WHERE connector_id = 'tdcc'",
        )
        .get(),
    ).toMatchObject({ cursor: "old-cursor" });
  });
});
