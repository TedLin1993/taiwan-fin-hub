import puppeteer, { type Browser, type Page } from "@cloudflare/puppeteer";
import { decode as decodeJpeg } from "jpeg-js";
import type {
  BankAccount,
  BankBalanceSnapshot,
  BankTransaction,
  CreditCardBill,
  InvestmentPosition,
  SyncResult
} from "@taiwan-fin-hub/core";
import type { SinopacConfig } from "@taiwan-fin-hub/connectors";

const LOGIN_URL = "https://mma.sinopac.com/MemberPortal/Member/NextWebLogin.aspx";
const CARD_INFO_URL = "https://mma.sinopac.com/SinoCard/Account/Info";
const CARD_STATEMENT_URL = "https://mma.sinopac.com/SinoCard/Account/StatementInquiry";
const CARD_UNBILLED_URL = "https://mma.sinopac.com/SinoCard/Account/UnbilledTxInquiry";
const US_STOCK_URL = "https://mma.sinopac.com/StockAndETF/Dashboard";
const CAPTCHA_BROWSER_KEEP_ALIVE_MS = 150_000;
const CAPTCHA_VALIDITY_MS = 120_000;

type Row = string[];
type PageSnapshot = { url: string; title: string; text: string; tables: Row[][] };
type Scraped = {
  bankAccounts: Array<Omit<BankAccount, "id" | "connectorId">>;
  bankBalanceSnapshots: Array<Omit<BankBalanceSnapshot, "id" | "connectorId">>;
  bankTransactions: Array<Omit<BankTransaction, "id" | "connectorId">>;
  creditCardBills: Array<Omit<CreditCardBill, "id" | "connectorId">>;
  records: Array<Omit<InvestmentPosition, "id" | "connectorId">>;
};

export class SinopacVerificationRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SinopacVerificationRequiredError";
  }
}

export class SinopacBrowserCapacityError extends Error {
  constructor(message: string, readonly retryAfterSeconds = 20) {
    super(message);
    this.name = "SinopacBrowserCapacityError";
  }
}

export function createSinopacConnector(browser?: Fetcher) {
  return {
    id: "sinopac" as const,
    name: "永豐銀行 MMA",
    async sync(config: SinopacConfig, cursor?: string): Promise<SyncResult<Omit<InvestmentPosition, "id" | "connectorId">>> {
      if (!config.userId || !config.account || !config.password) {
        throw new Error("永豐銀行需要身分證字號／統編、使用者代碼與網路密碼。");
      }
      if (!browser) throw new Error("永豐銀行需要 BROWSER binding 才能登入。");

      let browserInstance: Browser;
      let page: Page;
      if (config.browserSessionId && config.captcha) {
        if (!config.browserSessionExpiresAt || new Date(config.browserSessionExpiresAt) <= new Date()) {
          throw new SinopacVerificationRequiredError("永豐圖形驗證碼已逾時，請重新取得驗證碼。");
        }
        try {
          browserInstance = await puppeteer.connect(browser, config.browserSessionId);
        } catch {
          throw new SinopacVerificationRequiredError("永豐登入工作階段已失效，請重新取得圖形驗證碼。");
        }
        const pages = await browserInstance.pages();
        page = pages.find((candidate) => candidate.url().includes("NextWebLogin")) ?? pages[0];
        if (!page) {
          await browserInstance.close();
          throw new SinopacVerificationRequiredError("永豐登入工作階段沒有可用頁面，請重新取得圖形驗證碼。");
        }
      } else {
        if (!config.sessionCookies) {
          throw new SinopacVerificationRequiredError("永豐同步需要圖形驗證碼，請先完成一次人工驗證。");
        }
        browserInstance = await launchBrowser(browser);
        page = await browserInstance.newPage();
      }
      try {
        if (config.browserSessionId && config.captcha) {
          await submitLogin(page, config.captcha);
        } else {
          await configurePage(page);
          await restoreCookies(page, config.sessionCookies);
          await page.goto(CARD_INFO_URL, { waitUntil: "domcontentloaded", timeout: 20_000 });
          if (await needsLoginAfterNavigation(page)) {
            throw new SinopacVerificationRequiredError("永豐登入工作階段已失效，請重新取得圖形驗證碼。");
          }
        }

        const cards = await scrapeCards(page, config.lookbackMonths ?? 3);
        const records = await scrapeInvestments(page);
        const freshCookies = JSON.stringify(await page.cookies());
        return {
          records,
          bankAccounts: cards.bankAccounts,
          bankBalanceSnapshots: cards.bankBalanceSnapshots,
          bankTransactions: cards.bankTransactions,
          creditCardBills: cards.creditCardBills,
          cursor: JSON.stringify({
            ...(readCursor(cursor) ?? {}),
            sessionCookies: freshCookies,
            sessionExpiresAt: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
            syncedAt: new Date().toISOString()
          })
        };
      } finally {
        // A submitted CAPTCHA is single-use. Close the browser on both success
        // and failure so an invalid code cannot consume the remaining idle time.
        await browserInstance.close();
      }
    }
  };
}

