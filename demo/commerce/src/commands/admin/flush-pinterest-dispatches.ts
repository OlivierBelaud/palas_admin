import { repairUnpreparedDispatches } from '../../modules/event-hub/dispatch-repair'
import { flushDestinationDispatches, type RawDispatchDb } from '../../modules/event-hub/dispatch-runner'
import { getPinterestConfig, pinterestDestinationConnector } from '../../modules/event-hub/pinterest-connector'

export default defineCommand({
  name: 'flushPinterestDispatches',
  description: 'Send pending Event Hub Pinterest dispatch logs and persist delivery status.',
  input: z.object({
    batchLimit: z.number().int().min(1).max(200).default(50),
  }),
  workflow: async (input, { step, log }) => {
    const config = getPinterestConfig()
    return await step.action('flush-pinterest-dispatches', {
      invoke: async (_i: unknown, ctx) => {
        const db = ctx.app.resolve('IDatabasePort') as RawDispatchDb | undefined
        if (!db?.raw) throw new MantaError('UNEXPECTED_STATE', 'No database configured')

        await repairUnpreparedDispatches(db, pinterestDestinationConnector, { signal: ctx.signal })
        const result = await flushDestinationDispatches({
          db,
          connector: pinterestDestinationConnector,
          batchLimit: input.batchLimit,
          signal: ctx.signal,
        })

        if (ctx.signal?.aborted) {
          throw new MantaError('CONFLICT', 'flushPinterestDispatches cancelled', { code: 'WORKFLOW_CANCELLED' })
        }

        log.info(
          `[flushPinterestDispatches] scanned=${result.scanned} sent=${result.sent} invalid=${result.invalid} retry=${result.retry} error=${result.error} not_configured=${result.not_configured} test_mode=${config.testMode}`,
        )

        return result
      },
      compensate: async () => {
        // Dispatch rows are idempotent by event_destination_key. Partial
        // progress is expected; the next cron tick resumes pending/retry rows.
      },
    })({})
  },
})
