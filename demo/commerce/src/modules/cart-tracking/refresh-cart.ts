export interface RawDb {
  raw<T = unknown>(query: string, params?: unknown[]): Promise<T[]>
}

export interface CartRefreshKey {
  cart_id?: string | null
  cart_token?: string | null
  checkout_token?: string | null
  shopify_order_id?: string | null
  email?: string | null
}

export interface CartAuditSummary {
  carts: number
  missing_birth: number
  empty_items: number
  missing_email: number
  missing_distinct_id: number
  completed_stage: number
  completed_status: number
  carts_with_shopify_order: number
  completed_stage_non_completed_status: number
  completed_stage_missing_completed_at: number
  completed_at_non_completed_stage: number
  missing_cart_order_links: number
  missing_cart_contact_links: number
  duplicate_cart_contact_pairs: number
  missing_order_contact_links: number
  duplicate_order_contact_pairs: number
  duplicate_shopify_order_ids: number
  duplicate_shopify_order_extra_carts: number
  carts_with_multiple_orders: number
  orders_with_multiple_carts: number
  orphan_cart_order_links: number
  orphan_cart_contact_links: number
  orphan_order_contact_links: number
}

export interface RepairCartSnapshotsOptions {
  limit?: number
  dryRun?: boolean
}

export interface RepairCartSnapshotsResult {
  before: CartAuditSummary
  after: CartAuditSummary
  selected: number
  repaired: number
  merged_duplicate_order_carts: number
  dry_run: boolean
}

export interface RefreshCartResult {
  selected: number
  repaired: number
  dry_run: boolean
}

export async function auditCartSnapshots(db: RawDb): Promise<CartAuditSummary> {
  const [summary] = await db.raw<CartAuditSummary>(CART_AUDIT_SQL)
  return normalizeAuditSummary(summary)
}

export async function repairCartSnapshots(
  db: RawDb,
  options: RepairCartSnapshotsOptions = {},
): Promise<RepairCartSnapshotsResult> {
  const dryRun = options.dryRun === true
  const limit = Math.max(1, Math.min(options.limit ?? 500, 5000))
  const before = await auditCartSnapshots(db)
  const rows = await db.raw<{ id: string }>(CART_REPAIR_TARGETS_SQL, [limit])

  let mergedDuplicateOrderCarts = 0
  if (!dryRun) {
    await deleteOrphanLinks(db)
    mergedDuplicateOrderCarts += await mergeDuplicateShopifyOrderCarts(db)
    await dedupeCartOrderLinks(db)
    await dedupeCartContactLinks(db)
    await dedupeOrderContactLinks(db)
    for (const row of rows) {
      await repairOneCart(db, row.id)
    }
    await dedupeCartOrderLinks(db)
  }

  const after = await auditCartSnapshots(db)
  return {
    before,
    after,
    selected: rows.length + (dryRun ? before.duplicate_shopify_order_extra_carts : mergedDuplicateOrderCarts),
    repaired: dryRun ? 0 : rows.length + mergedDuplicateOrderCarts,
    merged_duplicate_order_carts: mergedDuplicateOrderCarts,
    dry_run: dryRun,
  }
}

export async function refreshCartSnapshot(
  db: RawDb,
  key: CartRefreshKey,
  options: { dryRun?: boolean; limit?: number } = {},
): Promise<RefreshCartResult> {
  const dryRun = options.dryRun === true
  const limit = Math.max(1, Math.min(options.limit ?? 50, 500))
  const rows = await selectCartsByKey(db, key, limit)
  if (!dryRun) {
    await deleteOrphanLinks(db)
    await dedupeCartOrderLinks(db)
    await dedupeCartContactLinks(db)
    await dedupeOrderContactLinks(db)
    for (const row of rows) {
      await repairOneCart(db, row.id)
    }
    await dedupeCartOrderLinks(db)
  }
  return { selected: rows.length, repaired: dryRun ? 0 : rows.length, dry_run: dryRun }
}