export async function prepareSinopacCaptcha(browser: Fetcher | undefined, config: SinopacConfig) {
  if (!config.userId || !config.account || !config.password) {
    throw new Error("請先儲存永豐身分證字號／統編、使用者代碼與網路密碼。");
  }
  if (!browser) throw new Error("永豐銀行需要 BROWSER binding 才能取得驗證碼。");

  const browserInstance = await getCaptchaBrowser(browser, config.browserSessionId);
  const pages = await browserInstance.pages();
  const page = pages.find((candidate) => candidate.url().includes("NextWebLogin")) ?? pages[0] ?? await browserInstance.newPage();
  let preserved = false;
  try {
    await configurePage(page);
    let bytes: Uint8Array | string | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await openLoginAndFill(page, config);
      await page.waitForFunction(() => {
        const image = document.querySelector<HTMLImageElement>("#imgCode");
        return Boolean(image?.complete && image.naturalWidth > 0);
      }, { timeout: 10_000 });
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 400));
      const image = await page.$("#imgCode");
      if (!image) throw new Error("永豐登入頁沒有取得圖形驗證碼。");
      const candidate = await image.screenshot({ type: "jpeg" });
      if (captchaHasVisibleDigits(candidate)) {
        bytes = candidate;
        break;
      }
    }
    if (!bytes) throw new Error("永豐圖形驗證碼影像為空白，請稍後再試。");
    const sessionId = browserInstance.sessionId();
    await browserInstance.disconnect();
    preserved = true;
    return {
      browserSessionId: sessionId,
      browserSessionExpiresAt: new Date(Date.now() + CAPTCHA_VALIDITY_MS).toISOString(),
      captchaImage: `data:image/jpeg;base64,${bytesToBase64(bytes)}`
    };
  } finally {
    if (!preserved) await browserInstance.close();
  }
}

async function getCaptchaBrowser(browser: Fetcher, preferredSessionId?: string) {
  if (preferredSessionId) {
    const sessions = await puppeteer.sessions(browser).catch(() => []);
    const preferred = sessions.find((session) => session.sessionId === preferredSessionId);
    if (preferred?.connectionId) {
      throw new SinopacBrowserCapacityError("永豐驗證碼正在產生中，請稍候再試。", 3);
    }
    if (preferred) {
      try {
        return await puppeteer.connect(browser, preferred.sessionId);
      } catch {
        throw new SinopacBrowserCapacityError("前一個永豐驗證工作階段尚未釋放，請稍候再試。", 3);
      }
    }
  }

  const limits = await puppeteer.limits(browser).catch(() => undefined);
  if (limits && limits.allowedBrowserAcquisitions < 1) {
    const retryAfterSeconds = Math.max(1, Math.ceil(limits.timeUntilNextAllowedBrowserAcquisition / 1000));
    throw new SinopacBrowserCapacityError("Cloudflare 瀏覽器啟動頻率已達上限，請稍後再取得驗證碼。", retryAfterSeconds);
  }
  return launchBrowser(browser, { keep_alive: CAPTCHA_BROWSER_KEEP_ALIVE_MS });
}

