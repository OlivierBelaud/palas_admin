export interface OrderProjectionDb {
  raw<T = unknown>(query: string, params?: unknown[]): Promise<T[]>
}

export interface OrderProjectionAudit {
  projected_orders: number
  missing_cart_order_links: number
  missing_order_contact_links: number
  duplicate_order_contact_pairs: number
  orphan_cart_order_links: number
  orphan_order_contact_links: number
}

export interface OrderProjectionReconciliation {
  before: OrderProjectionAudit
  after: OrderProjectionAudit
  inserted_cart_order_links: number
  inserted_order_contact_links: number
  deleted_duplicate_links: number
  dry_run: boolean
}

export async function auditOrderProjection(db: OrderProjectionDb): Promise<OrderProjectionAudit> {
  const [summary] = await db.raw<Partial<OrderProjectionAudit>>(ORDER_PROJECTION_AUDIT_SQL)
  return normalizeAudit(summary)
}

export async function reconcileOrderProjectionLinks(
  db: OrderProjectionDb,
  options: { dryRun?: boolean } = {},
): Promise<OrderProjectionReconciliation> {
  const before = await auditOrderProjection(db)
  if (options.dryRun !== false) {
    return {
      before,
      after: before,
      inserted_cart_order_links: 0,
      inserted_order_contact_links: 0,
      deleted_duplicate_links: 0,
      dry_run: true,
    }
  }

  const [repair] = await db.raw<{
    inserted_cart_order_links?: number | string
    inserted_order_contact_links?: number | string
    deleted_duplicate_links?: number | string
  }>(ORDER_PROJECTION_REPAIR_SQL)
  const after = await auditOrderProjection(db)
  return {
    before,
    after,
    inserted_cart_order_links: Number(repair?.inserted_cart_order_links ?? 0),
    inserted_order_contact_links: Number(repair?.inserted_order_contact_links ?? 0),
    deleted_duplicate_links: Number(repair?.deleted_duplicate_links ?? 0),
    dry_run: false,
  }
}

function normalizeAudit(summary: Partial<OrderProjectionAudit> | undefined): OrderProjectionAudit {
  return {
    projected_orders: Number(summary?.projected_orders ?? 0),
    missing_cart_order_links: Number(summary?.missing_cart_order_links ?? 0),
    missing_order_contact_links: Number(summary?.missing_order_contact_links ?? 0),
    duplicate_order_contact_pairs: Number(summary?.duplicate_order_contact_pairs ?? 0),
    orphan_cart_order_links: Number(summary?.orphan_cart_order_links ?? 0),
    orphan_order_contact_links: Number(summary?.orphan_order_contact_links ?? 0),
  }
}

const ORDER_PROJECTION_AUDIT_SQL = `
WITH matching_contacts AS (
  SELECT
    o.id::text AS order_id,
    contact.id::text AS contact_id
  FROM orders o
  JOIN LATERAL (
    SELECT c.id
    FROM contacts c
    WHERE c.deleted_at IS NULL
      AND (
        (
          o.shopify_customer_id IS NOT NULL
          AND o.shopify_customer_id <> ''
          AND c.shopify_customer_id = o.shopify_customer_id
        ) OR (
          (o.shopify_customer_id IS NULL OR o.shopify_customer_id = '')
          AND o.email IS NOT NULL
          AND o.email <> ''
          AND LOWER(c.email) = LOWER(o.email)
        )
      )
    ORDER BY
      CASE WHEN c.shopify_customer_id = o.shopify_customer_id THEN 0 ELSE 1 END,
      c.updated_at DESC NULLS LAST
    LIMIT 1
  ) contact ON TRUE
  WHERE o.deleted_at IS NULL
),
summary AS (
  SELECT
    (SELECT count(*)::int FROM orders o WHERE o.deleted_at IS NULL) AS projected_orders,
    (
      SELECT count(*)::int
      FROM carts c
      JOIN orders o
        ON o.shopify_order_id = c.shopify_order_id
       AND o.deleted_at IS NULL
      LEFT JOIN cart_order co
        ON co.cart_id = c.id
       AND co.order_id = o.id::text
       AND co.deleted_at IS NULL
      WHERE c.deleted_at IS NULL
        AND c.shopify_order_id IS NOT NULL
        AND c.shopify_order_id <> ''
        AND co.id IS NULL
    ) AS missing_cart_order_links,
    (
      SELECT count(*)::int
      FROM matching_contacts match
      LEFT JOIN order_contact oc
        ON oc.order_id = match.order_id
       AND oc.contact_id = match.contact_id
       AND oc.deleted_at IS NULL
      WHERE oc.id IS NULL
    ) AS missing_order_contact_links,
    (
      SELECT count(*)::int
      FROM (
        SELECT order_id, contact_id
        FROM order_contact
        WHERE deleted_at IS NULL
        GROUP BY order_id, contact_id
        HAVING count(*) > 1
      ) duplicates
    ) AS duplicate_order_contact_pairs,
    (
      SELECT count(*)::int
      FROM cart_order co
      LEFT JOIN carts c ON c.id = co.cart_id AND c.deleted_at IS NULL
      LEFT JOIN orders o ON o.id::text = co.order_id AND o.deleted_at IS NULL
      WHERE co.deleted_at IS NULL
        AND (c.id IS NULL OR o.id IS NULL)
    ) AS orphan_cart_order_links,
    (
      SELECT count(*)::int
      FROM order_contact oc
      LEFT JOIN orders o ON o.id::text = oc.order_id AND o.deleted_at IS NULL
      LEFT JOIN contacts c ON c.id::text = oc.contact_id AND c.deleted_at IS NULL
      WHERE oc.deleted_at IS NULL
        AND (o.id IS NULL OR c.id IS NULL)
    ) AS orphan_order_contact_links
)
SELECT * FROM summary
`

