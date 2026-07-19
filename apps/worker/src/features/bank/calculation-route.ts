import type { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { AppBindings } from "../../platform/env";
import { honoFactory } from "../../platform/hono";
import { jsonError } from "../../platform/http";
import { validationHook } from "../../platform/validation";
import {
  BankTransactionNotFoundError,
  setCalculationPreference,
} from "./calculation-service";

const calculationPreferenceSchema = z.object({
  excludedFromCalculation: z.boolean(),
});

export const bankCalculationRoutes = honoFactory.createApp();
registerBankTransactionRoutes(bankCalculationRoutes);

function registerBankTransactionRoutes(api: Hono<AppBindings>) {
  api.patch(
    "/bank/transactions/:transactionId/calculation",
    zValidator(
      "json",
      calculationPreferenceSchema,
      validationHook(
        "INVALID_REQUEST",
        "Transaction calculation preference is invalid.",
      ),
    ),
    async (c) => {
      const body = c.req.valid("json");
      try {
        await setCalculationPreference(
          c.env.DB,
          c.req.param("transactionId"),
          body.excludedFromCalculation,
        );
      } catch (error) {
        if (error instanceof BankTransactionNotFoundError) {
          return jsonError(
            "BANK_TRANSACTION_NOT_FOUND",
            "Bank transaction was not found.",
            404,
          );
        }
        throw error;
      }

      return c.json({
        success: true,
        excludedFromCalculation: body.excludedFromCalculation,
      });
    },
  );
}
