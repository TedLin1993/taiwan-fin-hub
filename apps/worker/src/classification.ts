export type ClassificationResult = {
  categoryId: string;
  label: string;
  source: "override" | "user_rule" | "system_rule" | "fallback";
  ruleId?: string;
  excludedFromCalculation?: boolean;
};

export type ClassifiedTransaction = {
  id: string;
  description?: string | null;
  counterparty?: string | null;
  sourceId: string;
};

export function matchesClassificationRule(
  rule: { field: string; operator: string; pattern: string },
  transaction: ClassifiedTransaction
) {
  const anyText = [transaction.description, transaction.counterparty, transaction.sourceId]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const text =
    rule.field === "description" ? (transaction.description ?? "").toLowerCase() :
    rule.field === "counterparty" ? (transaction.counterparty ?? "").toLowerCase() :
    rule.field === "source_id" ? transaction.sourceId.toLowerCase() :
    anyText;

  if (rule.operator === "contains") return text.includes(rule.pattern.toLowerCase());
  if (rule.operator === "equals") return text === rule.pattern.toLowerCase();
  if (rule.operator === "starts_with") return text.startsWith(rule.pattern.toLowerCase());
  if (rule.operator === "regex") {
    try {
      return new RegExp(rule.pattern, "i").test(text);
    } catch {
      return false;
    }
  }
  return false;
}

export async function resolveClassifications(
  db: D1Database,
  transactions: ClassifiedTransaction[]
): Promise<Map<string, ClassificationResult>> {
  if (transactions.length === 0) return new Map();

  // URL paths normalize backslashes, so compare override ids in their normalized form.
  const normalizeId = (id: string) => id.replace(/\\/g, "/");
  const transactionIds = new Set(transactions.map((transaction) => normalizeId(transaction.id)));
  const [overrides, rules] = await Promise.all([
    db.prepare(
      `SELECT o.target_id, o.category_id, c.label
       FROM classification_overrides o
       JOIN classification_categories c ON c.id = o.category_id
       WHERE o.target_type = 'bank_transaction'`
    ).all<{ target_id: string; category_id: string; label: string }>(),
    db.prepare(
      `SELECT r.id, r.category_id, c.label, r.target_type, r.field, r.operator, r.pattern,
              r.is_system, r.excluded_from_calculation
       FROM classification_rules r
       JOIN classification_categories c ON c.id = r.category_id
       WHERE r.enabled = 1
       ORDER BY r.priority DESC, r.updated_at DESC, r.id ASC`
    ).all<{
      id: string;
      category_id: string;
      label: string;
      target_type: string | null;
      field: string;
      operator: string;
      pattern: string;
      is_system: number;
      excluded_from_calculation: number;
    }>()
  ]);

  const overrideMap = new Map(
    overrides.results
      .filter((override) => transactionIds.has(normalizeId(override.target_id)))
      .map((override) => [normalizeId(override.target_id), override])
  );
  const result = new Map<string, ClassificationResult>();

  for (const transaction of transactions) {
    const override = overrideMap.get(normalizeId(transaction.id));
    if (override) {
      result.set(transaction.id, {
        categoryId: override.category_id,
        label: override.label,
        source: "override"
      });
      continue;
    }

    let matched: ClassificationResult | undefined;
    for (const rule of rules.results) {
      if (rule.target_type && rule.target_type !== "bank_transaction") continue;
      if (!matchesClassificationRule(rule, transaction)) continue;
      matched = {
        categoryId: rule.category_id,
        label: rule.label,
        source: rule.is_system ? "system_rule" : "user_rule",
        ruleId: rule.id,
        excludedFromCalculation: rule.excluded_from_calculation === 1
      };
      break;
    }
    result.set(transaction.id, matched ?? { categoryId: "other", label: "其他", source: "fallback" });
  }

  return result;
}
