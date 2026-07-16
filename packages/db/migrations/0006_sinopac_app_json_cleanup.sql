DELETE FROM bank_transactions
WHERE connector_id = 'sinopac'
  AND account_id IN (
    SELECT id
    FROM bank_accounts
    WHERE connector_id = 'sinopac'
      AND source_id = 'credit:sinopac:dawho'
  );

DELETE FROM bank_balance_snapshots
WHERE connector_id = 'sinopac'
  AND account_id IN (
    SELECT id
    FROM bank_accounts
    WHERE connector_id = 'sinopac'
      AND source_id = 'credit:sinopac:dawho'
  );

DELETE FROM credit_card_bills
WHERE connector_id = 'sinopac'
  AND account_id IN (
    SELECT id
    FROM bank_accounts
    WHERE connector_id = 'sinopac'
      AND source_id = 'credit:sinopac:dawho'
  );

DELETE FROM bank_accounts
WHERE connector_id = 'sinopac'
  AND source_id = 'credit:sinopac:dawho';

UPDATE connector_settings
SET sync_cursor = NULL
WHERE connector_id = 'sinopac';
