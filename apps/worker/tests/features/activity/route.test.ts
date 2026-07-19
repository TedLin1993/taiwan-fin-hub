import { describe, expect, it } from "vitest";
import type { Env } from "../../../src/platform/env";
import { activityRoutes } from "../../../src/features/activity/route";

type Preference = {
  invoiceId: string;
  transactionId: string | null;
  decision: "linked" | "separate";
  createdAt: string;
  updatedAt: string;
};

function createDb() {
  const invoices = new Map([
    ["invoice-1", { id: "invoice-1", invoiceDate: "2026-07-06T04:39:18.000Z" }],
    ["invoice-2", { id: "invoice-2", invoiceDate: "2026-07-06" }],
  ]);
  const transactions = new Map([
    [
      "transaction-1",
      {
        id: "transaction-1",
        postedDate: "2026-07-06",
        authorizedAt: null,
        amount: 37,
        currency: "TWD",
        accountType: "credit",
      },
    ],
    [
      "transaction-other-day",
      {
        id: "transaction-other-day",
        postedDate: "2026-07-07",
        authorizedAt: null,
        amount: -50,
        currency: "TWD",
        accountType: "checking",
      },
    ],
    [
      "transaction-next-taipei-day",
      {
        id: "transaction-next-taipei-day",
        postedDate: "2026-07-06T16:00:00.000Z",
        authorizedAt: null,
        amount: 50,
        currency: "TWD",
        accountType: "credit",
      },
    ],
  ]);
  const preferences = new Map<string, Preference>();

  const db = {
    prepare(sql: string) {
      let values: unknown[] = [];
      return {
        bind(...nextValues: unknown[]) {
          values = nextValues;
          return this;
        },
        async first() {
          if (sql.includes("FROM invoices"))
            return invoices.get(String(values[0])) ?? null;
          if (sql.includes("FROM bank_transactions"))
            return transactions.get(String(values[0])) ?? null;
          if (sql.includes("WHERE transaction_id")) {
            const linked = Array.from(preferences.values()).find(
              (preference) =>
                preference.decision === "linked" &&
                preference.transactionId === values[0],
            );
            return linked ? { invoiceId: linked.invoiceId } : null;
          }
          return null;
        },
        async all() {
          return { results: Array.from(preferences.values()) };
        },
        async run() {
          const [invoiceId, transactionId, decision, createdAt, updatedAt] =
            values as [
              string,
              string | null,
              "linked" | "separate",
              string,
              string,
            ];
          const previous = preferences.get(invoiceId);
          preferences.set(invoiceId, {
            invoiceId,
            transactionId,
            decision,
            createdAt: previous?.createdAt ?? createdAt,
            updatedAt,
          });
          return { meta: { changes: 1 } };
        },
      };
    },
  } as unknown as D1Database;
  return { db, preferences };
}

describe("activity invoice transaction mappings", () => {
  it("links an invoice to a same-day expense and lists the preference", async () => {
    const { db } = createDb();
    const response = await activityRoutes.request(
      "/activity/invoice-mappings/invoice-1",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionId: "transaction-1" }),
      },
      { DB: db } as Env,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      invoiceId: "invoice-1",
      transactionId: "transaction-1",
      decision: "linked",
    });

    const list = await activityRoutes.request(
      "/activity/invoice-mappings",
      {},
      { DB: db } as Env,
    );
    await expect(list.json()).resolves.toEqual([
      expect.objectContaining({
        invoiceId: "invoice-1",
        transactionId: "transaction-1",
        decision: "linked",
      }),
    ]);
  });

  it("keeps a previously linked invoice separate", async () => {
    const { db, preferences } = createDb();
    preferences.set("invoice-1", {
      invoiceId: "invoice-1",
      transactionId: "transaction-1",
      decision: "linked",
      createdAt: "2026-07-19T00:00:00.000Z",
      updatedAt: "2026-07-19T00:00:00.000Z",
    });

    const response = await activityRoutes.request(
      "/activity/invoice-mappings/invoice-1",
      { method: "DELETE" },
      { DB: db } as Env,
    );
    expect(response.status).toBe(200);
    expect(preferences.get("invoice-1")).toMatchObject({
      transactionId: null,
      decision: "separate",
    });
  });

  it("rejects invalid, cross-day, and already-used mappings", async () => {
    const { db, preferences } = createDb();
    const invalid = await activityRoutes.request(
      "/activity/invoice-mappings/invoice-1",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionId: "" }),
      },
      { DB: db } as Env,
    );
    expect(invalid.status).toBe(400);

    const crossDay = await activityRoutes.request(
      "/activity/invoice-mappings/invoice-1",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionId: "transaction-other-day" }),
      },
      { DB: db } as Env,
    );
    expect(crossDay.status).toBe(400);

    const crossTaipeiDay = await activityRoutes.request(
      "/activity/invoice-mappings/invoice-1",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transactionId: "transaction-next-taipei-day",
        }),
      },
      { DB: db } as Env,
    );
    expect(crossTaipeiDay.status).toBe(400);

    preferences.set("invoice-2", {
      invoiceId: "invoice-2",
      transactionId: "transaction-1",
      decision: "linked",
      createdAt: "2026-07-19T00:00:00.000Z",
      updatedAt: "2026-07-19T00:00:00.000Z",
    });
    const unavailable = await activityRoutes.request(
      "/activity/invoice-mappings/invoice-1",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionId: "transaction-1" }),
      },
      { DB: db } as Env,
    );
    expect(unavailable.status).toBe(409);
  });
});
