import { type RawDb, repairCartSnapshots } from '../../modules/cart-tracking/refresh-cart'

export default defineCommand({
  name: 'repairCartSnapshotsApply',
  description: 'Apply one controlled batch of Cart snapshot/link repairs.',
  input: z.object({}),
  workflow: async (_input, { step, log }) => {
    const result = await step.action('repair-cart-snapshots-apply', {
      invoke: async (_i: unknown, ctx) => {
        const db = ctx.app.resolve('IDatabasePort') as RawDb | undefined
        if (!db) throw new MantaError('UNEXPECTED_STATE', 'No database configured')
        return repairCartSnapshots(db, { limit: 1000, dryRun: false })
      },
      compensate: async () => {},
    })({})

    log.info(
      `[repairCartSnapshotsApply] selected=${result.selected} repaired=${result.repaired} missing_cart_order_links ${result.before.missing_cart_order_links}->${result.after.missing_cart_order_links}`,
    )
    return result
  },
})
