import { flushDestinationDispatches, type RawDispatchDb } from '../../modules/event-hub/dispatch-runner'
import { getMetaCapiConfig, metaCapiDestinationConnector } from '../../modules/event-hub/meta-capi-connector'

export default defineCommand({
  name: 'flushMetaCapiDispatches',
  description: 'Send pending Event Hub Meta CAPI dispatch logs and persist delivery status.',
  input: z.object({
    batchLimit: z.number().int().min(1).max(200).default(50),
  }),
  workflow: async (input, { step, log }) => {
    const config = getMetaCapiConfig()
    return await step.action('flush-meta-capi-dispatches', {
      invoke: async (_i: unknown, ctx) => {
        const db = ctx.app.resolve('IDatabasePort') as RawDispatchDb | undefined
        if (!db?.raw) throw new MantaError('UNEXPECTED_STATE', 'No database configured')

        const result = await flushDestinationDispatches({
          db,
          connector: metaCapiDestinationConnector,
          batchLimit: input.batchLimit,
          signal: ctx.signal,
        })

        if (ctx.signal?.aborted) {
          throw new MantaError('CONFLICT', 'flushMetaCapiDispatches cancelled', { code: 'WORKFLOW_CANCELLED' })
        }

        log.info(
          `[flushMetaCapiDispatches] scanned=${result.scanned} sent=${result.sent} invalid=${result.invalid} retry=${result.retry} error=${result.error} not_configured=${result.not_configured} test_event_code=${Boolean(config.testEventCode)}`,
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
