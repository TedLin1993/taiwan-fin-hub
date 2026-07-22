import type {
  NotificationPreferences,
  PushSubscriptionInput,
} from "@taiwan-fin-hub/core";

export type PushSubscriptionRow = {
  id: string;
  encrypted_subscription: string;
  created_at: string;
  updated_at: string;
  last_success_at: string | null;
  consecutive_failures: number;
};

const DEFAULT_PREFERENCES: NotificationPreferences = {
  success: false,
  failed: true,
  needsUserAction: true,
};

export async function listPushSubscriptions(db: D1Database) {
  const result = await db
    .prepare(
      `SELECT id, encrypted_subscription, created_at, updated_at,
              last_success_at, consecutive_failures
       FROM push_subscriptions
       ORDER BY created_at ASC, id ASC`,
    )
    .all<PushSubscriptionRow>();
  return result.results;
}

export async function upsertPushSubscription(
  db: D1Database,
  input: {
    id: string;
    encryptedSubscription: string;
    now: string;
  },
) {
  await db
    .prepare(
      `INSERT INTO push_subscriptions (
         id, encrypted_subscription, created_at, updated_at,
         last_success_at, consecutive_failures
       ) VALUES (?, ?, ?, ?, NULL, 0)
       ON CONFLICT(id) DO UPDATE SET
         encrypted_subscription = excluded.encrypted_subscription,
         updated_at = excluded.updated_at,
         consecutive_failures = 0`,
    )
    .bind(input.id, input.encryptedSubscription, input.now, input.now)
    .run();
}

export async function removePushSubscription(db: D1Database, id: string) {
  await db
    .prepare("DELETE FROM push_subscriptions WHERE id = ?")
    .bind(id)
    .run();
}

export async function markPushSuccess(db: D1Database, id: string, now: string) {
  await db
    .prepare(
      `UPDATE push_subscriptions
       SET last_success_at = ?, consecutive_failures = 0, updated_at = ?
       WHERE id = ?`,
    )
    .bind(now, now, id)
    .run();
}

export async function markPushFailure(db: D1Database, id: string, now: string) {
  await db
    .prepare(
      `UPDATE push_subscriptions
       SET consecutive_failures = consecutive_failures + 1, updated_at = ?
       WHERE id = ?`,
    )
    .bind(now, id)
    .run();
}

export async function getNotificationPreferences(db: D1Database) {
  const row = await db
    .prepare(
      `SELECT notify_success AS success,
              notify_failed AS failed,
              notify_needs_user_action AS needsUserAction
       FROM notification_preferences
       WHERE id = 'default'`,
    )
    .first<{
      success: number;
      failed: number;
      needsUserAction: number;
    }>();

  if (!row) return DEFAULT_PREFERENCES;
  return {
    success: Boolean(row.success),
    failed: Boolean(row.failed),
    needsUserAction: Boolean(row.needsUserAction),
  } satisfies NotificationPreferences;
}

export async function saveNotificationPreferences(
  db: D1Database,
  preferences: NotificationPreferences,
  now: string,
) {
  await db
    .prepare(
      `INSERT INTO notification_preferences (
         id, notify_success, notify_failed,
         notify_needs_user_action, updated_at
       ) VALUES ('default', ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         notify_success = excluded.notify_success,
         notify_failed = excluded.notify_failed,
         notify_needs_user_action = excluded.notify_needs_user_action,
         updated_at = excluded.updated_at`,
    )
    .bind(
      preferences.success ? 1 : 0,
      preferences.failed ? 1 : 0,
      preferences.needsUserAction ? 1 : 0,
      now,
    )
    .run();
}

export async function countPushSubscriptions(db: D1Database) {
  const row = await db
    .prepare("SELECT COUNT(*) AS count FROM push_subscriptions")
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export function normalizePushSubscription(input: PushSubscriptionInput) {
  return {
    endpoint: input.endpoint,
    expirationTime: input.expirationTime ?? null,
    keys: {
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
    },
  } satisfies PushSubscriptionInput;
}
