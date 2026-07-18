ALTER TABLE classification_rules
ADD COLUMN excluded_from_calculation INTEGER NOT NULL DEFAULT 0
CHECK (excluded_from_calculation IN (0, 1));

UPDATE classification_rules
SET excluded_from_calculation = 1
WHERE id = 'system:bank:creditcard-payment';

CREATE UNIQUE INDEX IF NOT EXISTS idx_classification_categories_label_nocase
  ON classification_categories (label COLLATE NOCASE);
