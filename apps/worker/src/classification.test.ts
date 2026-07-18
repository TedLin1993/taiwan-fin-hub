import { describe, expect, it } from "vitest";
import { matchesClassificationRule, resolveClassifications } from "./classification";

const transaction = {
  id: "tx-1",
  sourceId: "source-1",
  description: "STARBUCKS TAIPEI",
  counterparty: "Coffee Shop"
};

describe("matchesClassificationRule", () => {
  it("supports field-specific and any-text matching", () => {
    expect(matchesClassificationRule({ field: "description", operator: "contains", pattern: "starbucks" }, transaction)).toBe(true);
    expect(matchesClassificationRule({ field: "any_text", operator: "contains", pattern: "coffee" }, transaction)).toBe(true);
  });

  it("treats invalid regular expressions as non-matches", () => {
    expect(matchesClassificationRule({ field: "any_text", operator: "regex", pattern: "[" }, transaction)).toBe(false);
  });
});

describe("resolveClassifications", () => {
  it("returns the calculation action from the first matching rule", async () => {
    const db = {
      prepare(sql: string) {
        return {
          async all() {
            if (sql.includes("classification_overrides")) return { results: [] };
            return {
              results: [{
                id: "user:card-payment",
                category_id: "transfer",
                label: "轉帳",
                target_type: "bank_transaction",
                field: "any_text",
                operator: "contains",
                pattern: "卡費",
                is_system: 0,
                excluded_from_calculation: 1
              }]
            };
          }
        };
      }
    } as unknown as D1Database;

    const result = await resolveClassifications(db, [{
      id: "tx-card-payment",
      sourceId: "source-card-payment",
      description: "本月卡費"
    }]);

    expect(result.get("tx-card-payment")).toMatchObject({
      categoryId: "transfer",
      excludedFromCalculation: true
    });
  });
});
