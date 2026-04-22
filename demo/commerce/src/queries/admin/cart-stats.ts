// Cart stats for the admin dashboard — all categories are DERIVED from
// highest_stage + last_action_at (see modules/cart-tracking/abandonment.ts
// and docs/cart-abandonment-rules.md). The DB `status` column is not used
// for categorization — only `completed` vs `active`, which is equivalent to
// `highest_stage = 'completed'`.

import { computeActivityState, computeSubStage } from '../../modules/cart-tracking/abandonment'

export default defineQuery({
  name: 'cart-stats',
  description: 'Aggregated cart statistics (last 30 days) — activity states derived on the fly',
  input: z.object({}).optional(),
  handler: async (_input, { query }) => {
    const carts = await query.graph({
      entity: 'cart',
      fields: ['highest_stage', 'last_action_at', 'total_price'],
      pagination: { limit: 500 },
    })

    if (carts.length === 0) {
      return {
        total_carts: 0,
        active: 0,
        cart_abandoned: 0,
        checkout_abandoned: 0,
        payment_abandoned: 0,
        completed: 0,
        dead: 0,
        total_revenue: 0,
        avg_cart_value: 0,
        abandoned_revenue: 0,
      }
    }

    const now = Date.now()
    let browsing = 0
    let dormant = 0
    let dead = 0
    let completed = 0
    let cartAbandoned = 0
    let checkoutAbandoned = 0
    let paymentAbandoned = 0
    let totalRevenue = 0
    let abandonedRevenue = 0
    let nonEmptySum = 0
    let nonEmptyCount = 0

    for (const c of carts) {
      const price = c.total_price ?? 0
      const activity = computeActivityState(c, now)

      switch (activity) {
        case 'browsing':
          browsing++
          break
        case 'dormant':
          dormant++
          break
        case 'dead':
          dead++
          break
        case 'completed':
          completed++
          totalRevenue += price
          break
      }

      // Funnel sub-stage — only meaningful for dormant/dead carts, but we
      // count every non-completed cart by where it stopped in the funnel so
      // the classic "cart / checkout / payment abandoned" KPIs stay readable.
      if (activity !== 'completed') {
        const sub = computeSubStage(c.highest_stage)
        if (sub === 'cart_abandoned') cartAbandoned++
        else if (sub === 'checkout_abandoned') checkoutAbandoned++
        else if (sub === 'payment_abandoned') paymentAbandoned++

        if (price > 0 && activity !== 'browsing') abandonedRevenue += price
      }

      if (price > 0) {
        nonEmptySum += price
        nonEmptyCount++
      }
    }

    return {
      total_carts: carts.length,
      active: browsing + dormant, // "En cours" = pas encore dead, pas encore completed
      cart_abandoned: cartAbandoned,
      checkout_abandoned: checkoutAbandoned,
      payment_abandoned: paymentAbandoned,
      completed,
      dead,
      total_revenue: Math.round(totalRevenue * 100) / 100,
      avg_cart_value: nonEmptyCount > 0 ? Math.round((nonEmptySum / nonEmptyCount) * 100) / 100 : 0,
      abandoned_revenue: Math.round(abandonedRevenue * 100) / 100,
    }
  },
})
