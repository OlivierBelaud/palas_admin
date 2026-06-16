// Command: incremental Shopify Admin → local DB sync.
//
// Pulls customers and orders updated since the last successful run and
// upserts them into `contacts` and `orders` (ON CONFLICT DO UPDATE,
// keyed by `email` for contacts and `shopify_order_id` for orders).
//
// Strategy:
//   1. Read separate MAX(shopify_synced_at) cursors for contacts and
//      orders. Contacts use a 1h overlap; orders use a rolling 48h lookback
//      so modified Shopify orders are re-read even if a prior high-water mark
//      already advanced.
//   2. GraphQL: paginate customers/orders independently until drained or the
//      hard cap is reached.
//   3. Upsert in CHUNK-of-500 batches. ON CONFLICT clauses preserve any
//      manually-set fields the operator may have edited locally.
//   4. Re-fetch every changed order by id and persist the full order snapshot
//      in the same sync tick.
//
// Idempotence: ON CONFLICT clauses are deterministic; a second run on
// the same data is a no-op (the COALESCE branches keep existing
// non-null fields, and EXCLUDED-only fields just rewrite identical
// values). Purchase state is synchronized through `orders`, not duplicated on
// contacts. No full-refresh — that's the job of dedicated Shopify backfills.

import { type RawDb, reattachHistoryForContact } from '../../modules/contact/reattach-history'
import { classifyOrderChannel, type OrderSalesChannel } from '../../modules/order/classify-order-channel'
import {
  mapShopifyOrderNodeToSnapshot,
  normalizeShopifyOrderId,
  type OrderSnapshot,
} from '../../modules/order/refresh-order'
import {
  paginateConnection,
  ShopifyAdminClient,
  type ShopifyAdminClient as ShopifyAdminClientType,
} from '../../modules/shopify-admin/client'

// Defensive overlap so we don't miss records updated right before the
// last run committed. Shopify's `updated_at` is eventually consistent.
const OVERLAP_MS = 60 * 60 * 1000 // 1h
const ORDER_UPDATE_ROLLING_LOOKBACK_MS = 48 * 60 * 60 * 1000

// Hard cap per run — Vercel Hobby cron has 60s timeout; one run pulling
// > 5000 customers/orders + upserting them risks timing out. The next
// tick picks up the leftover via the high-water mark.
const HARD_CAP = 5000
const ORDER_SNAPSHOT_BATCH_SIZE = 50

const ORDER_SNAPSHOT_REPLACE_FIELDS = [
  'email',
  'shopify_customer_id',
  'shopify_source_name',
  'shopify_source_identifier',
  'shopify_app_name',
  'shopify_channel_name',
  'shopify_tags',
  'sales_channel',
  'include_in_ecommerce_analytics',
  'analytics_exclusion_reason',
  'order_number',
  'status',
  'financial_status',
  'fulfillment_status',
  'total_price',
  'currency',
  'shipping_country_code',
  'shipping_country_name',
  'shipping_city',
  'shipping_province_code',
  'items',
  'placed_at',
  'cancelled_at',
  'shopify_synced_at',
]

interface CustomerRow {
  shopify_customer_id: string
  email: string
  first_name: string | null
  last_name: string | null
  locale: string | null
  phone: string | null
  city: string | null
  country_code: string | null
  shopify_synced_at: Date
}

