import {
  parseTaishinCreditCardData,
  reconcileTaishinTransactionSourceIds,
} from "@taiwan-fin-hub/connectors";
import { describe, expect, it } from "vitest";

const summary = {
  value: {
    "001": {
      "OUT-AVAIL-CREDIT": "168,500",
      "OUT-STMT-BALANCE": "10,060",
      "OUT-CRLIMIT-PERM": "200,000",
    },
  },
  error: null,
};

function transaction(
  description: string,
  amount: string,
  cardLast4 = "3108",
  currency = "新臺幣",
) {
  return {
    order: `信用卡 (卡號末四碼:${cardLast4})`,
    detail: [
      {
        showOutDesc: description,
        showOutCurrency: currency,
        showOutPostDate: "2026/07/10",
        showOutTXNDate: "2026/07/08",
        showOutAmt: amount,
        showOutCountry: "TW",
      },
    ],
  };
}

function bill(period = "2026/07", details = [transaction("測試商店", "350")]) {
  return {
    value: {
      showAccoutnYM: period,
      showStmtDate: "2026/07/20",
      showDueDate: "2026/08/05",
      showCbalance: "10,060",
      showCdue: "10,060",
      showMinPay: "1,129",
      showPayment: "0",
      newAcctDetailList: details,
    },
    error: null,
  };
}

function realtime(rows: unknown[][], cardLast4 = "3108") {
  return {
    value: {
      fmtRealTxListMap: [
        {
          cardname: `信用卡 (卡號末四碼:${cardLast4})`,
          txlist: rows,
        },
      ],
    },
    error: null,
  };
}

