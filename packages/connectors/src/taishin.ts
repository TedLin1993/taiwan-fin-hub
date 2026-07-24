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
type TransactionWithOccurrence = TransactionCandidate & {
  occurrence: number;
};
type TaishinTransaction = Omit<BankTransaction, "id" | "connectorId">;

export type TaishinExistingTransactionIdentity = Pick<
  BankTransaction,
  | "sourceId"
  | "postedDate"
  | "authorizedAt"
  | "amount"
  | "currency"
  | "description"
  | "counterparty"
  | "status"
  | "raw"
>;

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
  const billEntries = billValues
    .flatMap((value) => {
      const bill = parseBill(value);
      return bill ? [{ value, bill }] : [];
    })
    .sort((left, right) =>
      right.bill.billingPeriod.localeCompare(left.bill.billingPeriod),
    );
  const currentBillEntry = billEntries.find(
    ({ value }) => optionalNumber(value.showCdue) != null,
  );
  if (!summaryTwd || !currentBillEntry) {
    throw new Error("台新信用卡 API 缺少額度或帳單資料。");
  }

  const currentBill = currentBillEntry.value;
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

  const statementAmount = optionalAbsoluteNumber(
    currentBill.showCbalance ?? summaryTwd["OUT-STMT-BALANCE"],
  );
  const availableCredit = optionalNumber(summaryTwd["OUT-AVAIL-CREDIT"]);
  const creditLimit = optionalNumber(summaryTwd["OUT-CRLIMIT-PERM"]);
  const paymentDueDate = normalizeDate(currentBill.showDueDate);
  const statementClosingDate = normalizeDate(currentBill.showStmtDate);
  const remainingDue = Math.abs(optionalNumber(currentBill.showCdue)!);
  const asOfAt = now.toISOString();

  const bills = billEntries
    .map(({ bill }) => bill)
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
        balance: remainingDue > 0 ? -remainingDue : 0,
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
  const statementAmount = optionalAbsoluteNumber(value.showCbalance);
  const paidAmount = optionalAbsoluteNumber(value.showPayment);
  const remainingDue = optionalAbsoluteNumber(value.showCdue);
  const minimumPayment = optionalAbsoluteNumber(value.showMinPay);
  const paymentDueDate = normalizeDate(value.showDueDate);
  const statementClosingDate = normalizeDate(value.showStmtDate);
  return {
    sourceId: `taishin:card:statement:${billingPeriod}:TWD`,
    billingPeriod,
    statementAmount,
    minimumPayment,
    paidAmount,
    isPaid: remainingDue == null ? undefined : remainingDue === 0,
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
  const pendingWithOccurrences = assignOccurrences(pending);
  const pendingByMatchKey = groupByMatchKey(pendingWithOccurrences);
  const postedByMatchKey = groupByMatchKey(posted);
  const postedOccurrences = new Map<TransactionCandidate, number>();
  const consumedPending = new Set<TransactionWithOccurrence>();

  for (const [matchKey, postedGroup] of postedByMatchKey) {
    const pendingGroup = pendingByMatchKey.get(matchKey) ?? [];

    for (const postedTransaction of postedGroup) {
      const matchingPending = pendingGroup.filter((pendingTransaction) =>
        merchantNamesMatch(
          postedTransaction.description,
          pendingTransaction.description,
        ),
      );
      if (matchingPending.length !== 1) continue;

      const pendingTransaction = matchingPending[0]!;
      const matchingPosted = postedGroup.filter((candidate) =>
        merchantNamesMatch(
          candidate.description,
          pendingTransaction.description,
        ),
      );
      if (matchingPosted.length !== 1) continue;

      postedOccurrences.set(postedTransaction, pendingTransaction.occurrence);
      consumedPending.add(pendingTransaction);
    }

    let nextOccurrence =
      Math.max(0, ...pendingGroup.map(({ occurrence }) => occurrence)) + 1;
    for (const postedTransaction of postedGroup) {
      if (postedOccurrences.has(postedTransaction)) continue;
      postedOccurrences.set(postedTransaction, nextOccurrence);
      nextOccurrence += 1;
    }
  }

  const postedWithIds = posted.map((transaction) =>
    assignSourceId(transaction, postedOccurrences.get(transaction) ?? 1),
  );
  const unmatchedPending = pendingWithOccurrences
    .filter((transaction) => !consumedPending.has(transaction))
    .map(({ occurrence, ...transaction }) =>
      assignSourceId(transaction, occurrence),
    );

  return [...postedWithIds, ...unmatchedPending].map(
    ({ matchKey: _matchKey, cardLast4: _cardLast4, ...transaction }) =>
      transaction,
  );
}

