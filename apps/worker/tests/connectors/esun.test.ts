import { describe, expect, it } from "vitest";
import {
  normalizeEsunTimelineTransactions,
  type EsunTimelinePage,
  type EsunTimelineTransaction,
} from "../../src/connectors/esun";

function page(transactions: EsunTimelineTransaction[]): EsunTimelinePage {
  return {
    timelineList: [
      {
        year: "2026",
        month: "07",
        txnList: transactions,
      },
    ],
  };
}

function transaction(
  acfg: string,
  overrides: Partial<EsunTimelineTransaction> = {},
): EsunTimelineTransaction {
  return {
    payCur: "TWD",
    payAmt: "252",
    storeName: "全支付﹘全聯",
    consumerDt: "07/05",
    cardNo: "****1204",
    acfg,
    ...overrides,
  };
}

describe("E.SUN credit card timeline normalization", () => {
  it("collapses pending and posted lifecycle copies into one stable transaction", () => {
    const rows = normalizeEsunTimelineTransactions([
      page([transaction("未入帳"), transaction("已入帳")]),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].sourceId).toBe(
      "2026-07-05T00:00:00.000Z:credit:esun:1204:全支付﹘全聯:252:TWD:1",
    );
    expect((rows[0].raw as EsunTimelineTransaction).acfg).toBe("已入帳");
  });

  it("preserves repeated real purchases using occurrence numbers", () => {
    const rows = normalizeEsunTimelineTransactions([
      page([
        transaction("未入帳"),
        transaction("未入帳"),
        transaction("已入帳"),
        transaction("已入帳"),
      ]),
    ]);

    expect(rows.map(({ sourceId }) => sourceId)).toEqual([
      "2026-07-05T00:00:00.000Z:credit:esun:1204:全支付﹘全聯:252:TWD:1",
      "2026-07-05T00:00:00.000Z:credit:esun:1204:全支付﹘全聯:252:TWD:2",
    ]);
    expect(
      rows.map(({ raw }) => (raw as EsunTimelineTransaction).acfg),
    ).toEqual(["已入帳", "已入帳"]);
  });

  it("keeps all pending purchases while no posted copy exists", () => {
    const rows = normalizeEsunTimelineTransactions([
      page([transaction("未入帳"), transaction("未入帳")]),
    ]);

    expect(rows).toHaveLength(2);
  });
});
