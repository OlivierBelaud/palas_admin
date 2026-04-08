import { z } from 'zod'

export default defineQuery({
  name: 'cart-stats',
  description: 'Aggregated cart statistics: funnel, abandonment breakdown, revenue (last 30 days)',
  input: z.object({}).optional(),
  handler: async (_input, { query }) => {
    const now = new Date()
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()

    // Get all carts with activity in the last 30 days
    const allCarts = await query.graph({
      entity: 'cart',
      pagination: { limit: 10000 },
    }) as any[]

    const carts = allCarts.filter((c: any) =>
      new Date(c.last_action_at).toISOString() >= thirtyDaysAgo,
    )

    if (carts.length === 0) {
      return {
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
    }

    const statusCounts: Record<string, number> = {}
    for (const cart of carts) {
      const s = cart.status ?? 'active'
      statusCounts[s] = (statusCounts[s] ?? 0) + 1
    }

    const completedCarts = carts.filter((c: any) => c.status === 'completed')
    const totalRevenue = completedCarts.reduce((sum: number, c: any) => sum + (c.total_price ?? 0), 0)

    const nonEmpty = carts.filter((c: any) => c.total_price > 0)
    const avgCartValue = nonEmpty.length > 0
      ? nonEmpty.reduce((sum: number, c: any) => sum + c.total_price, 0) / nonEmpty.length
      : 0

    // Revenue lost in abandoned carts (all non-completed with total > 0)
    const abandonedCarts = carts.filter((c: any) => c.status !== 'completed' && c.status !== 'active' && c.total_price > 0)
    const abandonedRevenue = abandonedCarts.reduce((sum: number, c: any) => sum + (c.total_price ?? 0), 0)

    return {
      total_carts: carts.length,
      active: statusCounts.active ?? 0,
      cart_abandoned: statusCounts.cart_abandoned ?? 0,
      checkout_abandoned: statusCounts.checkout_abandoned ?? 0,
      payment_abandoned: statusCounts.payment_abandoned ?? 0,
      completed: statusCounts.completed ?? 0,
      total_revenue: Math.round(totalRevenue * 100) / 100,
      avg_cart_value: Math.round(avgCartValue * 100) / 100,
      abandoned_revenue: Math.round(abandonedRevenue * 100) / 100,
    }
  },
})
