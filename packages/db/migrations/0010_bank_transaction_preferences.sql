CREATE TABLE IF NOT EXISTS bank_transaction_preferences (
  transaction_id TEXT PRIMARY KEY,
  excluded_from_calculation INTEGER NOT NULL DEFAULT 0 CHECK (excluded_from_calculation IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bank_transaction_preferences_excluded
  ON bank_transaction_preferences (excluded_from_calculation);
