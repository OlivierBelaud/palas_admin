import { randomUUID } from 'node:crypto'
import type { RawDb } from './apply-event'
import { toIngestInput } from './posthog-adapter'
import { type HogQLEventRow, rowToPosthogEvent } from './posthog-sync'

type RecoveryState = {
  cart_since: string | null
  checkout_since: string | null
  sweep_until: string
  cursor_timestamp: string | null
  cursor_uuid: string | null
}

type RecoveryOptions = {
  db: RawDb
  fetchPage: (query: string) => Promise<HogQLEventRow[]>
  ingest: (input: Record<string, unknown>) => Promise<unknown>
  shouldStop?: () => boolean
  now?: () => number
  maxEvents?: number
  budgetMs?: number
}

export type RecoveryCommands = {
  ingestCartEvent(input: Record<string, unknown>): Promise<unknown>
  refreshCart(input: Record<string, unknown>): Promise<unknown>
}

export async function ingestRecoveredCartEvent(input: Record<string, unknown>, commands: RecoveryCommands) {
  const outcome = await commands.ingestCartEvent(input)
  if (outcome && typeof outcome === 'object' && 'cart_id' in outcome && typeof outcome.cart_id === 'string') {
    // The live refresh subscriber logs and swallows errors. Recovery must await
    // the business refresh explicitly before permanently deduplicating this UUID.
    await commands.refreshCart({
      cart_id: outcome.cart_id,
      reason: 'posthog_recovery_confirmation',
      source: 'syncPosthogEvents',
      dryRun: false,
    })
  }
  return outcome
}

// Quote only database-held timestamps and IDs; never interpolate event properties.
const quote = (value: string) => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
const date = (value: string) => `toDateTime64(${quote(value)}, 6, 'UTC')`

export function recoveryPageQuery(state: RecoveryState, limit: number): string {
  const kind = (name: 'cart' | 'checkout', since: string | null) =>
    `(event LIKE '${name}:%'${since ? ` AND timestamp >= ${date(since)}` : ''})`
  const cursor =
    state.cursor_timestamp && state.cursor_uuid
      ? ` AND (timestamp > ${date(state.cursor_timestamp)} OR (timestamp = ${date(state.cursor_timestamp)} AND toString(uuid) > ${quote(state.cursor_uuid)}))`
      : ''
  return `SELECT uuid, event, distinct_id, timestamp, properties FROM events
    WHERE (${kind('cart', state.cart_since)} OR ${kind('checkout', state.checkout_since)})
      AND timestamp < ${date(state.sweep_until)}${cursor}
    ORDER BY timestamp ASC, toString(uuid) ASC LIMIT ${Math.max(1, Math.min(500, Math.floor(limit)))}`
}

/**
 * Safety-net recovery: frozen, keyset-paged sweeps plus a bounded independent retry
 * queue. Receipts suppress expensive command/workflow creation on the 24h overlap.
 * A run admits work for 45s; an already admitted ingest finishes normally. Lease
 * fencing prevents an expired worker from committing progress after a redeploy.
 * The ten-minute lease exceeds the job runtime; crashes resume after lease expiry.
 */
