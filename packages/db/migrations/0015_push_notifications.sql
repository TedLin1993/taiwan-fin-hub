CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  encrypted_subscription TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_success_at TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS notification_preferences (
  id TEXT PRIMARY KEY CHECK (id = 'default'),
  notify_success INTEGER NOT NULL DEFAULT 0,
  notify_failed INTEGER NOT NULL DEFAULT 1,
  notify_needs_user_action INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO notification_preferences (
  id,
  notify_success,
  notify_failed,
  notify_needs_user_action,
  updated_at
)
VALUES ('default', 0, 1, 1, datetime('now'));
