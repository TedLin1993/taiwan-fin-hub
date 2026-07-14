import type { Hono } from "hono";
import { z } from "zod";
import type { AppBindings } from "../env";
import { jsonError } from "../http";

const updateSchema = z.object({
  rates: z.record(z.string().min(3).max(3), z.number().finite().positive())
});

export function registerExchangeRateRoutes(api: Hono<AppBindings>) {
  api.get("/exchange-rates", async (c) => {
    const rows = await c.env.DB.prepare(
      `SELECT currency, rate_to_twd AS rateTwd, updated_at AS updatedAt
       FROM exchange_rates
       ORDER BY currency ASC`
    ).all<{ currency: string; rateTwd: number; updatedAt: string }>();
    return c.json(rows.results);
  });

  api.put("/exchange-rates", async (c) => {
    const parsed = updateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return jsonError("INVALID_REQUEST", "Exchange rates are invalid.");
    const now = new Date().toISOString();
    const entries = Object.entries(parsed.data.rates);
    if (entries.length > 0) {
      await c.env.DB.batch(entries.map(([currency, rate]) =>
        c.env.DB.prepare(
          `INSERT INTO exchange_rates (currency, rate_to_twd, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(currency) DO UPDATE SET
             rate_to_twd = excluded.rate_to_twd,
             updated_at = excluded.updated_at`
        ).bind(currency.toUpperCase(), rate, now)
      ));
    }
    return c.json({ success: true });
  });
}
