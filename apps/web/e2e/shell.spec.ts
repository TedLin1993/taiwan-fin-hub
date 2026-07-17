import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown;
    if (path === "/api/runtime") body = { demoMode: false };
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
    else if (path === "/api/sync-jobs")
      body = [
        {
          id: "einvoice:all",
          connectorId: "einvoice",
          scope: "all",
          enabled: true,
          intervalMinutes: 1440,
          nextRunAt: "2026-07-17T22:50:00.000Z",
          scheduleMode: "inherit",
          preferredTime: "06:50",
          lockedUntil: null,
          lockedBy: null,
          lockTrigger: null,
          lockScope: null,
          lastRunAt: "2026-07-16T22:50:00.000Z",
          lastSuccessAt: "2026-07-16T22:50:00.000Z",
          lastStatus: "success",
          lastError: null,
          updatedAt: "2026-07-16T22:50:00.000Z",
          running: false,
        },
      ];
    else if (path === "/api/sync-schedule")
      body = {
        intervalMinutes: 1440,
        preferredTime: "06:50",
        timezone: "Asia/Taipei",
        updatedAt: "2026-07-16T10:50:00.000Z",
      };
    else if (path === "/api/classification/rules") body = [];
    else if (path.includes("/connectors/") && path.endsWith("/settings"))
      body = path.includes("/connectors/einvoice/")
        ? {
            configured: true,
            updatedAt: "2026-07-16T10:50:00.000Z",
            publicConfig: { periodsBack: 1, fetchDetails: true },
          }
        : { configured: false, publicConfig: {} };
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

test("shows the settings dashboard at a glance", async ({ page }) => {
  await page.goto("/#/settings");

  await expect(
    page.getByText("資料來源", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("同步排程", { exact: true })).toBeVisible();
  await expect(page.getByText("需要處理", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "電子發票" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "預設同步排程" }),
  ).toBeVisible();
  const scheduleCard = page
    .getByRole("heading", { name: "預設同步排程" })
    .locator("xpath=ancestor::section[1]");
  await expect(scheduleCard.locator('input[type="time"]')).toHaveCount(0);
  const timePicker = scheduleCard.locator("[data-popover-trigger]");
  await expect(timePicker).toHaveAccessibleName("選擇時間，目前 06:50");
  await timePicker.click();
  const timePopover = page.locator("[data-popover-content]");
  await expect(timePopover.getByText("選擇同步時間")).toBeVisible();
  await timePopover.getByLabel("分鐘").selectOption("40");
  await expect(timePicker).toHaveAccessibleName("選擇時間，目前 06:40");
  await timePopover.getByRole("button", { name: "完成" }).click();
  await expect(timePopover).not.toBeVisible();
  await expect(page.getByRole("heading", { name: "匯率" })).toBeVisible();
  await expect(page.getByText("目前沒有外幣帳戶")).toBeVisible();
  await expect(page.getByRole("heading", { name: "資料安全" })).toBeVisible();
  await expect(page.getByPlaceholder("比對文字")).toBeVisible();

  const invoiceCard = page
    .getByRole("heading", { name: "電子發票" })
    .locator("xpath=ancestor::div[contains(@class, 'bg-card')][1]");
  await invoiceCard.getByRole("button", { name: "管理設定" }).click();
  await expect(
    invoiceCard.getByRole("heading", { name: "連線與同步" }),
  ).toBeVisible();
  await expect(
    invoiceCard.getByRole("heading", { name: "連線憑證" }),
  ).toBeVisible();
  await expect(invoiceCard.getByText("App ID", { exact: true })).toHaveCount(0);
  await expect(invoiceCard.getByText("API Key", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    invoiceCard.getByText("手機號碼（電子發票帳號）", { exact: true }),
  ).toBeVisible();
  await expect(
    invoiceCard.getByText("電子發票 App 登入密碼", { exact: true }),
  ).toBeVisible();
  await expect(invoiceCard.getByText("已儲存", { exact: true })).toHaveCount(2);
  await expect(invoiceCard.getByText(/跟隨預設：.*每天.*06:50/)).toBeVisible();
});
