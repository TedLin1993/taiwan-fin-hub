import type {
  BankAccount,
  BankBalanceSnapshot,
  BankTransaction,
  CreditCardBill,
} from "@taiwan-fin-hub/core";
import { z } from "zod";

export const taishinConfigSchema = z.object({
  userId: z.string().min(1).optional(),
  account: z.string().min(1).optional(),
  password: z.string().min(1).optional(),
  lookbackMonths: z.coerce.number().int().min(1).max(6).default(6),
  sessionCookies: z.string().optional(),
  sessionCreatedAt: z.string().optional(),
  browserSessionId: z.string().optional(),
  browserSessionExpiresAt: z.string().optional(),
  captchaDigitCount: z.number().int().min(4).max(8).optional(),
  captcha: z
    .string()
    .regex(/^\d{4,8}$/)
    .optional(),
});

export type TaishinConfig = z.infer<typeof taishinConfigSchema>;

export function parseTaishinConfig(config: unknown): TaishinConfig {
  return taishinConfigSchema.parse(config);
}

export type TaishinCreditCardPayloads = {
  summary: unknown;
  bills: unknown[];
  realtime?: unknown;
};

export type TaishinCreditCardData = {
  bankAccounts: Array<Omit<BankAccount, "id" | "connectorId">>;
  bankBalanceSnapshots: Array<Omit<BankBalanceSnapshot, "id" | "connectorId">>;
  bankTransactions: Array<Omit<BankTransaction, "id" | "connectorId">>;
  creditCardBills: Array<Omit<CreditCardBill, "id" | "connectorId">>;
};

type JsonRecord = Record<string, unknown>;
type TransactionCandidate = Omit<
  BankTransaction,
  "id" | "connectorId" | "accountId" | "sourceId"
> & {
  matchKey: string;
  cardLast4: string;
};

const ACCOUNT_SOURCE_ID = "credit:taishin:main";

export function parseTaishinCreditCardData(
  payloads: TaishinCreditCardPayloads,
  lookbackMonths = 6,
  now = new Date(),
): TaishinCreditCardData {
  const summary = responseValue(payloads.summary);
  const summaryTwd = firstRecordValue(summary);
  const billValues = payloads.bills
    .map(responseValue)
    .filter((value): value is JsonRecord => Boolean(value));
  if (!summaryTwd || billValues.length === 0) {
    throw new Error("台新信用卡 API 缺少額度或帳單資料。");
  }

  const currentBill = billValues[0]!;
  const postedCandidates = billValues.flatMap(postedTransactions);
  const pendingCandidates = realtimeTransactions(
    responseValue(payloads.realtime),
  );
  const transactions = mergeTransactionLifecycle(
    postedCandidates,
    pendingCandidates,
  );
  const cardLast4s = Array.from(
    new Set(
      [...postedCandidates, ...pendingCandidates]
        .map((transaction) => transaction.cardLast4)
        .filter((value) => value !== "unknown"),
    ),
  ).sort();

  const statementAmount = absoluteNumber(
    currentBill.showCbalance ?? summaryTwd["OUT-STMT-BALANCE"],
  );
  const availableCredit = optionalNumber(summaryTwd["OUT-AVAIL-CREDIT"]);
  const creditLimit = optionalNumber(summaryTwd["OUT-CRLIMIT-PERM"]);
  const paymentDueDate = normalizeDate(currentBill.showDueDate);
  const statementClosingDate = normalizeDate(currentBill.showStmtDate);
  const remainingDue = absoluteNumber(currentBill.showCdue);
  const asOfAt = now.toISOString();

  const bills = billValues
    .map(parseBill)
    .filter(
      (
        bill,
      ): bill is Omit<CreditCardBill, "id" | "connectorId" | "accountId"> =>
        Boolean(bill),
    )
    .slice(0, Math.max(1, Math.min(6, lookbackMonths)));

  return {
    bankAccounts: [
      {
        sourceId: ACCOUNT_SOURCE_ID,
        institutionName: "台新銀行",
        accountName: "台新信用卡",
        accountType: "credit",
        currency: "TWD",
        creditLimit,
        raw: { cardLast4s },
      },
    ],
    bankBalanceSnapshots: [
      {
        accountId: ACCOUNT_SOURCE_ID,
        sourceId: `${ACCOUNT_SOURCE_ID}:${asOfAt.slice(0, 10)}`,
        balance: -statementAmount,
        availableBalance: availableCredit,
        statementBalance: statementAmount,
        paymentDueDate,
        statementClosingDate,
        noPaymentNeeded: remainingDue === 0,
        currency: "TWD",
        asOfAt,
        raw: {
          statementAmount,
          availableCredit,
          paymentDueDate,
          statementClosingDate,
        },
      },
    ],
    bankTransactions: transactions.map((transaction) => ({
      ...transaction,
      accountId: ACCOUNT_SOURCE_ID,
    })),
    creditCardBills: bills.map((bill) => ({
      ...bill,
      accountId: ACCOUNT_SOURCE_ID,
    })),
  };
}

