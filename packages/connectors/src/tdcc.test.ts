import { describe, expect, it } from "vitest";
import { parseTdccTradeRow } from "./tdcc";

describe("parseTdccTradeRow", () => {
  it("does not misread TR002 field 18 as the execution price", () => {
    const row = [
      "01150714",
      "00001",
      "0050  ",
      "元大台灣50",
      "0",
      "0",
      "0",
      "0",
      "12",
      "01150713",
      "113",
      "買　　進",
      "93.000000000000000000",
      "17293.000000000000000000",
      "2",
      "0",
      "",
      "",
      "1",
      "20260716",
      "TWD",
      "其他類股",
      "",
    ];

    const trade = parseTdccTradeRow(row, {
      brokerNo: "9A9J",
      brokerAccount: "0338852",
      brokerName: "永豐金板新",
    });

    expect(trade).toMatchObject({
      symbol: "0050",
      quantity: 93,
      tradeDate: "2026-07-13T00:00:00.000Z",
      postedDate: "2026-07-14T00:00:00.000Z",
      transactionCode: "113",
      currency: "TWD",
    });
    expect(trade.price).toBeUndefined();
    expect(trade.amount).toBeUndefined();

    const fields = (
      trade.raw as {
        fields: { txnSHR: string; txnPBBal: string; field18: string };
      }
    ).fields;
    expect(fields).toMatchObject({
      // This transaction added 93 shares, leaving a post-transaction balance
      // of 17,293 shares. Neither value is an execution price.
      txnSHR: "93.000000000000000000",
      txnPBBal: "17293.000000000000000000",
      field18: "1",
    });
  });
});
