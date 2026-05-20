export default defineCommand({
  name: 'requestCartRefresh',
  description: 'Emit a cart.refresh-requested ping. The subscriber performs Cart snapshot/link repair.',
  input: z.object({
    cart_id: z.string().nullable().optional(),
    cart_token: z.string().nullable().optional(),
    checkout_token: z.string().nullable().optional(),
    shopify_order_id: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    reason: z.string().default('unknown'),
    source: z.string().default('unknown'),
  }),
  workflow: async (input, { step, log }) => {
    await step.emit('cart.refresh-requested', {
      cart_id: input.cart_id ?? null,
      cart_token: input.cart_token ?? null,
      checkout_token: input.checkout_token ?? null,
      shopify_order_id: input.shopify_order_id ?? null,
      email: input.email?.trim().toLowerCase() ?? null,
      reason: input.reason,
      source: input.source,
      requested_at: new Date().toISOString(),
    })
    log.info(`[requestCartRefresh] source=${input.source} reason=${input.reason}`)
    return { requested: true }
  },
})