function parseBill(
  value: JsonRecord,
): Omit<CreditCardBill, "id" | "connectorId" | "accountId"> | undefined {
  const billingPeriod = normalizePeriod(value.showAccoutnYM);
  if (!billingPeriod) return undefined;
  const statementAmount = absoluteNumber(value.showCbalance);
  const paidAmount = absoluteNumber(value.showPayment);
  const remainingDue = absoluteNumber(value.showCdue);
  const minimumPayment = absoluteNumber(value.showMinPay);
  const paymentDueDate = normalizeDate(value.showDueDate);
  const statementClosingDate = normalizeDate(value.showStmtDate);
  return {
    sourceId: `taishin:card:statement:${billingPeriod}:TWD`,
    billingPeriod,
    statementAmount,
    minimumPayment,
    paidAmount,
    isPaid: remainingDue === 0,
    paymentDueDate,
    statementClosingDate,
    currency: "TWD",
    raw: {
      billingPeriod,
      statementAmount,
      minimumPayment,
      paidAmount,
      remainingDue,
      paymentDueDate,
      statementClosingDate,
    },
  };
}

function postedTransactions(value: JsonRecord): TransactionCandidate[] {
  const groups = Array.isArray(value.newAcctDetailList)
    ? value.newAcctDetailList.filter(isRecord)
    : [];
  const candidates: TransactionCandidate[] = [];
  for (const group of groups) {
    const cardLast4 = last4(stringValue(group.order)) ?? "unknown";
    const details = Array.isArray(group.detail)
      ? group.detail.filter(isRecord)
      : [];
    for (const detail of details) {
      const transactionDate = normalizeDate(detail.showOutTXNDate);
      const postedDate = normalizeDate(detail.showOutPostDate);
      const rawAmount = optionalNumber(detail.showOutAmt);
      if (!transactionDate || rawAmount == null || rawAmount === 0) continue;
      const description =
        stringValue(detail.showOutDesc).trim() || "台新信用卡交易";
      const amount = signedAmount(rawAmount, description);
      const currency = normalizeCurrency(detail.showOutCurrency);
      candidates.push({
        matchKey: transactionMatchKey(
          currency,
          transactionDate,
          amount,
          cardLast4,
        ),
        cardLast4,
        authorizedAt: transactionDate,
        postedDate: postedDate ?? transactionDate,
        amount,
        currency,
        description,
        counterparty: description,
        status: "posted",
        raw: {
          cardLast4: cardLast4 === "unknown" ? undefined : cardLast4,
          transactionDate,
          postedDate: postedDate ?? transactionDate,
          description,
          amount,
          currency,
          country: stringValue(detail.showOutCountry).trim() || undefined,
        },
      });
    }
  }
  return candidates;
}

function realtimeTransactions(
  value: JsonRecord | undefined,
): TransactionCandidate[] {
  if (!value || !Array.isArray(value.fmtRealTxListMap)) return [];
  const candidates: TransactionCandidate[] = [];
  for (const group of value.fmtRealTxListMap.filter(isRecord)) {
    const cardName = stringValue(group.cardname);
    const cardLast4 = last4(cardName) ?? "unknown";
    const rows = Array.isArray(group.txlist) ? group.txlist : [];
    for (const row of rows) {
      if (!Array.isArray(row)) continue;
      const transactionDate = normalizeDate(row[0]);
      const time = stringValue(row[1]).trim();
      const description = stringValue(row[2]).trim() || "台新信用卡交易";
      const rawAmount = optionalNumber(row[3]);
      const country = stringValue(row[4]).trim();
      const authorizationResult = stringValue(row[5]).trim();
      if (
        !transactionDate ||
        rawAmount == null ||
        rawAmount === 0 ||
        !/成功|success|approved/i.test(authorizationResult)
      ) {
        continue;
      }
      const amount = signedAmount(rawAmount, description);
      const currency = "TWD";
      const authorizedAt = dateTimeWithTaipeiOffset(transactionDate, time);
      candidates.push({
        matchKey: transactionMatchKey(
          currency,
          transactionDate,
          amount,
          cardLast4,
        ),
        cardLast4,
        authorizedAt,
        amount,
        currency,
        description,
        counterparty: description,
        status: "pending",
        raw: {
          cardLast4: cardLast4 === "unknown" ? undefined : cardLast4,
          authorizedAt,
          description,
          amount,
          currency,
          country: country || undefined,
          authorizationResult,
        },
      });
    }
  }
  return candidates;
}

