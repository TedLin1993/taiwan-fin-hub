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
