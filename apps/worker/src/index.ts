import {
  einvoiceConnector,
  EInvoiceProtocolUnavailableError,
  parseConnectorConfig,
  parseCathaybkConfig,
  parseEsunConfig,
  parseInvoiceConfig,
  parseSinopacConfig,
  parseTdccConfig,
  syncTdccTradeHistory,
  tdccConnector,
  TdccOtpExpiredError
} from "@taiwan-fin-hub/connectors";
import { createCathaybkConnector } from "./cathaybk";
import { createEsunConnector } from "./esun";
import {
  createSinopacConnector,
  prepareSinopacCaptcha,
  SinopacBrowserCapacityError,
  SinopacVerificationRequiredError
} from "./sinopac";
import {
  type BankAccount,
  type BankBalanceSnapshot,
  type BankTransaction,
  type ConnectorId,
  type CreditCardBill,
  type InvestmentPosition,
  type InvestmentTransaction,
  type InvoiceLineItem,
  type NetWorthHistoryPoint,
  isConnectorId
} from "@taiwan-fin-hub/core";
import {
  acquireSyncJobLock,
  completeSyncJob,
  failSyncJob,
  findNextDueSyncJob,
  getConnectorSettings,
  markManualSyncFailure,
  markManualSyncSuccess,
  nextSyncRunAt,
  releaseSyncJobLock,
  renewSyncJobLock,
  type SyncJobRow,
  type SyncScheduleMode,
  type SyncStatus,
  type SyncTrigger,
  upsertConnectorSettings
} from "@taiwan-fin-hub/db";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { verifyAccessIdentity } from "./access-auth";
import { resolveClassifications, type ClassificationResult } from "./classification";
import { encryptJson, decryptJson } from "./crypto";
import type { AppBindings, Env } from "./env";
import {
  apiErrorResponse,
  demoReadOnlyMiddleware,
  isDemoMode,
  jsonError,
  parsePagination,
  setPaginationHeaders
} from "./http";
import { readValidateNumberFromImage } from "./validate-number-ocr";
import { registerExchangeRateRoutes } from "./routes/exchange-rates";
import { registerClassificationRoutes } from "./routes/classification";
import { registerInvoiceRoutes } from "./routes/invoices";
import { registerManualAssetRoutes } from "./routes/manual-assets";

type SyncScope =
  | "all"
  | "investments"
  | "bank"
  | "trades"
  | "investments+bank"
  | "investments+trades"
  | "bank+trades";

const SYNC_SCOPE_ALL = "all";
const TDCC_SCOPE_INVESTMENTS = "investments";
const TDCC_SCOPE_BANK = "bank";
const TDCC_SCOPE_TRADES = "trades";
const SYNC_LOCK_LEASE_MS = 30 * 60 * 1000;
const SYNC_LOCK_HEARTBEAT_MS = 5 * 60 * 1000;
const MAX_SCHEDULED_JOBS_PER_TICK = 3;

type SyncOutcome = {
  success: true;
  connectorId: ConnectorId;
  scope: SyncScope;
  records: number;
  cursorUpdated: boolean;
  detailRecords?: number;
};

class SyncAlreadyRunningError extends Error {
  constructor(readonly connectorId: ConnectorId) {
    super(`${connectorId} sync is already running.`);
  }
}

class NeedsUserActionError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export const app = new Hono<AppBindings>();
export const api = new Hono<AppBindings>();

const settingsBodySchema = z.object({
  config: z.record(z.string(), z.unknown())
});

const syncIntervalSchema = z.number().int().refine(
  (value) => [60, 360, 720, 1440, 10080].includes(value),
  "Unsupported sync interval."
);
const preferredTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const preferredWeekdaySchema = z.number().int().min(0).max(6);
const syncScheduleUpdateSchema = z.object({
  intervalMinutes: syncIntervalSchema,
  preferredTime: preferredTimeSchema,
  preferredWeekday: preferredWeekdaySchema
});

const PUBLIC_FIELDS: Record<string, string[]> = {
  esun: ["lookbackMonths"],
  cathaybk: ["lookbackMonths"],
  sinopac: ["lookbackMonths"],
  einvoice: ["periodsBack", "fetchDetails"]
};

const tdccSyncBodySchema = z.object({
  otp: z.string().min(1).optional(),
  otpChannel: z.enum(["email", "sms"]).optional()
});

const einvoiceSyncBodySchema = z.object({
  fetchDetails: z.boolean().optional()
});

const sinopacSyncBodySchema = z.object({
  captcha: z.string().regex(/^\d{6}$/).optional()
});

const bankHistoryRebuildBodySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
});

const syncJobUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  nextRunAt: z.string().datetime().optional(),
  intervalMinutes: syncIntervalSchema.optional(),
  preferredTime: preferredTimeSchema.optional(),
  preferredWeekday: preferredWeekdaySchema.optional(),
  scheduleMode: z.enum(["inherit", "custom"]).optional()
}).refine(
  data => Object.values(data).some(value => value !== undefined),
  "At least one sync job setting is required."
);
const scheduledSyncScopeSchema = z.literal("all");

function requireAccessSecrets(env: Env): asserts env is Env & { TEAM_DOMAIN: string } {
  if (!env.TEAM_DOMAIN || (!env.POLICY_AUD && !env.POLICY_AUDS)) {
    throw new Error("TEAM_DOMAIN and POLICY_AUD or POLICY_AUDS are required unless DEMO_MODE is enabled.");
  }
}

function configEncryptionKey(env: Env) {
  if (!env.CONFIG_ENCRYPTION_KEY) {
    throw new Error("CONFIG_ENCRYPTION_KEY is required for connector settings and sync.");
  }

  return env.CONFIG_ENCRYPTION_KEY;
}

type DefaultSyncSchedule = {
  intervalMinutes: number;
  preferredTime: string;
  preferredWeekday: number;
  timezone: "Asia/Taipei";
  updatedAt: string;
};

async function getDefaultSyncSchedule(db: D1Database) {
  const schedule = await db.prepare(
    `SELECT
       interval_minutes AS intervalMinutes,
       preferred_time AS preferredTime,
       preferred_weekday AS preferredWeekday,
       timezone,
       updated_at AS updatedAt
     FROM sync_schedule_settings
     WHERE id = 'default'`
  ).first<DefaultSyncSchedule>();
  if (!schedule) throw new Error("Default sync schedule is not configured.");
  return schedule;
}

api.use("*", async (c, next) => {
  if (isDemoMode(c.env)) {
    await next();
    return;
  }

  requireAccessSecrets(c.env);

  const identity = await verifyAccessIdentity(c.req.raw, c.env);
  if (!identity.ok) {
    return c.json(
      {
        success: false,
        error: {
          code: "UNAUTHORIZED",
          message: identity.message
        }
      },
      401
    );
  }

  await next();
});

api.use("*", demoReadOnlyMiddleware);

api.get("/runtime", (c) =>
  c.json({
    demoMode: isDemoMode(c.env)
  })
);

api.use("/connectors/:connectorId/*", async (c, next) => {
  const connectorId = c.req.param("connectorId");
  if (!isConnectorId(connectorId)) {
    return c.json(
      {
        success: false,
        error: {
          code: "CONNECTOR_NOT_FOUND",
          message: "Connector id is not supported."
        }
      },
      404
    );
  }

  c.set("connectorId", connectorId);
  await next();
});

registerManualAssetRoutes(api);
registerExchangeRateRoutes(api);
registerInvoiceRoutes(api);
registerClassificationRoutes(api);

api.get("/summary", async (c) => {
  const [invoiceRow, investmentRow, bankAccountRow, bankBalanceRow] = await Promise.all([
    c.env.DB.prepare("SELECT COUNT(*) AS count FROM invoices").first<{ count: number }>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS count, COALESCE(SUM(market_value), 0) AS total
       FROM investment_positions
       WHERE as_of_date = (
         SELECT MAX(p2.as_of_date) FROM investment_positions p2
         WHERE p2.connector_id = investment_positions.connector_id
           AND p2.asset_type = investment_positions.asset_type
       )`
    ).first<{ count: number; total: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) AS count FROM bank_accounts WHERE canonical_account_id IS NULL").first<{ count: number }>(),
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(balance), 0) AS total
      FROM bank_balance_snapshots
      WHERE id IN (
        SELECT (
          SELECT latest.id
          FROM bank_balance_snapshots latest
          WHERE latest.account_id = account.id
          ORDER BY latest.as_of_at DESC, latest.updated_at DESC
          LIMIT 1
        )
        FROM bank_accounts account
        WHERE account.canonical_account_id IS NULL
      )`
    ).first<{ total: number }>()
  ]);

  return c.json({
    invoiceCount: invoiceRow?.count ?? 0,
    investmentCount: investmentRow?.count ?? 0,
    totalInvestmentValue: investmentRow?.total ?? 0,
    bankAccountCount: bankAccountRow?.count ?? 0,
    totalBankBalance: bankBalanceRow?.total ?? 0
  });
});

api.post("/ocr/validate-number", async (c) => {
  const contentType = c.req.header("Content-Type")?.split(";")[0]?.trim().toLowerCase();
  if (!contentType || !["image/jpeg", "image/jpg"].includes(contentType)) {
    return jsonError(
      "INVALID_CONTENT_TYPE",
      "Request body must be an image/jpeg payload."
    );
  }

  const imageBytes = await c.req.arrayBuffer();
  if (imageBytes.byteLength === 0) {
    return jsonError("EMPTY_IMAGE", "Request body must include an image.");
  }

  if (imageBytes.byteLength > 256_000) {
    return jsonError("IMAGE_TOO_LARGE", "Captcha image must be 256 KB or smaller.");
  }

  const result = await readValidateNumberFromImage(imageBytes, { contentType });
  if (!/^\d{6}$/.test(result.text)) {
    return jsonError("OCR_FAILED", "Could not read a 6 digit validation number.", 422);
  }

  return c.json({
    number: result.text,
    confidence: result.confidence,
    digits: result.digits,
    image: {
      width: result.width,
      height: result.height
    }
  });
});

