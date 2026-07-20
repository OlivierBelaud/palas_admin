import { flushDestinationDispatches, type RawDispatchDb } from '../../modules/event-hub/dispatch-runner'
import { ensureMissingGa4DispatchLogs, ga4DestinationConnector } from '../../modules/event-hub/ga4-connector'

export default defineCommand({
  name: 'flushGa4Dispatches',
  description: 'Send pending Event Hub GA4 dispatch logs via Measurement Protocol and persist delivery status.',
  input: z.object({
    batchLimit: z.number().int().min(1).max(200).default(50),
  }),
  workflow: async (input, { step, log }) => {
    return await step.action('flush-ga4-dispatches', {
      invoke: async (_i: unknown, ctx) => {
        const db = ctx.app.resolve('IDatabasePort') as RawDispatchDb | undefined
        if (!db?.raw) throw new MantaError('UNEXPECTED_STATE', 'No database configured')

        const reconciliation = await ensureMissingGa4DispatchLogs(db)
        const result = await flushDestinationDispatches({
          db,
          connector: ga4DestinationConnector,
          batchLimit: input.batchLimit,
          signal: ctx.signal,
        })

        if (ctx.signal?.aborted) {
          throw new MantaError('CONFLICT', 'flushGa4Dispatches cancelled', { code: 'WORKFLOW_CANCELLED' })
        }

        log.info(
          `[flushGa4Dispatches] reconciled=${reconciliation.inserted} scanned=${result.scanned} sent=${result.sent} invalid=${result.invalid} retry=${result.retry} error=${result.error} not_configured=${result.not_configured} claim_conflict=${result.claim_conflict}`,
        )

        return { reconciled: reconciliation.inserted, ...result }
      },
      compensate: async () => {
        // Dispatch rows are idempotent by event_destination_key. Partial
        // progress is expected; the next cron tick resumes pending/retry rows.
      },
    })({})
  },
})
