import type { ConnectorId } from "@taiwan-fin-hub/core";

export async function updateConnectorEncryptedConfig(
  db: D1Database,
  connectorId: ConnectorId,
  encryptedConfig: string,
) {
  await db
    .prepare(
      `UPDATE connector_settings SET encrypted_config = ? WHERE connector_id = ?`,
    )
    .bind(encryptedConfig, connectorId)
    .run();
}

export function connectorEncryptedConfigStatement(
  db: D1Database,
  connectorId: ConnectorId,
  encryptedConfig: string,
  now: string,
) {
  return db
    .prepare(
      `UPDATE connector_settings
    SET encrypted_config = ?, updated_at = ?
    WHERE connector_id = ?`,
    )
    .bind(encryptedConfig, now, connectorId);
}

export function connectorStateStatement(
  db: D1Database,
  connectorId: ConnectorId,
  encryptedConfig: string,
  cursor: string,
  now: string,
) {
  return db
    .prepare(
      `UPDATE connector_settings
    SET encrypted_config = ?, sync_cursor = ?, updated_at = ?
    WHERE connector_id = ?`,
    )
    .bind(encryptedConfig, cursor, now, connectorId);
}

export function connectorCursorStatement(
  db: D1Database,
  connectorId: ConnectorId,
  cursor: string,
  now: string,
) {
  return db
    .prepare(
      `UPDATE connector_settings
    SET sync_cursor = ?, updated_at = ?
    WHERE connector_id = ?`,
    )
    .bind(cursor, now, connectorId);
}

export function deleteSyncedBankDataStatements(
  db: D1Database,
  connectorId: ConnectorId,
) {
  return [
    db
      .prepare(`DELETE FROM bank_transactions WHERE connector_id = ?`)
      .bind(connectorId),
    db
      .prepare(`DELETE FROM credit_card_bills WHERE connector_id = ?`)
      .bind(connectorId),
  ];
}

export function reconcileEsunLifecycleShadowStatements(db: D1Database) {
  const shadowJoin = `canonical.connector_id = shadow.connector_id
      AND canonical.account_id = shadow.account_id
      AND canonical.source_id = replace(
        replace(shadow.source_id, ':已入帳:', ':'),
        ':未入帳:', ':'
      )`;
  const isLifecycleShadow = `shadow.connector_id = 'esun'
      AND (
        instr(shadow.source_id, ':已入帳:') > 0
        OR instr(shadow.source_id, ':未入帳:') > 0
      )`;

  return [
    db.prepare(
      `INSERT INTO bank_transaction_preferences
        (transaction_id, excluded_from_calculation, created_at, updated_at)
       SELECT canonical.id, preference.excluded_from_calculation,
              preference.created_at, preference.updated_at
       FROM bank_transactions shadow
       JOIN bank_transactions canonical ON ${shadowJoin}
       JOIN bank_transaction_preferences preference
         ON preference.transaction_id = shadow.id
       WHERE ${isLifecycleShadow}
       ON CONFLICT(transaction_id) DO NOTHING`,
    ),
    db.prepare(
      `INSERT INTO classification_overrides
        (id, target_type, target_id, category_id, created_at, updated_at)
       SELECT 'override:bank_transaction:' || canonical.id,
              'bank_transaction', canonical.id, override.category_id,
              override.created_at, override.updated_at
       FROM bank_transactions shadow
       JOIN bank_transactions canonical ON ${shadowJoin}
       JOIN classification_overrides override
         ON override.target_type = 'bank_transaction'
        AND override.target_id = shadow.id
       WHERE ${isLifecycleShadow}
       ON CONFLICT(target_type, target_id) DO NOTHING`,
    ),
    db.prepare(
      `DELETE FROM bank_transaction_preferences
       WHERE transaction_id IN (
         SELECT shadow.id
         FROM bank_transactions shadow
         JOIN bank_transactions canonical ON ${shadowJoin}
         WHERE ${isLifecycleShadow}
       )`,
    ),
    db.prepare(
      `DELETE FROM classification_overrides
       WHERE target_type = 'bank_transaction'
         AND target_id IN (
           SELECT shadow.id
           FROM bank_transactions shadow
           JOIN bank_transactions canonical ON ${shadowJoin}
           WHERE ${isLifecycleShadow}
         )`,
    ),
    db.prepare(
      `DELETE FROM bank_transactions
       WHERE id IN (
         SELECT shadow.id
         FROM bank_transactions shadow
         JOIN bank_transactions canonical ON ${shadowJoin}
         WHERE ${isLifecycleShadow}
       )`,
    ),
  ];
}

export function linkCanonicalBankAccountsStatement(db: D1Database) {
  return db.prepare(
    `UPDATE bank_accounts
    SET canonical_account_id = (
      SELECT direct.id FROM bank_accounts direct
      WHERE direct.connector_id IN ('esun', 'cathaybk')
        AND direct.bank_code = bank_accounts.bank_code
        AND direct.account_last4 = bank_accounts.account_last4
        AND direct.currency = bank_accounts.currency
      ORDER BY direct.connector_id
      LIMIT 1
    )
    WHERE connector_id NOT IN ('esun', 'cathaybk')
      AND bank_code IS NOT NULL
      AND account_last4 IS NOT NULL`,
  );
}
