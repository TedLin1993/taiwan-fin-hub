INSERT OR IGNORE INTO sync_jobs (
  id,
  connector_id,
  scope,
  enabled,
  interval_minutes,
  next_run_at,
  created_at,
  updated_at
) VALUES
  ('einvoice:all', 'einvoice', 'all', 0, 1440, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+1 day'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('tdcc:all', 'tdcc', 'all', 0, 1440, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+1 day'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('esun:all', 'esun', 'all', 0, 1440, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+1 day'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('cathaybk:all', 'cathaybk', 'all', 0, 1440, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+1 day'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
