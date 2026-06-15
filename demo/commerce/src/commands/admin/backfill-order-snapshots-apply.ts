import { runBackfillOrdersFromShopify } from './backfill-order-snapshots'

export default defineCommand({
  name: 'backfillOrdersFromShopifyApply',
  description: 'Apply one controlled batch of incomplete Order refreshes from Shopify.',
  input: z.object({}),
  workflow: async (_input, { step, log }) => {
    return await runBackfillOrdersFromShopify(
      {
        limit: 250,
        dryRun: false,
        onlyMissingItems: true,
        onlyMissingClassification: false,
        delayMs: 0,
      },
      step,
      log,
    )
  },
})
