ALTER TABLE bank_transactions
  ADD COLUMN status TEXT NOT NULL DEFAULT 'posted'
  CHECK (status IN ('pending', 'posted'));

UPDATE bank_transactions
SET status = 'pending'
WHERE connector_id = 'esun'
  AND json_extract(
    CASE WHEN json_valid(raw_payload) THEN raw_payload ELSE '{}' END,
    '$.acfg'
  ) = '未入帳';

CREATE INDEX IF NOT EXISTS idx_bank_transactions_status
  ON bank_transactions (connector_id, account_id, status);
