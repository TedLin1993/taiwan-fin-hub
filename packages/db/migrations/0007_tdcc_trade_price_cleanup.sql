-- TR002 field 18 is not an execution price. Older connector versions stored
-- the field's constant value (usually 1) as price and quantity * 1 as amount.
UPDATE investment_transactions
SET price = NULL,
    amount = NULL
WHERE connector_id = 'tdcc';
