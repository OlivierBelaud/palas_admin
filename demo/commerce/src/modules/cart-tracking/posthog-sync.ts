// Pure helper used by both the syncPostHogEvents command and its
// unit tests. Takes a list of HogQL rows + an `ingest` callback (which
// is `step.command.ingestCartEvent` in production) and runs the
// normalize → dispatch → count loop.
//
// Lives on its own (separate from posthog-adapter.ts) because the
// adapter is read-only — it only normalises events. This file owns
// the orchestration of an ingest pass, with the ergonomics of a
// pure function: deterministic, easy to test, no global / framework
// dependency. The abort-on-cancel logic lives in the command layer
// because raising a MantaError requires the framework globals.

import type { PosthogEvent } from './apply-event'
import { normalizeCartEvent, toIngestInput } from './posthog-adapter'

/**
 * Shape of one row returned by HogQL for the canonical sync query.
 * Tuple order: [uuid, event, distinct_id, timestamp, properties]. The
 * properties field arrives as a JSON-encoded string from PostHog (we
 * decode it into an object for downstream consumers).
 */
export type HogQLEventRow = readonly [
  uuid: unknown,
  event: unknown,
  distinct_id: unknown,
  timestamp: unknown,
  properties: unknown,
]

export interface SyncIngestResult {
  ingested: number
  skipped: number
  errors: number
}

export interface SyncIngestOptions {
  /**
   * Called for each successfully-normalised event. In production this is
   * `(input) => step.command.ingestCartEvent(input)`. Tests pass a
   * mock so they can assert on the dispatched payloads.
   */
  ingest: (input: Record<string, unknown>) => Promise<unknown>
  /**
   * Optional warning sink — invoked at most a handful of times so a
   * thousand failing events don't drown the logs.
   */
  warn?: (message: string) => void
  /**
   * Optional predicate consulted before each iteration. Returning true
   * stops the loop early without throwing — the command layer is
   * responsible for translating "cancelled" into a MantaError.
   */
  shouldStop?: () => boolean
}

/**
 * Convert a raw HogQL row into the in-memory PosthogEvent shape used
 * by the rest of the cart-tracking pipeline. JSON-encoded `properties`
 * are decoded; non-string values are passed through as-is so callers
 * keep working with objects directly.
 */
export function rowToPosthogEvent(row: HogQLEventRow): PosthogEvent {
  const [uuid, event, distinctId, timestamp, properties] = row
  return {
    uuid: String(uuid),
    event: event as string,
    distinct_id: (distinctId ?? null) as string | null,
    timestamp: timestamp as string,
    properties: parsePosthogProperties(properties),
  }
}

export function parsePosthogProperties(properties: unknown): Record<string, unknown> {
  let value = properties
  for (let i = 0; i < 2; i += 1) {
    if (typeof value !== 'string') break
    value = JSON.parse(value) as unknown
  }
  return isRecord(value) ? value : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Run the normalise + dispatch loop for a batch of HogQL rows. Errors
 * thrown by `ingest` are caught and counted — the loop never throws.
 * Use `shouldStop` to break early on cancellation.
 */
export async function ingestHogQLRows(
  rows: readonly HogQLEventRow[],
  opts: SyncIngestOptions,
): Promise<SyncIngestResult> {
  let ingested = 0
  let skipped = 0
  let errors = 0

  for (const row of rows) {
    if (opts.shouldStop?.()) break

    const evt = rowToPosthogEvent(row)
    const normalized = normalizeCartEvent(evt)
    if (!normalized) {
      skipped += 1
      continue
    }
    const input = toIngestInput(evt)
    if (!input) {
      skipped += 1
      continue
    }

    try {
      await opts.ingest(input)
      ingested += 1
    } catch (err) {
      if (errors < 10) {
        opts.warn?.(`ingest failed for ${evt.event} (${evt.uuid}): ${(err as Error).message}`)
      }
      errors += 1
    }
  }

  return { ingested, skipped, errors }
}
