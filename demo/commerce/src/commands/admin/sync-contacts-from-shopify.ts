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

import { type RawDb, reattachHistoryForContact } from '../../modules/contact/reattach-history'
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

export default defineCommand({
  name: 'syncContactsFromShopify',
  description:
    'Pull customers + orders updated since last run from Shopify Admin and upsert them into `contacts` and `orders` (incremental, idempotent).',
  input: z.object({}),
  workflow: async (_input, { step, log }) => {
    const startedAt = Date.now()

    // ── 1. High-water mark via services ─────────────────────────────
    // biome-ignore lint/suspicious/noExplicitAny: $notnull is a Manta filter operator not in the entity type
    const [latestContact] = (await step.service.contact.listContacts({ shopify_synced_at: { $notnull: true } } as any, {
      order: { shopify_synced_at: 'DESC' },
      take: 1,
    })) as Array<{ shopify_synced_at?: Date | string | null }>
    // biome-ignore lint/suspicious/noExplicitAny: same as above
    const [latestOrder] = (await step.service.order.listOrders({ shopify_synced_at: { $notnull: true } } as any, {
      order: { shopify_synced_at: 'DESC' },
      take: 1,
    })) as Array<{ shopify_synced_at?: Date | string | null }>
    type _StepSvcAny = Record<string, (...args: unknown[]) => Promise<unknown>>
    const contactMax = latestContact?.shopify_synced_at ? new Date(latestContact.shopify_synced_at) : null
    const orderMax = latestOrder?.shopify_synced_at ? new Date(latestOrder.shopify_synced_at) : null

    // Use the SMALLER of the two (or null = genesis pull) — we want both
    // contacts and orders to fully catch up if one lagged.
    let sinceTs: Date | null = null
    if (contactMax && orderMax) sinceTs = new Date(Math.min(contactMax.getTime(), orderMax.getTime()))
    else if (contactMax) sinceTs = contactMax
    else if (orderMax) sinceTs = orderMax

    const cursorTs = sinceTs ? new Date(sinceTs.getTime() - OVERLAP_MS) : null
    const sinceIso = cursorTs?.toISOString() ?? null
    const searchQuery = buildSearchQuery(sinceIso)

    log.info(`[syncContactsFromShopify] starting — since=${sinceIso ?? 'genesis'}`)

    // ── 2. Pull from Shopify Admin GraphQL (compensable network step) ─
    const pulled = await step.action('pull-from-shopify', {
      invoke: async (_i: unknown, ctx): Promise<{ customers: CustomerRow[]; orders: OrderRow[] }> => {
        const client = new ShopifyAdminClient()
        const [customers, orders] = await Promise.all([
          pullCustomers(client, searchQuery, ctx.signal),
          pullOrders(client, searchQuery, ctx.signal),
        ])
        if (ctx.signal?.aborted) {
          throw new MantaError('CONFLICT', 'syncContactsFromShopify cancelled', { code: 'WORKFLOW_CANCELLED' })
        }
        return { customers, orders }
      },
      compensate: async () => {
        // Read-only on Shopify; the local upsert is idempotent on the next tick.
      },
    })({})
    const customersForUpsert = pulled.customers
    const ordersForUpsert = pulled.orders

    log.info(`[syncContactsFromShopify] pulled customers=${customersForUpsert.length} orders=${ordersForUpsert.length}`)

    // ── 3. Bulk upsert via services (CQRS — no raw SQL) ──────────────
    let contactsWritten = 0
    let ordersWritten = 0
    if (customersForUpsert.length > 0) {
      const result = (await step.service.contact.upsertWithReplace(
        customersForUpsert as unknown as Record<string, unknown>[],
        // Replace fields on conflict — keep email-keyed identity but refresh
        // every Shopify-sourced field. Manual edits to klaviyo_* / distinct_id
        // / *_count from other code paths are preserved (not in this list).
        [
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
        ],
        ['email'],
      )) as Array<{ id: string }>
      contactsWritten = result.length
    }
    if (ordersForUpsert.length > 0) {
      const result = (await step.service.order.upsertWithReplace(
        ordersForUpsert as unknown as Record<string, unknown>[],
        [
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
        ],
        ['shopify_order_id'],
      )) as Array<{ id: string }>
      ordersWritten = result.length
    }

    // ── 4. Retro-attach historical carts to the freshly-upserted contacts ─
    // Anonymous carts that landed before we knew the Shopify customer id
    // (or before the Contact row existed at all) get linked back via the
    // contact's email. First-write-wins on cart.shopify_customer_id.
    let cartsReattached = 0
    await step.action('reattach-cart-history', {
      invoke: async (_i: unknown, ctx) => {
        const db = ctx.app.infra.db as RawDb | undefined
        if (!db || customersForUpsert.length === 0) return null
        for (const c of customersForUpsert) {
          if (!c.shopify_customer_id || !c.email) continue
          try {
            const outcome = await reattachHistoryForContact(db, {
              email: c.email,
              shopify_customer_id: c.shopify_customer_id,
            })
            cartsReattached += outcome.carts_attached
          } catch (err) {
            log.warn(`[syncContactsFromShopify] reattach failed for ${c.email}: ${(err as Error).message}`)
          }
        }
        return null
      },
      compensate: async () => {
        // Read-only against Shopify and idempotent locally — nothing to undo.
      },
    })({})

    // Every Shopify customer/order update means the contact snapshot may
    // need consolidation across Shopify + Klaviyo + PostHog. Emit a refresh
    // ping for every touched email instead of letting this bulk sync be a
    // special mutation path with its own contact semantics.
    const refreshEmails = Array.from(
      new Set(
        [
          ...customersForUpsert.map((c) => c.email),
          ...ordersForUpsert.map((o) => o.email).filter((email): email is string => Boolean(email)),
        ].map((email) => email.trim().toLowerCase()),
      ),
    )
    for (const email of refreshEmails) {
      await step.emit('contact.refresh-requested', {
        email,
        reason: 'shopify_sync',
        source: 'syncContactsFromShopify',
        requested_at: new Date().toISOString(),
      })
    }
    for (const order of ordersForUpsert) {
      await step.emit('order.refresh-requested', {
        shopify_order_id: order.shopify_order_id,
        reason: 'shopify_sync',
        source: 'syncContactsFromShopify',
        requested_at: new Date().toISOString(),
      })
    }

    const durationMs = Date.now() - startedAt
    log.info(
      `[syncContactsFromShopify] done — contacts=${contactsWritten} orders=${ordersWritten} carts_reattached=${cartsReattached} contact_refresh_requested=${refreshEmails.length} order_refresh_requested=${ordersForUpsert.length} duration_ms=${durationMs}`,
    )

    return {
      contacts: contactsWritten,
      orders: ordersWritten,
      carts_reattached: cartsReattached,
      contact_refresh_requested: refreshEmails.length,
      order_refresh_requested: ordersForUpsert.length,
      duration_ms: durationMs,
      since: sinceIso,
    }
  },
})