export function reconcileTaishinTransactionSourceIds(
  transactions: TaishinTransaction[],
  existingTransactions: TaishinExistingTransactionIdentity[],
): TaishinTransaction[] {
  const incoming = transactions.map((transaction, index) => ({
    index,
    transaction,
    identity: taishinTransactionIdentity(transaction),
  }));
  const existing = existingTransactions
    .map((transaction) => ({
      transaction,
      identity: taishinTransactionIdentity(transaction),
    }))
    .filter(
      (
        entry,
      ): entry is typeof entry & {
        identity: NonNullable<typeof entry.identity>;
      } => Boolean(entry.identity),
    );
  const assignments = new Map<number, string>();
  const consumedExisting = new Set<string>();

  assignUniqueIdentityMatches(
    incoming,
    existing,
    assignments,
    consumedExisting,
    (left, right) =>
      Boolean(
        left.authorizedAt &&
        right.authorizedAt &&
        left.authorizedAt === right.authorizedAt &&
        merchantNamesMatch(left.description, right.description),
      ),
  );
  assignUniqueIdentityMatches(
    incoming,
    existing,
    assignments,
    consumedExisting,
    (left, right) => merchantNamesMatch(left.description, right.description),
  );

  const reservedSourceIds = new Set(
    existingTransactions.map(({ sourceId }) => sourceId),
  );
  const nextOccurrences = new Map<string, number>();
  for (const entry of existing) {
    const occurrence = sourceIdOccurrence(entry.transaction.sourceId);
    if (occurrence == null) continue;
    nextOccurrences.set(
      entry.identity.matchKey,
      Math.max(
        nextOccurrences.get(entry.identity.matchKey) ?? 1,
        occurrence + 1,
      ),
    );
  }

  return incoming.map(({ index, transaction, identity }) => {
    if (!identity) return transaction;
    const assignedSourceId = assignments.get(index);
    if (assignedSourceId) {
      return withTaishinSourceId(
        transaction,
        assignedSourceId,
        identity.matchKey,
      );
    }

    if (!reservedSourceIds.has(transaction.sourceId)) {
      reservedSourceIds.add(transaction.sourceId);
      return withTaishinSourceId(
        transaction,
        transaction.sourceId,
        identity.matchKey,
      );
    }

    let occurrence = nextOccurrences.get(identity.matchKey) ?? 1;
    let sourceId = taishinTransactionSourceId(identity.matchKey, occurrence);
    while (reservedSourceIds.has(sourceId)) {
      occurrence += 1;
      sourceId = taishinTransactionSourceId(identity.matchKey, occurrence);
    }
    nextOccurrences.set(identity.matchKey, occurrence + 1);
    reservedSourceIds.add(sourceId);
    return withTaishinSourceId(transaction, sourceId, identity.matchKey);
  });
}

type TaishinTransactionIdentity = {
  matchKey: string;
  authorizedAt?: string;
  description?: string;
};

function assignUniqueIdentityMatches(
  incoming: Array<{
    index: number;
    transaction: TaishinTransaction;
    identity: TaishinTransactionIdentity | undefined;
  }>,
  existing: Array<{
    transaction: TaishinExistingTransactionIdentity;
    identity: TaishinTransactionIdentity;
  }>,
  assignments: Map<number, string>,
  consumedExisting: Set<string>,
  matches: (
    left: TaishinTransactionIdentity,
    right: TaishinTransactionIdentity,
  ) => boolean,
) {
  for (const incomingEntry of incoming) {
    if (assignments.has(incomingEntry.index) || !incomingEntry.identity)
      continue;
    const candidates = existing.filter(
      (existingEntry) =>
        !consumedExisting.has(existingEntry.transaction.sourceId) &&
        existingEntry.identity.matchKey === incomingEntry.identity!.matchKey &&
        matches(incomingEntry.identity!, existingEntry.identity),
    );
    if (candidates.length !== 1) continue;

    const [candidate] = candidates;
    const competingIncoming = incoming.filter(
      (entry) =>
        !assignments.has(entry.index) &&
        entry.identity?.matchKey === candidate!.identity.matchKey &&
        matches(entry.identity, candidate!.identity),
    );
    if (competingIncoming.length !== 1) continue;

    assignments.set(incomingEntry.index, candidate!.transaction.sourceId);
    consumedExisting.add(candidate!.transaction.sourceId);
  }
}