describe("Taishin credit-card parser", () => {
  it("uses one aggregate credit account and limits bills to six periods", () => {
    const result = parseTaishinCreditCardData(
      {
        summary,
        bills: Array.from({ length: 7 }, (_, index) =>
          bill(`2026/${String(7 - index).padStart(2, "0")}`, []),
        ),
      },
      6,
      new Date("2026-07-23T00:00:00.000Z"),
    );

    expect(result.bankAccounts).toHaveLength(1);
    expect(result.bankAccounts[0]).toMatchObject({
      sourceId: "credit:taishin:main",
      creditLimit: 200000,
    });
    expect(result.creditCardBills).toHaveLength(6);
    expect(result.bankBalanceSnapshots[0]).toMatchObject({
      availableBalance: 168500,
      statementBalance: 10060,
    });
  });

  it("uses the remaining amount as the current card liability", () => {
    const partiallyPaidBill = bill();
    Object.assign(partiallyPaidBill.value, {
      showCbalance: "10,060",
      showCdue: "2,060",
      showPayment: "8,000",
    });
    const partial = parseTaishinCreditCardData({
      summary,
      bills: [partiallyPaidBill],
    });

    expect(partial.bankBalanceSnapshots[0]).toMatchObject({
      balance: -2060,
      statementBalance: 10060,
      noPaymentNeeded: false,
    });

    Object.assign(partiallyPaidBill.value, {
      showCdue: "0",
      showPayment: "10,060",
    });
    const paid = parseTaishinCreditCardData({
      summary,
      bills: [partiallyPaidBill],
    });

    expect(paid.bankBalanceSnapshots[0]).toMatchObject({
      balance: 0,
      statementBalance: 10060,
      noPaymentNeeded: true,
    });
  });

  it("uses the newest valid bill when the current month is empty", () => {
    const previousBill = bill("2026/06", []);
    Object.assign(previousBill.value, {
      showCbalance: "8,060",
      showCdue: "2,060",
      showPayment: "6,000",
      showStmtDate: "2026/06/20",
      showDueDate: "2026/07/05",
    });

    const result = parseTaishinCreditCardData({
      summary,
      bills: [{ value: {}, error: null }, previousBill],
    });

    expect(result.bankBalanceSnapshots[0]).toMatchObject({
      balance: -2060,
      statementBalance: 8060,
      paymentDueDate: "2026-07-05",
      statementClosingDate: "2026-06-20",
      noPaymentNeeded: false,
    });
    expect(
      result.creditCardBills.map(({ billingPeriod }) => billingPeriod),
    ).toEqual(["2026-06"]);
  });

  it("upgrades merchant-matched pending occurrences and keeps the rest pending", () => {
    const result = parseTaishinCreditCardData({
      summary,
      bills: [
        bill("2026/07", [
          transaction("第一商店（入帳後）", "350"),
          transaction("第二商店", "350"),
        ]),
      ],
      realtime: realtime([
        ["2026/07/08", "12:30:00", "第一商店", "350", "TW", "成功"],
        ["2026/07/08", "13:30:00", "第二商店", "350", "TW", "成功"],
        ["2026/07/08", "14:30:00", "尚未入帳", "350", "TW", "成功"],
      ]),
    });

    expect(result.bankTransactions).toHaveLength(3);
    expect(result.bankTransactions.map(({ sourceId }) => sourceId)).toEqual([
      expect.stringContaining(":1"),
      expect.stringContaining(":2"),
      expect.stringContaining(":3"),
    ]);
    expect(result.bankTransactions.map(({ status }) => status)).toEqual([
      "posted",
      "posted",
      "pending",
    ]);
  });

  it("keeps an ambiguous same-day same-amount authorization pending", () => {
    const result = parseTaishinCreditCardData({
      summary,
      bills: [bill("2026/07", [transaction("商戶 B", "350")])],
      realtime: realtime([
        ["2026/07/08", "12:30:00", "商戶 A", "350", "TW", "成功"],
      ]),
    });

    expect(result.bankTransactions).toHaveLength(2);
    expect(result.bankTransactions).toEqual([
      expect.objectContaining({
        description: "商戶 B",
        status: "posted",
        sourceId: expect.stringContaining(":2"),
      }),
      expect.objectContaining({
        description: "商戶 A",
        status: "pending",
        sourceId: expect.stringContaining(":1"),
      }),
    ]);
    expect(
      new Set(result.bankTransactions.map(({ sourceId }) => sourceId)).size,
    ).toBe(2);
  });

  it("preserves duplicate transaction ids across sync subsets and ordering", () => {
    const first = parseTaishinCreditCardData({
      summary,
      bills: [bill("2026/07", [])],
      realtime: realtime([
        ["2026/07/08", "12:30:00", "商戶 A", "350", "TW", "成功"],
        ["2026/07/08", "13:30:00", "商戶 B", "350", "TW", "成功"],
      ]),
    });
    const firstIds = new Map(
      first.bankTransactions.map(({ description, sourceId }) => [
        description,
        sourceId,
      ]),
    );
    const existingBeforeReconciliation = first.bankTransactions.map(
      (transaction) => {
        const { lifecycleMatchKey: _lifecycleMatchKey, ...raw } =
          transaction.raw as Record<string, unknown>;
        return { ...transaction, raw };
      },
    );

    const next = parseTaishinCreditCardData({
      summary,
      bills: [bill("2026/07", [transaction("商戶 A", "350")])],
      realtime: realtime([
        ["2026/07/08", "13:30:00", "商戶 B", "350", "TW", "成功"],
      ]),
    });
    const reconciled = reconcileTaishinTransactionSourceIds(
      next.bankTransactions,
      existingBeforeReconciliation,
    );

    expect(
      new Map(
        reconciled.map(({ description, sourceId }) => [description, sourceId]),
      ),
    ).toEqual(firstIds);

    const remainingOnly = parseTaishinCreditCardData({
      summary,
      bills: [bill("2026/07", [])],
      realtime: realtime([
        ["2026/07/08", "13:30:00", "商戶 B", "350", "TW", "成功"],
      ]),
    });
    expect(
      reconcileTaishinTransactionSourceIds(
        remainingOnly.bankTransactions,
        existingBeforeReconciliation,
      )[0]?.sourceId,
    ).toBe(firstIds.get("商戶 B"));

    const newOnly = parseTaishinCreditCardData({
      summary,
      bills: [bill("2026/07", [])],
      realtime: realtime([
        ["2026/07/08", "14:30:00", "商戶 C", "350", "TW", "成功"],
      ]),
    });
    expect(
      reconcileTaishinTransactionSourceIds(
        newOnly.bankTransactions,
        existingBeforeReconciliation,
      )[0]?.sourceId,
    ).toMatch(/:3$/);
  });

  it("keeps cards isolated and preserves refunds and foreign currency", () => {
    const result = parseTaishinCreditCardData({
      summary,
      bills: [
        bill("2026/07", [
          transaction("美元消費", "12.50", "3108", "USD"),
          transaction("退款", "88", "9921"),
        ]),
      ],
      realtime: realtime([
        ["2026/07/08", "12:30:00", "不同卡同額", "12.50", "US", "成功"],
      ]),
    });

    expect(
      result.bankTransactions.find(({ currency }) => currency === "USD"),
    ).toMatchObject({ amount: -12.5, status: "posted" });
    expect(
      result.bankTransactions.find(({ description }) => description === "退款"),
    ).toMatchObject({ amount: 88, status: "posted" });
    expect(
      result.bankTransactions.filter(({ amount }) => amount === -12.5),
    ).toHaveLength(2);
  });

  it("persists only masked, whitelisted raw fields", () => {
    const payload = bill();
    Object.assign(payload.value, {
      customerName: "王小明",
      nationalId: "A123456789",
      cardNumber: "4111111111113108",
      debitAccount: "01234567890123",
    });

    const result = parseTaishinCreditCardData({
      summary,
      bills: [payload],
    });
    const serialized = JSON.stringify(result);

    expect(serialized).not.toMatch(
      /王小明|A123456789|4111111111113108|01234567890123/,
    );
    expect(serialized).toContain("3108");
  });

  it("fails explicitly on empty or error payloads", () => {
    expect(() =>
      parseTaishinCreditCardData({
        summary: { value: {}, error: null },
        bills: [],
      }),
    ).toThrow("缺少額度或帳單資料");
    expect(() =>
      parseTaishinCreditCardData({
        summary,
        bills: [{ value: {}, error: null }],
      }),
    ).toThrow("缺少額度或帳單資料");
    expect(() =>
      parseTaishinCreditCardData({
        summary: { value: {}, error: { code: "DRIFT" } },
        bills: [bill()],
      }),
    ).toThrow("API 回傳錯誤");
  });
});
