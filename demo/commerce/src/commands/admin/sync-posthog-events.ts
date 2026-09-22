// Five-minute safety net for events that bypass or outlive the live proxy.
// Durable progress and compact receipts avoid replaying healthy workflows.
import type { RawDb } from '../../modules/cart-tracking/apply-event'
import {
  ingestRecoveredCartEvent,
  type RecoveryCommands,
  recoverPosthogEvents,
} from '../../modules/cart-tracking/posthog-recovery'
import type { HogQLEventRow } from '../../modules/cart-tracking/posthog-sync'
import { posthogPrivateKey, runPosthogHogQL } from '../../utils/posthog-query'

export default defineCommand({
  name: 'syncPosthogEvents',
  description: 'Recover missing cart/checkout events with durable progress and deduplication',
  input: z.object({}),
  workflow: async (_input, { step, log }) => {
    const key = posthogPrivateKey()
    if (!key) throw new MantaError('INVALID_STATE', 'POSTHOG_API_KEY is required for syncPosthogEvents')
    return await step.action('sync-posthog-events', {
      invoke: async (_i: unknown, ctx) => {
        const db = ctx.app.resolve('IDatabasePort') as RawDb | undefined
        if (!db) throw new MantaError('UNEXPECTED_STATE', 'No database configured')
        const startedAt = Date.now()
        const commands = step.command as unknown as RecoveryCommands
        const result = await recoverPosthogEvents({
          db,
          fetchPage: (query) => runPosthogHogQL<HogQLEventRow[]>(query, { privateKey: key, signal: ctx.signal }),
          ingest: (input) => ingestRecoveredCartEvent(input, commands),
          shouldStop: () => ctx.signal?.aborted ?? false,
        })
        if (ctx.signal?.aborted) {
          throw new MantaError('CONFLICT', 'syncPosthogEvents cancelled', { code: 'WORKFLOW_CANCELLED' })
        }
        const durationMs = Date.now() - startedAt
        log.info(
          `[syncPosthogEvents] fetched=${result.fetched} ingested=${result.ingested} skipped=${result.skipped} errors=${result.errors} retried=${result.retried} busy=${result.busy} duration_ms=${durationMs}`,
        )
        return { ...result, duration_ms: durationMs }
      },
      compensate: async () => {
        // The durable cursor and retry receipts survive cancellation/redeploys.
      },
    })({})
  },
})
