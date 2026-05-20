import { type RawDb, refreshCartSnapshot } from '../../modules/cart-tracking/refresh-cart'

export default defineCommand({
  name: 'refreshCart',
  description: 'Refresh one Cart snapshot and its Contact/Order links from local snapshot keys.',
  input: z
    .object({
      cart_id: z.string().nullable().optional(),
      cart_token: z.string().nullable().optional(),
      checkout_token: z.string().nullable().optional(),
      shopify_order_id: z.string().nullable().optional(),
      email: z.string().nullable().optional(),
      reason: z.string().nullable().optional(),
      source: z.string().nullable().optional(),
      dryRun: z.boolean().default(false),
    })
    .refine(
      (value) =>
        Boolean(value.cart_id || value.cart_token || value.checkout_token || value.shopify_order_id || value.email),
      'At least one cart lookup key is required',
    ),
  workflow: async (input, { step, log }) => {
    const result = await step.action('refresh-cart', {
      invoke: async (_i: unknown, ctx) => {
        const db = ctx.app.resolve('IDatabasePort') as RawDb | undefined
        if (!db) throw new MantaError('UNEXPECTED_STATE', 'No database configured')
        return refreshCartSnapshot(
          db,
          {
            cart_id: input.cart_id,
            cart_token: input.cart_token,
            checkout_token: input.checkout_token,
            shopify_order_id: input.shopify_order_id,
            email: input.email,
          },
          { dryRun: input.dryRun },
        )
      },
      compensate: async () => {},
    })({})

    log.info(
      `[refreshCart] source=${input.source ?? 'unknown'} reason=${input.reason ?? 'unknown'} selected=${result.selected} repaired=${result.repaired} dry_run=${result.dry_run}`,
    )
    return result
  },
})