api.get("/investments", async (c) => {
  const { limit, offset } = parsePagination(c.req.query(), 100);
  const result = await c.env.DB.prepare(
    `SELECT
      id,
      asset_type AS assetType,
      symbol,
      name,
      quantity,
      market_value AS marketValue,
      cash_balance AS cashBalance,
      currency,
      as_of_date AS asOfDate
    FROM investment_positions
    WHERE as_of_date = (
      SELECT MAX(p2.as_of_date) FROM investment_positions p2
      WHERE p2.connector_id = investment_positions.connector_id
        AND p2.asset_type = investment_positions.asset_type
    )
    ORDER BY as_of_date DESC, asset_type ASC, name ASC
    LIMIT ? OFFSET ?`
  ).bind(limit + 1, offset).all();

  const hasMore = result.results.length > limit;
  setPaginationHeaders((name, value) => c.header(name, value), { offset, limit, hasMore });
  return c.json(result.results.slice(0, limit));
});

api.get("/investment-transactions", async (c) => {
  const { limit, offset } = parsePagination(c.req.query(), 100);
  const result = await c.env.DB.prepare(
    `SELECT
      id,
      connector_id AS connectorId,
      account_id AS accountId,
      source_id AS sourceId,
      broker_no AS brokerNo,
      broker_account AS brokerAccount,
      broker_name AS brokerName,
      symbol,
      name,
      asset_type AS assetType,
      trade_date AS tradeDate,
      posted_date AS postedDate,
      transaction_code AS transactionCode,
      transaction_name AS transactionName,
      quantity,
      price,
      amount,
      currency
    FROM investment_transactions
    ORDER BY COALESCE(trade_date, posted_date) DESC, updated_at DESC
    LIMIT ? OFFSET ?`
  ).bind(limit + 1, offset).all();

  const hasMore = result.results.length > limit;
  setPaginationHeaders((name, value) => c.header(name, value), { offset, limit, hasMore });
  return c.json(result.results.slice(0, limit));
});

api.get("/bank", async (c) => {
  const { limit, offset } = parsePagination(c.req.query(), 100);
  const [accounts, transactions] = await Promise.all([
    c.env.DB.prepare(
      `SELECT
        account.id,
        account.connector_id AS connectorId,
        account.source_id AS sourceId,
        account.institution_name AS institutionName,
        account.account_name AS accountName,
        account.account_type AS accountType,
        account.currency,
        account.bank_code AS bankCode,
        account.account_last4 AS accountLast4,
        balance.balance AS balance,
        balance.available_balance AS availableBalance,
        balance.payment_due_date AS paymentDueDate,
        balance.statement_closing_date AS statementClosingDate,
        balance.as_of_at AS asOfAt
      FROM bank_accounts account
      LEFT JOIN bank_balance_snapshots balance
        ON balance.id = (
          SELECT latest.id
          FROM bank_balance_snapshots latest
          WHERE latest.account_id = account.id
          ORDER BY latest.as_of_at DESC, latest.updated_at DESC
          LIMIT 1
        )
      WHERE account.canonical_account_id IS NULL
      ORDER BY account.institution_name ASC, account.account_name ASC, account.source_id ASC`
    ).all(),
    c.env.DB.prepare(
      `SELECT
        txn.id,
        txn.connector_id AS connectorId,
        txn.account_id AS accountId,
        account.source_id AS accountSourceId,
        account.account_name AS accountName,
        account.institution_name AS institutionName,
        account.account_type AS accountType,
        account.bank_code AS bankCode,
        account.account_last4 AS accountLast4,
        txn.source_id AS sourceId,
        txn.posted_date AS postedDate,
        txn.authorized_at AS authorizedAt,
        txn.amount,
        txn.currency,
        txn.description,
        txn.counterparty
      FROM bank_transactions txn
      JOIN bank_accounts account ON account.id = txn.account_id
      WHERE account.canonical_account_id IS NULL
      ORDER BY COALESCE(txn.posted_date, txn.authorized_at) DESC, txn.updated_at DESC
      LIMIT ? OFFSET ?`
    ).bind(limit + 1, offset).all()
  ]);

  const hasMore = transactions.results.length > limit;
  const transactionPage = transactions.results.slice(0, limit);

  let classificationMap: Map<string, ClassificationResult>;
  try {
    classificationMap = await resolveClassifications(
      c.env.DB,
      transactionPage.map((t) => ({ id: String(t.id), description: t.description as string | null, counterparty: t.counterparty as string | null, sourceId: String(t.sourceId) }))
    );
  } catch (e) {
    console.error("[classify] resolveClassifications failed:", e);
    classificationMap = new Map();
  }

  setPaginationHeaders((name, value) => c.header(name, value), { offset, limit, hasMore });

  return c.json({
    accounts: accounts.results.map(normalizeBankAccountDisplay),
    transactions: transactionPage.map((t) => ({
      ...normalizeBankTransactionDisplay(t),
      classification: classificationMap.get(String(t.id))
    }))
  });
});

api.get("/bank/bills", async (c) => {
  const { limit, offset } = parsePagination(c.req.query(), 50);
  const rows = await c.env.DB.prepare(
    `SELECT
      b.id,
      b.connector_id AS connectorId,
      b.account_id AS accountId,
      a.source_id AS accountSourceId,
      b.source_id AS sourceId,
      b.billing_period AS billingPeriod,
      b.statement_amount AS statementAmount,
      b.minimum_payment AS minimumPayment,
      b.paid_amount AS paidAmount,
      b.is_paid AS isPaid,
      b.payment_due_date AS paymentDueDate,
      b.statement_closing_date AS statementClosingDate,
      b.currency
    FROM credit_card_bills b
    JOIN bank_accounts a ON a.id = b.account_id
    ORDER BY b.billing_period DESC, b.account_id ASC
    LIMIT ? OFFSET ?`
  ).bind(limit + 1, offset).all();
  const hasMore = rows.results.length > limit;
  setPaginationHeaders((name, value) => c.header(name, value), { offset, limit, hasMore });
  return c.json(rows.results.slice(0, limit));
});

api.get("/history/net-worth", async (c) => {
  const { limit, offset } = parsePagination(c.req.query(), 100);
  const rows = await c.env.DB.prepare(
    `SELECT date, net_worth AS netWorth, asset_type AS assetType, source
     FROM net_worth_history
     ORDER BY date DESC, source ASC, asset_type ASC
     LIMIT ? OFFSET ?`
  ).bind(limit + 1, offset).all<{ date: string; netWorth: number; assetType: string; source: string }>();
  const hasMore = rows.results.length > limit;
  setPaginationHeaders((name, value) => c.header(name, value), { offset, limit, hasMore });
  return c.json(rows.results.slice(0, limit).reverse());
});

api.post("/history/net-worth/rebuild-bank", async (c) => {
  const body = bankHistoryRebuildBodySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) {
    return c.json({ error: "from/to must use YYYY-MM-DD" }, 400);
  }

  const range = await resolveBankHistoryDateRange(c.env.DB, body.data.from, body.data.to);
  if (!range) {
    return c.json({ success: true, dates: 0 });
  }

  const dates = enumerateDates(range.from, range.to);
  await rebuildBankDepositHistory(c.env.DB, dates);
  return c.json({ success: true, dates: dates.length, from: range.from, to: range.to });
});

api.get("/connectors/:connectorId/settings", async (c) => {
  const connectorId = c.get("connectorId");
  const settings = await getConnectorSettings(c.env.DB, connectorId);
  let sessionAvailable = false;
  if (connectorId === "sinopac" && settings) {
    const stored = await decryptJson<Record<string, unknown>>(settings.encrypted_config, configEncryptionKey(c.env));
    sessionAvailable = typeof stored.sessionCookies === "string"
      && stored.sessionCookies.length > 0
      && stored.protocol === "sinopac-mobile-app-json-v1";
  }

  return c.json({
    connectorId,
    configured: Boolean(settings),
    updatedAt: settings?.updated_at,
    publicConfig: settings?.public_config ? JSON.parse(settings.public_config) : null,
    sessionAvailable
  });
});

api.put("/connectors/:connectorId/settings", async (c) => {
  const connectorId = c.get("connectorId");
  const body = settingsBodySchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) {
    return c.json(
      {
        success: false,
        error: {
          code: "INVALID_REQUEST_BODY",
          message: "Request body must include a config object."
        }
      },
      400
    );
  }

  const rawConfig = body.data.config;
  const publicKeys = PUBLIC_FIELDS[connectorId] ?? [];
  const publicConfig: Record<string, unknown> = {};
  const sensitiveConfig: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rawConfig)) {
    if (publicKeys.includes(k)) publicConfig[k] = v;
    else sensitiveConfig[k] = v;
  }
  const hasSensitive = Object.values(sensitiveConfig).some((v) => v !== undefined && v !== "");

  const now = new Date().toISOString();
  const encryptionKey = configEncryptionKey(c.env);
  const existing = await getConnectorSettings(c.env.DB, connectorId);
  if (!hasSensitive && !existing) {
    return c.json({ success: false, error: { code: "CONNECTOR_CONFIG_MISSING", message: "Cannot update public config before credentials are set." } }, 400);
  }

  let parsedConfig: unknown;
  let mergedPublic: Record<string, unknown>;
  try {
    const storedConfig = existing
      ? await decryptJson<Record<string, unknown>>(existing.encrypted_config, encryptionKey)
      : {};
    const storedPublic = existing?.public_config ? JSON.parse(existing.public_config) : {};
    const mergedConfig: Record<string, unknown> = {
      ...storedConfig,
      ...storedPublic,
      ...rawConfig
    };

    if (connectorId === "einvoice" && einvoiceCredentialsChanged(storedConfig, rawConfig)) {
      for (const key of [
        "userToken", "mobileBarcode", "sid", "token", "iv", "svrCode", "loginAppId",
        "loginLiat", "loginSsMe", "ltoken", "hkey", "serverTimeOffset"
      ]) delete mergedConfig[key];
    }

    if (connectorId === "sinopac" && sinopacCredentialsChanged(storedConfig, rawConfig)) {
      for (const key of [
        "sessionCookies", "sessionExpiresAt", "browserSessionId", "browserSessionExpiresAt", "captcha", "protocol"
      ]) delete mergedConfig[key];
    }

    parsedConfig = parseConnectorConfig(connectorId, mergedConfig);
    mergedPublic = { ...storedPublic, ...publicConfig };
  } catch {
    return c.json(
      {
        success: false,
        error: {
          code: "INVALID_CONNECTOR_CONFIG",
          message: "Connector config does not match the expected shape."
        }
      },
      400
    );
  }

  const encryptedConfig = await encryptJson(parsedConfig, encryptionKey);
  await upsertConnectorSettings(c.env.DB, {
    id: existing?.id ?? crypto.randomUUID(),
    connectorId,
    encryptedConfig,
    publicConfig: Object.keys(mergedPublic).length > 0 ? JSON.stringify(mergedPublic) : null,
    now
  });

  return c.json({
    connectorId,
    configured: true,
    updatedAt: now
  });
});

