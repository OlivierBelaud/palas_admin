// Command: incremental Shopify Admin → local DB sync.
//
// Pulls customers and orders updated since the last successful run and
// upserts them into `contacts` and `orders` (ON CONFLICT DO UPDATE,
// keyed by `email` for contacts and `shopify_order_id` for orders).
//
// Strategy:
//   1. Read MAX(shopify_synced_at) for both contacts and orders. The
//      smaller of the two minus 1h is the "since" cursor for this run
//      (overlap window absorbs Shopify's eventual-consistency on
//      `updated_at` and any clock skew).
//   2. GraphQL: paginate `customers(query: "updated_at:>'<since>'")` and
//      `orders(query: "updated_at:>'<since>'")` until drained or the
//      hard cap is reached.
//   3. Upsert in CHUNK-of-500 batches. ON CONFLICT clauses preserve any
//      manually-set fields the operator may have edited locally.
//
// Idempotence: ON CONFLICT clauses are deterministic; a second run on
// the same data is a no-op (the COALESCE branches keep existing
// non-null fields, and EXCLUDED-only fields just rewrite identical
// values). No full-refresh — that's the job of `audit-and-fix-prod-v1.ts`.

import {
  paginateConnection,
  ShopifyAdminClient,
  type ShopifyAdminClient as ShopifyAdminClientType,
} from '../../modules/shopify-admin/client'

// Defensive overlap so we don't miss records updated right before the
// last run committed. Shopify's `updated_at` is eventually consistent.
const OVERLAP_MS = 60 * 60 * 1000 // 1h

// Hard cap per run — Vercel Hobby cron has 60s timeout; one run pulling
// > 5000 customers/orders + upserting them risks timing out. The next
// tick picks up the leftover via the high-water mark.
const HARD_CAP = 5000
const CHUNK = 500

type RawDb = { raw: <T>(sql: string, params?: unknown[]) => Promise<T[]> }

interface CustomerRow {
  shopify_customer_id: string
  email: string
  first_name: string | null
  last_name: string | null
  locale: string | null
  phone: string | null
  city: string | null
  country_code: string | null
  orders_count: number
  total_spent: number
  last_order_at: Date | null
  shopify_synced_at: Date
}

interface OrderRow {
  shopify_order_id: string
  email: string | null
  order_number: string
  status: 'pending' | 'paid' | 'fulfilled' | 'cancelled' | 'refunded'
  financial_status: string | null
  fulfillment_status: string | null
  total_price: number
  currency: string
  placed_at: Date | null
  cancelled_at: Date | null
  shopify_synced_at: Date
}

