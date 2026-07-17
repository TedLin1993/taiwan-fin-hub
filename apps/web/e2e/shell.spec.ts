import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown;
    if (path === "/api/runtime") body = { demoMode: true };
    else if (path === "/api/summary")
      body = {
        totalAssetsTwd: 0,
        totalLiabilitiesTwd: 0,
        netWorthTwd: 0,
        monthlyIncomeTwd: 0,
        monthlyExpenseTwd: 0,
        accounts: 0,
        investments: 0,
        transactions: 0,
      };
    else if (path === "/api/bank") body = { accounts: [], transactions: [] };
    else if (path === "/api/investments")
      body = [
        {
          id: "position-1",
          assetType: "stock",
          symbol: "2330",
          name: "台積電",
          quantity: 10,
          marketValue: 12400,
          currency: "TWD",
          asOfDate: "2026-07-17",
        },
      ];
    else if (path === "/api/investments/performance")
      body = {
        positions: [
          {
            positionId: "position-1",
            costBasis: 10000,
            averageCost: 1000,
            profitLoss: 2400,
            returnRate: 24,
            available: true,
          },
        ],
        points: [
          {
            date: "2026-07-16",
            marketValue: 12000,
            costBasis: 10000,
            profitLoss: 2000,
          },
          {
            date: "2026-07-17",
            marketValue: 12400,
            costBasis: 10000,
            profitLoss: 2400,
          },
        ],
        totalCostBasis: 10000,
        currentProfitLoss: 2400,
        currentReturnRate: 24,
        periodStart: "2026-07-16",
        periodEnd: "2026-07-17",
        coveredPositions: 1,
        totalPositions: 1,
        estimated: true,
      };
    else if (path === "/api/investment-transactions") body = [];
    else if (path === "/api/invoices") body = [];
    else if (path === "/api/manual-assets") body = [];
    else if (path === "/api/exchange-rates") body = [];
    else if (path === "/api/history/net-worth") body = [];
    else if (path === "/api/sync-jobs") body = [];
    else if (path === "/api/classification/rules") body = [];
    else if (path.includes("/connectors/") && path.endsWith("/settings"))
      body = { configured: false, publicConfig: {} };
    else throw new Error(`Unexpected API request in E2E mock: ${path}`);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
});

test("loads the responsive shell and changes primary views", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("Taiwan Fin Hub").first()).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "總覽", exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "資產" }).first().click();
  await expect(
    page.getByRole("heading", { name: "資產", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/#\/assets$/);

  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "總覽", exact: true }),
  ).toBeVisible();
});

test("renders the mobile bottom navigation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("navigation", { name: "主要導覽" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "更多" }).click();
  await expect(
    page.getByRole("heading", { name: "更多", exact: true }),
  ).toBeVisible();
});

test("uses app-like scrolling and history only in standalone display mode", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("html")).not.toHaveClass(/is-standalone/);
  await expect(page.locator("html")).toHaveCSS("touch-action", "manipulation");

  await page.addInitScript(() => {
    const nativeMatchMedia = window.matchMedia.bind(window);
    window.matchMedia = (query: string) => {
      if (query !== "(display-mode: standalone)")
        return nativeMatchMedia(query);
      return {
        matches: true,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => true,
      };
    };
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();

  await expect(page.locator("html")).toHaveClass(/is-standalone/);
  await expect(page.locator("html")).toHaveCSS("overflow", "hidden");
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
  await expect(page.locator("#root")).toHaveCSS("touch-action", "pan-x pan-y");
  await expect(page.locator("#root")).toHaveCSS("overflow-y", "auto");
  await expect(page.locator("#root")).toHaveCSS("overscroll-behavior", "none");

  const historyLength = await page.evaluate(() => window.history.length);
  await page.getByRole("button", { name: "資產", exact: true }).last().click();
  await expect(page).toHaveURL(/#\/assets$/);
  await expect(
    page.getByRole("heading", { name: "資產", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => window.history.length)).toBe(historyLength);
});

test("opens a primary view from its hash route", async ({ page }) => {
  await page.goto("/#/invoices");
  await expect(
    page.getByRole("heading", { name: "發票", exact: true }),
  ).toBeVisible();
});

test("shows unrealized investment profit and its history", async ({ page }) => {
  await page.goto("/#/investments");
  await expect(
    page.getByRole("heading", { name: "投資", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("未實現損益走勢")).toBeVisible();
  await expect(page.getByText("+NT$2,400").first()).toBeVisible();
  await expect(page.getByText("+24.00%")).toBeVisible();
});