const ORDER_PROJECTION_REPAIR_SQL = `
WITH deleted_duplicate_order_contacts AS (
  DELETE FROM order_contact duplicate
  USING order_contact keeper
  WHERE duplicate.deleted_at IS NULL
    AND keeper.deleted_at IS NULL
    AND duplicate.ctid < keeper.ctid
    AND duplicate.order_id = keeper.order_id
    AND duplicate.contact_id = keeper.contact_id
  RETURNING duplicate.id
),
inserted_cart_orders AS (
  INSERT INTO cart_order (id, cart_id, order_id, created_at, updated_at)
  SELECT gen_random_uuid(), c.id, o.id::text, NOW(), NOW()
  FROM carts c
  JOIN orders o
    ON o.shopify_order_id = c.shopify_order_id
   AND o.deleted_at IS NULL
  WHERE c.deleted_at IS NULL
    AND c.shopify_order_id IS NOT NULL
    AND c.shopify_order_id <> ''
  ON CONFLICT (cart_id, order_id) DO NOTHING
  RETURNING id
),
matching_contacts AS (
  SELECT
    o.id::text AS order_id,
    contact.id::text AS contact_id
  FROM orders o
  JOIN LATERAL (
    SELECT c.id
    FROM contacts c
    WHERE c.deleted_at IS NULL
      AND (
        (
          o.shopify_customer_id IS NOT NULL
          AND o.shopify_customer_id <> ''
          AND c.shopify_customer_id = o.shopify_customer_id
        ) OR (
          (o.shopify_customer_id IS NULL OR o.shopify_customer_id = '')
          AND o.email IS NOT NULL
          AND o.email <> ''
          AND LOWER(c.email) = LOWER(o.email)
        )
      )
    ORDER BY
      CASE WHEN c.shopify_customer_id = o.shopify_customer_id THEN 0 ELSE 1 END,
      c.updated_at DESC NULLS LAST
    LIMIT 1
  ) contact ON TRUE
  WHERE o.deleted_at IS NULL
),
inserted_order_contacts AS (
  INSERT INTO order_contact (id, order_id, contact_id, created_at, updated_at)
  SELECT gen_random_uuid(), match.order_id, match.contact_id, NOW(), NOW()
  FROM matching_contacts match
  ON CONFLICT (order_id, contact_id) WHERE deleted_at IS NULL DO NOTHING
  RETURNING id
)
SELECT
  (SELECT count(*)::int FROM inserted_cart_orders) AS inserted_cart_order_links,
  (SELECT count(*)::int FROM inserted_order_contacts) AS inserted_order_contact_links,
  (SELECT count(*)::int FROM deleted_duplicate_order_contacts) AS deleted_duplicate_links
`