async function selectCartsByKey(db: RawDb, key: CartRefreshKey, limit: number): Promise<Array<{ id: string }>> {
  const email = key.email?.trim().toLowerCase() || null
  return db.raw<{ id: string }>(
    `SELECT id
       FROM carts
      WHERE ($1::text IS NOT NULL AND id = $1)
         OR ($2::text IS NOT NULL AND cart_token = $2)
         OR ($3::text IS NOT NULL AND checkout_token = $3)
         OR ($4::text IS NOT NULL AND shopify_order_id = $4)
         OR ($5::text IS NOT NULL AND LOWER(email) = $5)
      ORDER BY last_action_at DESC NULLS LAST, updated_at DESC NULLS LAST
      LIMIT $6`,
    [
      key.cart_id?.trim() || null,
      key.cart_token?.trim() || null,
      key.checkout_token?.trim() || null,
      key.shopify_order_id?.trim() || null,
      email,
      limit,
    ],
  )
}

async function repairOneCart(db: RawDb, cartId: string): Promise<void> {
  await db.raw(
    `UPDATE carts c
        SET highest_stage = CASE
              WHEN c.shopify_order_id IS NOT NULL AND c.shopify_order_id <> '' THEN 'completed'
              WHEN c.completed_at IS NOT NULL THEN 'completed'
              ELSE c.highest_stage
            END,
            status = CASE
              WHEN c.shopify_order_id IS NOT NULL AND c.shopify_order_id <> '' THEN 'completed'
              WHEN c.highest_stage = 'completed' THEN 'completed'
              WHEN c.completed_at IS NOT NULL THEN 'completed'
              ELSE c.status
            END,
            completed_at = CASE
              WHEN c.shopify_order_id IS NOT NULL AND c.shopify_order_id <> ''
                THEN COALESCE(c.completed_at, o.placed_at, c.last_action_at)
              WHEN c.highest_stage = 'completed' OR c.status = 'completed'
                THEN COALESCE(c.completed_at, c.last_action_at)
              ELSE c.completed_at
            END,
            cart_birth_at = COALESCE(c.cart_birth_at, c.last_action_at, c.created_at),
            updated_at = NOW()
       FROM orders o
      WHERE c.id = $1
        AND o.shopify_order_id = c.shopify_order_id`,
    [cartId],
  )

  await db.raw(
    `UPDATE carts
        SET highest_stage = CASE
              WHEN completed_at IS NOT NULL OR status = 'completed' THEN 'completed'
              ELSE highest_stage
            END,
            status = CASE
              WHEN highest_stage = 'completed' OR completed_at IS NOT NULL THEN 'completed'
              ELSE status
            END,
            completed_at = CASE
              WHEN highest_stage = 'completed' OR status = 'completed'
                THEN COALESCE(completed_at, last_action_at)
              ELSE completed_at
            END,
            cart_birth_at = COALESCE(cart_birth_at, last_action_at, created_at),
            updated_at = NOW()
      WHERE id = $1`,
    [cartId],
  )

  await db.raw(
    `INSERT INTO cart_order (id, cart_id, order_id, created_at, updated_at)
     SELECT gen_random_uuid(), c.id, o.id::text, NOW(), NOW()
       FROM carts c
       JOIN orders o ON o.shopify_order_id = c.shopify_order_id
     WHERE c.id = $1
        AND c.shopify_order_id IS NOT NULL
        AND c.shopify_order_id <> ''
        AND NOT EXISTS (
          SELECT 1 FROM cart_order existing_order
           WHERE existing_order.order_id = o.id::text
             AND existing_order.cart_id <> c.id
        )
     ON CONFLICT (cart_id, order_id) DO NOTHING`,
    [cartId],
  )

  await db.raw(
    `DELETE FROM cart_contact cc
      USING contacts c, carts cart
      WHERE cc.cart_id = cart.id
        AND cart.id = $1
        AND LOWER(c.email) = LOWER(cart.email)
        AND cc.contact_id <> c.id::text`,
    [cartId],
  )

  await db.raw(
    `INSERT INTO cart_contact (id, cart_id, contact_id, created_at, updated_at)
     SELECT gen_random_uuid(), c.id, contact.id::text, NOW(), NOW()
       FROM carts c
       JOIN contacts contact ON LOWER(contact.email) = LOWER(c.email)
      WHERE c.id = $1
        AND c.email IS NOT NULL
        AND c.email <> ''
        AND NOT EXISTS (
          SELECT 1 FROM cart_contact existing
           WHERE existing.cart_id = c.id
             AND existing.contact_id = contact.id::text
        )`,
    [cartId],
  )

  await db.raw(
    `INSERT INTO order_contact (id, order_id, contact_id, created_at, updated_at)
     SELECT gen_random_uuid(), o.id::text, contact.id::text, NOW(), NOW()
       FROM carts c
       JOIN orders o ON o.shopify_order_id = c.shopify_order_id
       JOIN contacts contact ON (
         LOWER(contact.email) = LOWER(COALESCE(o.email, c.email))
         OR (
           o.shopify_customer_id IS NOT NULL
           AND o.shopify_customer_id <> ''
           AND contact.shopify_customer_id = o.shopify_customer_id
         )
         OR (
           c.shopify_customer_id IS NOT NULL
           AND c.shopify_customer_id <> ''
           AND contact.shopify_customer_id = c.shopify_customer_id
         )
       )
      WHERE c.id = $1
        AND NOT EXISTS (
          SELECT 1 FROM order_contact existing
           WHERE existing.order_id = o.id::text
             AND existing.contact_id = contact.id::text
        )`,
    [cartId],
  )

  await db.raw(
    `DELETE FROM cart_contact a
      USING cart_contact b
      WHERE a.ctid < b.ctid
        AND a.cart_id = b.cart_id
        AND a.contact_id = b.contact_id
        AND a.cart_id = $1`,
    [cartId],
  )
}

