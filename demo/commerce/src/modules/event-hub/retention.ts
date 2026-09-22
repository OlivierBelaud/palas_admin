import type { RawDispatchDb } from './dispatch-runner'

const BATCH_SIZE = 1000
// These short-lived tracking commands have no business-history role. Failed,
// paused and pending runs are deliberately excluded, as are commerce commands.
const TRACKING_COMMANDS = [
  'cmd:recordCanonicalEventLog',
  'cmd:ingestCartEvent',
  'cmd:refreshCart',
  'cmd:refreshContact',
  'cmd:syncPosthogEvents',
]

export async function compactTrackingHistory(db: RawDispatchDb) {
  const dispatches = await db.raw<{ count: string }>(
    `WITH candidates AS (
       SELECT id FROM dispatch_logs
       WHERE status IN ('sent', 'invalid')
         AND GREATEST(updated_at, sent_at, event_received_at) < NOW() - INTERVAL '24 hours'
         AND (request_payload IS NOT NULL OR response_payload IS NOT NULL OR metadata IS NOT NULL OR error_message IS NOT NULL)
       ORDER BY updated_at ASC LIMIT $1 FOR UPDATE SKIP LOCKED
     ), compacted AS (
       UPDATE dispatch_logs SET request_payload = NULL, response_payload = NULL,
         metadata = NULL, error_message = NULL
       WHERE id IN (SELECT id FROM candidates) RETURNING 1
     ) SELECT COUNT(*)::text AS count FROM compacted`,
    [BATCH_SIZE],
  )
  // Keep event IDs indefinitely: replay has no upper age bound. Never compact
  // partially provisioned events or the source envelope needed by active sends.
  const events = await db.raw<{ count: string }>(
    `WITH candidates AS (
       SELECT e.id FROM event_logs e
       WHERE e.received_at < NOW() - INTERVAL '24 hours'
         AND e.dispatch_prepared_at < NOW() - INTERVAL '24 hours'
         AND (e.payload_normalized IS NOT NULL OR e.distinct_id IS NOT NULL OR e.identity_muid IS NOT NULL)
         AND NOT EXISTS (
           SELECT 1 FROM dispatch_logs d WHERE d.event_id = e.event_id
             AND (d.status NOT IN ('sent', 'invalid') OR
               GREATEST(d.updated_at, d.sent_at, d.event_received_at) >= NOW() - INTERVAL '24 hours')
         )
       ORDER BY e.received_at ASC LIMIT $1 FOR UPDATE OF e SKIP LOCKED
     ), compacted AS (
       UPDATE event_logs SET payload_normalized = NULL, validation_errors = NULL,
         identity_muid = NULL, identity_email_sha256 = NULL, distinct_id = NULL,
         page_type = NULL, market = NULL
       WHERE id IN (SELECT id FROM candidates) RETURNING 1
     ) SELECT COUNT(*)::text AS count FROM compacted`,
    [BATCH_SIZE],
  )
  // beta.12 checkpoints are owned by workflow_runs.id = transaction_id.
  // Successful workflows cannot be resumed (manager.resume rejects terminal
  // statuses). Delete their checkpoints and run together in one SQL statement.
  const workflows = await db.raw<{ count: string }>(
    `WITH candidates AS MATERIALIZED (
       SELECT r.id FROM unnest($1::text[]) AS command(name)
       CROSS JOIN LATERAL (
         SELECT id FROM workflow_runs WHERE command_name = command.name AND status = 'succeeded'
           AND completed_at < NOW() - INTERVAL '24 hours'
         ORDER BY started_at ASC LIMIT $2 FOR UPDATE SKIP LOCKED
       ) r
     ), checkpoints AS (
       DELETE FROM workflow_checkpoints WHERE transaction_id IN (SELECT id FROM candidates) RETURNING 1
     ), removed AS (
       DELETE FROM workflow_runs WHERE id IN (SELECT id FROM candidates)
         AND (SELECT COUNT(*) FROM checkpoints) >= 0 RETURNING 1
     ) SELECT COUNT(*)::text AS count FROM removed`,
    [TRACKING_COMMANDS, Math.floor(BATCH_SIZE / TRACKING_COMMANDS.length)],
  )
  return {
    events_compacted: Number(events[0]?.count ?? 0),
    dispatches_compacted: Number(dispatches[0]?.count ?? 0),
    workflows_deleted: Number(workflows[0]?.count ?? 0),
  }
}
