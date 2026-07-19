import type { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { AppBindings } from "../../platform/env";
import { honoFactory } from "../../platform/hono";
import { validationHook } from "../../platform/validation";
import { getExchangeRates, updateExchangeRates } from "./service";

const updateSchema = z.object({
  rates: z.record(z.string().min(3).max(3), z.number().finite().positive()),
});

export const exchangeRateRoutes = honoFactory.createApp();
registerExchangeRateRoutes(exchangeRateRoutes);

function registerExchangeRateRoutes(api: Hono<AppBindings>) {
  api.get("/exchange-rates", async (c) =>
    c.json(await getExchangeRates(c.env.DB)),
  );

  api.put(
    "/exchange-rates",
    zValidator(
      "json",
      updateSchema,
      validationHook("INVALID_REQUEST", "Exchange rates are invalid."),
    ),
    async (c) => {
      await updateExchangeRates(c.env.DB, c.req.valid("json").rates);
      return c.json({ success: true });
    },
  );
}
