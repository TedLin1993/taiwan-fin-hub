UPDATE bank_transactions
SET amount = CASE
  WHEN amount < 0
    OR description LIKE '%退款%'
    OR description LIKE '%退貨%'
    OR description LIKE '%折抵%'
    OR description LIKE '%折讓%'
    OR description LIKE '%回饋%'
    OR description LIKE '%沖銷%'
    OR description LIKE '%貸方%'
    OR description LIKE '%繳款%'
    OR lower(COALESCE(description, '')) LIKE '%refund%'
    OR lower(COALESCE(description, '')) LIKE '%credit%'
    OR lower(COALESCE(description, '')) LIKE '%payment%'
  THEN ABS(amount)
  ELSE -ABS(amount)
END
WHERE account_id IN (
  SELECT id
  FROM bank_accounts
  WHERE connector_id = 'esun'
    AND account_type = 'credit'
);
