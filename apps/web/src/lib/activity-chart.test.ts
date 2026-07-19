import { describe, expect, it } from "vitest";
import {
  activityCashAmountTwd,
  activityCashFlow,
  buildActivityCategorySlices,
} from "./activity-chart";
import type { ActivityItem } from "./types";

function item(overrides: Partial<ActivityItem>): ActivityItem {
  return {
    id: "1",
    source: "bank",
    date: "2026-07-01",
    title: "交易",
    subtitle: "",
    amount: 0,
    currency: "TWD",
    category: "其他",
    status: "posted",
    ...overrides,
  };
}

describe("activity category chart", () => {
  it("converts cash flow to TWD and treats cards and invoices as expenses", () => {
    expect(
      activityCashAmountTwd(item({ amount: 10, currency: "USD" }), { USD: 32 }),
    ).toBe(320);
    expect(
      activityCashAmountTwd(item({ source: "card", amount: 500 }), {}),
    ).toBe(-500);
    expect(
      activityCashAmountTwd(item({ source: "invoice", amount: 500 }), {}),
    ).toBe(-500);
    expect(activityCashFlow(item({ source: "invoice", amount: 500 }))).toBe(
      "expense",
    );
  });

  it("groups categories and sorts them by amount descending", () => {
    const slices = buildActivityCategorySlices(
      [
        item({ amount: -100, category: "餐飲" }),
        item({ id: "2", amount: -300, category: "交通" }),
        item({ id: "3", amount: -50, category: "餐飲" }),
        item({ id: "4", amount: 900, category: "薪資" }),
      ],
      "expense",
      {},
    );

    expect(
      slices.map(({ category, amount }) => ({ category, amount })),
    ).toEqual([
      { category: "交通", amount: 300 },
      { category: "餐飲", amount: 150 },
    ]);
    expect(slices[0]?.percentage).toBeCloseTo(66.67, 1);
  });

  it("keeps excluded categories selectable without counting their amount", () => {
    const excluded = item({ amount: -500, excludedFromCalculation: true });

    expect(activityCashAmountTwd(excluded, {})).toBe(0);
    expect(activityCashFlow(excluded)).toBe("expense");
    expect(buildActivityCategorySlices([excluded], "expense", {})).toEqual([
      {
        category: "其他",
        amount: 0,
        percentage: 0,
        color: "#3e6f7c",
      },
    ]);
  });

  it("sorts zero-value excluded categories after counted categories", () => {
    const slices = buildActivityCategorySlices(
      [
        item({ amount: -500, category: "餐飲" }),
        item({
          id: "2",
          amount: -300,
          category: "其他",
          excludedFromCalculation: true,
        }),
      ],
      "expense",
      {},
    );

    expect(
      slices.map(({ category, amount, percentage }) => ({
        category,
        amount,
        percentage,
      })),
    ).toEqual([
      { category: "餐飲", amount: 500, percentage: 100 },
      { category: "其他", amount: 0, percentage: 0 },
    ]);
  });
});
