export default defineSubscriber({
  event: 'cart.refresh-requested',
  subscriberId: 'cart-refresh',
  handler: async (message, { command, log }) => {
    const data = message.data as
      | {
          cart_id?: string | null
          cart_token?: string | null
          checkout_token?: string | null
          shopify_order_id?: string | null
          email?: string | null
          reason?: string
          source?: string
        }
      | undefined
    if (!data?.cart_id && !data?.cart_token && !data?.checkout_token && !data?.shopify_order_id && !data?.email) {
      log.warn('[cart-refresh] missing cart key — skipping')
      return
    }
    try {
      // biome-ignore lint/suspicious/noExplicitAny: command registry is dynamically typed.
      await (command as any).refreshCart({
        cart_id: data.cart_id ?? null,
        cart_token: data.cart_token ?? null,
        checkout_token: data.checkout_token ?? null,
        shopify_order_id: data.shopify_order_id ?? null,
        email: data.email?.trim().toLowerCase() ?? null,
        reason: data.reason ?? 'unknown',
        source: data.source ?? 'unknown',
        dryRun: false,
      })
    } catch (err) {
      log.error(`[cart-refresh] refreshCart failed: ${(err as Error).message}`)
      throw err
    }
  },
})
