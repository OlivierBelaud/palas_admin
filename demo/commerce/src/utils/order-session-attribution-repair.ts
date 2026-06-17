import type { RuntimeSql } from './manta-runtime'

export interface OrderSessionAttributionRepairResult {
  candidate_orders: number
  repaired_orders: number
  remaining_unattributed_orders: number
}

const ACTIVE_WINDOW_MINUTES = 30

/**
 * Repair the materialized order -> visitor_session link used by daily
 * reporting. Shopify/webhook paths can complete carts without going through
 * the PostHog checkout transition that normally stamps visitor_sessions.
 *
 * The repair is idempotent and follows the documented attribution priorities:
 * 1. same distinct_id, session active at cart_birth_at;
 * 2. same distinct_id, session active at conversion time;
 * 3. same email, session active at conversion time.
 */
export async function repairOrderSessionAttribution(
  sql: RuntimeSql,
  period: { startIso: string; endIso: string },
): Promise<OrderSessionAttributionRepairResult> {
  const [before] = await sql.unsafe<Array<{ count: number }>>(UNATTRIBUTED_ORDERS_SQL, [period.startIso, period.endIso])

  const repaired = await sql.unsafe<Array<{ order_row_id: string }>>(REPAIR_ATTRIBUTION_SQL, [
    period.startIso,
    period.endIso,
    ACTIVE_WINDOW_MINUTES,
  ])

  const [after] = await sql.unsafe<Array<{ count: number }>>(UNATTRIBUTED_ORDERS_SQL, [period.startIso, period.endIso])

  return {
    candidate_orders: Number(before?.count ?? 0),
    repaired_orders: repaired.length,
    remaining_unattributed_orders: Number(after?.count ?? 0),
  }
}

const UNATTRIBUTED_ORDERS_SQL = `
WITH day_orders AS (
  SELECT id, shopify_order_id
    FROM orders
   WHERE deleted_at IS NULL
     AND include_in_ecommerce_analytics = true
     AND placed_at >= $1::timestamptz
     AND placed_at < $2::timestamptz
)
SELECT COUNT(*)::int AS count
  FROM day_orders o
 WHERE NOT EXISTS (
   SELECT 1
     FROM visitor_sessions vs
    WHERE vs.deleted_at IS NULL
      AND (vs.order_id = o.shopify_order_id OR vs.order_id = o.id::text)
 )
`

const REPAIR_ATTRIBUTION_SQL = `
WITH day_orders AS (
  SELECT
    o.id::text AS order_row_id,
    o.shopify_order_id,
    o.email AS order_email,
    o.placed_at,
    c.id::text AS cart_id,
    c.distinct_id AS cart_distinct_id,
    c.email AS cart_email,
    c.cart_birth_at,
    COALESCE(c.completed_at, o.placed_at) AS conversion_at
  FROM orders o
  LEFT JOIN carts c
    ON c.deleted_at IS NULL
   AND c.shopify_order_id = o.shopify_order_id
  WHERE o.deleted_at IS NULL
    AND o.include_in_ecommerce_analytics = true
    AND o.placed_at >= $1::timestamptz
    AND o.placed_at < $2::timestamptz
    AND NOT EXISTS (
      SELECT 1
        FROM visitor_sessions existing
       WHERE existing.deleted_at IS NULL
         AND (existing.order_id = o.shopify_order_id OR existing.order_id = o.id::text)
    )
),
matches AS (
  SELECT
    o.order_row_id,
    o.shopify_order_id,
    picked.session_id,
    picked.attributed_at
  FROM day_orders o
  JOIN LATERAL (
    SELECT *
    FROM (
      SELECT
        vs.id::text AS session_id,
        o.cart_birth_at AS attributed_at,
        1 AS priority,
        vs.started_at
      FROM visitor_sessions vs
      WHERE o.cart_distinct_id IS NOT NULL
        AND o.cart_birth_at IS NOT NULL
        AND vs.deleted_at IS NULL
        AND vs.distinct_id = o.cart_distinct_id
        AND vs.started_at <= o.cart_birth_at
        AND vs.last_event_at >= o.cart_birth_at - ($3::int * INTERVAL '1 minute')

      UNION ALL

      SELECT
        vs.id::text AS session_id,
        o.conversion_at AS attributed_at,
        2 AS priority,
        vs.started_at
      FROM visitor_sessions vs
      WHERE o.cart_distinct_id IS NOT NULL
        AND o.conversion_at IS NOT NULL
        AND vs.deleted_at IS NULL
        AND vs.distinct_id = o.cart_distinct_id
        AND vs.started_at <= o.conversion_at
        AND vs.last_event_at >= o.conversion_at - ($3::int * INTERVAL '1 minute')

      UNION ALL

      SELECT
        vs.id::text AS session_id,
        o.conversion_at AS attributed_at,
        3 AS priority,
        vs.started_at
      FROM visitor_sessions vs
      WHERE COALESCE(NULLIF(o.order_email, ''), NULLIF(o.cart_email, '')) IS NOT NULL
        AND o.conversion_at IS NOT NULL
        AND vs.deleted_at IS NULL
        AND (
          LOWER(vs.email_at_session_start) = LOWER(COALESCE(NULLIF(o.order_email, ''), NULLIF(o.cart_email, '')))
          OR LOWER(vs.email_at_session_end) = LOWER(COALESCE(NULLIF(o.order_email, ''), NULLIF(o.cart_email, '')))
        )
        AND vs.started_at <= o.conversion_at
        AND vs.last_event_at >= o.conversion_at - ($3::int * INTERVAL '1 minute')
    ) candidates
    ORDER BY priority ASC, started_at DESC
    LIMIT 1
  ) picked ON true
),
deduped_matches AS (
  SELECT DISTINCT ON (session_id)
    order_row_id,
    shopify_order_id,
    session_id,
    attributed_at
  FROM matches
  ORDER BY session_id, attributed_at DESC NULLS LAST, order_row_id
),
updated AS (
  UPDATE visitor_sessions vs
     SET cart_converted = true,
         order_id = deduped_matches.shopify_order_id,
         became_customer_in_session = COALESCE(vs.segment_at_session_start <> 'returning_customer', true),
         became_customer_at = CASE
           WHEN COALESCE(vs.segment_at_session_start <> 'returning_customer', true)
             THEN deduped_matches.attributed_at
           ELSE NULL
         END,
         updated_at = NOW()
    FROM deduped_matches
   WHERE vs.id::text = deduped_matches.session_id
     AND (vs.order_id IS NULL OR vs.order_id = deduped_matches.shopify_order_id)
   RETURNING deduped_matches.order_row_id
)
SELECT DISTINCT order_row_id FROM updated
`