async function dedupeCartContactLinks(db: RawDb): Promise<void> {
  await db.raw(`
    DELETE FROM cart_contact a
     USING cart_contact b
     WHERE a.ctid < b.ctid
       AND a.cart_id = b.cart_id
       AND a.contact_id = b.contact_id
  `)
}

async function mergeDuplicateShopifyOrderCarts(db: RawDb): Promise<number> {
  const rows = await db.raw<{ deleted_duplicate_carts: string }>(`
    WITH ranked AS (
      SELECT
        c.*,
        o.id::text AS order_pk,
        o.total_price AS order_total,
        row_number() OVER (
          PARTITION BY c.shopify_order_id
          ORDER BY
            abs(coalesce(c.total_price, 0) - coalesce(o.total_price, 0)) ASC NULLS LAST,
            c.item_count DESC NULLS LAST,
            CASE WHEN c.checkout_token IS NOT NULL AND c.checkout_token <> '' THEN 0 ELSE 1 END,
            c.completed_at DESC NULLS LAST,
            c.last_action_at DESC NULLS LAST,
            c.updated_at DESC
        ) AS rn
      FROM carts c
      LEFT JOIN orders o ON o.shopify_order_id = c.shopify_order_id
      WHERE c.shopify_order_id IS NOT NULL
        AND c.shopify_order_id <> ''
    ),
    mapped AS (
      SELECT
        loser.id AS loser_id,
        keeper.id AS keeper_id,
        loser.shopify_order_id,
        loser.order_pk
      FROM ranked loser
      JOIN ranked keeper
        ON keeper.shopify_order_id = loser.shopify_order_id
       AND keeper.rn = 1
      WHERE loser.rn > 1
    ),
    loser_rollup AS (
      SELECT
        m.keeper_id,
        min(l.cart_birth_at) AS min_birth,
        max(l.last_action_at) AS max_last_action_at,
        max(l.completed_at) AS max_completed_at,
        max(l.distinct_id) FILTER (WHERE l.distinct_id IS NOT NULL AND l.distinct_id <> '') AS any_distinct_id,
        max(l.email) FILTER (WHERE l.email IS NOT NULL AND l.email <> '') AS any_email,
        max(l.first_name) FILTER (WHERE l.first_name IS NOT NULL AND l.first_name <> '') AS any_first_name,
        max(l.last_name) FILTER (WHERE l.last_name IS NOT NULL AND l.last_name <> '') AS any_last_name,
        max(l.phone) FILTER (WHERE l.phone IS NOT NULL AND l.phone <> '') AS any_phone,
        max(l.city) FILTER (WHERE l.city IS NOT NULL AND l.city <> '') AS any_city,
        max(l.country_code) FILTER (WHERE l.country_code IS NOT NULL AND l.country_code <> '') AS any_country_code,
        max(l.shopify_customer_id) FILTER (
          WHERE l.shopify_customer_id IS NOT NULL AND l.shopify_customer_id <> ''
        ) AS any_shopify_customer_id
      FROM mapped m
      JOIN carts l ON l.id = m.loser_id
      GROUP BY m.keeper_id
    ),
    updated_keepers AS (
      UPDATE carts k
         SET cart_birth_at = LEAST(k.cart_birth_at, r.min_birth),
             last_action_at = GREATEST(k.last_action_at, r.max_last_action_at),
             completed_at = COALESCE(k.completed_at, r.max_completed_at),
             distinct_id = COALESCE(NULLIF(k.distinct_id, ''), r.any_distinct_id),
             email = COALESCE(NULLIF(k.email, ''), r.any_email),
             first_name = COALESCE(NULLIF(k.first_name, ''), r.any_first_name),
             last_name = COALESCE(NULLIF(k.last_name, ''), r.any_last_name),
             phone = COALESCE(NULLIF(k.phone, ''), r.any_phone),
             city = COALESCE(NULLIF(k.city, ''), r.any_city),
             country_code = COALESCE(NULLIF(k.country_code, ''), r.any_country_code),
             shopify_customer_id = COALESCE(NULLIF(k.shopify_customer_id, ''), r.any_shopify_customer_id),
             highest_stage = 'completed',
             status = 'completed',
             updated_at = NOW()
        FROM loser_rollup r
       WHERE k.id = r.keeper_id
       RETURNING k.id
    ),
    moved_cart_contacts AS (
      UPDATE cart_contact cc
         SET cart_id = m.keeper_id, updated_at = NOW()
        FROM mapped m
       WHERE cc.cart_id = m.loser_id
       RETURNING cc.id
    ),
    deleted_duplicate_cart_contacts AS (
      DELETE FROM cart_contact a
       USING cart_contact b
       WHERE a.ctid < b.ctid
         AND a.cart_id = b.cart_id
         AND a.contact_id = b.contact_id
       RETURNING a.id
    ),
    deleted_loser_cart_orders AS (
      DELETE FROM cart_order co
       USING mapped m
       WHERE co.cart_id = m.loser_id
       RETURNING co.id
    ),
    inserted_keeper_cart_orders AS (
      INSERT INTO cart_order (id, cart_id, order_id, created_at, updated_at)
      SELECT gen_random_uuid(), m.keeper_id, m.order_pk, NOW(), NOW()
        FROM mapped m
       WHERE m.order_pk IS NOT NULL
      ON CONFLICT (cart_id, order_id) DO NOTHING
      RETURNING id
    ),
    deleted_loser_carts AS (
      DELETE FROM carts c
       USING mapped m
       WHERE c.id = m.loser_id
       RETURNING c.id
    )
    SELECT count(*)::text AS deleted_duplicate_carts FROM deleted_loser_carts
  `)
  return Number(rows[0]?.deleted_duplicate_carts ?? 0)
}

