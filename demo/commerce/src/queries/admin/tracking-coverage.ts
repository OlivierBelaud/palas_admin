// Cross-system tracking coverage — does each of our identified carts appear
// where it should in Shopify + Klaviyo?
//
// Row per cart, pill per channel. Data sources:
//   - carts              (PG)             : start set = identified carts
//   - Shopify Admin API  (GraphQL, live)  : orders + abandonedCheckouts +
//                                           customers, no DW sync lag
//   - klaviyo_*          (PostHog DW)     : profile + abandonment emails
//
// Shopify Flow is deliberately absent — no API surface exposes Flow runs
// (schema introspection done 2026-04-22). To cover Flow we'll need to
// self-instrument the workflows (tag / metafield / HTTP webhook).

import { computeActivityState } from '../../modules/cart-tracking/abandonment'
import { paginateConnection, ShopifyAdminClient } from '../../modules/shopify-admin/client'

type CartRow = {
  id: string
  email: string
  highest_stage: string
  last_action_at: Date
  total_price: number | null
}

interface ShopifyOrderNode {
  id: string
  name: string
  email: string | null
  createdAt: string
  displayFinancialStatus: string | null
}

interface ShopifyAbandonedNode {
  id: string
  customer: { email: string | null } | null
  createdAt: string
  abandonedCheckoutUrl: string | null
}

interface ShopifyCustomerNode {
  id: string
  email: string | null
  numberOfOrders: string | number | null
}

export default defineQuery({
  name: 'tracking-coverage',
  description: 'Cross-channel coverage matrix — our carts × Shopify (live API) × Klaviyo',
  input: z.object({
    limit: z.number().int().positive().max(500).default(200),
    offset: z.number().int().min(0).default(0),
    days: z.number().int().positive().max(90).default(30),
  }),
  handler: async (input, { query, log }) => {
    // ── 1. Pull identified carts ───────────────────────────────────────
    const carts = (await query.graph({
      entity: 'cart',
      filters: { email: { $notnull: true } },
      fields: ['id', 'email', 'highest_stage', 'last_action_at', 'total_price'],
      sort: { last_action_at: 'desc' },
      pagination: { limit: input.limit, offset: input.offset },
    })) as unknown as CartRow[]

    if (carts.length === 0) return []

    const days = input.days ?? 30
    const cutoffMs = Date.now() - days * 86400 * 1000
    const windowed = carts.filter((c) => new Date(c.last_action_at).getTime() >= cutoffMs)
    if (windowed.length === 0) return []

    const emails = Array.from(new Set(windowed.map((c) => c.email.toLowerCase())))

    // ── 2. Parallel fetches: Shopify (live) + Klaviyo (DW) ─────────────
    const [
      shopifyOrderByEmail,
      shopifyAbandonedByEmail,
      shopifyCustomerByEmail,
      klaviyoProfiles,
      klaviyoAbandonEmails,
    ] = await Promise.all([
      fetchShopifyOrders(emails, log).catch((err) => {
        log.warn(`[tracking-coverage] shopify orders: ${(err as Error).message}`)
        return new Map<string, ShopifyOrderNode>()
      }),
      fetchShopifyAbandoned(emails, days, log).catch((err) => {
        log.warn(`[tracking-coverage] shopify abandoned: ${(err as Error).message}`)
        return new Map<string, ShopifyAbandonedNode>()
      }),
      fetchShopifyCustomers(emails, log).catch((err) => {
        log.warn(`[tracking-coverage] shopify customers: ${(err as Error).message}`)
        return new Map<string, ShopifyCustomerNode>()
      }),
      fetchKlaviyoProfiles(emails, log),
      fetchKlaviyoAbandonEmails(emails, log),
    ])

    // ── 3. Merge into one row per cart ─────────────────────────────────
    const now = Date.now()
    return windowed.map((c) => {
      const emailKey = c.email.toLowerCase()
      const activity = computeActivityState(c, now)

      const palas: 'completed' | 'abandoned' | 'active' =
        activity === 'completed' ? 'completed' : activity === 'dormant' || activity === 'dead' ? 'abandoned' : 'active'

      const order = shopifyOrderByEmail.get(emailKey)
      const abandoned = shopifyAbandonedByEmail.get(emailKey)
      const customer = shopifyCustomerByEmail.get(emailKey)
      const shopify: 'order' | 'abandoned' | 'customer' | 'none' = order
        ? 'order'
        : abandoned
          ? 'abandoned'
          : customer
            ? 'customer'
            : 'none'
      const shopifyDetails = order
        ? `${order.name} · ${order.displayFinancialStatus ?? '—'}`
        : abandoned
          ? `abandonné ${new Date(abandoned.createdAt).toISOString().slice(0, 10)}`
          : customer
            ? `client connu · ${customer.numberOfOrders ?? 0} cmd${Number(customer.numberOfOrders) > 1 ? 's' : ''}`
            : null

      const klaviyoEmail = klaviyoAbandonEmails.get(emailKey)
      const klaviyo: 'email_sent' | 'profile' | 'none' = klaviyoEmail
        ? 'email_sent'
        : klaviyoProfiles.has(emailKey)
          ? 'profile'
          : 'none'
      const klaviyoDetails = klaviyoEmail
        ? `${klaviyoEmail.metric} · ${new Date(klaviyoEmail.sent_at).toISOString().slice(0, 10)}`
        : null

      return {
        id: c.id,
        email: c.email,
        activity_state: activity,
        palas,
        shopify,
        shopify_details: shopifyDetails,
        klaviyo,
        klaviyo_details: klaviyoDetails,
        total_price: c.total_price ?? 0,
        last_action_at: c.last_action_at,
      }
    })
  },
})

