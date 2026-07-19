CREATE TABLE IF NOT EXISTS sync_write_staging (
  run_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  record_key TEXT NOT NULL,
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id, entity_type, record_key)
);

CREATE INDEX IF NOT EXISTS idx_sync_write_staging_created_at
  ON sync_write_staging (created_at);

ALTER TABLE bank_transactions
  ADD COLUMN effective_date TEXT AS (COALESCE(posted_date, authorized_at, ''));

ALTER TABLE investment_transactions
  ADD COLUMN effective_date TEXT AS (COALESCE(trade_date, posted_date, ''));

CREATE INDEX IF NOT EXISTS idx_bank_transactions_effective_updated
  ON bank_transactions (effective_date DESC, updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_investment_transactions_effective_updated
  ON investment_transactions (effective_date DESC, updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_investment_positions_latest_scope
  ON investment_positions (connector_id, asset_type, as_of_date DESC);

CREATE INDEX IF NOT EXISTS idx_investment_positions_page
  ON investment_positions (as_of_date DESC, asset_type ASC, name ASC, id ASC);

CREATE INDEX IF NOT EXISTS idx_invoices_page
  ON invoices (invoice_date DESC, updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_credit_card_bills_page
  ON credit_card_bills (billing_period DESC, account_id ASC, id ASC);

CREATE INDEX IF NOT EXISTS idx_net_worth_history_page
  ON net_worth_history (date DESC, source ASC, asset_type ASC, id ASC);
