import { type RawDb, repairCartSnapshots } from '../../modules/cart-tracking/refresh-cart'

export default defineCommand({
  name: 'repairCartSnapshots',
  description: 'Dry-run or repair Cart snapshot/link inconsistencies in controlled batches.',
  input: z.object({
    limit: z.number().int().min(1).max(5000).default(500),
    dryRun: z.boolean().default(true),
  }),
  workflow: async (input, { step, log }) => {
    const result = await step.action('repair-cart-snapshots', {
      invoke: async (_i: unknown, ctx) => {
        const db = ctx.app.resolve('IDatabasePort') as RawDb | undefined
        if (!db) throw new MantaError('UNEXPECTED_STATE', 'No database configured')
        return repairCartSnapshots(db, { limit: input.limit, dryRun: input.dryRun })
      },
      compensate: async () => {},
    })({})

    log.info(
      `[repairCartSnapshots] dry_run=${result.dry_run} selected=${result.selected} repaired=${result.repaired} missing_cart_order_links ${result.before.missing_cart_order_links}->${result.after.missing_cart_order_links}`,
    )
    return result
  },
})