api.get("/sync-schedule", async (c) => {
  return c.json(await getDefaultSyncSchedule(c.env.DB));
});

api.put("/sync-schedule", async (c) => {
  const body = syncScheduleUpdateSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) {
    return jsonError(
      "INVALID_REQUEST_BODY",
      "Sync schedule requires a supported interval and HH:mm time."
    );
  }

  const now = new Date();
  const inheritedJobs = await c.env.DB.prepare(
    `SELECT id, next_run_at AS nextRunAt
     FROM sync_jobs
     WHERE schedule_mode = 'inherit'`
  ).all<{ id: string; nextRunAt: string }>();
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `INSERT INTO sync_schedule_settings (
         id, interval_minutes, preferred_time, preferred_weekday, timezone, updated_at
       ) VALUES ('default', ?, ?, ?, 'Asia/Taipei', ?)
       ON CONFLICT(id) DO UPDATE SET
         interval_minutes = excluded.interval_minutes,
         preferred_time = excluded.preferred_time,
         preferred_weekday = excluded.preferred_weekday,
         timezone = excluded.timezone,
         updated_at = excluded.updated_at`
    ).bind(
      body.data.intervalMinutes,
      body.data.preferredTime,
      body.data.preferredWeekday,
      now.toISOString()
    )
  ];

  for (const job of inheritedJobs.results) {
    statements.push(
      c.env.DB.prepare(
        `UPDATE sync_jobs
         SET interval_minutes = ?, preferred_time = ?, preferred_weekday = ?, next_run_at = ?, updated_at = ?
         WHERE id = ?`
      ).bind(
        body.data.intervalMinutes,
        body.data.preferredTime,
        body.data.preferredWeekday,
        nextSyncRunAt(
          body.data.intervalMinutes,
          body.data.preferredTime,
          now,
          job.nextRunAt,
          body.data.preferredWeekday
        ),
        now.toISOString(),
        job.id
      )
    );
  }

  await c.env.DB.batch(statements);
  return c.json({
    intervalMinutes: body.data.intervalMinutes,
    preferredTime: body.data.preferredTime,
    preferredWeekday: body.data.preferredWeekday,
    timezone: "Asia/Taipei",
    updatedAt: now.toISOString()
  } satisfies DefaultSyncSchedule);
});

