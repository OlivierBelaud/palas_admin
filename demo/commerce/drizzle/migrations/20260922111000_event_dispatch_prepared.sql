-- Additive marker: legacy envelopes remain intact until destination provisioning is complete.
ALTER TABLE event_logs ADD COLUMN IF NOT EXISTS dispatch_prepared_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS event_logs_unprepared_dispatch_idx ON event_logs(received_at,event_id)
  WHERE dispatch_prepared_at IS NULL AND payload_normalized IS NOT NULL;
