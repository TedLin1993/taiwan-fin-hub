import { describe, expect, it } from "vitest";
import { parseAmount, parseDate, parseInvestmentRows } from "./sinopac";

describe("sinopac parser", () => {
  it("parses Taiwan amounts and ROC dates", () => {
    expect(parseAmount("NT$ 1,234.50")).toBe(1234.5);
    expect(parseAmount("(2,000)")).toBe(-2000);
    expect(parseDate("115/07/15")).toBe("2026-07-15");
  });

  it("maps DAWHO stock tables to investment positions", () => {
    const positions = parseInvestmentRows([[
      ["代號", "名稱", "股數", "市值", "幣別"],
      ["AAPL", "Apple Inc.", "10", "2,100.00", "USD"],
      ["VOO", "Vanguard ETF", "3", "1,500.00", "USD"]
    ]], "2026-07-15");
    expect(positions).toHaveLength(2);
    expect(positions[0]).toMatchObject({ symbol: "AAPL", quantity: 10, marketValue: 2100, currency: "USD", assetType: "stock" });
    expect(positions[1]).toMatchObject({ symbol: "VOO", assetType: "etf" });
  });
});
