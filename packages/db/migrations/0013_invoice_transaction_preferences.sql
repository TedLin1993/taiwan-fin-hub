CREATE TABLE IF NOT EXISTS invoice_transaction_preferences (
  invoice_id TEXT PRIMARY KEY,
  transaction_id TEXT,
  decision TEXT NOT NULL CHECK (decision IN ('linked', 'separate')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (decision = 'linked' AND transaction_id IS NOT NULL)
    OR decision = 'separate'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_transaction_preferences_linked_transaction
  ON invoice_transaction_preferences (transaction_id)
  WHERE decision = 'linked';