async function dedupeCartOrderLinks(db: RawDb): Promise<void> {
  await db.raw(`
    WITH ranked AS (
      SELECT
        co.ctid,
        row_number() OVER (
          PARTITION BY co.order_id
          ORDER BY
            CASE WHEN c.shopify_order_id = o.shopify_order_id THEN 0 ELSE 1 END,
            CASE WHEN c.highest_stage = 'completed' THEN 0 ELSE 1 END,
            c.completed_at DESC NULLS LAST,
            c.last_action_at DESC NULLS LAST,
            co.created_at ASC
        ) AS rn_for_order,
        row_number() OVER (
          PARTITION BY co.cart_id
          ORDER BY
            o.placed_at DESC NULLS LAST,
            co.created_at ASC
        ) AS rn_for_cart
      FROM cart_order co
      LEFT JOIN carts c ON c.id = co.cart_id
      LEFT JOIN orders o ON o.id::text = co.order_id
    )
    DELETE FROM cart_order co
     USING ranked r
     WHERE co.ctid = r.ctid
       AND (r.rn_for_order > 1 OR r.rn_for_cart > 1)
  `)
}

async function dedupeOrderContactLinks(db: RawDb): Promise<void> {
  await db.raw(`
    DELETE FROM order_contact a
     USING order_contact b
     WHERE a.ctid < b.ctid
       AND a.order_id = b.order_id
       AND a.contact_id = b.contact_id
  `)
}

