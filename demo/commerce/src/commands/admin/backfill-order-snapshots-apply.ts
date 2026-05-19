import { runBackfillOrderSnapshots } from './backfill-order-snapshots'

export default defineCommand({
  name: 'backfillOrderSnapshotsApply',
  description: 'Apply one controlled batch of incomplete Order snapshot refreshes from Shopify.',
  input: z.object({}),
  workflow: async (_input, { step, log }) => {
    return await runBackfillOrderSnapshots(
      {
        limit: 250,
        dryRun: false,
        onlyMissingItems: true,
        delayMs: 0,
      },
      step,
      log,
    )
  },
})
