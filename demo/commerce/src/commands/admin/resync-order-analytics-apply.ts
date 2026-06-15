import { runBackfillOrdersFromShopify } from './backfill-order-snapshots'

export default defineCommand({
  name: 'resyncOrderAnalyticsApply',
  description: 'Refresh Order rows that still miss channel classification and rebuild order/contact links.',
  input: z.object({}),
  workflow: async (_input, { step, log }) => {
    return await runBackfillOrdersFromShopify(
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
