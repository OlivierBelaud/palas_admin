CREATE TABLE IF NOT EXISTS reporting_daily_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day text NOT NULL,
  timezone text NOT NULL DEFAULT 'Europe/Paris',
  status text NOT NULL DEFAULT 'ready',
  payload jsonb NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  source_max_last_event_at timestamptz,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS reporting_daily_snapshots_day_timezone_uq
  ON reporting_daily_snapshots (day, timezone)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS reporting_daily_snapshots_status_idx
  ON reporting_daily_snapshots (status);
