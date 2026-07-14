import { describe, expect, it } from "vitest";
import { matchesClassificationRule } from "./classification";

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
