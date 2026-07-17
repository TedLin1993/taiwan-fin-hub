import { describe, expect, it } from "vitest";
import { buildUnrealizedPerformance } from "./investment-performance";

const twd = { currency: "TWD", rateToTwd: null };

describe("buildUnrealizedPerformance", () => {
  it("uses moving-average cost after a partial sale", () => {
    const result = buildUnrealizedPerformance(
      [
        {
          date: "2026-01-01",
          netWorth: 1000,
          assetType: "stock",
          source: "tdcc",
        },
        {
          date: "2026-01-02",
          netWorth: 1560,
          assetType: "stock",
          source: "tdcc",
        },
        {
          date: "2026-01-03",
          netWorth: 1300,
          assetType: "stock",
          source: "tdcc",
        },
      ],
      [
        {
          id: "position-1",
          symbol: "2330",
          name: "台積電",
          quantity: 10,
          marketValue: 1300,
          ...twd,
        },
      ],
      [
        {
          date: "2025-12-01",
          symbol: "2330",
          name: "台積電",
          transactionCode: "B",
          transactionName: "買進",
          quantity: 10,
          price: 100,
          amount: 1000,
          ...twd,
        },
        {
          date: "2026-01-02",
          symbol: "2330",
          name: "台積電",
          transactionCode: "B",
          transactionName: "買進",
          quantity: 5,
          price: 120,
          amount: 600,
          ...twd,
        },
        {
          date: "2026-01-03",
          symbol: "2330",
          name: "台積電",
          transactionCode: "S",
          transactionName: "賣出",
          quantity: 5,
          price: 130,
          amount: 650,
          ...twd,
        },
      ],
    );

    expect(result.totalCostBasis).toBe(1067);
    expect(result.currentProfitLoss).toBe(233);
    expect(result.currentReturnRate).toBeCloseTo(21.88, 2);
    expect(result.points.map((point) => point.profitLoss)).toEqual([
      0, -40, 233,
    ]);
  });

  it("combines stock and fund history while carrying the last known value", () => {
    const result = buildUnrealizedPerformance(
      [
        {
          date: "2026-01-01",
          netWorth: 800,
          assetType: "stock",
          source: "tdcc",
        },
        {
          date: "2026-01-01",
          netWorth: 200,
          assetType: "fund",
          source: "tdcc",
        },
        {
          date: "2026-01-02",
          netWorth: 850,
          assetType: "stock",
          source: "tdcc",
        },
      ],
      [
        {
          id: "position-1",
          symbol: "2330",
          name: "台積電",
          quantity: 10,
          marketValue: 1050,
          ...twd,
        },
      ],
      [
        {
          date: "2025-12-01",
          symbol: "2330",
          name: "台積電",
          transactionCode: "B",
          transactionName: "買進",
          quantity: 10,
          price: 100,
          amount: 1000,
          ...twd,
        },
      ],
    );

    expect(result.points).toMatchObject([
      { date: "2026-01-01", marketValue: 1000, costBasis: 1000, profitLoss: 0 },
      {
        date: "2026-01-02",
        marketValue: 1050,
        costBasis: 1000,
        profitLoss: 50,
      },
    ]);
  });

  it("does not report unrealized profit when trade history cannot cover holdings", () => {
    const result = buildUnrealizedPerformance(
      [],
      [
        {
          id: "position-1",
          symbol: "2330",
          name: "台積電",
          quantity: 10,
          marketValue: 1300,
          ...twd,
        },
      ],
      [
        {
          date: "2026-01-01",
          symbol: "2330",
          name: "台積電",
          transactionCode: "B",
          transactionName: "買進",
          quantity: 5,
          price: 100,
          amount: 500,
          ...twd,
        },
      ],
    );

    expect(result.positions[0]).toMatchObject({
      available: false,
      profitLoss: null,
    });
    expect(result.currentProfitLoss).toBeNull();
    expect(result.points).toEqual([]);
  });

  it("rejects the legacy TDCC field-18 placeholder as a cost", () => {
    const result = buildUnrealizedPerformance(
      [],
      [
        {
          id: "position-1",
          symbol: "0050",
          name: "元大台灣50",
          quantity: 93,
          marketValue: 9900,
          ...twd,
        },
      ],
      [
        {
          date: "2026-07-13",
          symbol: "0050",
          name: "元大台灣50",
          transactionCode: "113",
          transactionName: "買　　進",
          quantity: 93,
          price: 1,
          amount: 93,
          ...twd,
        },
      ],
    );

    expect(result.currentProfitLoss).toBeNull();
    expect(result.positions[0]).toMatchObject({
      available: false,
      costBasis: null,
    });
  });

  it("ignores trades for instruments without a current holding", () => {
    const result = buildUnrealizedPerformance(
      [
        {
          date: "2026-01-01",
          netWorth: 1000,
          assetType: "stock",
          source: "tdcc",
        },
        {
          date: "2026-01-02",
          netWorth: 1100,
          assetType: "stock",
          source: "tdcc",
        },
      ],
      [
        {
          id: "position-1",
          symbol: "2330",
          name: "台積電",
          quantity: 10,
          marketValue: 1100,
          ...twd,
        },
      ],
      [
        {
          date: "2025-12-01",
          symbol: "2330",
          name: "台積電",
          transactionCode: "B",
          transactionName: "買進",
          quantity: 10,
          price: 100,
          amount: 1000,
          ...twd,
        },
        {
          date: "2025-12-01",
          symbol: "00905",
          name: "已售出 ETF",
          transactionCode: "S",
          transactionName: "賣出",
          quantity: 5000,
          price: 10,
          amount: 50000,
          ...twd,
        },
      ],
    );

    expect(result.coveredPositions).toBe(1);
    expect(result.currentProfitLoss).toBe(100);
    expect(result.points).toHaveLength(2);
  });
});