function taishinTransactionIdentity(
  transaction: TaishinTransaction | TaishinExistingTransactionIdentity,
): TaishinTransactionIdentity | undefined {
  const raw = isRecord(transaction.raw) ? transaction.raw : {};
  const authorizedAt =
    stringValue(transaction.authorizedAt).trim() ||
    stringValue(raw.authorizedAt).trim() ||
    undefined;
  const transactionDate =
    normalizeDate(raw.transactionDate) ??
    normalizeDate(authorizedAt) ??
    normalizeDate(transaction.postedDate);
  if (!transactionDate) return undefined;
  const rawCardLast4 = stringValue(raw.cardLast4).trim();
  const cardLast4 =
    (/^\d{4}$/.test(rawCardLast4) ? rawCardLast4 : last4(rawCardLast4)) ??
    "unknown";
  const matchKey =
    stringValue(raw.lifecycleMatchKey).trim() ||
    transactionMatchKey(
      transaction.currency,
      transactionDate,
      transaction.amount,
      cardLast4,
    );
  return {
    matchKey,
    authorizedAt,
    description: transaction.description,
  };
}

function withTaishinSourceId(
  transaction: TaishinTransaction,
  sourceId: string,
  matchKey: string,
): TaishinTransaction {
  return {
    ...transaction,
    sourceId,
    raw: {
      ...(isRecord(transaction.raw) ? transaction.raw : {}),
      lifecycleMatchKey: matchKey,
      duplicateOccurrence: sourceIdOccurrence(sourceId),
    },
  };
}

function sourceIdOccurrence(sourceId: string) {
  const occurrence = Number(sourceId.match(/:(\d+)$/)?.[1]);
  return Number.isInteger(occurrence) && occurrence > 0
    ? occurrence
    : undefined;
}

function assignOccurrences(
  candidates: TransactionCandidate[],
): TransactionWithOccurrence[] {
  const occurrences = new Map<string, number>();
  return candidates.map((candidate) => {
    const occurrence = (occurrences.get(candidate.matchKey) ?? 0) + 1;
    occurrences.set(candidate.matchKey, occurrence);
    return {
      ...candidate,
      occurrence,
    };
  });
}

function assignSourceId(candidate: TransactionCandidate, occurrence: number) {
  return {
    ...candidate,
    sourceId: taishinTransactionSourceId(candidate.matchKey, occurrence),
    raw: {
      ...(candidate.raw as JsonRecord),
      lifecycleMatchKey: candidate.matchKey,
      duplicateOccurrence: occurrence,
    },
  };
}

function taishinTransactionSourceId(matchKey: string, occurrence: number) {
  return `taishin:card:tx:v1:${matchKey}:${occurrence}`;
}

function groupByMatchKey<T extends TransactionCandidate>(candidates: T[]) {
  const groups = new Map<string, T[]>();
  for (const candidate of candidates) {
    const group = groups.get(candidate.matchKey) ?? [];
    group.push(candidate);
    groups.set(candidate.matchKey, group);
  }
  return groups;
}

function merchantNamesMatch(
  left: string | undefined,
  right: string | undefined,
) {
  const normalizedLeft = normalizeMerchantName(left);
  const normalizedRight = normalizeMerchantName(right);
  if (!normalizedLeft || !normalizedRight) return false;
  if (normalizedLeft === normalizedRight) return true;
  return (
    Math.min(normalizedLeft.length, normalizedRight.length) >= 4 &&
    (normalizedLeft.includes(normalizedRight) ||
      normalizedRight.includes(normalizedLeft))
  );
}

function normalizeMerchantName(value: string | undefined) {
  return (value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s()[\]{}（）【】〈〉《》,，.。:：/\\_-]+/g, "");
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

function optionalAbsoluteNumber(value: unknown) {
  const number = optionalNumber(value);
  return number == null ? undefined : Math.abs(number);
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
