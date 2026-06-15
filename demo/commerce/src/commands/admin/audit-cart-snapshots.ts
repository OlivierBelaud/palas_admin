import { auditCartSnapshots, type RawDb } from '../../modules/cart-tracking/refresh-cart'

export default defineCommand({
  name: 'auditCartSnapshots',
  description: 'Audit Cart rows and Cart links against Contact and Order rows.',
  input: z.object({}),
  workflow: async (_input, { step, log }) => {
    const summary = await step.action('audit-cart-snapshots', {
      invoke: async (_i: unknown, ctx) => {
        const db = ctx.app.resolve('IDatabasePort') as RawDb | undefined
        if (!db) throw new MantaError('UNEXPECTED_STATE', 'No database configured')
        return auditCartSnapshots(db)
      },
      compensate: async () => {},
    })({})

    log.info(
      `[auditCartSnapshots] carts=${summary.carts} missing_cart_order_links=${summary.missing_cart_order_links} missing_cart_contact_links=${summary.missing_cart_contact_links} duplicate_cart_contact_pairs=${summary.duplicate_cart_contact_pairs}`,
    )
    return summary
  },
})
