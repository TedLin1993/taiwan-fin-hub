import type { Hono } from "hono";
import { z } from "zod";
import type { AppBindings } from "../env";
import { jsonError } from "../http";

const targetTypeSchema = z.enum(["bank_transaction"]);
const categorySchema = z.object({ categoryId: z.string().min(1).max(64) });
const createRuleSchema = z.object({
  categoryId: z.string().min(1).max(64),
  targetType: targetTypeSchema.optional(),
  field: z.enum(["any_text", "description", "counterparty", "source_id"]),
  operator: z.enum(["contains", "equals", "starts_with", "regex"]),
  pattern: z.string().min(1).max(300),
  priority: z.number().int().min(0).max(10_000).optional(),
  description: z.string().max(500).optional()
});
const updateRuleSchema = z.object({
  categoryId: z.string().min(1).max(64).optional(),
  pattern: z.string().min(1).max(300).optional(),
  priority: z.number().int().min(0).max(10_000).optional(),
  enabled: z.boolean().optional(),
  description: z.string().max(500).nullable().optional()
}).refine((body) => Object.keys(body).length > 0);

function extractOverrideTargetId(requestPath: string, targetType: string) {
  const prefix = `/classification/overrides/${targetType}/`;
  const index = requestPath.indexOf(prefix);
  return index >= 0 ? requestPath.slice(index + prefix.length) : "";
}

export function registerClassificationRoutes(api: Hono<AppBindings>) {
  api.get("/classification/categories", async (c) => {
    const rows = await c.env.DB.prepare(
      `SELECT id, label, sort_order AS sortOrder, is_system AS isSystem
       FROM classification_categories
       ORDER BY sort_order ASC, id ASC`
    ).all();
    return c.json(rows.results);
  });

  api.get("/classification/rules", async (c) => {
    const rows = await c.env.DB.prepare(
      `SELECT id, category_id AS categoryId, target_type AS targetType, field, operator,
              pattern, priority, enabled, is_system AS isSystem, source, description
       FROM classification_rules
       ORDER BY priority DESC, updated_at DESC, id ASC`
    ).all();
    return c.json(rows.results);
  });

  api.put("/classification/overrides/:targetType/*", async (c) => {
    const targetType = targetTypeSchema.safeParse(c.req.param("targetType"));
    const body = categorySchema.safeParse(await c.req.json().catch(() => null));
    if (!targetType.success || !body.success) {
      return jsonError("INVALID_REQUEST", "Classification override is invalid.");
    }
    const targetId = extractOverrideTargetId(c.req.path, targetType.data);
    if (!targetId) return jsonError("INVALID_REQUEST", "targetId is required.");

    const now = new Date().toISOString();
    await c.env.DB.prepare(
      `INSERT INTO classification_overrides
         (id, target_type, target_id, category_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(target_type, target_id) DO UPDATE SET
         category_id = excluded.category_id,
         updated_at = excluded.updated_at`
    ).bind(
      `override:${targetType.data}:${targetId}`,
      targetType.data,
      targetId,
      body.data.categoryId,
      now,
      now
    ).run();
    return c.json({ success: true });
  });

  api.delete("/classification/overrides/:targetType/*", async (c) => {
    const targetType = targetTypeSchema.safeParse(c.req.param("targetType"));
    if (!targetType.success) return jsonError("INVALID_REQUEST", "targetType is not supported.");
    const targetId = extractOverrideTargetId(c.req.path, targetType.data);
    if (!targetId) return jsonError("INVALID_REQUEST", "targetId is required.");
    await c.env.DB.prepare(
      `DELETE FROM classification_overrides WHERE target_type = ? AND target_id = ?`
    ).bind(targetType.data, targetId).run();
    return c.json({ success: true });
  });

  api.post("/classification/rules", async (c) => {
    const parsed = createRuleSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return jsonError("INVALID_REQUEST", "Classification rule is invalid.");
    const body = parsed.data;
    const now = new Date().toISOString();
    const id = `user:${crypto.randomUUID()}`;
    await c.env.DB.prepare(
      `INSERT INTO classification_rules
         (id, category_id, target_type, field, operator, pattern, priority, enabled,
          is_system, source, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, 'user', ?, ?, ?)`
    ).bind(
      id,
      body.categoryId,
      body.targetType ?? null,
      body.field,
      body.operator,
      body.pattern,
      body.priority ?? 200,
      body.description ?? null,
      now,
      now
    ).run();
    return c.json({ id, success: true });
  });

  api.put("/classification/rules/:ruleId", async (c) => {
    const parsed = updateRuleSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return jsonError("INVALID_REQUEST", "Classification rule update is invalid.");
    const sets: string[] = [];
    const values: unknown[] = [];
    if (parsed.data.categoryId) { sets.push("category_id = ?"); values.push(parsed.data.categoryId); }
    if (parsed.data.pattern !== undefined) { sets.push("pattern = ?"); values.push(parsed.data.pattern); }
    if (parsed.data.priority !== undefined) { sets.push("priority = ?"); values.push(parsed.data.priority); }
    if (parsed.data.enabled !== undefined) { sets.push("enabled = ?"); values.push(parsed.data.enabled ? 1 : 0); }
    if (parsed.data.description !== undefined) { sets.push("description = ?"); values.push(parsed.data.description); }
    sets.push("updated_at = ?");
    values.push(new Date().toISOString(), c.req.param("ruleId"));
    const result = await c.env.DB.prepare(
      `UPDATE classification_rules SET ${sets.join(", ")} WHERE id = ? AND is_system = 0`
    ).bind(...values).run();
    if (result.meta.changes !== 1) return jsonError("RULE_NOT_FOUND", "Editable rule was not found.", 404);
    return c.json({ success: true });
  });

  api.delete("/classification/rules/:ruleId", async (c) => {
    const result = await c.env.DB.prepare(
      `DELETE FROM classification_rules WHERE id = ? AND is_system = 0`
    ).bind(c.req.param("ruleId")).run();
    if (result.meta.changes !== 1) return jsonError("RULE_NOT_FOUND", "Editable rule was not found.", 404);
    return c.json({ success: true });
  });
}
