export interface ClassificationRuleRow {
  id: string;
  categoryId: string;
  targetType: string;
  field: string;
  operator: string;
  pattern: string;
  priority: number;
  enabled: boolean;
  isSystem: boolean;
  excludedFromCalculation: boolean;
  description?: string;
  createdAt?: string;
}

export interface ClassificationCategoryRow {
  id: string;
  label: string;
  sortOrder: number;
  isSystem: boolean;
}
