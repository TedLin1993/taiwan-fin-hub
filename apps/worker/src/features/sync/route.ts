import {
  EInvoiceProtocolUnavailableError,
  TdccConnectionError,
  TdccVerificationRequiredError,
} from "@taiwan-fin-hub/connectors";
import { zValidator } from "@hono/zod-validator";
import { type Context, type Hono } from "hono";
import { z } from "zod";
import { SinopacBrowserCapacityError } from "../../connectors/sinopac";
import type { AppBindings } from "../../platform/env";
import { honoFactory } from "../../platform/hono";
import { jsonError } from "../../platform/http";
import { validationHook } from "../../platform/validation";
import {
  NeedsUserActionError,
  prepareSinopacCaptchaSession,
  safeErrorMessage,
  syncCathaybk,
  syncEinvoice,
  syncEsun,
  syncSinopac,
  syncTdcc,
  SyncAlreadyRunningError,
  SYNC_SCOPE_ALL,
  TDCC_SCOPE_BANK,
  TDCC_SCOPE_INVESTMENTS,
  TDCC_SCOPE_TRADES,
  withManualSyncLock,
  type SyncOutcome,
} from "./service";

const tdccSyncBodySchema = z.object({
  otp: z.string().min(1).optional(),
  otpChannel: z.enum(["email", "sms"]).optional(),
});

const einvoiceSyncBodySchema = z.object({
  fetchDetails: z.boolean().optional(),
});

const sinopacSyncBodySchema = z.object({
  captcha: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
});

export const syncRoutes = honoFactory.createApp();
registerSyncRoutes(syncRoutes);

function registerSyncRoutes(api: Hono<AppBindings>) {
  api.post(
    "/connectors/einvoice/sync",
    zValidator(
      "json",
      einvoiceSyncBodySchema,
      validationHook("INVALID_REQUEST", "E-Invoice sync options are invalid."),
    ),
    async (c) => {
      const overrides = c.req.valid("json");
      return syncRouteResponse(
        c,
        withManualSyncLock(c.env, "einvoice", SYNC_SCOPE_ALL, () =>
          syncEinvoice(c.env, "manual", overrides),
        ),
      );
    },
  );

  api.post(
    "/connectors/tdcc/sync",
    zValidator(
      "json",
      tdccSyncBodySchema,
      validationHook("INVALID_REQUEST", "TDCC sync options are invalid."),
    ),
    async (c) => {
      const overrides = c.req.valid("json");
      return syncRouteResponse(
        c,
        withManualSyncLock(c.env, "tdcc", SYNC_SCOPE_ALL, () =>
          syncTdcc(c.env, "manual", overrides, [
            TDCC_SCOPE_INVESTMENTS,
            TDCC_SCOPE_BANK,
            TDCC_SCOPE_TRADES,
          ]),
        ),
      );
    },
  );

  api.post(
    "/connectors/tdcc/sync/investments",
    zValidator(
      "json",
      tdccSyncBodySchema,
      validationHook("INVALID_REQUEST", "TDCC sync options are invalid."),
    ),
    async (c) => {
      const overrides = c.req.valid("json");
      return syncRouteResponse(
        c,
        withManualSyncLock(c.env, "tdcc", TDCC_SCOPE_INVESTMENTS, () =>
          syncTdcc(c.env, "manual", overrides, [TDCC_SCOPE_INVESTMENTS]),
        ),
      );
    },
  );

  api.post(
    "/connectors/tdcc/sync/bank",
    zValidator(
      "json",
      tdccSyncBodySchema,
      validationHook("INVALID_REQUEST", "TDCC sync options are invalid."),
    ),
    async (c) => {
      const overrides = c.req.valid("json");
      return syncRouteResponse(
        c,
        withManualSyncLock(c.env, "tdcc", TDCC_SCOPE_BANK, () =>
          syncTdcc(c.env, "manual", overrides, [TDCC_SCOPE_BANK]),
        ),
      );
    },
  );

  api.post(
    "/connectors/tdcc/sync/trades",
    zValidator(
      "json",
      tdccSyncBodySchema,
      validationHook("INVALID_REQUEST", "TDCC sync options are invalid."),
    ),
    async (c) => {
      const overrides = c.req.valid("json");
      return syncRouteResponse(
        c,
        withManualSyncLock(c.env, "tdcc", TDCC_SCOPE_TRADES, () =>
          syncTdcc(c.env, "manual", overrides, [TDCC_SCOPE_TRADES]),
        ),
      );
    },
  );

  api.post("/connectors/esun/sync", async (c) => {
    return syncRouteResponse(
      c,
      withManualSyncLock(c.env, "esun", SYNC_SCOPE_ALL, () =>
        syncEsun(c.env, "manual"),
      ),
    );
  });

  api.post("/connectors/cathaybk/sync", async (c) => {
    return syncRouteResponse(
      c,
      withManualSyncLock(c.env, "cathaybk", SYNC_SCOPE_ALL, () =>
        syncCathaybk(c.env, "manual"),
      ),
    );
  });

  api.post("/connectors/sinopac/captcha", async (c) => {
    try {
      return c.json(await prepareSinopacCaptchaSession(c.env));
    } catch (error) {
      if (error instanceof SyncAlreadyRunningError) {
        return jsonError(
          "SYNC_ALREADY_RUNNING",
          "永豐已有驗證或同步作業正在進行。",
          409,
        );
      }
      if (error instanceof SinopacBrowserCapacityError) {
        const response = jsonError("SINOPAC_BROWSER_BUSY", error.message, 429);
        response.headers.set("Retry-After", String(error.retryAfterSeconds));
        return response;
      }
      if (error instanceof NeedsUserActionError) {
        return jsonError("USER_ACTION_REQUIRED", error.message, 400);
      }
      return jsonError("SINOPAC_CAPTCHA_FAILED", safeErrorMessage(error), 502);
    }
  });

  api.post(
    "/connectors/sinopac/sync",
    zValidator(
      "json",
      sinopacSyncBodySchema,
      validationHook("INVALID_REQUEST", "Sinopac sync options are invalid."),
    ),
    async (c) => {
      const overrides = c.req.valid("json");
      return syncRouteResponse(
        c,
        withManualSyncLock(c.env, "sinopac", SYNC_SCOPE_ALL, () =>
          syncSinopac(c.env, "manual", overrides),
        ),
      );
    },
  );
}

async function syncRouteResponse(
  c: Context<AppBindings>,
  result: Promise<SyncOutcome>,
) {
  try {
    return c.json(await result);
  } catch (error) {
    if (error instanceof SyncAlreadyRunningError) {
      return jsonError("SYNC_ALREADY_RUNNING", error.message, 409);
    }
    if (error instanceof TdccVerificationRequiredError) {
      return jsonError(
        error.channel === "sms"
          ? "TDCC_SMS_OTP_REQUIRED"
          : "TDCC_EMAIL_OTP_REQUIRED",
        error.message,
        400,
      );
    }
    if (error instanceof TdccConnectionError) {
      return jsonError("TDCC_CONNECTION_FAILED", error.message, 400);
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