interface OrderRow {
  shopify_order_id: string
  shopify_customer_id: string | null
  shopify_source_name: string | null
  shopify_source_identifier: string | null
  shopify_app_name: string | null
  shopify_channel_name: string | null
  shopify_tags: string[]
  sales_channel: OrderSalesChannel
  include_in_ecommerce_analytics: boolean
  analytics_exclusion_reason: string | null
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

function buildOrderCursor(orderMax: Date | null, now = new Date()): Date | null {
  if (!orderMax) return null
  return new Date(Math.min(orderMax.getTime() - OVERLAP_MS, now.getTime() - ORDER_UPDATE_ROLLING_LOOKBACK_MS))
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
    defaultAddress: { city: string | null; countryCodeV2: string | null } | null
  }
  const nodes = await paginateConnection<Node>(
    client,
    (cursor) => ({
      query: `query Customers($cursor: String, $q: String) {
        customers(first: 250, after: $cursor${searchQuery ? ', query: $q' : ''}) {
          edges {
            node {
              id email firstName lastName locale phone
              defaultAddress { city countryCodeV2 }
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
      const row: CustomerRow = {
        shopify_customer_id: gidNum(n.id),
        email,
        first_name: n.firstName,
        last_name: n.lastName,
        locale: n.locale,
        phone: n.phone,
        city: n.defaultAddress?.city ?? null,
        country_code: n.defaultAddress?.countryCodeV2 ?? null,
        shopify_synced_at: now,
      }
      return row
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
    sourceName: string | null
    sourceIdentifier: string | null
    tags: string[] | null
    app: { name: string | null } | null
    channelInformation: { channelDefinition: { channelName: string | null } | null } | null
    currentTotalPriceSet: { shopMoney: { amount: string; currencyCode: string } }
    customer: { id: string | null; email: string | null } | null
  }
  const nodes = await paginateConnection<Node>(
    client,
    (cursor) => ({
      query: `query Orders($cursor: String, $q: String) {
        orders(first: 250, after: $cursor${searchQuery ? ', query: $q' : ''}, sortKey: UPDATED_AT) {
          edges {
            node {
              id name email displayFinancialStatus displayFulfillmentStatus
              cancelledAt createdAt sourceName sourceIdentifier tags
              app { name }
              channelInformation { channelDefinition { channelName } }
              currentTotalPriceSet { shopMoney { amount currencyCode } }
              customer { id email }
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
    const tags = n.tags ?? []
    const classification = classifyOrderChannel({
      source_name: n.sourceName,
      source_identifier: n.sourceIdentifier,
      app_name: n.app?.name,
      channel_name: n.channelInformation?.channelDefinition?.channelName,
      tags,
    })
    return {
      shopify_order_id: gidNum(n.id),
      shopify_customer_id: n.customer?.id ? gidNum(n.customer.id) : null,
      shopify_source_name: n.sourceName,
      shopify_source_identifier: n.sourceIdentifier,
      shopify_app_name: n.app?.name ?? null,
      shopify_channel_name: n.channelInformation?.channelDefinition?.channelName ?? null,
      shopify_tags: tags,
      ...classification,
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

async function fetchOrderSnapshots(
  client: ShopifyAdminClientType,
  orderIds: string[],
  signal: AbortSignal | undefined,
): Promise<OrderSnapshot[]> {
  const snapshots: OrderSnapshot[] = []
  for (let i = 0; i < orderIds.length; i += ORDER_SNAPSHOT_BATCH_SIZE) {
    if (signal?.aborted) {
      throw new MantaError('CONFLICT', 'syncContactsFromShopify cancelled', { code: 'WORKFLOW_CANCELLED' })
    }
    const ids = orderIds
      .slice(i, i + ORDER_SNAPSHOT_BATCH_SIZE)
      .map((id) => `gid://shopify/Order/${normalizeShopifyOrderId(id)}`)
    const data = await client.query<{ nodes: unknown[] }>(
      `query OrdersByIds($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Order {
            id
            name
            email
            displayFinancialStatus
            displayFulfillmentStatus
            cancelledAt
            createdAt
            sourceName
            sourceIdentifier
            tags
            app { name }
            channelInformation { channelDefinition { channelName } }
            currentTotalPriceSet { shopMoney { amount currencyCode } }
            shippingAddress { countryCodeV2 country city provinceCode }
            customer { id email }
            lineItems(first: 100) {
              edges {
                node {
                  id
                  title
                  quantity
                  sku
                  variantTitle
                  variant { id title product { id } }
                  originalUnitPriceSet { shopMoney { amount } }
                  discountedTotalSet { shopMoney { amount } }
                }
              }
            }
          }
        }
      }`,
      { ids },
      signal,
    )
    snapshots.push(
      ...data.nodes
        .filter((node): node is Parameters<typeof mapShopifyOrderNodeToSnapshot>[0] => Boolean(node))
        .map((node) => mapShopifyOrderNodeToSnapshot(node)),
    )
  }
  return snapshots
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

    // Contacts keep a narrow high-water overlap. Orders use a rolling
    // lookback because Shopify order updates are material even when the
    // contact cursor has already advanced.
    const contactCursorTs = contactMax ? new Date(contactMax.getTime() - OVERLAP_MS) : null
    const orderCursorTs = buildOrderCursor(orderMax)
    const contactSinceIso = contactCursorTs?.toISOString() ?? null
    const orderSinceIso = orderCursorTs?.toISOString() ?? null
    const contactSearchQuery = buildSearchQuery(contactSinceIso)
    const orderSearchQuery = buildSearchQuery(orderSinceIso)

    log.info(
      `[syncContactsFromShopify] starting — contacts_since=${contactSinceIso ?? 'genesis'} orders_since=${orderSinceIso ?? 'genesis'}`,
    )

    // ── 2. Pull from Shopify Admin GraphQL (compensable network step) ─
    const pulled = await step.action('pull-from-shopify', {
      invoke: async (_i: unknown, ctx): Promise<{ customers: CustomerRow[]; orders: OrderRow[] }> => {
        const client = new ShopifyAdminClient()
        const [customers, orders] = await Promise.all([
          pullCustomers(client, contactSearchQuery, ctx.signal),
          pullOrders(client, orderSearchQuery, ctx.signal),
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
    let orderSnapshotsRefreshed = 0
    if (customersForUpsert.length > 0) {
      const result = (await step.service.contact.upsertWithReplace(
        customersForUpsert as unknown as Record<string, unknown>[],
        // Replace fields on conflict — keep email-keyed identity but refresh
        // every Shopify-sourced identity field. Klaviyo and analytics identity
        // fields are owned by their dedicated sync paths.
        [
          'phone',
          'locale',
          'first_name',
          'last_name',
          'country_code',
          'city',
          'shopify_customer_id',
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
          'shopify_customer_id',
          'shopify_source_name',
          'shopify_source_identifier',
          'shopify_app_name',
          'shopify_channel_name',
          'shopify_tags',
          'sales_channel',
          'include_in_ecommerce_analytics',
          'analytics_exclusion_reason',
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

    if (ordersForUpsert.length > 0) {
      const snapshots = await step.action('refresh-shopify-order-snapshots', {
        invoke: async (_i: unknown, ctx): Promise<OrderSnapshot[]> => {
          const client = new ShopifyAdminClient({
            domain: process.env.SHOPIFY_SHOP_DOMAIN ?? 'fancy-palas.myshopify.com',
          })
          return fetchOrderSnapshots(
            client,
            ordersForUpsert.map((order) => order.shopify_order_id),
            ctx.signal,
          )
        },
        compensate: async () => {
          // Read-only on Shopify; local upsert is idempotent on the next tick.
        },
      })({})

      if (snapshots.length > 0) {
        const result = (await step.service.order.upsertWithReplace(
          snapshots as unknown as Record<string, unknown>[],
          ORDER_SNAPSHOT_REPLACE_FIELDS,
          ['shopify_order_id'],
        )) as Array<{ id: string }>
        orderSnapshotsRefreshed = result.length
      }
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

    // Every Shopify customer/order update may expose identity data that needs
    // consolidation across Shopify + Klaviyo + PostHog. Emit a refresh ping
    // for every touched email instead of letting this bulk sync become a
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
      await step.emit('cart.refresh-requested', {
        email,
        reason: 'shopify_contact_sync',
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
      await step.emit('cart.refresh-requested', {
        shopify_order_id: order.shopify_order_id,
        email: order.email?.trim().toLowerCase() ?? null,
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
      order_snapshots_refreshed: orderSnapshotsRefreshed,
      carts_reattached: cartsReattached,
      contact_refresh_requested: refreshEmails.length,
      order_refresh_requested: ordersForUpsert.length,
      duration_ms: durationMs,
      contact_since: contactSinceIso,
      order_since: orderSinceIso,
      since: orderSinceIso ?? contactSinceIso,
    }
  },
})