export async function recoverPosthogEvents(options: RecoveryOptions) {
  const { db } = options
  const now = options.now ?? Date.now
  const started = now()
  const stop = () => Boolean(options.shouldStop?.()) || now() - started >= (options.budgetMs ?? 45_000)
  const token = randomUUID()
  const counters = { fetched: 0, ingested: 0, skipped: 0, errors: 0, retried: 0, busy: false }
  // Preserve the previous per-class bootstrap bounds. A class with no snapshots
  // starts at genesis rather than silently discarding its older recovery events.
  if (!(await db.raw("SELECT id FROM posthog_recovery_state WHERE id='cart-checkout'")).length) {
    await db.raw(
      `INSERT INTO posthog_recovery_state(id, cart_since, checkout_since, sweep_until)
      SELECT 'cart-checkout',
        (MAX(last_action_at) FILTER (WHERE last_action LIKE 'cart:%') - interval '24 hours')::text,
        (MAX(last_action_at) FILTER (WHERE last_action LIKE 'checkout:%') - interval '24 hours')::text,
        $1 FROM carts ON CONFLICT(id) DO NOTHING`,
      [new Date(now()).toISOString()],
    )
  }
  const claimed = await db.raw<RecoveryState>(
    `UPDATE posthog_recovery_state
    SET lease_token=$1, lease_until=clock_timestamp()+interval '10 minutes', updated_at=now()
    WHERE id='cart-checkout' AND (lease_until IS NULL OR lease_until < clock_timestamp())
    RETURNING cart_since, checkout_since, sweep_until, cursor_timestamp, cursor_uuid`,
    [token],
  )
  if (!claimed.length) return { ...counters, busy: true }
  const state = claimed[0]
  const owned = `id='cart-checkout' AND lease_token=$1 AND lease_until > clock_timestamp()`
  const ensureLease = async () => {
    const rows = await db.raw(
      `UPDATE posthog_recovery_state
      SET lease_until=clock_timestamp()+interval '10 minutes' WHERE ${owned} RETURNING id`,
      [token],
    )
    if (!rows.length) throw new Error('PostHog recovery lease lost')
  }
  const persist = async (row: HogQLEventRow, failed: boolean, advance: boolean) => {
    // Progress and outcome commit together. Failed rows are durable before the
    // cursor passes them; completed receipts erase the temporary retry payload.
    const result = await db.raw(
      `WITH owner AS (
      UPDATE posthog_recovery_state SET updated_at=now(),
        cursor_timestamp=CASE WHEN $5::boolean THEN $6 ELSE cursor_timestamp END,
        cursor_uuid=CASE WHEN $5::boolean THEN $2 ELSE cursor_uuid END
      WHERE ${owned} RETURNING id
    ), receipt AS (
      INSERT INTO posthog_recovery_receipts(event_uuid,status,payload,attempts,next_retry_at)
      SELECT $2,$3,$4::text::jsonb,1,CASE WHEN $3='retry' THEN now()+interval '5 minutes' END FROM owner
      ON CONFLICT(event_uuid) DO UPDATE SET status=EXCLUDED.status,payload=EXCLUDED.payload,
        attempts=posthog_recovery_receipts.attempts+1,
        next_retry_at=CASE WHEN EXCLUDED.status='retry' THEN now()+interval '5 minutes' *
          LEAST(288, posthog_recovery_receipts.attempts+1) END, updated_at=now()
      RETURNING event_uuid
    ) SELECT event_uuid FROM receipt`,
      [token, String(row[0]), failed ? 'retry' : 'done', failed ? JSON.stringify(row) : null, advance, String(row[3])],
    )
    if (!result.length) throw new Error('PostHog recovery lease lost')
  }
  const process = async (row: HogQLEventRow, advance: boolean) => {
    await ensureLease()
    let failed = false
    try {
      const input = toIngestInput(rowToPosthogEvent(row))
      if (!input) counters.skipped += 1
      else {
        const outcome = await options.ingest(input)
        if (outcome && typeof outcome === 'object' && 'recovery_pending' in outcome && outcome.recovery_pending) {
          throw new Error('Business follow-up remains pending')
        }
        counters.ingested += 1
      }
    } catch {
      failed = true
      counters.errors += 1
    }
    await persist(row, failed, advance)
  }
  try {
    // Retry a bounded number first so poison rows do not block new page progress.
    const retryRows = await db.raw<{ payload: HogQLEventRow }>(`SELECT payload FROM posthog_recovery_receipts
      WHERE status='retry' AND next_retry_at <= now() ORDER BY next_retry_at,event_uuid LIMIT 25`)
    for (const row of retryRows) {
      if (stop()) return counters
      if (now() - started >= Math.min(10_000, (options.budgetMs ?? 45_000) / 4)) break
      await process(row.payload, false)
      counters.retried += 1
    }
    const maxEvents = options.maxEvents ?? 5000
    while (!stop() && counters.fetched < maxEvents) {
      await ensureLease()
      const limit = Math.min(500, maxEvents - counters.fetched)
      const rows = await options.fetchPage(recoveryPageQuery(state, limit))
      const receipts = await db.raw<{ event_uuid: string }>(
        'SELECT event_uuid FROM posthog_recovery_receipts WHERE event_uuid=ANY($1::text[])',
        [rows.map((row) => String(row[0]))],
      )
      // Retry rows also skip the overlap: only the independent queue retries them.
      const seen = new Set(receipts.map((receipt) => receipt.event_uuid))
      let uncommittedCursor = false
      const checkpoint = async () => {
        if (!uncommittedCursor) return
        const moved = await db.raw(
          `UPDATE posthog_recovery_state SET cursor_timestamp=$2,cursor_uuid=$3,
          updated_at=now() WHERE ${owned} RETURNING id`,
          [token, state.cursor_timestamp, state.cursor_uuid],
        )
        if (!moved.length) throw new Error('PostHog recovery lease lost')
        uncommittedCursor = false
      }
      for (const row of rows) {
        if (stop()) {
          await checkpoint()
          return counters
        }
        if (typeof row[0] !== 'string' || !row[0] || typeof row[3] !== 'string' || !row[3]) {
          throw new Error('PostHog returned an invalid recovery cursor')
        }
        if (seen.has(row[0])) {
          counters.skipped += 1
          // Existing durable receipts need only one cursor write per page.
          uncommittedCursor = true
        } else {
          await process(row, true)
          seen.add(row[0])
          uncommittedCursor = false
        }
        state.cursor_timestamp = row[3]
        state.cursor_uuid = row[0]
        counters.fetched += 1
      }
      await checkpoint()
      if (rows.length < limit) {
        // Anchor overlap to the previous frozen upper bound, not completion time:
        // even a long interrupted historical sweep cannot create a time gap.
        const moved = await db.raw(
          `UPDATE posthog_recovery_state
          SET cart_since=(sweep_until::timestamptz - interval '24 hours')::text,
            checkout_since=(sweep_until::timestamptz - interval '24 hours')::text,
            sweep_until=$2, cursor_timestamp=NULL,cursor_uuid=NULL,updated_at=now()
          WHERE ${owned} RETURNING id`,
          [token, new Date(now()).toISOString()],
        )
        if (!moved.length) throw new Error('PostHog recovery lease lost')
        break
      }
    }
    return counters
  } finally {
    await db.raw(
      `UPDATE posthog_recovery_state SET lease_token=NULL,lease_until=NULL
      WHERE id='cart-checkout' AND lease_token=$1`,
      [token],
    )
  }
}
