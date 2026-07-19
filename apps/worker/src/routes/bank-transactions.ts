import type { Hono } from "hono";
import { z } from "zod";
import type { AppBindings } from "../platform/env";
import { jsonError } from "../platform/http";

const calculationPreferenceSchema = z.object({
  excludedFromCalculation: z.boolean()
});

type CalculationTransaction = {
  accountType?: string | null;
  description?: string | null;
  counterparty?: string | null;
  calculationPreference?: number | null;
  classificationExcludedFromCalculation?: boolean | null;
};

function calculationText(transaction: CalculationTransaction) {
  const normalized = `${transaction.description ?? ""} ${transaction.counterparty ?? ""}`
    .normalize("NFKC")
    .toLowerCase();
  return {
    compact: normalized.replace(/[\s\p{P}\p{S}]+/gu, ""),
    words: normalized.replace(/[^a-z0-9]+/g, " ").trim()
  };
}

export function isDefaultCalculationExcluded(
  transaction: CalculationTransaction
) {
  const { compact, words } = calculationText(transaction);
  const paddedWords = ` ${words} `;

  if (compact.includes("卡費") || compact.includes("繳卡款")) return true;
  if (compact.includes("繳信用卡")) return true;
  if (
    compact.includes("信用卡") &&
    ["繳款", "扣款", "還款", "自扣", "自動扣繳"].some((keyword) =>
      compact.includes(keyword)
    )
  ) return true;
  if (paddedWords.includes(" card payment ")) return true;

  if (transaction.accountType === "credit") {
    if (compact.includes("繳款入帳") || compact.includes("自扣已入帳")) {
      return true;
    }
    if (paddedWords.includes(" payment received ")) return true;
  }

  return false;
}

export function resolveCalculationExclusion(
  transaction: CalculationTransaction
) {
  if (
    transaction.calculationPreference === 0 ||
    transaction.calculationPreference === 1
  ) {
    return transaction.calculationPreference === 1;
  }
  if (transaction.classificationExcludedFromCalculation) return true;
  return isDefaultCalculationExcluded(transaction);
}

export function registerBankTransactionRoutes(api: Hono<AppBindings>) {
  api.patch("/bank/transactions/:transactionId/calculation", async (c) => {
    const body = calculationPreferenceSchema.safeParse(
      await c.req.json().catch(() => null)
    );
    if (!body.success) {
      return jsonError(
        "INVALID_REQUEST",
        "Transaction calculation preference is invalid."
      );
    }

    const transactionId = c.req.param("transactionId");
    const transaction = await c.env.DB.prepare(
      "SELECT id FROM bank_transactions WHERE id = ?"
    ).bind(transactionId).first<{ id: string }>();
    if (!transaction) {
      return jsonError(
        "BANK_TRANSACTION_NOT_FOUND",
        "Bank transaction was not found.",
        404
      );
    }

    const now = new Date().toISOString();
    await c.env.DB.prepare(
      `INSERT INTO bank_transaction_preferences
         (transaction_id, excluded_from_calculation, created_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(transaction_id) DO UPDATE SET
         excluded_from_calculation = excluded.excluded_from_calculation,
         updated_at = excluded.updated_at`
    ).bind(
      transactionId,
      body.data.excludedFromCalculation ? 1 : 0,
      now,
      now
    ).run();

    return c.json({
      success: true,
      excludedFromCalculation: body.data.excludedFromCalculation
    });
  });
}
