import { describe, expect, it } from "vitest";
import { buildNetWorthChartData, getAvailableNetWorthAssets } from "./net-worth-chart";
import type { NetWorthHistoryRow } from "./types";

const rows: NetWorthHistoryRow[] = [
  { date: "2026-01-01", netWorth: 100, assetType: "stock", source: "tdcc" },
  { date: "2026-01-02", netWorth: 40, assetType: "fund", source: "tdcc" },
  { date: "2026-01-02", netWorth: 500, assetType: "deposit", source: "bank" },
  { date: "2026-01-03", netWorth: 110, assetType: "stock", source: "tdcc" },
  { date: "2026-01-03", netWorth: 200, assetType: "manual:home", source: "manual" },
  { date: "2026-01-03", netWorth: 50, assetType: "manual:policy", source: "manual" }
];

describe("net worth chart data", () => {
  it("aggregates selected asset types into one point per date", () => {
    const points = buildNetWorthChartData(rows, ["stock", "fund", "deposit"], "ALL");

    expect(points).toEqual([
      { date: "2026-01-01", stock: 100, fund: 0, deposit: 0, manual: 0, selectedTotal: 100 },
      { date: "2026-01-02", stock: 100, fund: 40, deposit: 500, manual: 0, selectedTotal: 640 },
      { date: "2026-01-03", stock: 110, fund: 40, deposit: 500, manual: 250, selectedTotal: 650 }
    ]);
  });

  it("aggregates independent manual assets and includes them only when selected", () => {
    const points = buildNetWorthChartData(rows, ["manual"], "ALL");

    expect(points).toEqual([
      { date: "2026-01-03", stock: 110, fund: 40, deposit: 500, manual: 250, selectedTotal: 250 }
    ]);
  });

  it("reports the asset types that have history", () => {
    expect([...getAvailableNetWorthAssets(rows)]).toEqual(["stock", "fund", "deposit", "manual"]);
  });

  it("filters points outside the selected timeframe", () => {
    const points = buildNetWorthChartData(rows, ["stock"], "1M", new Date("2026-02-02T00:00:00Z"));

    expect(points.map((point) => point.date)).toEqual(["2026-01-03"]);
    expect(points[0]?.stock).toBe(110);
  });
});
