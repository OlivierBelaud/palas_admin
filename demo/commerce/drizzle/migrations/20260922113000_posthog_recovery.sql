-- Recovery metadata only; no changes to commerce records or the live ingestion path.
CREATE TABLE IF NOT EXISTS posthog_recovery_state (
  id text PRIMARY KEY CHECK (id = 'cart-checkout'),
  cart_since text,
  checkout_since text,
  sweep_until text NOT NULL,
  cursor_timestamp text,
  cursor_uuid text,
  lease_token text,
  lease_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS posthog_recovery_receipts (
  event_uuid text PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('done', 'retry')),
  -- Completed receipts retain only UUID/state, never the full analytics payload.
  payload jsonb,
  attempts integer NOT NULL DEFAULT 0,
  next_retry_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'done' AND payload IS NULL) OR (status = 'retry' AND payload IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS posthog_recovery_retry_idx
  ON posthog_recovery_receipts(next_retry_at) WHERE status = 'retry';