async function launchBrowser(browser: Fetcher, options?: { keep_alive?: number }) {
  try {
    return await puppeteer.launch(browser, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/Browser time limit exceeded for today/i.test(message)) {
      throw new SinopacBrowserCapacityError("Cloudflare 瀏覽器今日使用額度已用完，請於額度重置後再試。", 60);
    }
    if (/code:\s*429|rate limit exceeded/i.test(message)) {
      throw new SinopacBrowserCapacityError("Cloudflare 瀏覽器暫時達到使用上限，請稍後再試。", 20);
    }
    throw error;
  }
}

async function configurePage(page: Page) {
  await page.setViewport({ width: 1280, height: 900 });
  await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131 Safari/537.36");
}

async function restoreCookies(page: Page, serialized?: string) {
  if (!serialized) return;
  try {
    const cookies = JSON.parse(serialized);
    if (Array.isArray(cookies) && cookies.length) await page.setCookie(...cookies);
  } catch {
    // A stale or malformed session must not prevent a fresh login.
  }
}

async function needsLogin(page: Page) {
  return page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>('input[placeholder="使用者代碼"]');
    if (!input) return false;
    const style = getComputedStyle(input);
    const rect = input.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  });
}

async function needsLoginAfterNavigation(page: Page) {
  try {
    return await needsLogin(page);
  } catch (error) {
    if (!(error instanceof Error) || !/Execution context was destroyed/i.test(error.message)) throw error;
    await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 10_000 }).catch(() => null);
    return needsLogin(page);
  }
}

async function openLoginAndFill(page: Page, config: SinopacConfig) {
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 20_000 });
  await page.waitForSelector('input[placeholder="身分證字號(統一編號)"]', { timeout: 30_000 });
  await page.type('input[placeholder="身分證字號(統一編號)"]', config.userId!);
  await page.type('input[placeholder="使用者代碼"]', config.account!);
  await page.type('input[placeholder="網路密碼"]', config.password!);
}