api.get("/sync-jobs", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT
       id,
       connector_id AS connectorId,
       scope,
       enabled,
       interval_minutes AS intervalMinutes,
       next_run_at AS nextRunAt,
       schedule_mode AS scheduleMode,
       preferred_time AS preferredTime,
       preferred_weekday AS preferredWeekday,
       locked_until AS lockedUntil,
       locked_by AS lockedBy,
       lock_trigger AS lockTrigger,
       lock_scope AS lockScope,
       last_run_at AS lastRunAt,
       last_success_at AS lastSuccessAt,
       last_status AS lastStatus,
       last_error AS lastError,
       updated_at AS updatedAt
     FROM sync_jobs
     ORDER BY connector_id ASC, scope ASC`
  ).all<{
    id: string;
    connectorId: ConnectorId;
    scope: string;
    enabled: number;
    intervalMinutes: number;
    nextRunAt: string;
    scheduleMode: SyncScheduleMode;
    preferredTime: string;
    preferredWeekday: number;
    lockedUntil: string | null;
    lockedBy: string | null;
    lockTrigger: SyncTrigger | null;
    lockScope: string | null;
    lastRunAt: string | null;
    lastSuccessAt: string | null;
    lastStatus: SyncStatus | null;
    lastError: string | null;
    updatedAt: string;
  }>();

  return c.json(rows.results.map((row) => ({
    ...row,
    enabled: Boolean(row.enabled),
    running: Boolean(row.lockedUntil && new Date(row.lockedUntil) > new Date())
  })));
});

api.patch("/sync-jobs/:connectorId/:scope", async (c) => {
  const connectorId = c.req.param("connectorId");
  if (!isConnectorId(connectorId)) {
    return jsonError("CONNECTOR_NOT_FOUND", "Connector id is not supported.", 404);
  }

  const scopeResult = scheduledSyncScopeSchema.safeParse(c.req.param("scope"));
  if (!scopeResult.success) {
    return jsonError("SYNC_JOB_NOT_FOUND", "Scheduled sync scope is not supported.", 404);
  }
  const scope = scopeResult.data;
  const body = syncJobUpdateSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) {
    return jsonError("INVALID_REQUEST_BODY", "Request body must include a valid sync job setting.");
  }

  const job = await c.env.DB.prepare(
    "SELECT * FROM sync_jobs WHERE connector_id = ? AND scope = ?"
  ).bind(connectorId, scope).first<SyncJobRow<ConnectorId>>();
  if (!job) {
    return jsonError("SYNC_JOB_NOT_FOUND", "Sync job is not configured.", 404);
  }

  const now = new Date();
  const scheduleMode = body.data.scheduleMode ?? job.schedule_mode;
  const defaultSchedule = scheduleMode === "inherit"
    ? await getDefaultSyncSchedule(c.env.DB)
    : null;
  const intervalMinutes = defaultSchedule?.intervalMinutes
    ?? body.data.intervalMinutes
    ?? job.interval_minutes;
  const preferredTime = defaultSchedule?.preferredTime
    ?? body.data.preferredTime
    ?? job.preferred_time;
  const preferredWeekday = defaultSchedule?.preferredWeekday
    ?? body.data.preferredWeekday
    ?? job.preferred_weekday;
  const scheduleChanged = body.data.scheduleMode !== undefined
    || body.data.intervalMinutes !== undefined
    || body.data.preferredTime !== undefined
    || body.data.preferredWeekday !== undefined;
  const nextRunAt = body.data.nextRunAt
    ?? (scheduleChanged || body.data.enabled === true
      ? nextSyncRunAt(
          intervalMinutes,
          preferredTime,
          now,
          job.next_run_at,
          preferredWeekday
        )
      : job.next_run_at);
  const result = await c.env.DB.prepare(
    `UPDATE sync_jobs
     SET enabled = COALESCE(?, enabled),
         next_run_at = ?,
         interval_minutes = ?,
         schedule_mode = ?,
         preferred_time = ?,
         preferred_weekday = ?,
         updated_at = ?
     WHERE connector_id = ?
       AND scope = ?`
  ).bind(
    body.data.enabled !== undefined ? (body.data.enabled ? 1 : 0) : null,
    nextRunAt,
    intervalMinutes,
    scheduleMode,
    preferredTime,
    preferredWeekday,
    now.toISOString(),
    connectorId,
    scope
  ).run();

  if (result.meta.changes !== 1) {
    return jsonError("SYNC_JOB_NOT_FOUND", "Sync job is not configured.", 404);
  }

  return c.json({
    success: true,
    connectorId,
    scope,
    enabled: body.data.enabled ?? Boolean(job.enabled),
    intervalMinutes,
    preferredTime,
    preferredWeekday,
    scheduleMode,
    nextRunAt
  });
});

api.post("/connectors/einvoice/sync", async (c) => {
  const overrides = einvoiceSyncBodySchema.parse(await c.req.json().catch(() => ({})));
  return syncRouteResponse(c, withManualSyncLock(c.env, "einvoice", SYNC_SCOPE_ALL, () =>
    syncEinvoice(c.env, "manual", overrides)
  ));
});

api.post("/connectors/tdcc/sync", async (c) => {
  const overrides = await tdccSyncBody(c);
  return syncRouteResponse(c, withManualSyncLock(c.env, "tdcc", SYNC_SCOPE_ALL, () =>
    syncTdcc(c.env, "manual", overrides, [
      TDCC_SCOPE_INVESTMENTS,
      TDCC_SCOPE_BANK,
      TDCC_SCOPE_TRADES
    ])
  ));
});
api.post("/connectors/tdcc/sync/investments", async (c) => {
  const overrides = await tdccSyncBody(c);
  return syncRouteResponse(c, withManualSyncLock(c.env, "tdcc", TDCC_SCOPE_INVESTMENTS, () =>
    syncTdcc(c.env, "manual", overrides, [TDCC_SCOPE_INVESTMENTS])
  ));
});
api.post("/connectors/tdcc/sync/bank", async (c) => {
  const overrides = await tdccSyncBody(c);
  return syncRouteResponse(c, withManualSyncLock(c.env, "tdcc", TDCC_SCOPE_BANK, () =>
    syncTdcc(c.env, "manual", overrides, [TDCC_SCOPE_BANK])
  ));
});
api.post("/connectors/tdcc/sync/trades", async (c) => {
  const overrides = await tdccSyncBody(c);
  return syncRouteResponse(c, withManualSyncLock(c.env, "tdcc", TDCC_SCOPE_TRADES, () =>
    syncTdcc(c.env, "manual", overrides, [TDCC_SCOPE_TRADES])
  ));
});

api.post("/connectors/esun/sync", async (c) => {
  return syncRouteResponse(c, withManualSyncLock(c.env, "esun", SYNC_SCOPE_ALL, () => syncEsun(c.env, "manual")));
});

api.post("/connectors/cathaybk/sync", async (c) => {
  return syncRouteResponse(c, withManualSyncLock(c.env, "cathaybk", SYNC_SCOPE_ALL, () => syncCathaybk(c.env, "manual")));
});

api.post("/connectors/sinopac/captcha", async (c) => {
  const connectorId = "sinopac";
  const runId = crypto.randomUUID();
  const lockRowId = canonicalSyncLockRowId(connectorId);
  const locked = await acquireSyncJobLock(c.env.DB, {
    lockRowId,
    scope: SYNC_SCOPE_ALL,
    trigger: "manual",
    runId,
    leaseMs: 3 * 60 * 1000
  });
  if (!locked) return jsonError("SYNC_ALREADY_RUNNING", "永豐已有驗證或同步作業正在進行。", 409);
  try {
    const settings = await requireConnectorSettings(c.env.DB, connectorId);
    const stored = await decryptJson<Record<string, unknown>>(settings.encrypted_config, configEncryptionKey(c.env));
    const publicStored = settings.public_config ? JSON.parse(settings.public_config) : {};
    const config = parseSinopacConfig({ ...stored, ...publicStored });
    const prepared = await prepareSinopacCaptcha(c.env.BROWSER, config);
    await c.env.DB.prepare(
      `UPDATE connector_settings SET encrypted_config = ? WHERE connector_id = ?`
    ).bind(
      await encryptJson({
        ...stored,
        browserSessionId: prepared.browserSessionId,
        browserSessionExpiresAt: prepared.browserSessionExpiresAt
      }, configEncryptionKey(c.env)),
      connectorId
    ).run();
    return c.json({
      captchaImage: prepared.captchaImage,
      expiresAt: prepared.browserSessionExpiresAt
    });
  } catch (error) {
    if (error instanceof SinopacBrowserCapacityError) {
      const response = jsonError("SINOPAC_BROWSER_BUSY", error.message, 429);
      response.headers.set("Retry-After", String(error.retryAfterSeconds));
      return response;
    }
    if (error instanceof NeedsUserActionError) {
      return jsonError("USER_ACTION_REQUIRED", error.message, 400);
    }
    return jsonError("SINOPAC_CAPTCHA_FAILED", safeErrorMessage(error), 502);
  } finally {
    await releaseSyncJobLock(c.env.DB, lockRowId, runId);
  }
});

api.post("/connectors/sinopac/sync", async (c) => {
  const overrides = sinopacSyncBodySchema.parse(await c.req.json().catch(() => ({})));
  return syncRouteResponse(c, withManualSyncLock(c.env, "sinopac", SYNC_SCOPE_ALL, () =>
    syncSinopac(c.env, "manual", overrides)
  ));
});

async function tdccSyncBody(c: Context<AppBindings>) {
  return tdccSyncBodySchema.parse(await c.req.json().catch(() => ({})));
}

async function syncRouteResponse(
  c: Context<AppBindings>,
  result: Promise<SyncOutcome>
) {
  try {
    return c.json(await result);
  } catch (error) {
    if (error instanceof SyncAlreadyRunningError) {
      return jsonError("SYNC_ALREADY_RUNNING", error.message, 409);
    }
    if (error instanceof NeedsUserActionError) {
      return jsonError("USER_ACTION_REQUIRED", error.message, 400);
    }
    if (error instanceof EInvoiceProtocolUnavailableError) {
      return jsonError("CONNECTOR_PROTOCOL_UNAVAILABLE", error.message, 503);
    }
    if (error instanceof SinopacBrowserCapacityError) {
      const response = jsonError("SINOPAC_BROWSER_BUSY", error.message, 429);
      response.headers.set("Retry-After", String(error.retryAfterSeconds));
      return response;
    }
    throw error;
  }
}

async function syncEinvoice(
  env: Env,
  trigger: SyncTrigger,
  overrides: z.infer<typeof einvoiceSyncBodySchema> = {}
): Promise<SyncOutcome> {
  const connectorId = "einvoice";
  const scope = "all";
  const settings = await requireConnectorSettings(env.DB, connectorId);
  const config = await decryptJson<unknown>(settings.encrypted_config, configEncryptionKey(env));
  const parsedConfig = parseInvoiceConfig({ ...(config as Record<string, unknown>), ...overrides });
  const originalInvoiceConfig = invoiceConfigSnapshot(config as Record<string, unknown>);
  console.log(`[sync] ${connectorId}/${scope}: starting trigger=${trigger} (cursor=${settings.sync_cursor ?? "none"})`);
  const result = await einvoiceConnector.sync(parsedConfig, settings.sync_cursor ?? undefined);
  const invoiceLineItems = result.invoiceLineItems ?? [];
  const detailErrorCount =
    "detailErrorCount" in result && typeof result.detailErrorCount === "number"
      ? result.detailErrorCount
      : 0;
  console.log(
    `[sync] ${connectorId}/${scope}: fetched ${result.records.length} invoices, ${invoiceLineItems.length} detail rows` +
      (detailErrorCount > 0 ? `, ${detailErrorCount} detail errors` : "")
  );
  const now = new Date().toISOString();

  const statements = result.records.map((invoice) => {
    const id = stableId(connectorId, invoice.sourceId);
    return env.DB.prepare(
      `INSERT INTO invoices (
        id,
        connector_id,
        source_id,
        invoice_number,
        invoice_date,
        seller_name,
        amount,
        raw_payload,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(connector_id, source_id) DO UPDATE SET
        invoice_number = excluded.invoice_number,
        invoice_date = excluded.invoice_date,
        seller_name = excluded.seller_name,
        amount = excluded.amount,
        raw_payload = excluded.raw_payload,
        updated_at = excluded.updated_at`
    ).bind(
      id,
      connectorId,
      invoice.sourceId,
      invoice.invoiceNumber ?? null,
      invoice.invoiceDate,
      invoice.sellerName ?? null,
      invoice.amount,
      JSON.stringify(invoice.raw ?? invoice),
      now,
      now
    );
  });
  statements.push(
    ...invoiceLineItems.map((item) => invoiceLineItemStatement(env.DB, connectorId, item, now))
  );

  if (result.cursor) {
    statements.push(cursorStatement(env.DB, connectorId, result.cursor, now));
  }

  if (invoiceConfigChanged(originalInvoiceConfig, parsedConfig)) {
    statements.push(
      env.DB.prepare(
        `UPDATE connector_settings
        SET encrypted_config = ?, updated_at = ?
        WHERE connector_id = ?`
      ).bind(await encryptJson(parsedConfig, configEncryptionKey(env)), now, connectorId)
    );
  }

  if (statements.length > 0) {
    await env.DB.batch(statements);
  }

  return {
    success: true,
    connectorId,
    scope,
    records: result.records.length,
    detailRecords: invoiceLineItems.length,
    cursorUpdated: Boolean(result.cursor && result.cursor !== settings.sync_cursor)
  };
}

async function syncEsun(env: Env, trigger: SyncTrigger): Promise<SyncOutcome> {
  const connectorId = "esun";
  const scope = "all";
  const settings = await requireConnectorSettings(env.DB, connectorId);
  const stored = await decryptJson<unknown>(settings.encrypted_config, configEncryptionKey(env));
  const config = parseEsunConfig(stored);

  console.log(`[sync] ${connectorId}/${scope}: starting trigger=${trigger} (cursor=${settings.sync_cursor ?? "none"})`);
  const result = await createEsunConnector(env.BROWSER).sync(config, settings.sync_cursor ?? undefined);

  const bankAccounts = result.bankAccounts ?? [];
  const bankBalanceSnapshots = result.bankBalanceSnapshots ?? [];
  const bankTransactions = result.bankTransactions ?? [];
  const creditCardBills = result.creditCardBills ?? [];
  console.log(`[sync] ${connectorId}/${scope}: accounts=${bankAccounts.length} snapshots=${bankBalanceSnapshots.length} transactions=${bankTransactions.length} bills=${creditCardBills.length}`);

  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [
    ...bankAccounts.map((a) => bankAccountStatement(env.DB, connectorId, a, now)),
    ...bankBalanceSnapshots.map((s) => bankBalanceSnapshotStatement(env.DB, connectorId, s, now)),
    ...bankTransactions.map((t) => bankTransactionStatement(env.DB, connectorId, t, now)),
    ...creditCardBills.map((b) => creditCardBillStatement(env.DB, connectorId, b, now)),
    ...(bankAccounts.length > 0 ? [linkCanonicalBankAccountsStatement(env.DB)] : [])
  ];

  if (result.cursor) {
    const updatedConfig = { ...config, ...JSON.parse(result.cursor) };
    statements.push(
      env.DB.prepare(`UPDATE connector_settings SET encrypted_config = ?, sync_cursor = ?, updated_at = ? WHERE connector_id = ?`)
        .bind(await encryptJson(updatedConfig, configEncryptionKey(env)), result.cursor, now, connectorId)
    );
  }

  if (statements.length > 0) {
    await env.DB.batch(statements);
  }

  if (bankBalanceSnapshots.length > 0) {
    await rebuildBankDepositHistory(env.DB, [dateFromIso(now)]);
  }

  return {
    success: true,
    connectorId,
    scope,
    records: bankAccounts.length + bankBalanceSnapshots.length + bankTransactions.length,
    cursorUpdated: Boolean(result.cursor && result.cursor !== settings.sync_cursor)
  };
}

async function syncCathaybk(env: Env, trigger: SyncTrigger): Promise<SyncOutcome> {
  const connectorId = "cathaybk";
  const scope = "all";
  const settings = await requireConnectorSettings(env.DB, connectorId);
  const stored = await decryptJson<unknown>(settings.encrypted_config, configEncryptionKey(env));
  const publicStored = settings.public_config ? JSON.parse(settings.public_config) : {};
  const config = parseCathaybkConfig({ ...(stored as object), ...publicStored });

  console.log(`[sync] ${connectorId}/${scope}: starting trigger=${trigger} (cursor=${settings.sync_cursor ?? "none"})`);
  const result = await createCathaybkConnector(env.BROWSER).sync(config, settings.sync_cursor ?? undefined);

  const bankAccounts = result.bankAccounts ?? [];
  const bankBalanceSnapshots = result.bankBalanceSnapshots ?? [];
  const bankTransactions = result.bankTransactions ?? [];
  const creditCardBills = result.creditCardBills ?? [];
  console.log(`[sync] ${connectorId}/${scope}: accounts=${bankAccounts.length} snapshots=${bankBalanceSnapshots.length} transactions=${bankTransactions.length} bills=${creditCardBills.length}`);

  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [
    ...bankAccounts.map((a) => bankAccountStatement(env.DB, connectorId, a, now)),
    ...bankBalanceSnapshots.map((s) => bankBalanceSnapshotStatement(env.DB, connectorId, s, now)),
    ...bankTransactions.map((t) => bankTransactionStatement(env.DB, connectorId, t, now)),
    ...creditCardBills.map((b) => creditCardBillStatement(env.DB, connectorId, b, now)),
    ...(bankAccounts.length > 0 ? [linkCanonicalBankAccountsStatement(env.DB)] : [])
  ];

  if (result.cursor) {
    const cursorState = JSON.parse(result.cursor) as Record<string, unknown>;
    const updatedConfig = { ...config, ...cursorState };
    statements.push(
      env.DB.prepare(`UPDATE connector_settings SET encrypted_config = ?, sync_cursor = ?, updated_at = ? WHERE connector_id = ?`)
        .bind(await encryptJson(updatedConfig, configEncryptionKey(env)), result.cursor, now, connectorId)
    );
  }

  if (statements.length > 0) {
    await env.DB.batch(statements);
  }

  if (bankBalanceSnapshots.length > 0) {
    await rebuildBankDepositHistory(env.DB, [dateFromIso(now)]);
  }

  return {
    success: true,
    connectorId,
    scope,
    records: bankAccounts.length + bankBalanceSnapshots.length + bankTransactions.length,
    cursorUpdated: Boolean(result.cursor && result.cursor !== settings.sync_cursor)
  };
}

async function syncSinopac(
  env: Env,
  trigger: SyncTrigger,
  overrides: z.infer<typeof sinopacSyncBodySchema> = {}
): Promise<SyncOutcome> {
  const connectorId = "sinopac";
  const scope = "all";
  const settings = await requireConnectorSettings(env.DB, connectorId);
  const stored = await decryptJson<Record<string, unknown>>(settings.encrypted_config, configEncryptionKey(env));
  const publicStored = settings.public_config ? JSON.parse(settings.public_config) : {};
  const config = parseSinopacConfig({ ...stored, ...publicStored, ...overrides });

  console.log(`[sync] ${connectorId}/${scope}: starting trigger=${trigger} (cursor=${settings.sync_cursor ? "set" : "none"})`);
  let result: Awaited<ReturnType<ReturnType<typeof createSinopacConnector>["sync"]>>;
  try {
    result = await createSinopacConnector(env.BROWSER).sync(config, settings.sync_cursor ?? undefined);
  } catch (error) {
    const cleaned = { ...stored };
    const hadPendingVerification = Boolean(config.browserSessionId && overrides.captcha);
    if (hadPendingVerification) {
      delete cleaned.captcha;
      delete cleaned.browserSessionId;
      delete cleaned.browserSessionExpiresAt;
    }
    if (error instanceof SinopacVerificationRequiredError) {
      delete cleaned.sessionCookies;
      delete cleaned.sessionExpiresAt;
      delete cleaned.protocol;
    }
    if (hadPendingVerification || error instanceof SinopacVerificationRequiredError) {
      await env.DB.prepare(`UPDATE connector_settings SET encrypted_config = ? WHERE connector_id = ?`)
        .bind(await encryptJson(cleaned, configEncryptionKey(env)), connectorId)
        .run();
    }
    if (error instanceof SinopacVerificationRequiredError) {
      throw new NeedsUserActionError(error.message);
    }
    throw error;
  }
  const bankAccounts = result.bankAccounts ?? [];
  const bankBalanceSnapshots = result.bankBalanceSnapshots ?? [];
  const bankTransactions = result.bankTransactions ?? [];
  const creditCardBills = result.creditCardBills ?? [];
  console.log(`[sync] ${connectorId}/${scope}: accounts=${bankAccounts.length} snapshots=${bankBalanceSnapshots.length} transactions=${bankTransactions.length} bills=${creditCardBills.length}`);

  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(`DELETE FROM bank_transactions WHERE connector_id = ?`).bind(connectorId),
    env.DB.prepare(`DELETE FROM credit_card_bills WHERE connector_id = ?`).bind(connectorId),
    ...bankAccounts.map((account) => bankAccountStatement(env.DB, connectorId, account, now)),
    ...bankBalanceSnapshots.map((snapshot) => bankBalanceSnapshotStatement(env.DB, connectorId, snapshot, now)),
    ...bankTransactions.map((transaction) => bankTransactionStatement(env.DB, connectorId, transaction, now)),
    ...creditCardBills.map((bill) => creditCardBillStatement(env.DB, connectorId, bill, now)),
    ...(bankAccounts.length > 0 ? [linkCanonicalBankAccountsStatement(env.DB)] : [])
  ];
  let persistedCursor: string | undefined;
  if (result.cursor) {
    const cursorState = JSON.parse(result.cursor) as Record<string, unknown>;
    const {
      sessionCookies: _sessionCookies,
      sessionExpiresAt: _sessionExpiresAt,
      ...safeCursorState
    } = cursorState;
    persistedCursor = JSON.stringify(safeCursorState);
    const {
      browserSessionId: _browserSessionId,
      browserSessionExpiresAt: _browserSessionExpiresAt,
      captcha: _captcha,
      ...reusableConfig
    } = config;
    statements.push(
      env.DB.prepare(`UPDATE connector_settings SET encrypted_config = ?, sync_cursor = ?, updated_at = ? WHERE connector_id = ?`)
        .bind(await encryptJson({ ...reusableConfig, ...cursorState }, configEncryptionKey(env)), persistedCursor, now, connectorId)
    );
  }
  if (statements.length > 0) await env.DB.batch(statements);
  if (bankBalanceSnapshots.length > 0) await rebuildBankDepositHistory(env.DB, [dateFromIso(now)]);
  return {
    success: true,
    connectorId,
    scope,
    records: bankAccounts.length + bankBalanceSnapshots.length + bankTransactions.length + creditCardBills.length,
    cursorUpdated: Boolean(persistedCursor && persistedCursor !== settings.sync_cursor)
  };
}

async function syncTdcc(
  env: Env,
  trigger: SyncTrigger,
  overrides: z.infer<typeof tdccSyncBodySchema>,
  scopes: string[]
): Promise<SyncOutcome> {
  const selected = new Set(scopes.includes(SYNC_SCOPE_ALL)
    ? [TDCC_SCOPE_INVESTMENTS, TDCC_SCOPE_BANK, TDCC_SCOPE_TRADES]
    : scopes);
  const scope = tdccOutcomeScope(selected);
  let records = 0;
  let cursorUpdated = false;

  if (selected.has(TDCC_SCOPE_INVESTMENTS) || selected.has(TDCC_SCOPE_BANK)) {
    const result = await syncTdccPositionsAndBank(env, trigger, overrides, {
      writeInvestments: selected.has(TDCC_SCOPE_INVESTMENTS),
      writeBank: selected.has(TDCC_SCOPE_BANK),
      scope
    });
    records += result.records;
    cursorUpdated = cursorUpdated || result.cursorUpdated;
  }

  if (selected.has(TDCC_SCOPE_TRADES)) {
    const result = await syncTdccTrades(env, trigger, overrides, scope);
    records += result.records;
    cursorUpdated = cursorUpdated || result.cursorUpdated;
  }

  return {
    success: true,
    connectorId: "tdcc",
    scope,
    records,
    cursorUpdated
  };
}

async function syncTdccPositionsAndBank(
  env: Env,
  trigger: SyncTrigger,
  overrides: z.infer<typeof tdccSyncBodySchema>,
  options: {
    writeInvestments: boolean;
    writeBank: boolean;
    scope: SyncScope;
  }
): Promise<{ records: number; cursorUpdated: boolean }> {
  const connectorId = "tdcc";
  const settings = await requireConnectorSettings(env.DB, connectorId);
  const config = await decryptJson<unknown>(settings.encrypted_config, configEncryptionKey(env));
  const mergedConfig = { ...(config as Record<string, unknown>), ...overrides };
  const parsedConfig = parseTdccConfig(mergedConfig);
  const syncScope = options.scope;
  console.log(`[sync] ${connectorId}/${syncScope}: starting trigger=${trigger} (cursor=${settings.sync_cursor ?? "none"})`);

  let result: Awaited<ReturnType<typeof tdccConnector.sync>>;
  try {
    result = await tdccConnector.sync(parsedConfig, settings.sync_cursor ?? undefined);
  } catch (error) {
    await handleTdccSyncError(env, settings.id, connectorId, mergedConfig, syncScope, trigger, error);
    throw error;
  }

  console.log(`[sync] ${connectorId}/${syncScope}: fetched ${result.records.length} investment records`);
  const now = new Date().toISOString();

  const bankAccounts = result.bankAccounts ?? [];
  const bankBalanceSnapshots = result.bankBalanceSnapshots ?? [];
  const bankTransactions = result.bankTransactions ?? [];
  const netWorthHistory = result.netWorthHistory ?? [];
  console.log(`[sync] ${connectorId}/${syncScope}: bank accounts=${bankAccounts.length} snapshots=${bankBalanceSnapshots.length} transactions=${bankTransactions.length} history=${netWorthHistory.length}`);
  const statements: D1PreparedStatement[] = [
    ...(options.writeBank ? bankAccounts.map((account) => bankAccountStatement(env.DB, connectorId, account, now)) : []),
    ...(options.writeBank
      ? bankBalanceSnapshots.map((snapshot) => bankBalanceSnapshotStatement(env.DB, connectorId, snapshot, now))
      : []),
    ...(options.writeBank
      ? bankTransactions.map((transaction) => bankTransactionStatement(env.DB, connectorId, transaction, now))
      : []),
    ...(options.writeInvestments
      ? result.records.map((position) => investmentPositionStatement(env.DB, connectorId, position, now))
      : []),
    ...netWorthHistory.map((point) => netWorthHistoryStatement(env.DB, connectorId, point, now)),
    ...(options.writeBank && bankAccounts.length > 0 ? [linkCanonicalBankAccountsStatement(env.DB)] : [])
  ];

  if (result.cursor) {
    statements.push(cursorStatement(env.DB, connectorId, result.cursor, now));
  }

  if (statements.length > 0) {
    await env.DB.batch(statements);
  }

  if (options.writeBank && bankBalanceSnapshots.length > 0) {
    await rebuildBankDepositHistory(env.DB, [dateFromIso(now)]);
  }

  return {
    records:
      (options.writeInvestments ? result.records.length : 0) +
      (options.writeBank ? bankAccounts.length + bankBalanceSnapshots.length + bankTransactions.length : 0),
    cursorUpdated: Boolean(result.cursor && result.cursor !== settings.sync_cursor)
  };
}

async function syncTdccTrades(
  env: Env,
  trigger: SyncTrigger,
  overrides: z.infer<typeof tdccSyncBodySchema>,
  scope: SyncScope
): Promise<{ records: number; cursorUpdated: boolean }> {
  const connectorId = "tdcc";
  const settings = await requireConnectorSettings(env.DB, connectorId);
  const config = await decryptJson<unknown>(settings.encrypted_config, configEncryptionKey(env));
  const mergedConfig = { ...(config as Record<string, unknown>), ...overrides };
  const parsedConfig = parseTdccConfig(mergedConfig);
  console.log(`[sync] ${connectorId}/${scope}: starting trigger=${trigger} (cursor=${settings.sync_cursor ?? "none"})`);

  let result: Awaited<ReturnType<typeof syncTdccTradeHistory>>;
  try {
    result = await syncTdccTradeHistory(parsedConfig, settings.sync_cursor ?? undefined);
  } catch (error) {
    await handleTdccSyncError(env, settings.id, connectorId, mergedConfig, scope, trigger, error);
    throw error;
  }

  const now = new Date().toISOString();
  const investmentTransactions = result.investmentTransactions ?? [];
  console.log(`[sync] ${connectorId}/${scope}: fetched ${investmentTransactions.length} investment transactions`);
  const statements: D1PreparedStatement[] = [
    ...investmentTransactions.map((transaction) => investmentTransactionStatement(env.DB, connectorId, transaction, now))
  ];

  if (result.cursor) {
    statements.push(cursorStatement(env.DB, connectorId, result.cursor, now));
  }

  if (statements.length > 0) {
    await env.DB.batch(statements);
  }

  return {
    records: investmentTransactions.length,
    cursorUpdated: Boolean(result.cursor && result.cursor !== settings.sync_cursor)
  };
}

function tdccOutcomeScope(scopes: Set<string>): SyncScope {
  const allScopes = [TDCC_SCOPE_INVESTMENTS, TDCC_SCOPE_BANK, TDCC_SCOPE_TRADES];
  if (allScopes.every((scope) => scopes.has(scope))) return SYNC_SCOPE_ALL;
  return (allScopes.filter((scope) => scopes.has(scope)).join("+") || SYNC_SCOPE_ALL) as SyncScope;
}

async function requireConnectorSettings(env: Env["DB"], connectorId: ConnectorId) {
  const settings = await getConnectorSettings(env, connectorId);
  if (!settings) {
    throw new NeedsUserActionError("Connector settings are required before sync.");
  }
  return settings;
}

async function handleTdccSyncError(
  env: Env,
  settingsId: string,
  connectorId: "tdcc",
  mergedConfig: Record<string, unknown>,
  scope: SyncScope,
  trigger: SyncTrigger,
  error: unknown
): Promise<never> {
  if (error instanceof TdccOtpExpiredError) {
    const { otp, ...configWithoutOtp } = mergedConfig;
    await upsertConnectorSettings(env.DB, {
      id: settingsId,
      connectorId,
      encryptedConfig: await encryptJson(configWithoutOtp, configEncryptionKey(env)),
      publicConfig: null,
      now: new Date().toISOString()
    });
    console.log(`[sync] ${connectorId}/${scope}: cleared expired otp from config`);
  }

  if (trigger === "scheduled" && isUserActionError(error)) {
    throw new NeedsUserActionError(error instanceof Error ? error.message : "Sync requires user action.");
  }

  throw error;
}

async function withManualSyncLock(
  env: Env,
  connectorId: ConnectorId,
  scope: SyncScope,
  task: () => Promise<SyncOutcome>
) {
  const runId = crypto.randomUUID();
  const lockRowId = canonicalSyncLockRowId(connectorId);
  const locked = await acquireSyncJobLock(env.DB, {
    lockRowId,
    scope,
    trigger: "manual",
    runId,
    leaseMs: SYNC_LOCK_LEASE_MS
  });

  if (!locked) {
    throw new SyncAlreadyRunningError(connectorId);
  }

  const stopHeartbeat = startSyncLockHeartbeat(env.DB, lockRowId, runId);
  try {
    const outcome = await task();
    await markManualSyncSuccess(env.DB, connectorId, scope);
    return outcome;
  } catch (error) {
    const status: SyncStatus = isUserActionError(error) ? "needs_user_action" : "failed";
    await markManualSyncFailure(env.DB, connectorId, scope, {
      status,
      errorMessage: safeErrorMessage(error)
    });
    throw error;
  } finally {
    stopHeartbeat();
    await releaseSyncJobLock(env.DB, lockRowId, runId);
  }
}

async function runSchedulerTick(env: Env, controller: ScheduledController) {
  for (let index = 0; index < MAX_SCHEDULED_JOBS_PER_TICK; index += 1) {
    const due = await findNextDueSyncJob<ConnectorId>(env.DB);
    if (!due) return;
    await runScheduledJob(env, controller, due);
  }
}

async function runScheduledJob(
  env: Env,
  controller: ScheduledController,
  due: SyncJobRow<ConnectorId>
) {
  const runId = crypto.randomUUID();
  const lockRowId = canonicalSyncLockRowId(due.connector_id);
  const locked = await acquireSyncJobLock(env.DB, {
    lockRowId,
    scope: due.scope,
    trigger: "scheduled",
    runId,
    leaseMs: SYNC_LOCK_LEASE_MS
  });
  if (!locked) return;

  const stopHeartbeat = startSyncLockHeartbeat(env.DB, lockRowId, runId);
  const startedAt = Date.now();
  try {
    const outcome = await runDueSyncJob(env, due);
    await completeSyncJob(env.DB, due);
    console.log(JSON.stringify({
      event: "sync_run_finished",
      runId,
      cron: controller.cron,
      connectorId: outcome.connectorId,
      scope: outcome.scope,
      trigger: "scheduled",
      status: "success",
      records: outcome.records,
      durationMs: Date.now() - startedAt
    }));
  } catch (error) {
    const status: SyncStatus = isUserActionError(error) ? "needs_user_action" : "failed";
    await failSyncJob(env.DB, due, { status, errorMessage: safeErrorMessage(error) });
    console.error(JSON.stringify({
      event: "sync_run_failed",
      runId,
      cron: controller.cron,
      connectorId: due.connector_id,
      scope: due.scope,
      trigger: "scheduled",
      status,
      message: safeErrorMessage(error),
      durationMs: Date.now() - startedAt
    }));
  } finally {
    stopHeartbeat();
    await releaseSyncJobLock(env.DB, lockRowId, runId);
  }
}

function startSyncLockHeartbeat(db: D1Database, lockRowId: string, runId: string) {
  const timer = setInterval(() => {
    void renewSyncJobLock(db, { lockRowId, runId, leaseMs: SYNC_LOCK_LEASE_MS })
      .then((renewed) => {
        if (!renewed) console.error(`[sync] lock heartbeat lost for ${lockRowId}`);
      })
      .catch((error) => console.error(`[sync] lock heartbeat failed for ${lockRowId}`, error));
  }, SYNC_LOCK_HEARTBEAT_MS);
  return () => clearInterval(timer);
}

async function runDueSyncJob(env: Env, job: SyncJobRow<ConnectorId>) {
  if (job.connector_id === "einvoice") {
    return syncEinvoice(env, "scheduled", { fetchDetails: true });
  }

  if (job.connector_id === "tdcc") {
    return syncTdcc(env, "scheduled", {}, [job.scope]);
  }

  if (job.connector_id === "esun") {
    return syncEsun(env, "scheduled");
  }

  if (job.connector_id === "cathaybk") {
    return syncCathaybk(env, "scheduled");
  }

  if (job.connector_id === "sinopac") {
    return syncSinopac(env, "scheduled");
  }

  throw new NeedsUserActionError("Scheduled connector is not supported.");
}

function canonicalSyncLockRowId(connectorId: ConnectorId) {
  return `${connectorId}:all`;
}

function isUserActionError(error: unknown) {
  if (
    error instanceof NeedsUserActionError ||
    error instanceof TdccOtpExpiredError ||
    error instanceof EInvoiceProtocolUnavailableError ||
    error instanceof SinopacVerificationRequiredError
  ) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /OTP|verification|requires.*login|requires.*session|requires.*user action/i.test(message);
}

function safeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").slice(0, 300);
}

function einvoiceCredentialsChanged(
  storedConfig: Record<string, unknown>,
  submittedConfig: Record<string, unknown>
) {
  return ["mobile", "password", "apiKey"].some(
    (key) =>
      key in submittedConfig &&
      submittedConfig[key] !== undefined &&
      submittedConfig[key] !== "" &&
      submittedConfig[key] !== storedConfig[key]
  );
}

function sinopacCredentialsChanged(
  storedConfig: Record<string, unknown>,
  submittedConfig: Record<string, unknown>
) {
  return ["userId", "account", "password"].some(
    (key) =>
      key in submittedConfig &&
      submittedConfig[key] !== undefined &&
      submittedConfig[key] !== "" &&
      submittedConfig[key] !== storedConfig[key]
  );
}

api.onError(apiErrorResponse);

app.route("/api", api);

app.get("*", async (c) => c.env.ASSETS.fetch(c.req.raw));

function cursorStatement(db: D1Database, connectorId: ConnectorId, cursor: string, now: string) {
  return db
    .prepare(
      `UPDATE connector_settings
      SET sync_cursor = ?, updated_at = ?
      WHERE connector_id = ?`
    )
    .bind(cursor, now, connectorId);
}

function stableId(...parts: string[]) {
  return parts.join(":");
}

function invoiceConfigSnapshot(config: Record<string, unknown>) {
  return Object.fromEntries([
    "protocol", "fetchDetails", "mobileBarcode", "userToken", "loginClientCode", "sid", "token", "iv", "svrCode",
    "loginAppId", "loginLiat", "loginSsMe", "ltoken", "hkey", "serverTimeOffset"
  ].map((key) => [key, config[key]]));
}

function invoiceConfigChanged(
  before: Record<string, unknown>,
  after: Record<string, unknown>
) {
  return Object.keys(before).some((key) => before[key] !== after[key]);
}

function invoiceLineItemStatement(
  db: D1Database,
  connectorId: ConnectorId,
  item: Omit<InvoiceLineItem, "id" | "connectorId" | "invoiceId">,
  now: string
) {
  const invoiceId = stableId(connectorId, item.invoiceSourceId);
  return db
    .prepare(
      `INSERT INTO invoice_line_items (
        id,
        invoice_id,
        connector_id,
        invoice_source_id,
        source_id,
        line_number,
        description,
        quantity,
        unit_price,
        amount,
        raw_payload,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(connector_id, invoice_source_id, source_id) DO UPDATE SET
        invoice_id = excluded.invoice_id,
        line_number = excluded.line_number,
        description = excluded.description,
        quantity = excluded.quantity,
        unit_price = excluded.unit_price,
        amount = excluded.amount,
        raw_payload = excluded.raw_payload,
        updated_at = excluded.updated_at`
    )
    .bind(
      stableId(connectorId, item.invoiceSourceId, "item", item.sourceId),
      invoiceId,
      connectorId,
      item.invoiceSourceId,
      item.sourceId,
      item.lineNumber,
      item.description,
      item.quantity ?? null,
      item.unitPrice ?? null,
      item.amount,
      JSON.stringify(item.raw ?? item),
      now,
      now
    );
}

// E.SUN's source IDs are "bank:esun:<accountNo>[:CCY]"; TDCC's settlement IDs are
// "settlement:<bankCode>:<accountNo>[:CCY]" where bankCode is the Taiwan bank code (e.g. 808
// for 玉山銀行). Matching on (bankCode, last 4 digits, currency) links the same physical
// account when it's synced both directly and via TDCC. TDCC may mask the account
// number, so only trailing digits are used from the account segment.
const ESUN_BANK_CODE = "808";
const CATHAYBK_BANK_CODE = "013";
const TAIWAN_BANK_NAMES: Record<string, string> = {
  "004": "台灣銀行",
  "005": "土地銀行",
  "006": "合作金庫銀行",
  "007": "第一銀行",
  "008": "華南銀行",
  "009": "彰化銀行",
  "011": "上海商銀",
  "012": "台北富邦銀行",
  "013": "國泰世華銀行",
  "016": "高雄銀行",
  "017": "兆豐銀行",
  "048": "王道銀行",
  "050": "台灣企銀",
  "052": "渣打銀行",
  "053": "台中銀行",
  "054": "京城銀行",
  "081": "匯豐銀行",
  "103": "新光銀行",
  "108": "陽信銀行",
  "700": "中華郵政",
  "803": "聯邦銀行",
  "805": "遠東銀行",
  "806": "元大銀行",
  "807": "永豐銀行",
  "808": "玉山銀行",
  "809": "凱基銀行",
  "810": "星展銀行",
  "812": "台新銀行",
  "816": "安泰銀行",
  "822": "中國信託銀行",
  "823": "將來銀行",
  "824": "連線銀行",
  "826": "樂天銀行"
};

type BankDisplayRow = {
  sourceId?: string;
  accountSourceId?: string;
  connectorId?: string;
  institutionName?: string | null;
  accountName?: string | null;
  accountType?: string | null;
  bankCode?: string | null;
  accountLast4?: string | null;
};

function deriveBankMatchKey(connectorId: ConnectorId, sourceId: string): { bankCode: string | null; last4: string | null } {
  if (connectorId === "esun" && sourceId.startsWith("bank:esun:")) {
    const last4 = sourceId.split(":")[2]?.replace(/\D/g, "").slice(-4) ?? "";
    return { bankCode: ESUN_BANK_CODE, last4: last4 || null };
  }
  if (connectorId === "cathaybk" && sourceId.startsWith("bank:cathaybk:")) {
    const last4 = sourceId.split(":")[2]?.replace(/\D/g, "").slice(-4) ?? "";
    return { bankCode: CATHAYBK_BANK_CODE, last4: last4 || null };
  }
  if (connectorId === "sinopac" && sourceId.startsWith("bank:sinopac:")) {
    const last4 = sourceId.split(":")[2]?.replace(/\D/g, "").slice(-4) ?? "";
    return { bankCode: "807", last4: last4 || null };
  }
  const match = sourceId.match(/^settlement:([^:]+):([^:]+)/);
  const last4 = match?.[2]?.replace(/\D/g, "").slice(-4) ?? "";
  return match ? { bankCode: match[1], last4: last4 || null } : { bankCode: null, last4: null };
}

function normalizeBankAccountDisplay<T extends BankDisplayRow>(row: T): T {
  if (row.accountType === "credit") return row;
  return normalizeDepositDisplay(row);
}

function normalizeBankTransactionDisplay<T extends BankDisplayRow>(row: T): T {
  if (row.accountType === "credit") return row;
  return normalizeDepositDisplay(row);
}

function normalizeDepositDisplay<T extends BankDisplayRow>(row: T): T {
  const sourceId = row.accountSourceId ?? row.sourceId ?? "";
  const settlement = parseBankAccountSource(sourceId);
  const bankCode =
    row.bankCode ??
    settlement.bankCode ??
    (row.connectorId === "esun" ? ESUN_BANK_CODE : row.connectorId === "cathaybk" ? CATHAYBK_BANK_CODE : undefined);
  const accountLast5 = accountLast5FromSourceId(sourceId);

  return {
    ...row,
    institutionName: (bankCode && TAIWAN_BANK_NAMES[bankCode]) || row.institutionName,
    accountName: accountLast5 ? `末五碼 ${accountLast5}` : row.accountName
  };
}

function parseBankAccountSource(sourceId: string): { bankCode?: string; account?: string } {
  const settlement = sourceId.match(/^settlement:([^:]+):([^:]+)/);
  if (settlement) return { bankCode: settlement[1], account: settlement[2] };

  const esun = sourceId.match(/^bank:esun:([^:]+)/);
  if (esun) return { bankCode: ESUN_BANK_CODE, account: esun[1] };

  const cathaybk = sourceId.match(/^bank:cathaybk:([^:]+)/);
  if (cathaybk) return { bankCode: CATHAYBK_BANK_CODE, account: cathaybk[1] };

  const sinopac = sourceId.match(/^bank:sinopac:([^:]+)/);
  if (sinopac) return { bankCode: "807", account: sinopac[1] };

  return {};
}

function accountLast5FromSourceId(sourceId: string) {
  const account = parseBankAccountSource(sourceId).account;
  const digits = account?.replace(/\D/g, "") ?? "";
  return digits ? digits.slice(-5) : undefined;
}

function bankAccountStatement(
  db: D1Database,
  connectorId: ConnectorId,
  account: Omit<BankAccount, "id" | "connectorId">,
  now: string
) {
  const { bankCode, last4 } = deriveBankMatchKey(connectorId, account.sourceId);
  return db
    .prepare(
      `INSERT INTO bank_accounts (
        id,
        connector_id,
        source_id,
        institution_name,
        account_name,
        account_type,
        currency,
        credit_limit,
        bank_code,
        account_last4,
        raw_payload,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(connector_id, source_id) DO UPDATE SET
        institution_name = excluded.institution_name,
        account_name = excluded.account_name,
        account_type = excluded.account_type,
        currency = excluded.currency,
        credit_limit = excluded.credit_limit,
        bank_code = excluded.bank_code,
        account_last4 = excluded.account_last4,
        raw_payload = excluded.raw_payload,
        updated_at = excluded.updated_at`
    )
    .bind(
      stableId(connectorId, account.sourceId),
      connectorId,
      account.sourceId,
      account.institutionName ?? null,
      account.accountName ?? null,
      account.accountType ?? null,
      account.currency || "TWD",
      account.creditLimit ?? null,
      bankCode,
      last4,
      JSON.stringify(account.raw ?? account),
      now,
      now
    );
}

function linkCanonicalBankAccountsStatement(db: D1Database) {
  return db.prepare(
    `UPDATE bank_accounts
    SET canonical_account_id = (
      SELECT direct.id FROM bank_accounts direct
      WHERE direct.connector_id IN ('esun', 'cathaybk')
        AND direct.bank_code = bank_accounts.bank_code
        AND direct.account_last4 = bank_accounts.account_last4
        AND direct.currency = bank_accounts.currency
      ORDER BY direct.connector_id  -- deterministic tiebreak
      LIMIT 1
    )
    WHERE connector_id NOT IN ('esun', 'cathaybk') AND bank_code IS NOT NULL AND account_last4 IS NOT NULL`
  );
}

function bankBalanceSnapshotStatement(
  db: D1Database,
  connectorId: ConnectorId,
  snapshot: Omit<BankBalanceSnapshot, "id" | "connectorId">,
  now: string
) {
  const accountId = stableId(connectorId, snapshot.accountId);
  return db
    .prepare(
      `INSERT INTO bank_balance_snapshots (
        id,
        connector_id,
        account_id,
        source_id,
        balance,
        available_balance,
        statement_balance,
        payment_due_date,
        statement_closing_date,
        no_payment_needed,
        currency,
        as_of_at,
        raw_payload,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(connector_id, account_id, source_id) DO UPDATE SET
        balance = excluded.balance,
        available_balance = excluded.available_balance,
        statement_balance = excluded.statement_balance,
        payment_due_date = excluded.payment_due_date,
        statement_closing_date = excluded.statement_closing_date,
        no_payment_needed = excluded.no_payment_needed,
        currency = excluded.currency,
        as_of_at = excluded.as_of_at,
        raw_payload = excluded.raw_payload,
        updated_at = excluded.updated_at`
    )
    .bind(
      stableId(connectorId, snapshot.accountId, snapshot.sourceId),
      connectorId,
      accountId,
      snapshot.sourceId,
      snapshot.balance,
      snapshot.availableBalance ?? null,
      snapshot.statementBalance ?? null,
      snapshot.paymentDueDate ?? null,
      snapshot.statementClosingDate ?? null,
      snapshot.noPaymentNeeded == null ? null : (snapshot.noPaymentNeeded ? 1 : 0),
      snapshot.currency || "TWD",
      snapshot.asOfAt,
      JSON.stringify(snapshot.raw ?? snapshot),
      now,
      now
    );
}

function bankTransactionStatement(
  db: D1Database,
  connectorId: ConnectorId,
  transaction: Omit<BankTransaction, "id" | "connectorId">,
  now: string
) {
  const accountId = stableId(connectorId, transaction.accountId);
  return db
    .prepare(
      `INSERT INTO bank_transactions (
        id,
        connector_id,
        account_id,
        source_id,
        posted_date,
        authorized_at,
        amount,
        currency,
        description,
        counterparty,
        raw_payload,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(connector_id, account_id, source_id) DO UPDATE SET
        posted_date = excluded.posted_date,
        authorized_at = excluded.authorized_at,
        amount = excluded.amount,
        currency = excluded.currency,
        description = excluded.description,
        counterparty = excluded.counterparty,
        raw_payload = excluded.raw_payload,
        updated_at = excluded.updated_at`
    )
    .bind(
      stableId(connectorId, transaction.accountId, transaction.sourceId),
      connectorId,
      accountId,
      transaction.sourceId,
      transaction.postedDate ?? null,
      transaction.authorizedAt ?? null,
      transaction.amount,
      transaction.currency || "TWD",
      transaction.description ?? null,
      transaction.counterparty ?? null,
      JSON.stringify(transaction.raw ?? transaction),
      now,
      now
    );
}

function creditCardBillStatement(
  db: D1Database,
  connectorId: ConnectorId,
  bill: Omit<CreditCardBill, "id" | "connectorId">,
  now: string
) {
  const accountId = stableId(connectorId, bill.accountId);
  return db
    .prepare(
      `INSERT INTO credit_card_bills (
        id,
        connector_id,
        account_id,
        source_id,
        billing_period,
        statement_amount,
        minimum_payment,
        paid_amount,
        is_paid,
        payment_due_date,
        statement_closing_date,
        currency,
        raw_payload,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(connector_id, account_id, billing_period) DO UPDATE SET
        source_id = excluded.source_id,
        statement_amount = excluded.statement_amount,
        minimum_payment = excluded.minimum_payment,
        paid_amount = excluded.paid_amount,
        is_paid = excluded.is_paid,
        payment_due_date = excluded.payment_due_date,
        statement_closing_date = excluded.statement_closing_date,
        currency = excluded.currency,
        raw_payload = excluded.raw_payload,
        updated_at = excluded.updated_at`
    )
    .bind(
      stableId(connectorId, bill.accountId, bill.billingPeriod),
      connectorId,
      accountId,
      bill.sourceId,
      bill.billingPeriod,
      bill.statementAmount ?? null,
      bill.minimumPayment ?? null,
      bill.paidAmount ?? null,
      bill.isPaid == null ? null : (bill.isPaid ? 1 : 0),
      bill.paymentDueDate ?? null,
      bill.statementClosingDate ?? null,
      bill.currency || "TWD",
      JSON.stringify(bill.raw ?? bill),
      now,
      now
    );
}

function investmentPositionStatement(
  db: D1Database,
  connectorId: ConnectorId,
  position: Omit<InvestmentPosition, "id" | "connectorId">,
  now: string
) {
  const normalized = normalizePosition(position);
  const id = stableId(connectorId, normalized.sourceId, normalized.asOfDate);
  return db
    .prepare(
      `INSERT INTO investment_positions (
        id,
        connector_id,
        source_id,
        asset_type,
        symbol,
        name,
        quantity,
        market_value,
        cash_balance,
        currency,
        as_of_date,
        raw_payload,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(connector_id, source_id, as_of_date) DO UPDATE SET
        asset_type = excluded.asset_type,
        symbol = excluded.symbol,
        name = excluded.name,
        quantity = excluded.quantity,
        market_value = excluded.market_value,
        cash_balance = excluded.cash_balance,
        currency = excluded.currency,
        raw_payload = excluded.raw_payload,
        updated_at = excluded.updated_at`
    )
    .bind(
      id,
      connectorId,
      normalized.sourceId,
      normalized.assetType,
      normalized.symbol ?? null,
      normalized.name,
      normalized.quantity ?? null,
      normalized.marketValue ?? null,
      normalized.cashBalance ?? null,
      normalized.currency,
      normalized.asOfDate,
      JSON.stringify(normalized.raw ?? normalized),
      now,
      now
    );
}

function investmentTransactionStatement(
  db: D1Database,
  connectorId: ConnectorId,
  transaction: Omit<InvestmentTransaction, "id" | "connectorId">,
  now: string
) {
  return db
    .prepare(
      `INSERT INTO investment_transactions (
        id,
        connector_id,
        account_id,
        source_id,
        broker_no,
        broker_account,
        broker_name,
        symbol,
        name,
        asset_type,
        trade_date,
        posted_date,
        transaction_code,
        transaction_name,
        quantity,
        price,
        amount,
        currency,
        raw_payload,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(connector_id, account_id, source_id) DO UPDATE SET
        broker_no = excluded.broker_no,
        broker_account = excluded.broker_account,
        broker_name = excluded.broker_name,
        symbol = excluded.symbol,
        name = excluded.name,
        asset_type = excluded.asset_type,
        trade_date = excluded.trade_date,
        posted_date = excluded.posted_date,
        transaction_code = excluded.transaction_code,
        transaction_name = excluded.transaction_name,
        quantity = excluded.quantity,
        price = excluded.price,
        amount = excluded.amount,
        currency = excluded.currency,
        raw_payload = excluded.raw_payload,
        updated_at = excluded.updated_at`
    )
    .bind(
      stableId(connectorId, transaction.accountId, transaction.sourceId),
      connectorId,
      transaction.accountId,
      transaction.sourceId,
      transaction.brokerNo ?? null,
      transaction.brokerAccount ?? null,
      transaction.brokerName ?? null,
      transaction.symbol ?? null,
      transaction.name ?? null,
      transaction.assetType ?? null,
      transaction.tradeDate ?? null,
      transaction.postedDate ?? null,
      transaction.transactionCode ?? null,
      transaction.transactionName ?? null,
      transaction.quantity ?? null,
      transaction.price ?? null,
      transaction.amount ?? null,
      transaction.currency || "TWD",
      JSON.stringify(transaction.raw ?? transaction),
      now,
      now
    );
}

function dateFromIso(iso: string) {
  return iso.slice(0, 10);
}

function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function enumerateDates(from: string, to: string) {
  const dates: string[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    dates.push(date);
  }
  return dates;
}

async function resolveBankHistoryDateRange(db: D1Database, from?: string, to?: string) {
  const row = await db.prepare(
    `SELECT
       MIN(substr(as_of_at, 1, 10)) AS minDate,
       MAX(substr(as_of_at, 1, 10)) AS maxDate
     FROM bank_balance_snapshots`
  ).first<{ minDate: string | null; maxDate: string | null }>();

  const minDate = row?.minDate;
  const maxDate = row?.maxDate;
  if (!minDate || !maxDate) return null;

  const resolvedFrom = from ?? minDate;
  const resolvedTo = to ?? maxDate;
  if (resolvedFrom > resolvedTo) return null;
  return { from: resolvedFrom, to: resolvedTo };
}

async function calculateBankDepositValue(db: D1Database, date: string) {
  const rows = await db.prepare(
    `SELECT
       latest.balance AS balance,
       latest.currency AS currency,
       rate.rate_to_twd AS rateToTwd
     FROM bank_accounts account
     JOIN bank_balance_snapshots latest
       ON latest.id = (
         SELECT snapshot.id
         FROM bank_balance_snapshots snapshot
         WHERE snapshot.account_id = account.id
           AND substr(snapshot.as_of_at, 1, 10) <= ?
         ORDER BY snapshot.as_of_at DESC, snapshot.updated_at DESC
         LIMIT 1
       )
     LEFT JOIN exchange_rates rate ON rate.currency = latest.currency
     WHERE account.canonical_account_id IS NULL
       AND COALESCE(account.account_type, 'unknown') != 'credit'`
  ).bind(date).all<{ balance: number; currency: string; rateToTwd: number | null }>();

  return Math.round(rows.results.reduce((sum, row) => {
    const currency = row.currency || "TWD";
    if (currency === "TWD") return sum + row.balance;
    return row.rateToTwd ? sum + row.balance * row.rateToTwd : sum;
  }, 0));
}

async function rebuildBankDepositHistory(db: D1Database, dates: string[]) {
  if (dates.length === 0) return;

  const now = new Date().toISOString();
  const statements: D1PreparedStatement[][] = [];
  let batch: D1PreparedStatement[] = [];
  for (const date of dates) {
    const netWorth = await calculateBankDepositValue(db, date);
    batch.push(
      db.prepare(
        `INSERT INTO net_worth_history (id, date, net_worth, asset_type, source, snapshotted_at)
         VALUES (?, ?, ?, 'deposit', 'bank', ?)
         ON CONFLICT(source, asset_type, date) DO UPDATE SET
           net_worth = excluded.net_worth,
           snapshotted_at = excluded.snapshotted_at`
      ).bind(`bank:deposit:${date}`, date, netWorth, now)
    );
    if (batch.length >= 100) {
      statements.push(batch);
      batch = [];
    }
  }
  if (batch.length > 0) {
    statements.push(batch);
  }

  for (const statementBatch of statements) {
    await db.batch(statementBatch);
  }
}

function netWorthHistoryStatement(db: D1Database, source: string, point: NetWorthHistoryPoint, now: string) {
  const assetType = point.assetType ?? "total";
  return db
    .prepare(
      `INSERT INTO net_worth_history (id, date, net_worth, asset_type, source, snapshotted_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(source, asset_type, date) DO UPDATE SET net_worth = excluded.net_worth, snapshotted_at = excluded.snapshotted_at`
    )
    .bind(`${source}:${assetType}:${point.date}`, point.date, point.netWorth, assetType, source, now);
}

function normalizePosition(position: Omit<InvestmentPosition, "id" | "connectorId">) {
  return {
    ...position,
    currency: position.currency || "TWD"
  };
}

export default {
  fetch: app.fetch,
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runSchedulerTick(env, controller));
  }
} satisfies ExportedHandler<Env>;
