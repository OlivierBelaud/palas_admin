import { z } from 'zod'

export default defineQuery({
  name: 'cart-stats',
  description: 'Aggregated cart statistics: funnel, abandonment breakdown, revenue (last 30 days)',
  input: z.object({}).optional(),
  handler: async (_input, { query }) => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

    // Use DB-level filter instead of fetching everything and filtering in JS
    const carts = await query.graph({
      entity: 'cart',
      filters: {
        last_action_at: { $gte: thirtyDaysAgo },
      },
      fields: ['status', 'total_price', 'highest_stage'],
      pagination: { limit: 5000 },
    }) as any[]

    const empty = {
      total_carts: 0,
      active: 0,
      cart_abandoned: 0,
      checkout_abandoned: 0,
      payment_abandoned: 0,
      completed: 0,
      total_revenue: 0,
      avg_cart_value: 0,
      abandoned_revenue: 0,
    }

    if (carts.length === 0) return empty

    let active = 0
    let cartAbandoned = 0
    let checkoutAbandoned = 0
    let paymentAbandoned = 0
    let completed = 0
    let totalRevenue = 0
    let abandonedRevenue = 0
    let nonEmptySum = 0
    let nonEmptyCount = 0

    for (const c of carts) {
      const price = c.total_price ?? 0
      switch (c.status) {
        case 'active': active++; break
        case 'cart_abandoned': cartAbandoned++; break
        case 'checkout_abandoned': checkoutAbandoned++; break
        case 'payment_abandoned': paymentAbandoned++; break
        case 'completed': completed++; totalRevenue += price; break
      }
      if (price > 0) {
        nonEmptySum += price
        nonEmptyCount++
      }
      if (c.status !== 'completed' && c.status !== 'active' && price > 0) {
        abandonedRevenue += price
      }
    }

    return {
      total_carts: carts.length,
      active,
      cart_abandoned: cartAbandoned,
      checkout_abandoned: checkoutAbandoned,
      payment_abandoned: paymentAbandoned,
      completed,
      total_revenue: Math.round(totalRevenue * 100) / 100,
      avg_cart_value: nonEmptyCount > 0 ? Math.round((nonEmptySum / nonEmptyCount) * 100) / 100 : 0,
      abandoned_revenue: Math.round(abandonedRevenue * 100) / 100,
    }
  },
})