async function deleteOrphanLinks(db: RawDb): Promise<void> {
  await db.raw(`
    DELETE FROM cart_order co
     WHERE NOT EXISTS (SELECT 1 FROM carts c WHERE c.id = co.cart_id)
        OR NOT EXISTS (SELECT 1 FROM orders o WHERE o.id::text = co.order_id)
  `)
  await db.raw(`
    DELETE FROM cart_contact cc
     WHERE NOT EXISTS (SELECT 1 FROM carts c WHERE c.id = cc.cart_id)
        OR NOT EXISTS (SELECT 1 FROM contacts contact WHERE contact.id::text = cc.contact_id)
  `)
  await db.raw(`
    DELETE FROM order_contact oc
     WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.id::text = oc.order_id)
        OR NOT EXISTS (SELECT 1 FROM contacts contact WHERE contact.id::text = oc.contact_id)
  `)
}

function normalizeAuditSummary(summary: CartAuditSummary | undefined): CartAuditSummary {
  const value = summary ?? ({} as Partial<CartAuditSummary>)
  return {
    carts: Number(value.carts ?? 0),
    missing_birth: Number(value.missing_birth ?? 0),
    empty_items: Number(value.empty_items ?? 0),
    missing_email: Number(value.missing_email ?? 0),
    missing_distinct_id: Number(value.missing_distinct_id ?? 0),
    completed_stage: Number(value.completed_stage ?? 0),
    completed_status: Number(value.completed_status ?? 0),
    carts_with_shopify_order: Number(value.carts_with_shopify_order ?? 0),
    completed_stage_non_completed_status: Number(value.completed_stage_non_completed_status ?? 0),
    completed_stage_missing_completed_at: Number(value.completed_stage_missing_completed_at ?? 0),
    completed_at_non_completed_stage: Number(value.completed_at_non_completed_stage ?? 0),
    missing_cart_order_links: Number(value.missing_cart_order_links ?? 0),
    missing_cart_contact_links: Number(value.missing_cart_contact_links ?? 0),
    duplicate_cart_contact_pairs: Number(value.duplicate_cart_contact_pairs ?? 0),
    missing_order_contact_links: Number(value.missing_order_contact_links ?? 0),
    duplicate_order_contact_pairs: Number(value.duplicate_order_contact_pairs ?? 0),
    duplicate_shopify_order_ids: Number(value.duplicate_shopify_order_ids ?? 0),
    duplicate_shopify_order_extra_carts: Number(value.duplicate_shopify_order_extra_carts ?? 0),
    carts_with_multiple_orders: Number(value.carts_with_multiple_orders ?? 0),
    orders_with_multiple_carts: Number(value.orders_with_multiple_carts ?? 0),
    orphan_cart_order_links: Number(value.orphan_cart_order_links ?? 0),
    orphan_cart_contact_links: Number(value.orphan_cart_contact_links ?? 0),
    orphan_order_contact_links: Number(value.orphan_order_contact_links ?? 0),
  }
}

