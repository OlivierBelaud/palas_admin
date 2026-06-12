import { db, json, nowMs, requireAdmin, roundMoney, timingHeader, unauthorized } from './runtime.mjs'

export default {
  async fetch(req) {
    const started = nowMs()
    const auth = requireAdmin(req)
    if (!auth) return unauthorized()
    const authDone = nowMs()

    const rows = await db().unsafe(
      `WITH classified AS (
         SELECT
           total_price,
           CASE
             WHEN highest_stage = 'completed' THEN 'completed'
             WHEN EXTRACT(EPOCH FROM (now() - last_action_at)) < 7200 THEN 'browsing'
             WHEN EXTRACT(EPOCH FROM (now() - last_action_at)) >= 604800 THEN 'dead'
             ELSE 'dormant'
           END AS activity,
           CASE
             WHEN highest_stage = 'cart' THEN 'cart_abandoned'
             WHEN highest_stage IN ('checkout_started', 'checkout_engaged') THEN 'checkout_abandoned'
             WHEN highest_stage = 'payment_attempted' THEN 'payment_abandoned'
             ELSE NULL
           END AS sub_stage
         FROM carts
         WHERE deleted_at IS NULL
       )
       SELECT
         COUNT(*)::text AS total_carts,
         COUNT(*) FILTER (WHERE activity IN ('browsing', 'dormant'))::text AS active,
         COUNT(*) FILTER (WHERE sub_stage = 'cart_abandoned' AND activity <> 'completed')::text AS cart_abandoned,
         COUNT(*) FILTER (WHERE sub_stage = 'checkout_abandoned' AND activity <> 'completed')::text AS checkout_abandoned,
         COUNT(*) FILTER (WHERE sub_stage = 'payment_abandoned' AND activity <> 'completed')::text AS payment_abandoned,
         COUNT(*) FILTER (WHERE activity = 'completed')::text AS completed,
         COUNT(*) FILTER (WHERE activity = 'dead')::text AS dead,
         COALESCE(SUM(total_price) FILTER (WHERE activity = 'completed'), 0)::text AS total_revenue,
         COALESCE(AVG(total_price) FILTER (WHERE total_price > 0), 0)::text AS avg_cart_value,
         COALESCE(SUM(total_price) FILTER (WHERE activity NOT IN ('completed', 'browsing') AND total_price > 0), 0)::text
           AS abandoned_revenue
       FROM classified`,
    )
    const dbDone = nowMs()
    const row = rows[0] ?? {}
    const data = {
      total_carts: number(row.total_carts),
      active: number(row.active),
      cart_abandoned: number(row.cart_abandoned),
      checkout_abandoned: number(row.checkout_abandoned),
      payment_abandoned: number(row.payment_abandoned),
      completed: number(row.completed),
      dead: number(row.dead),
      total_revenue: roundMoney(number(row.total_revenue)),
      avg_cart_value: roundMoney(number(row.avg_cart_value)),
      abandoned_revenue: roundMoney(number(row.abandoned_revenue)),
    }
    const serializeDone = nowMs()

    return json(
      { data },
      {
        headers: {
          'server-timing': timingHeader({
            auth: authDone - started,
            query: dbDone - authDone,
            serialize: serializeDone - dbDone,
            total: serializeDone - started,
          }),
        },
      },
    )
  },
}

function number(value) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}
