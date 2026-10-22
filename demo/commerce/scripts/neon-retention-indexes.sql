-- Operator-run SQL, one statement at a time outside a transaction.
-- After each build, verify pg_index.indisvalid for the index's to_regclass(name).
-- A failed concurrent build can leave an invalid index that IF NOT EXISTS skips.
-- If invalid, DROP INDEX CONCURRENTLY <name> outside a transaction, then rebuild.
CREATE INDEX CONCURRENTLY IF NOT EXISTS dispatch_logs_retention_pending_idx
  ON dispatch_logs (updated_at, id)
  WHERE status IN ('sent', 'invalid')
    AND (request_payload IS NOT NULL OR response_payload IS NOT NULL
      OR metadata IS NOT NULL OR error_message IS NOT NULL);

CREATE INDEX CONCURRENTLY IF NOT EXISTS event_logs_retention_pending_idx
  ON event_logs (received_at, id)
  WHERE dispatch_prepared_at IS NOT NULL
    AND (payload_normalized IS NOT NULL OR distinct_id IS NOT NULL OR identity_muid IS NOT NULL);