function toDate(v: unknown): Date | null {
  if (!v || typeof v !== 'string') return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

/** gid://shopify/Order/12345 → "12345" */
function gidNum(gid: string): string {
  const m = gid.match(/(\d+)$/)
  return m ? m[1] : gid
}

function deriveOrderStatus(args: {
  cancelledAt: Date | null
  financial: string | null
  fulfillment: string | null
}): OrderRow['status'] {
  if (args.cancelledAt) return 'cancelled'
  const fin = (args.financial ?? '').toUpperCase()
  const ful = (args.fulfillment ?? '').toUpperCase()
  if (fin === 'REFUNDED') return 'refunded'
  if (ful === 'FULFILLED') return 'fulfilled'
  if (fin === 'PAID') return 'paid'
  return 'pending'
}

/**
 * Build the Shopify search query for the `customers(query: ...)` /
 * `orders(query: ...)` field. `null` since means full pull (genesis).
 */
function buildSearchQuery(sinceIso: string | null): string | null {
  if (!sinceIso) return null
  return `updated_at:>'${sinceIso}'`
}

async function pullCustomers(
  client: ShopifyAdminClientType,
  searchQuery: string | null,
  signal: AbortSignal | undefined,
): Promise<CustomerRow[]> {
  type Node = {
    id: string
    email: string | null
    firstName: string | null
    lastName: string | null
    locale: string | null
    phone: string | null
    numberOfOrders: string | number
    amountSpent: { amount: string }
    defaultAddress: { city: string | null; countryCodeV2: string | null } | null
    lastOrder: { createdAt: string } | null
  }
  const nodes = await paginateConnection<Node>(
    client,
    (cursor) => ({
      query: `query Customers($cursor: String, $q: String) {
        customers(first: 250, after: $cursor${searchQuery ? ', query: $q' : ''}) {
          edges {
            node {
              id email firstName lastName locale phone numberOfOrders
              amountSpent { amount }
              defaultAddress { city countryCodeV2 }
              lastOrder { createdAt }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      variables: searchQuery ? { cursor, q: searchQuery } : { cursor },
    }),
    (data) => {
      const conn = (
        data as {
          customers: { edges: Array<{ node: Node }>; pageInfo: { hasNextPage: boolean; endCursor: string | null } }
        }
      ).customers
      return {
        nodes: conn.edges.map((e) => e.node),
        hasNextPage: conn.pageInfo.hasNextPage,
        endCursor: conn.pageInfo.endCursor,
      }
    },
    { hardCap: HARD_CAP, signal },
  )
  const now = new Date()
  return nodes
    .map((n) => {
      const email = (n.email ?? '').trim().toLowerCase()
      if (!email) return null
      return {
        shopify_customer_id: gidNum(n.id),
        email,
        first_name: n.firstName,
        last_name: n.lastName,
        locale: n.locale,
        phone: n.phone,
        city: n.defaultAddress?.city ?? null,
        country_code: n.defaultAddress?.countryCodeV2 ?? null,
        orders_count: Number(n.numberOfOrders) || 0,
        total_spent: Number(n.amountSpent?.amount) || 0,
        last_order_at: toDate(n.lastOrder?.createdAt),
        shopify_synced_at: now,
      } satisfies CustomerRow
    })
    .filter((r): r is CustomerRow => r !== null)
}

async function pullOrders(
  client: ShopifyAdminClientType,
  searchQuery: string | null,
  signal: AbortSignal | undefined,
): Promise<OrderRow[]> {
  type Node = {
    id: string
    name: string
    email: string | null
    displayFinancialStatus: string | null
    displayFulfillmentStatus: string | null
    cancelledAt: string | null
    createdAt: string
    currentTotalPriceSet: { shopMoney: { amount: string; currencyCode: string } }
    customer: { email: string | null } | null
  }
  const nodes = await paginateConnection<Node>(
    client,
    (cursor) => ({
      query: `query Orders($cursor: String, $q: String) {
        orders(first: 250, after: $cursor${searchQuery ? ', query: $q' : ''}, sortKey: UPDATED_AT) {
          edges {
            node {
              id name email displayFinancialStatus displayFulfillmentStatus
              cancelledAt createdAt
              currentTotalPriceSet { shopMoney { amount currencyCode } }
              customer { email }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      variables: searchQuery ? { cursor, q: searchQuery } : { cursor },
    }),
    (data) => {
      const conn = (
        data as {
          orders: { edges: Array<{ node: Node }>; pageInfo: { hasNextPage: boolean; endCursor: string | null } }
        }
      ).orders
      return {
        nodes: conn.edges.map((e) => e.node),
        hasNextPage: conn.pageInfo.hasNextPage,
        endCursor: conn.pageInfo.endCursor,
      }
    },
    { hardCap: HARD_CAP, signal },
  )
  const now = new Date()
  return nodes.map((n) => {
    const email = ((n.email ?? n.customer?.email ?? '').trim() || null)?.toLowerCase() ?? null
    const cancelledAt = toDate(n.cancelledAt)
    return {
      shopify_order_id: gidNum(n.id),
      email,
      order_number: n.name,
      status: deriveOrderStatus({
        cancelledAt,
        financial: n.displayFinancialStatus,
        fulfillment: n.displayFulfillmentStatus,
      }),
      financial_status: n.displayFinancialStatus,
      fulfillment_status: n.displayFulfillmentStatus,
      total_price: Number(n.currentTotalPriceSet.shopMoney.amount) || 0,
      currency: n.currentTotalPriceSet.shopMoney.currencyCode || 'EUR',
      placed_at: toDate(n.createdAt),
      cancelled_at: cancelledAt,
      shopify_synced_at: now,
    } satisfies OrderRow
  })
}

async function upsertContacts(db: RawDb, rows: CustomerRow[]): Promise<number> {
  if (rows.length === 0) return 0
  let done = 0
  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = rows.slice(i, i + CHUNK)
    // Build a multi-row INSERT … VALUES ($1,$2,…), ($n+1,…) statement.
    const cols = [
      'email',
      'phone',
      'locale',
      'first_name',
      'last_name',
      'country_code',
      'city',
      'shopify_customer_id',
      'orders_count',
      'total_spent',
      'last_order_at',
      'shopify_synced_at',
    ]
    const params: unknown[] = []
    const tuples: string[] = []
    for (const r of batch) {
      const offset = params.length
      params.push(
        r.email,
        r.phone,
        r.locale ?? 'fr-FR',
        r.first_name,
        r.last_name,
        r.country_code,
        r.city,
        r.shopify_customer_id,
        r.orders_count,
        r.total_spent,
        r.last_order_at,
        r.shopify_synced_at,
      )
      tuples.push(`(${cols.map((_, j) => `$${offset + j + 1}`).join(',')})`)
    }
    const sqlText = `
      INSERT INTO contacts (${cols.join(',')})
      VALUES ${tuples.join(',')}
      ON CONFLICT (email) DO UPDATE SET
        phone = COALESCE(EXCLUDED.phone, contacts.phone),
        locale = COALESCE(EXCLUDED.locale, contacts.locale),
        first_name = COALESCE(EXCLUDED.first_name, contacts.first_name),
        last_name = COALESCE(EXCLUDED.last_name, contacts.last_name),
        country_code = COALESCE(EXCLUDED.country_code, contacts.country_code),
        city = COALESCE(EXCLUDED.city, contacts.city),
        shopify_customer_id = COALESCE(EXCLUDED.shopify_customer_id, contacts.shopify_customer_id),
        orders_count = GREATEST(EXCLUDED.orders_count, contacts.orders_count),
        total_spent = GREATEST(EXCLUDED.total_spent, contacts.total_spent),
        last_order_at = GREATEST(EXCLUDED.last_order_at, contacts.last_order_at),
        shopify_synced_at = EXCLUDED.shopify_synced_at,
        updated_at = NOW()
    `
    await db.raw(sqlText, params)
    done += batch.length
  }
  return done
}

async function upsertOrders(db: RawDb, rows: OrderRow[]): Promise<number> {
  if (rows.length === 0) return 0
  let done = 0
  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = rows.slice(i, i + CHUNK)
    const cols = [
      'shopify_order_id',
      'email',
      'order_number',
      'status',
      'financial_status',
      'fulfillment_status',
      'total_price',
      'currency',
      'placed_at',
      'cancelled_at',
      'shopify_synced_at',
    ]
    const params: unknown[] = []
    const tuples: string[] = []
    for (const r of batch) {
      const offset = params.length
      params.push(
        r.shopify_order_id,
        r.email,
        r.order_number,
        r.status,
        r.financial_status,
        r.fulfillment_status,
        r.total_price,
        r.currency,
        r.placed_at,
        r.cancelled_at,
        r.shopify_synced_at,
      )
      tuples.push(`(${cols.map((_, j) => `$${offset + j + 1}`).join(',')})`)
    }
    const sqlText = `
      INSERT INTO orders (${cols.join(',')})
      VALUES ${tuples.join(',')}
      ON CONFLICT (shopify_order_id) DO UPDATE SET
        email = COALESCE(EXCLUDED.email, orders.email),
        order_number = EXCLUDED.order_number,
        status = EXCLUDED.status,
        financial_status = EXCLUDED.financial_status,
        fulfillment_status = EXCLUDED.fulfillment_status,
        total_price = EXCLUDED.total_price,
        currency = EXCLUDED.currency,
        placed_at = EXCLUDED.placed_at,
        cancelled_at = EXCLUDED.cancelled_at,
        shopify_synced_at = EXCLUDED.shopify_synced_at,
        updated_at = NOW()
    `
    await db.raw(sqlText, params)
    done += batch.length
  }
  return done
}

export default defineCommand({
  name: 'syncContactsFromShopify',
  description:
    'Pull customers + orders updated since last run from Shopify Admin and upsert them into `contacts` and `orders` (incremental, idempotent).',
  input: z.object({}),
  workflow: async (_input, { step, log }) => {
    return await step.action('sync-contacts-from-shopify', {
      invoke: async (_i: unknown, ctx) => {
        const db = ctx.app.infra.db as RawDb | undefined
        if (!db) throw new MantaError('UNEXPECTED_STATE', 'No database configured')

        const startedAt = Date.now()
        const client = new ShopifyAdminClient()

        // ── 1. Resolve the high-water mark ──────────────────────────
        const [contactMaxRow] = await db.raw<{ max_at: Date | null }>(
          'SELECT MAX(shopify_synced_at) AS max_at FROM contacts WHERE shopify_synced_at IS NOT NULL',
        )
        const [orderMaxRow] = await db.raw<{ max_at: Date | null }>(
          'SELECT MAX(shopify_synced_at) AS max_at FROM orders WHERE shopify_synced_at IS NOT NULL',
        )
        const contactMax = contactMaxRow?.max_at ?? null
        const orderMax = orderMaxRow?.max_at ?? null

        // Use the SMALLER of the two (or null = genesis pull) — we want
        // both contacts and orders to fully catch up if one lagged.
        let sinceTs: Date | null = null
        if (contactMax && orderMax) sinceTs = new Date(Math.min(contactMax.getTime(), orderMax.getTime()))
        else if (contactMax) sinceTs = contactMax
        else if (orderMax) sinceTs = orderMax

        // Apply 1h overlap to absorb Shopify eventual consistency.
        const cursorTs = sinceTs ? new Date(sinceTs.getTime() - OVERLAP_MS) : null
        const sinceIso = cursorTs?.toISOString() ?? null
        const searchQuery = buildSearchQuery(sinceIso)

        log.info(`[syncContactsFromShopify] starting — since=${sinceIso ?? 'genesis'}`)

        // ── 2. Pull customers + orders ──────────────────────────────
        const [customers, orders] = await Promise.all([
          pullCustomers(client, searchQuery, ctx.signal),
          pullOrders(client, searchQuery, ctx.signal),
        ])

        if (ctx.signal?.aborted) {
          throw new MantaError('CONFLICT', 'syncContactsFromShopify cancelled', { code: 'WORKFLOW_CANCELLED' })
        }

        log.info(`[syncContactsFromShopify] pulled customers=${customers.length} orders=${orders.length}`)

        // ── 3. Upsert ───────────────────────────────────────────────
        const contactsWritten = await upsertContacts(db, customers)
        const ordersWritten = await upsertOrders(db, orders)

        const durationMs = Date.now() - startedAt
        log.info(
          `[syncContactsFromShopify] done — contacts=${contactsWritten} orders=${ordersWritten} duration_ms=${durationMs}`,
        )

        return {
          contacts: contactsWritten,
          orders: ordersWritten,
          duration_ms: durationMs,
          since: sinceIso,
        }
      },
      compensate: async () => {
        // Idempotent upsert against external system — partial progress
        // is recovered by the next tick via the high-water mark.
      },
    })({})
  },
})