const CART_AUDIT_SQL = `
WITH base AS (
  SELECT
    count(*)::int AS carts,
    count(*) FILTER (WHERE cart_birth_at IS NULL)::int AS missing_birth,
    count(*) FILTER (WHERE items IS NULL OR items = '[]'::jsonb)::int AS empty_items,
    count(*) FILTER (WHERE email IS NULL OR email = '')::int AS missing_email,
    count(*) FILTER (WHERE distinct_id IS NULL OR distinct_id = '')::int AS missing_distinct_id,
    count(*) FILTER (WHERE highest_stage = 'completed')::int AS completed_stage,
    count(*) FILTER (WHERE status = 'completed')::int AS completed_status,
    count(*) FILTER (WHERE shopify_order_id IS NOT NULL AND shopify_order_id <> '')::int AS carts_with_shopify_order,
    count(*) FILTER (WHERE highest_stage = 'completed' AND status <> 'completed')::int AS completed_stage_non_completed_status,
    count(*) FILTER (WHERE highest_stage = 'completed' AND completed_at IS NULL)::int AS completed_stage_missing_completed_at,
    count(*) FILTER (WHERE completed_at IS NOT NULL AND highest_stage <> 'completed')::int AS completed_at_non_completed_stage
  FROM carts
),
cart_orders AS (
  SELECT
    count(*) FILTER (
      WHERE c.shopify_order_id IS NOT NULL
        AND c.shopify_order_id <> ''
        AND o.id IS NOT NULL
        AND co.cart_id IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM cart_order any_co
           WHERE any_co.order_id = o.id::text
        )
    )::int AS missing_cart_order_links
  FROM carts c
  LEFT JOIN orders o ON o.shopify_order_id = c.shopify_order_id
  LEFT JOIN cart_order co ON co.cart_id = c.id AND co.order_id = o.id::text
),
cart_contacts AS (
  SELECT
    count(*) FILTER (
      WHERE c.email IS NOT NULL
        AND c.email <> ''
        AND contact.id IS NOT NULL
        AND cc.cart_id IS NULL
    )::int AS missing_cart_contact_links
  FROM carts c
  LEFT JOIN contacts contact ON LOWER(contact.email) = LOWER(c.email)
  LEFT JOIN cart_contact cc ON cc.cart_id = c.id AND cc.contact_id = contact.id::text
),
order_contacts AS (
  SELECT
    count(*) FILTER (
      WHERE o.id IS NOT NULL
        AND contact.id IS NOT NULL
        AND oc.order_id IS NULL
    )::int AS missing_order_contact_links
  FROM carts c
  LEFT JOIN orders o ON o.shopify_order_id = c.shopify_order_id
  LEFT JOIN contacts contact ON (
    LOWER(contact.email) = LOWER(COALESCE(o.email, c.email))
    OR (
      o.shopify_customer_id IS NOT NULL
      AND o.shopify_customer_id <> ''
      AND contact.shopify_customer_id = o.shopify_customer_id
    )
    OR (
      c.shopify_customer_id IS NOT NULL
      AND c.shopify_customer_id <> ''
      AND contact.shopify_customer_id = c.shopify_customer_id
    )
  )
  LEFT JOIN order_contact oc ON oc.order_id = o.id::text AND oc.contact_id = contact.id::text
),
duplicates AS (
  SELECT
    (SELECT count(*)::int FROM (
      SELECT cart_id, contact_id FROM cart_contact GROUP BY cart_id, contact_id HAVING count(*) > 1
    ) d) AS duplicate_cart_contact_pairs,
    (SELECT count(*)::int FROM (
      SELECT order_id, contact_id FROM order_contact GROUP BY order_id, contact_id HAVING count(*) > 1
    ) d) AS duplicate_order_contact_pairs,
    (SELECT count(*)::int FROM (
      SELECT shopify_order_id FROM carts
      WHERE shopify_order_id IS NOT NULL AND shopify_order_id <> ''
      GROUP BY shopify_order_id HAVING count(*) > 1
    ) d) AS duplicate_shopify_order_ids,
    (SELECT COALESCE(sum(cnt - 1), 0)::int FROM (
      SELECT count(*) AS cnt FROM carts
      WHERE shopify_order_id IS NOT NULL AND shopify_order_id <> ''
      GROUP BY shopify_order_id HAVING count(*) > 1
    ) d) AS duplicate_shopify_order_extra_carts,
    (SELECT count(*)::int FROM (
      SELECT cart_id FROM cart_order GROUP BY cart_id HAVING count(DISTINCT order_id) > 1
    ) d) AS carts_with_multiple_orders,
    (SELECT count(*)::int FROM (
      SELECT order_id FROM cart_order GROUP BY order_id HAVING count(DISTINCT cart_id) > 1
    ) d) AS orders_with_multiple_carts
),
orphans AS (
  SELECT
    (SELECT count(*)::int
       FROM cart_order co
       LEFT JOIN carts c ON c.id = co.cart_id
       LEFT JOIN orders o ON o.id::text = co.order_id
      WHERE c.id IS NULL OR o.id IS NULL) AS orphan_cart_order_links,
    (SELECT count(*)::int
       FROM cart_contact cc
       LEFT JOIN carts c ON c.id = cc.cart_id
       LEFT JOIN contacts contact ON contact.id::text = cc.contact_id
      WHERE c.id IS NULL OR contact.id IS NULL) AS orphan_cart_contact_links,
    (SELECT count(*)::int
       FROM order_contact oc
       LEFT JOIN orders o ON o.id::text = oc.order_id
       LEFT JOIN contacts contact ON contact.id::text = oc.contact_id
      WHERE o.id IS NULL OR contact.id IS NULL) AS orphan_order_contact_links
)
SELECT *
FROM base
CROSS JOIN cart_orders
CROSS JOIN cart_contacts
CROSS JOIN order_contacts
CROSS JOIN duplicates
CROSS JOIN orphans
`

