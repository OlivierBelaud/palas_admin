export default defineSubscriber({
  event: 'order.refresh-requested',
  subscriberId: 'order-refresh',
  handler: async (message, { command, log }) => {
    const data = message.data as { shopify_order_id?: string; reason?: string; source?: string } | undefined
    const shopifyOrderId = data?.shopify_order_id?.trim()
    if (!shopifyOrderId) {
      log.warn('[order-refresh] missing shopify_order_id — skipping')
      return
    }
    try {
      // biome-ignore lint/suspicious/noExplicitAny: command registry is dynamically typed.
      await (command as any).refreshOrder({
        shopify_order_id: shopifyOrderId,
        reason: data?.reason ?? 'unknown',
        source: data?.source ?? 'unknown',
        dryRun: false,
      })
    } catch (err) {
      log.error(`[order-refresh] refreshOrder failed for ${shopifyOrderId}: ${(err as Error).message}`)
    }
  },
})