async function submitLogin(page: Page, captcha: string) {
  let stage = "填寫圖形驗證碼";
  let dialogMessage = "";
  try {
    await page.type("#ctl00_ctl00_ContentPlaceHolder1_DefaultContent_captcha", captcha);
    stage = "送出登入";
    let resolveDialog: (() => void) | undefined;
    const dialogSignal = new Promise<void>((resolve) => { resolveDialog = resolve; });
    page.once("dialog", async (dialog) => {
      dialogMessage = dialog.message();
      const isAlert = dialog.type() === "alert";
      await dialog.accept();
      if (isAlert) resolveDialog?.();
    });
    const navigation = page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => null);
    const loginStateChanged = page.waitForFunction(() => {
      const input = document.querySelector<HTMLInputElement>('input[placeholder="使用者代碼"]');
      const visible = input && getComputedStyle(input).display !== "none" && getComputedStyle(input).visibility !== "hidden" && input.getBoundingClientRect().width > 0;
      return !visible || /驗證碼錯誤|驗證碼有誤|密碼錯誤|登入失敗|使用者代碼錯誤/.test(document.body.innerText);
    }, { timeout: 20_000 }).catch(() => null);
    await page.click("#MMA_Login");
    await Promise.race([navigation, loginStateChanged, dialogSignal]);
    stage = "確認登入結果";
    await page.waitForFunction(() => document.readyState !== "loading", { timeout: 8_000 }).catch(() => undefined);
    if (await needsLoginAfterNavigation(page)) {
      const message = await page.evaluate(() => {
        const text = document.body.innerText.replace(/\s+/g, " ").trim();
        return text.match(/.{0,40}(?:驗證碼錯誤|驗證碼有誤|密碼錯誤|登入失敗|使用者代碼錯誤).{0,100}/)?.[0] ?? "";
      }).catch(() => "");
      throw new SinopacVerificationRequiredError(`永豐銀行登入失敗：${dialogMessage || message || "請確認帳密或驗證碼"}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new SinopacVerificationRequiredError(`永豐登入在「${stage}」失敗：${message}`);
  }
}

function bytesToBase64(bytes: Uint8Array | string) {
  if (typeof bytes === "string") return bytes;
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
  return btoa(binary);
}

function captchaHasVisibleDigits(bytes: Uint8Array | string) {
  if (typeof bytes === "string") return bytes.length > 100;
  try {
    const decoded = decodeJpeg(bytes, { useTArray: true });
    const pixels = decoded.width * decoded.height;
    if (pixels === 0) return false;
    let darkPixels = 0;
    for (let offset = 0; offset < decoded.data.length; offset += 4) {
      const luminance = 0.299 * (decoded.data[offset] ?? 255)
        + 0.587 * (decoded.data[offset + 1] ?? 255)
        + 0.114 * (decoded.data[offset + 2] ?? 255);
      if (luminance < 170) darkPixels += 1;
    }
    return darkPixels / pixels >= 0.12;
  } catch {
    return false;
  }
}

async function scrapeCards(page: Page, lookbackMonths: number): Promise<Scraped> {
  const accountId = "credit:sinopac:dawho";
  const account: Omit<BankAccount, "id" | "connectorId"> = {
    sourceId: accountId,
    institutionName: "永豐銀行",
    accountName: "永豐信用卡",
    accountType: "credit",
    currency: "TWD",
    raw: { provider: "sinopac.dawho", source: CARD_INFO_URL }
  };
  const snapshots: Array<Omit<BankBalanceSnapshot, "id" | "connectorId">> = [];
  const bills: Array<Omit<CreditCardBill, "id" | "connectorId">> = [];
  const transactions: Array<Omit<BankTransaction, "id" | "connectorId">> = [];

  const info = await visit(page, CARD_INFO_URL);
  const statement = await visit(page, CARD_STATEMENT_URL);
  const unbilled = await visit(page, CARD_UNBILLED_URL);
  const now = new Date().toISOString();
  const currentPeriod = periodFromText(statement.text) ?? now.slice(0, 7);
  const statementAmount = firstLabelAmount(statement.text, /(本期應繳|應繳金額|帳單金額)/);
  const minimumPayment = firstLabelAmount(statement.text, /(最低應繳|最低繳款)/);
  const dueDate = firstDateAfter(statement.text, /(繳款截止|繳費截止|繳款期限)/);
  const closingDate = firstDateAfter(statement.text, /(結帳日|結帳日期)/);
  const parsedBills = parseBills(statement.tables, lookbackMonths);
  if (parsedBills.length) bills.push(...parsedBills.map((bill) => ({ ...bill, accountId })));
  else if (statementAmount != null) {
    bills.push({
      accountId,
      sourceId: `sinopac:card:statement:${currentPeriod}`,
      billingPeriod: currentPeriod,
      statementAmount,
      minimumPayment: minimumPayment ?? undefined,
      paymentDueDate: dueDate,
      statementClosingDate: closingDate,
      currency: "TWD",
      raw: { source: CARD_STATEMENT_URL, text: statement.text.slice(0, 4000) }
    });
  }
  const balance = statementAmount ?? firstLabelAmount(info.text, /(未繳金額|待繳金額|目前欠款)/);
  if (balance != null) {
    snapshots.push({
      accountId,
      sourceId: `sinopac:card:balance:${now.slice(0, 10)}`,
      balance,
      statementBalance: statementAmount ?? undefined,
      paymentDueDate: dueDate,
      statementClosingDate: closingDate,
      currency: "TWD",
      asOfAt: now,
      raw: { source: CARD_INFO_URL }
    });
  }
  transactions.push(...parseCardTransactions(unbilled.tables, accountId));
  return { bankAccounts: [account], bankBalanceSnapshots: snapshots, bankTransactions: transactions, creditCardBills: bills, records: [] };
}

async function scrapeInvestments(page: Page): Promise<Array<Omit<InvestmentPosition, "id" | "connectorId">>> {
  const snapshot = await visit(page, US_STOCK_URL);
  const asOfDate = dateOnly(firstDateAfter(snapshot.text, /(資料日期|查詢日期|更新時間)/)) ?? new Date().toISOString().slice(0, 10);
  return parseInvestmentRows(snapshot.tables, asOfDate);
}

async function visit(page: Page, url: string): Promise<PageSnapshot> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
  await page.waitForFunction(() => document.body?.innerText?.length > 0, { timeout: 8_000 });
  const snapshot = await page.evaluate(() => ({
    url: location.href,
    title: document.title,
    text: document.body.innerText,
    tables: Array.from(document.querySelectorAll("table")).map((table) =>
      Array.from(table.querySelectorAll("tr")).map((row) => Array.from(row.querySelectorAll("th,td")).map((cell) => (cell.textContent ?? "").replace(/\s+/g, " ").trim()).filter(Boolean))
    ).filter((rows) => rows.length > 0)
  }));
  if (snapshot.url.includes("NextWebLogin")) throw new SinopacVerificationRequiredError("永豐銀行工作階段已失效，請重新取得圖形驗證碼。");
  return snapshot;
}

export function parseAmount(value: string | undefined): number | undefined {
  if (!value || /%/.test(value)) return undefined;
  const normalized = value.replace(/NT\$|US\$|HK\$|[$,\s]/gi, "").replace(/^\((.*)\)$/, "-$1");
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return undefined;
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : undefined;
}

export function parseDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = value.match(/(\d{3,4})[\/-](\d{1,2})[\/-](\d{1,2})/);
  if (!match) return undefined;
  const year = Number(match[1]) < 1911 ? Number(match[1]) + 1911 : Number(match[1]);
  return `${year.toString().padStart(4, "0")}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function parseBills(tables: Row[][], lookbackMonths: number) {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - lookbackMonths);
  const out: Array<Omit<CreditCardBill, "id" | "connectorId" | "accountId">> = [];
  for (const rows of tables) {
    const headers = rows[0]?.map(normalizeLabel) ?? [];
    const periodIndex = headers.findIndex((h) => /帳單期|繳款期|月份|期間/.test(h));
    const amountIndex = headers.findIndex((h) => /本期應繳|應繳金額|帳單金額|總金額/.test(h));
    const minimumIndex = headers.findIndex((h) => /最低應繳|最低繳款/.test(h));
    if (periodIndex < 0 && amountIndex < 0) continue;
    for (const row of rows.slice(1)) {
      const period = periodFromText(row[periodIndex] ?? row.join(" "));
      const statementAmount = parseAmount(row[amountIndex] ?? findNumericCell(row));
      if (!period || statementAmount == null) continue;
      const periodDate = new Date(`${period}-01`);
      if (periodDate < cutoff) continue;
      out.push({
        sourceId: `sinopac:card:statement:${period}`,
        billingPeriod: period,
        statementAmount,
        minimumPayment: parseAmount(row[minimumIndex]),
        paymentDueDate: row.map(parseDate).find(Boolean),
        currency: "TWD",
        raw: { row, headers }
      });
    }
  }
  return Array.from(new Map(out.map((bill) => [bill.billingPeriod, bill])).values());
}

function parseCardTransactions(tables: Row[][], accountId: string) {
  const out: Array<Omit<BankTransaction, "id" | "connectorId">> = [];
  for (const rows of tables) {
    const headers = rows[0]?.map(normalizeLabel) ?? [];
    const dateIndex = headers.findIndex((h) => /交易日|消費日|日期/.test(h));
    const amountIndex = headers.findIndex((h) => /金額|消費金額|交易金額/.test(h));
    if (dateIndex < 0 || amountIndex < 0) continue;
    for (const row of rows.slice(1)) {
      const postedDate = parseDate(row[dateIndex]);
      const amount = parseAmount(row[amountIndex]);
      if (!postedDate || amount == null) continue;
      out.push({ accountId, sourceId: `sinopac:card:tx:${postedDate}:${row.join("|")}`, postedDate, amount, currency: "TWD", description: row.filter((_, i) => i !== dateIndex && i !== amountIndex).join(" "), raw: { row, headers } });
    }
  }
  return out;
}

export function parseInvestmentRows(tables: Row[][], asOfDate: string): Array<Omit<InvestmentPosition, "id" | "connectorId">> {
  const out: Array<Omit<InvestmentPosition, "id" | "connectorId">> = [];
  for (const rows of tables) {
    const headers = rows[0]?.map(normalizeLabel) ?? [];
    const symbolIndex = headers.findIndex((h) => /代號|股票代碼|商品代碼|ticker|symbol/i.test(h));
    const nameIndex = headers.findIndex((h) => /名稱|商品名稱|股票名稱|name/i.test(h));
    const quantityIndex = headers.findIndex((h) => /股數|數量|持有數量|quantity/i.test(h));
    const valueIndex = headers.findIndex((h) => /市值|評估金額|目前價值|market.?value/i.test(h));
    const currencyIndex = headers.findIndex((h) => /幣別|currency/i.test(h));
    for (const row of rows.slice(1)) {
      const symbol = (row[symbolIndex] ?? row.find((cell) => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(cell.trim())) ?? "").trim();
      if (!symbol) continue;
      const name = (row[nameIndex] ?? symbol).trim();
      const quantity = parseAmount(row[quantityIndex] ?? findNumericCell(row));
      const marketValue = parseAmount(row[valueIndex] ?? findNumericCell(row, quantityIndex >= 0 ? quantityIndex : undefined));
      if (quantity == null && marketValue == null) continue;
      const currency = (row[currencyIndex] ?? row.find((cell) => /^(USD|TWD|HKD|CNY|JPY|EUR)$/.test(cell.trim().toUpperCase())) ?? "USD").trim().toUpperCase();
      const assetType = /ETF|基金|FUND/i.test(name) ? ( /ETF/i.test(name) ? "etf" : "fund") : "stock";
      out.push({
        sourceId: `sinopac:dawho:stock-etf:${currency}:${symbol}`,
        assetType,
        symbol,
        name,
        quantity,
        marketValue,
        currency,
        asOfDate,
        raw: { provider: "sinopac.dawho", source: US_STOCK_URL, row, headers }
      });
    }
  }
  return Array.from(new Map(out.map((position) => [position.sourceId, position])).values());
}

function normalizeLabel(value: string) { return value.toLowerCase().replace(/[\s_\/]/g, ""); }
function findNumericCell(row: string[], except?: number) { return row.find((cell, index) => index !== except && parseAmount(cell) != null); }
function periodFromText(text: string) { const match = text.match(/(20\d{2})[\/-](\d{1,2})|((?:10\d|11\d|[1-9]\d?))[\/-](\d{1,2})/); if (!match) return undefined; const year = match[1] ? Number(match[1]) : Number(match[3]) + 1911; return `${year}-${(match[2] ?? match[4]).padStart(2, "0")}`; }
function firstLabelAmount(text: string, label: RegExp) { const match = text.match(new RegExp(`${label.source}[^\\d-]{0,20}(-?[\\d,]+(?:\\.\\d+)?)`)); return parseAmount(match?.[1]); }
function firstDateAfter(text: string, label: RegExp) { const index = text.search(label); return index < 0 ? undefined : parseDate(text.slice(index, index + 50)); }
function dateOnly(value: string | undefined) { return value?.slice(0, 10); }
function readCursor(cursor?: string) { try { return cursor ? JSON.parse(cursor) as Record<string, unknown> : undefined; } catch { return undefined; } }
