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
    else if (path === "/api/investments") body = [];
    else if (path === "/api/investment-transactions") body = [];
    else if (path === "/api/invoices") body = [];
    else if (path === "/api/manual-assets") body = [];
    else if (path === "/api/exchange-rates") body = [];
    else if (path === "/api/history/net-worth") body = [];
    else if (path === "/api/sync-jobs") body = [];
    else if (path === "/api/classification/categories")
      body = [
        { id: "salary", label: "薪資", sortOrder: 1, isSystem: true },
        { id: "transfer", label: "轉帳", sortOrder: 2, isSystem: true },
        { id: "food", label: "餐飲", sortOrder: 3, isSystem: true },
        { id: "transport", label: "交通", sortOrder: 4, isSystem: true },
        { id: "shopping", label: "購物", sortOrder: 5, isSystem: true },
        { id: "housing", label: "居住", sortOrder: 6, isSystem: true },
        { id: "health", label: "醫療", sortOrder: 7, isSystem: true },
        { id: "education", label: "教育", sortOrder: 8, isSystem: true },
        {
          id: "entertainment",
          label: "娛樂",
          sortOrder: 9,
          isSystem: true,
        },
        { id: "investment", label: "投資", sortOrder: 10, isSystem: true },
        { id: "fee", label: "手續費", sortOrder: 11, isSystem: true },
        { id: "insurance", label: "保險", sortOrder: 12, isSystem: true },
        { id: "tax", label: "稅務", sortOrder: 13, isSystem: true },
        { id: "other", label: "其他", sortOrder: 14, isSystem: true },
      ];
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

test("excludes a bank transaction from activity calculations and restores it", async ({
  page,
}) => {
  let excludedFromCalculation = false;
  const month = new Date().toISOString().slice(0, 7);

  await page.route("**/api/bank", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        accounts: [
          {
            id: "account-1",
            connectorId: "cathaybk",
            sourceId: "account-source-1",
            institutionName: "測試銀行",
            accountName: "活期帳戶",
            accountType: "checking",
            currency: "TWD",
          },
        ],
        transactions: [
          {
            id: "transaction-1",
            connectorId: "cathaybk",
            accountId: "account-1",
            sourceId: "transaction-source-1",
            postedDate: `${month}-07`,
            amount: -8318,
            currency: "TWD",
            description: "台新卡費",
            status: "posted",
            excludedFromCalculation,
            classification: {
              categoryId: "other",
              label: "其他",
              source: "fallback",
            },
          },
        ],
      }),
    });
  });
  await page.route(
    "**/api/bank/transactions/transaction-1/calculation",
    async (route) => {
      const body = route.request().postDataJSON() as {
        excludedFromCalculation: boolean;
      };
      excludedFromCalculation = body.excludedFromCalculation;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, excludedFromCalculation }),
      });
    },
  );

  await page.goto("/#/activity");
  const expenseSlice = page.getByRole("button", {
    name: "其他 100.0% NT$8,318",
  });
  await expect(expenseSlice).toBeVisible();

  await page.getByRole("button", { name: "排除 台新卡費 的統計計算" }).click();
  await expect(
    page.getByRole("button", { name: "恢復 台新卡費 的統計計算" }),
  ).toBeVisible();
  await expect(expenseSlice).toBeHidden();

  await page.reload();
  await expect(
    page.getByRole("button", { name: "恢復 台新卡費 的統計計算" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "恢復 台新卡費 的統計計算" }).click();
  await expect(
    page.getByRole("button", { name: "排除 台新卡費 的統計計算" }),
  ).toBeVisible();
  await expect(expenseSlice).toBeVisible();
});
