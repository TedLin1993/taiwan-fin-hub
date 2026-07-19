import type { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { AppBindings } from "../../platform/env";
import { honoFactory } from "../../platform/hono";
import { jsonError } from "../../platform/http";
import { validationHook } from "../../platform/validation";
import { listInvoiceTransactionPreferences } from "./repository";
import {
  keepInvoiceSeparate,
  linkInvoiceToTransaction,
  MappingDateMismatchError,
  MappingInvoiceNotFoundError,
  MappingTransactionNotExpenseError,
  MappingTransactionNotFoundError,
  MappingTransactionUnavailableError,
} from "./service";

const mappingSchema = z.object({
  transactionId: z.string().trim().min(1),
});

export const activityRoutes = honoFactory.createApp();
registerActivityRoutes(activityRoutes);
activityRoutes.onError((error) => mappingError(error));

function registerActivityRoutes(api: Hono<AppBindings>) {
  api.get("/activity/invoice-mappings", async (c) =>
    c.json(await listInvoiceTransactionPreferences(c.env.DB)),
  );

  api.put(
    "/activity/invoice-mappings/:invoiceId",
    zValidator(
      "json",
      mappingSchema,
      validationHook("INVALID_REQUEST", "Invoice mapping is invalid."),
    ),
    async (c) =>
      c.json(
        await linkInvoiceToTransaction(
          c.env.DB,
          c.req.param("invoiceId"),
          c.req.valid("json").transactionId,
        ),
      ),
  );

  api.delete("/activity/invoice-mappings/:invoiceId", async (c) =>
    c.json(await keepInvoiceSeparate(c.env.DB, c.req.param("invoiceId"))),
  );
}

function mappingError(error: unknown) {
  if (error instanceof MappingInvoiceNotFoundError)
    return jsonError("INVOICE_NOT_FOUND", "Invoice was not found.", 404);
  if (error instanceof MappingTransactionNotFoundError)
    return jsonError(
      "BANK_TRANSACTION_NOT_FOUND",
      "Bank transaction was not found.",
      404,
    );
  if (error instanceof MappingTransactionUnavailableError)
    return jsonError(
      "BANK_TRANSACTION_ALREADY_MAPPED",
      "Bank transaction is already mapped to another invoice.",
      409,
    );
  if (error instanceof MappingDateMismatchError)
    return jsonError(
      "MAPPING_DATE_MISMATCH",
      "Invoice and bank transaction must be on the same day.",
      400,
    );
  if (error instanceof MappingTransactionNotExpenseError)
    return jsonError(
      "MAPPING_TRANSACTION_NOT_EXPENSE",
      "Only TWD expense transactions can be mapped to an invoice.",
      400,
    );
  throw error;
}