const CART_REPAIR_TARGETS_SQL = `
WITH linked AS (
  SELECT
    c.id,
    o.id::text AS order_id,
    contact.id::text AS contact_id,
    order_contact_source.id::text AS order_contact_source_id,
    order_contact.id AS order_contact_id,
    existing_order_link.order_id AS existing_order_link_id,
    co.cart_id AS cart_order_cart_id,
    cc.cart_id AS cart_contact_cart_id
  FROM carts c
  LEFT JOIN orders o ON o.shopify_order_id = c.shopify_order_id
  LEFT JOIN contacts contact ON LOWER(contact.email) = LOWER(c.email)
  LEFT JOIN contacts order_contact_source ON (
    LOWER(order_contact_source.email) = LOWER(COALESCE(o.email, c.email))
    OR (
      o.shopify_customer_id IS NOT NULL
      AND o.shopify_customer_id <> ''
      AND order_contact_source.shopify_customer_id = o.shopify_customer_id
    )
    OR (
      c.shopify_customer_id IS NOT NULL
      AND c.shopify_customer_id <> ''
      AND order_contact_source.shopify_customer_id = c.shopify_customer_id
    )
  )
  LEFT JOIN cart_order existing_order_link ON existing_order_link.order_id = o.id::text
  LEFT JOIN cart_order co ON co.cart_id = c.id AND co.order_id = o.id::text
  LEFT JOIN cart_contact cc ON cc.cart_id = c.id AND cc.contact_id = contact.id::text
  LEFT JOIN order_contact order_contact
    ON order_contact.order_id = o.id::text
   AND order_contact.contact_id = order_contact_source.id::text
)
SELECT DISTINCT id
FROM linked
WHERE id IN (
  SELECT id FROM carts
  WHERE cart_birth_at IS NULL
     OR (highest_stage = 'completed' AND status <> 'completed')
     OR (highest_stage = 'completed' AND completed_at IS NULL)
     OR (completed_at IS NOT NULL AND highest_stage <> 'completed')
     OR (shopify_order_id IS NOT NULL AND shopify_order_id <> '' AND highest_stage <> 'completed')
)
   OR (order_id IS NOT NULL AND existing_order_link_id IS NULL AND cart_order_cart_id IS NULL)
   OR (contact_id IS NOT NULL AND cart_contact_cart_id IS NULL)
   OR (order_id IS NOT NULL AND order_contact_source_id IS NOT NULL AND order_contact_id IS NULL)
ORDER BY id
LIMIT $1
`
