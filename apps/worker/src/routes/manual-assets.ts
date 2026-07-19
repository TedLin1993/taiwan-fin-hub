import type { Hono } from "hono";
import { z } from "zod";
import type { AppBindings } from "../platform/env";
import { jsonError } from "../platform/http";

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  category: z.string().trim().min(1).max(64),
  note: z.string().max(1_000).optional(),
  value: z.number().finite(),
  date: isoDateSchema
});
const updateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  category: z.string().trim().min(1).max(64).optional(),
  note: z.string().max(1_000).nullable().optional()
}).refine((body) => Object.keys(body).length > 0);
const historySchema = z.object({ value: z.number().finite(), date: isoDateSchema });

export function registerManualAssetRoutes(api: Hono<AppBindings>) {
  api.get("/manual-assets", async (c) => {
    const assets = await c.env.DB.prepare(
      `SELECT id, name, category, note, created_at AS createdAt FROM manual_assets ORDER BY created_at ASC`
    ).all<{ id: string; name: string; category: string; note: string | null; createdAt: string }>();
    const history = await c.env.DB.prepare(
      `SELECT asset_type AS assetId, net_worth AS value, date
       FROM net_worth_history
       WHERE source = 'manual'
       GROUP BY asset_type
       HAVING date = MAX(date)`
    ).all<{ assetId: string; value: number; date: string }>();
    const valueMap = Object.fromEntries(
      history.results.map((row) => [row.assetId, { value: row.value, date: row.date }])
    );
    return c.json(assets.results.map((asset) => ({ ...asset, ...valueMap[asset.id] })));
  });

  api.post("/manual-assets", async (c) => {
    const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return jsonError("INVALID_REQUEST", "Manual asset is invalid.");
    const body = parsed.data;
    const now = new Date().toISOString();
    const id = `manual:${crypto.randomUUID()}`;
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO manual_assets (id, name, category, note, created_at) VALUES (?, ?, ?, ?, ?)`
      ).bind(id, body.name, body.category, body.note ?? null, now),
      c.env.DB.prepare(
        `INSERT INTO net_worth_history (id, date, net_worth, asset_type, source, snapshotted_at)
         VALUES (?, ?, ?, ?, 'manual', ?)
         ON CONFLICT(source, asset_type, date) DO UPDATE SET
           net_worth = excluded.net_worth,
           snapshotted_at = excluded.snapshotted_at`
      ).bind(`manual:${id}:${body.date}`, body.date, body.value, id, now)
    ]);
    return c.json({ id });
  });

  api.put("/manual-assets/:id", async (c) => {
    const parsed = updateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return jsonError("INVALID_REQUEST", "Manual asset update is invalid.");
    const sets: string[] = [];
    const values: unknown[] = [];
    if (parsed.data.name) { sets.push("name = ?"); values.push(parsed.data.name); }
    if (parsed.data.category) { sets.push("category = ?"); values.push(parsed.data.category); }
    if ("note" in parsed.data) { sets.push("note = ?"); values.push(parsed.data.note ?? null); }
    values.push(c.req.param("id"));
    await c.env.DB.prepare(`UPDATE manual_assets SET ${sets.join(", ")} WHERE id = ?`)
      .bind(...values)
      .run();
    return c.json({ success: true });
  });

  api.delete("/manual-assets/:id", async (c) => {
    const id = c.req.param("id");
    await c.env.DB.batch([
      c.env.DB.prepare(`DELETE FROM net_worth_history WHERE source = 'manual' AND asset_type = ?`).bind(id),
      c.env.DB.prepare(`DELETE FROM manual_assets WHERE id = ?`).bind(id)
    ]);
    return c.json({ success: true });
  });

  api.get("/manual-assets/:id/history", async (c) => {
    const rows = await c.env.DB.prepare(
      `SELECT date, net_worth AS value
       FROM net_worth_history
       WHERE source = 'manual' AND asset_type = ?
       ORDER BY date DESC`
    ).bind(c.req.param("id")).all<{ date: string; value: number }>();
    return c.json(rows.results);
  });

  api.post("/manual-assets/:id/history", async (c) => {
    const parsed = historySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return jsonError("INVALID_REQUEST", "Manual asset history entry is invalid.");
    const id = c.req.param("id");
    const now = new Date().toISOString();
    await c.env.DB.prepare(
      `INSERT INTO net_worth_history (id, date, net_worth, asset_type, source, snapshotted_at)
       VALUES (?, ?, ?, ?, 'manual', ?)
       ON CONFLICT(source, asset_type, date) DO UPDATE SET
         net_worth = excluded.net_worth,
         snapshotted_at = excluded.snapshotted_at`
    ).bind(`manual:${id}:${parsed.data.date}`, parsed.data.date, parsed.data.value, id, now).run();
    return c.json({ success: true });
  });

  api.delete("/manual-assets/:id/history/:date", async (c) => {
    const parsedDate = isoDateSchema.safeParse(c.req.param("date"));
    if (!parsedDate.success) return jsonError("INVALID_REQUEST", "date must use YYYY-MM-DD.");
    await c.env.DB.prepare(
      `DELETE FROM net_worth_history WHERE source = 'manual' AND asset_type = ? AND date = ?`
    ).bind(c.req.param("id"), parsedDate.data).run();
    return c.json({ success: true });
  });
}
