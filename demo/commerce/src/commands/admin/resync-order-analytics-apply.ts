import { runBackfillOrderSnapshots } from './backfill-order-snapshots'

export default defineCommand({
  name: 'resyncOrderAnalyticsApply',
  description:
    'Refresh Order snapshots that still miss channel classification and rebuild order/contact analytics links.',
  input: z.object({}),
  workflow: async (_input, { step, log }) => {
    return await runBackfillOrderSnapshots(
      {
        limit: 1000,
        dryRun: false,
        onlyMissingItems: false,
        onlyMissingClassification: true,
        delayMs: 0,
      },
      step,
      log,
    )
  },
})