function mergeTransactionLifecycle(
  posted: TransactionCandidate[],
  pending: TransactionCandidate[],
) {
  const postedWithIds = assignSourceIds(posted);
  const pendingWithIds = assignSourceIds(pending);
  const postedCounts = countByMatchKey(postedWithIds);
  const seenPending = new Map<string, number>();
  const unmatchedPending = pendingWithIds.filter((transaction) => {
    const occurrence = (seenPending.get(transaction.matchKey) ?? 0) + 1;
    seenPending.set(transaction.matchKey, occurrence);
    return occurrence > (postedCounts.get(transaction.matchKey) ?? 0);
  });
  return [...postedWithIds, ...unmatchedPending].map(
    ({ matchKey: _matchKey, cardLast4: _cardLast4, ...transaction }) =>
      transaction,
  );
}

function assignSourceIds(candidates: TransactionCandidate[]) {
  const occurrences = new Map<string, number>();
  return candidates.map((candidate) => {
    const occurrence = (occurrences.get(candidate.matchKey) ?? 0) + 1;
    occurrences.set(candidate.matchKey, occurrence);
    return {
      ...candidate,
      sourceId: `taishin:card:tx:v1:${candidate.matchKey}:${occurrence}`,
      raw: {
        ...(candidate.raw as JsonRecord),
        duplicateOccurrence: occurrence,
      },
    };
  });
}

function countByMatchKey(
  candidates: Array<TransactionCandidate & { sourceId: string }>,
) {
  const counts = new Map<string, number>();
  for (const candidate of candidates) {
    counts.set(candidate.matchKey, (counts.get(candidate.matchKey) ?? 0) + 1);
  }
  return counts;
}

function responseValue(value: unknown): JsonRecord | undefined {
  if (!isRecord(value)) return undefined;
  if (
    value.error != null &&
    (!isRecord(value.error) || Object.keys(value.error).length > 0)
  ) {
    throw new Error("台新信用卡 API 回傳錯誤。");
  }
  return isRecord(value.value) ? value.value : undefined;
}

function firstRecordValue(value: JsonRecord | undefined) {
  if (!value) return undefined;
  return Object.values(value).find(isRecord);
}

function transactionMatchKey(
  currency: string,
  transactionDate: string,
  amount: number,
  cardLast4: string,
) {
  return [currency, transactionDate, amount, cardLast4].join(":");
}

function signedAmount(rawAmount: number, description: string) {
  const isCredit =
    rawAmount < 0 ||
    /退款|退貨|折抵|折讓|回饋|沖銷|繳款|自動轉帳扣繳|refund|credit|payment/i.test(
      description,
    );
  return isCredit ? Math.abs(rawAmount) : -Math.abs(rawAmount);
}

function normalizeCurrency(value: unknown) {
  const text = stringValue(value).trim().toUpperCase();
  if (!text || /新臺幣|台幣|臺幣|TWD|NTD/.test(text)) return "TWD";
  if (/美元|USD/.test(text)) return "USD";
  if (/日圓|日幣|JPY/.test(text)) return "JPY";
  if (/歐元|EUR/.test(text)) return "EUR";
  return text.length === 3 ? text : "TWD";
}

function normalizePeriod(value: unknown) {
  const text = stringValue(value).trim();
  const match = text.match(/(\d{4})[/-]?(\d{1,2})/);
  if (!match) return undefined;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return undefined;
  return `${match[1]}-${String(month).padStart(2, "0")}`;
}

function normalizeDate(value: unknown) {
  const text = stringValue(value).trim();
  const match = text.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (!match) return undefined;
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  return `${match[1]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function dateTimeWithTaipeiOffset(date: string, time: string) {
  const match = time.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return date;
  return `${date}T${String(Number(match[1])).padStart(2, "0")}:${match[2]}:${match[3] ?? "00"}+08:00`;
}

function optionalNumber(value: unknown) {
  if (typeof value === "number")
    return Number.isFinite(value) ? value : undefined;
  const text = stringValue(value)
    .replaceAll(",", "")
    .replace(/[^\d().+-]/g, "")
    .trim();
  if (!text) return undefined;
  const negative = /^\(.*\)$/.test(text);
  const number = Number(text.replace(/[()]/g, ""));
  if (!Number.isFinite(number)) return undefined;
  return negative ? -Math.abs(number) : number;
}

function absoluteNumber(value: unknown) {
  return Math.abs(optionalNumber(value) ?? 0);
}

function last4(value: string) {
  return value.match(/(?:末四碼\s*[:：]?\s*|[*xX])(\d{4})\D*$/)?.[1];
}

function stringValue(value: unknown) {
  return value == null ? "" : String(value);
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