// ── Shopify helpers (GraphQL Admin API) ─────────────────────────────────
// Shopify's search syntax has a hard clause cap (~250 terms). We batch the
// email OR-lists to 100 per request — conservative, stays well under the
// cost limits and Shopify's query complexity cap.

const SHOPIFY_BATCH = 100

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

async function fetchShopifyOrders(
  emails: string[],
  log: { info: (m: string) => void; warn: (m: string) => void },
): Promise<Map<string, ShopifyOrderNode>> {
  if (emails.length === 0) return new Map()
  const client = new ShopifyAdminClient()
  const byEmail = new Map<string, ShopifyOrderNode>()

  for (const batch of chunk(emails, SHOPIFY_BATCH)) {
    const queryStr = batch.map((e) => `email:${e.replace(/"/g, '\\"')}`).join(' OR ')
    const nodes = await paginateConnection<ShopifyOrderNode>(
      client,
      (cursor) => ({
        query: `
          query ($q: String!, $cursor: String) {
            orders(first: 100, query: $q, after: $cursor, sortKey: CREATED_AT, reverse: true) {
              edges { node { id name email createdAt displayFinancialStatus } }
              pageInfo { hasNextPage endCursor }
            }
          }`,
        variables: { q: queryStr, cursor },
      }),
      (data) => {
        const conn = (data.orders ?? {}) as {
          edges: Array<{ node: ShopifyOrderNode }>
          pageInfo: { hasNextPage: boolean; endCursor: string | null }
        }
        return {
          nodes: (conn.edges ?? []).map((e) => e.node),
          hasNextPage: Boolean(conn.pageInfo?.hasNextPage),
          endCursor: conn.pageInfo?.endCursor ?? null,
        }
      },
      { hardCap: 1000 },
    )

    for (const n of nodes) {
      if (!n.email) continue
      const key = n.email.toLowerCase()
      const prev = byEmail.get(key)
      if (!prev || new Date(n.createdAt).getTime() > new Date(prev.createdAt).getTime()) {
        byEmail.set(key, n)
      }
    }
  }
  log.info(`[tracking-coverage] shopify orders: ${byEmail.size}/${emails.length} emails matched`)
  return byEmail
}

