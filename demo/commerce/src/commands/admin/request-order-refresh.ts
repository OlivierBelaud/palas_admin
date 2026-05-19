import { normalizeShopifyOrderId } from '../../modules/order/refresh-order'

export default defineCommand({
  name: 'requestOrderRefresh',
  description: 'Emit an order.refresh-requested ping. The subscriber performs the Shopify snapshot refresh.',
  input: z.object({
    shopify_order_id: z.string().min(1),
    reason: z.string().default('unknown'),
    source: z.string().default('unknown'),
  }),
  workflow: async (input, { step, log }) => {
    const shopifyOrderId = normalizeShopifyOrderId(input.shopify_order_id)
    await step.emit('order.refresh-requested', {
      shopify_order_id: shopifyOrderId,
      reason: input.reason,
      source: input.source,
      requested_at: new Date().toISOString(),
    })
    log.info(`[requestOrderRefresh] shopify_order_id=${shopifyOrderId} source=${input.source} reason=${input.reason}`)
    return { requested: true, shopify_order_id: shopifyOrderId }
  },
})
