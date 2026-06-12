import { flushDestinationDispatches, type RawDispatchDb } from '../../modules/event-hub/dispatch-runner'
import { getGoogleAdsConfig, googleAdsDestinationConnector } from '../../modules/event-hub/google-ads-connector'

export default defineCommand({
  name: 'flushGoogleAdsDispatches',
  description: 'Send pending Event Hub purchase conversions to Google Ads and persist delivery status.',
  input: z.object({
    batchLimit: z.number().int().min(1).max(200).default(50),
  }),
  workflow: async (input, { step, log }) => {
    return await step.action('flush-google-ads-dispatches', {
      invoke: async (_i: unknown, ctx) => {
        const db = ctx.app.infra.db as RawDispatchDb | undefined
        if (!db?.raw) throw new MantaError('UNEXPECTED_STATE', 'No database configured')

        const result = await flushDestinationDispatches({
          db,
          connector: googleAdsDestinationConnector,
          batchLimit: input.batchLimit,
          signal: ctx.signal,
        })
        const config = getGoogleAdsConfig()

        if (ctx.signal?.aborted) {
          throw new MantaError('CONFLICT', 'flushGoogleAdsDispatches cancelled', { code: 'WORKFLOW_CANCELLED' })
        }

        log.info(
          `[flushGoogleAdsDispatches] scanned=${result.scanned} sent=${result.sent} invalid=${result.invalid} retry=${result.retry} error=${result.error} not_configured=${result.not_configured} validate_only=${config.validateOnly}`,
        )

        return {
          ...result,
          validate_only: config.validateOnly,
        }
      },
      compensate: async () => {
        // Dispatch rows are idempotent by event_destination_key. Partial
        // progress is expected; the next cron tick resumes pending/retry rows.
      },
    })({})
  },
})