async function fetchShopifyAbandoned(
  emails: string[],
  days: number,
  log: { warn: (m: string) => void; info: (m: string) => void },
): Promise<Map<string, ShopifyAbandonedNode>> {
  if (emails.length === 0) return new Map()
  const client = new ShopifyAdminClient()
  const byEmail = new Map<string, ShopifyAbandonedNode>()

  const cutoffISO = new Date(Date.now() - days * 86400 * 1000).toISOString().slice(0, 10)

  for (const batch of chunk(emails, SHOPIFY_BATCH)) {
    const queryStr = `${batch.map((e) => `email:${e.replace(/"/g, '\\"')}`).join(' OR ')} AND created_at:>=${cutoffISO}`
    const nodes = await paginateConnection<ShopifyAbandonedNode>(
      client,
      (cursor) => ({
        query: `
          query ($q: String!, $cursor: String) {
            abandonedCheckouts(first: 100, query: $q, after: $cursor, sortKey: CREATED_AT, reverse: true) {
              edges { node { id customer { email } createdAt abandonedCheckoutUrl } }
              pageInfo { hasNextPage endCursor }
            }
          }`,
        variables: { q: queryStr, cursor },
      }),
      (data) => {
        const conn = (data.abandonedCheckouts ?? {}) as {
          edges: Array<{ node: ShopifyAbandonedNode }>
          pageInfo: { hasNextPage: boolean; endCursor: string | null }
        }
        return {
          nodes: (conn.edges ?? []).map((e) => e.node),
          hasNextPage: Boolean(conn.pageInfo?.hasNextPage),
          endCursor: conn.pageInfo?.endCursor ?? null,
        }
      },
      { hardCap: 1000 },
    )

    for (const n of nodes) {
      const email = n.customer?.email
      if (!email) continue
      const key = email.toLowerCase()
      const prev = byEmail.get(key)
      if (!prev || new Date(n.createdAt).getTime() > new Date(prev.createdAt).getTime()) {
        byEmail.set(key, n)
      }
    }
  }
  log.info(`[tracking-coverage] shopify abandoned: ${byEmail.size}/${emails.length} emails matched`)
  return byEmail
}

async function fetchShopifyCustomers(
  emails: string[],
  log: { info: (m: string) => void; warn: (m: string) => void },
): Promise<Map<string, ShopifyCustomerNode>> {
  if (emails.length === 0) return new Map()
  const client = new ShopifyAdminClient()
  const byEmail = new Map<string, ShopifyCustomerNode>()

  for (const batch of chunk(emails, SHOPIFY_BATCH)) {
    const queryStr = batch.map((e) => `email:${e.replace(/"/g, '\\"')}`).join(' OR ')
    const nodes = await paginateConnection<ShopifyCustomerNode>(
      client,
      (cursor) => ({
        query: `
          query ($q: String!, $cursor: String) {
            customers(first: 100, query: $q, after: $cursor) {
              edges { node { id email numberOfOrders } }
              pageInfo { hasNextPage endCursor }
            }
          }`,
        variables: { q: queryStr, cursor },
      }),
      (data) => {
        const conn = (data.customers ?? {}) as {
          edges: Array<{ node: ShopifyCustomerNode }>
          pageInfo: { hasNextPage: boolean; endCursor: string | null }
        }
        return {
          nodes: (conn.edges ?? []).map((e) => e.node),
          hasNextPage: Boolean(conn.pageInfo?.hasNextPage),
          endCursor: conn.pageInfo?.endCursor ?? null,
        }
      },
      { hardCap: 1000 },
    )

    for (const n of nodes) {
      if (!n.email) continue
      byEmail.set(n.email.toLowerCase(), n)
    }
  }
  log.info(`[tracking-coverage] shopify customers: ${byEmail.size}/${emails.length} emails matched`)
  return byEmail
}

// ── Klaviyo helpers (PostHog DW via HogQL) ──────────────────────────────

async function fetchKlaviyoProfiles(emails: string[], log: { warn: (m: string) => void }): Promise<Set<string>> {
  if (emails.length === 0) return new Set()
  const host = process.env.POSTHOG_HOST ?? 'https://eu.i.posthog.com'
  const key = process.env.POSTHOG_API_KEY
  if (!key) {
    log.warn('[tracking-coverage] POSTHOG_API_KEY not set — klaviyo profiles skipped')
    return new Set()
  }
  const emailsList = emails.map((e) => `'${e.replace(/'/g, "''")}'`).join(',')

  try {
    const res = await fetch(`${host}/api/projects/@current/query/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: {
          kind: 'HogQLQuery',
          query: `
            SELECT DISTINCT lower(kp.email) AS email
            FROM klaviyo_profiles kp
            WHERE lower(kp.email) IN (${emailsList})
            LIMIT 10000
          `,
        },
        refresh: 'force_blocking',
      }),
    })
    if (!res.ok) {
      log.warn(`[tracking-coverage] HogQL profiles ${res.status}`)
      return new Set()
    }
    const data = (await res.json()) as { results?: unknown[][] }
    const set = new Set<string>()
    for (const r of data.results ?? []) {
      const email = r[0] as string | null
      if (email) set.add(email)
    }
    return set
  } catch (err) {
    log.warn(`[tracking-coverage] HogQL profiles: ${(err as Error).message}`)
    return new Set()
  }
}

async function fetchKlaviyoAbandonEmails(
  emails: string[],
  log: { warn: (m: string) => void },
): Promise<Map<string, { sent_at: string; metric: string }>> {
  if (emails.length === 0) return new Map()
  const host = process.env.POSTHOG_HOST ?? 'https://eu.i.posthog.com'
  const key = process.env.POSTHOG_API_KEY
  if (!key) return new Map()
  const emailsList = emails.map((e) => `'${e.replace(/'/g, "''")}'`).join(',')
  const out = new Map<string, { sent_at: string; metric: string }>()

  try {
    const res = await fetch(`${host}/api/projects/@current/query/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: {
          kind: 'HogQLQuery',
          query: `
            SELECT
              lower(kp.email) AS email,
              max(ke.datetime) AS sent_at,
              argMax(km.name, ke.datetime) AS metric
            FROM klaviyo_events ke
            JOIN klaviyo_profiles kp ON kp.id = JSONExtractString(ke.relationships, 'profile', 'data', 'id')
            JOIN klaviyo_metrics km ON km.id = JSONExtractString(ke.relationships, 'metric', 'data', 'id')
            WHERE lower(kp.email) IN (${emailsList})
              AND (
                km.name = 'Shopify_Checkout_Abandonned'
                OR km.name = 'Checkout Abandoned'
                OR km.name = 'Ops Cart Abandoned'
                OR (
                  km.name = 'Received Email'
                  AND (
                    positionCaseInsensitive(JSONExtractString(ke.event_properties, 'Subject'), 'oubli') > 0
                    OR positionCaseInsensitive(JSONExtractString(ke.event_properties, 'Subject'), 'pensez encore') > 0
                    OR positionCaseInsensitive(JSONExtractString(ke.event_properties, 'Subject'), 'attend plus que vous') > 0
                    OR positionCaseInsensitive(JSONExtractString(ke.event_properties, 'Subject'), 'commande palas vous attend') > 0
                    OR positionCaseInsensitive(JSONExtractString(ke.event_properties, 'Subject'), 'valider votre commande') > 0
                  )
                )
              )
            GROUP BY lower(kp.email)
            LIMIT 10000
          `,
        },
        refresh: 'force_blocking',
      }),
    })
    if (!res.ok) {
      log.warn(`[tracking-coverage] HogQL klaviyo emails ${res.status}`)
      return out
    }
    const data = (await res.json()) as { results?: unknown[][] }
    for (const r of data.results ?? []) {
      const email = r[0] as string | null
      if (!email) continue
      out.set(email, { sent_at: String(r[1] ?? ''), metric: String(r[2] ?? '') })
    }
    return out
  } catch (err) {
    log.warn(`[tracking-coverage] HogQL klaviyo emails: ${(err as Error).message}`)
    return out
  }
}
