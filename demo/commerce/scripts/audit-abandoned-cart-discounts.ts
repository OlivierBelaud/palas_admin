// Read-only audit: verify that recent abandoned-cart emails carrying a 10%
// discount were sent only to people with no prior Shopify order at send time.
//
// Run:
//   bunx tsx scripts/audit-abandoned-cart-discounts.ts [limit=100]

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'

const here = dirname(fileURLToPath(import.meta.url))

function loadEnv(file: string, override = false) {
  try {
    const envLines = readFileSync(resolve(here, '..', file), 'utf8').split('\n')
    for (const line of envLines) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (!m) continue
      if (!override && process.env[m[1]]) continue
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch {
    // Optional env file.
  }
}

loadEnv('.env.production')
loadEnv('.env.local')
loadEnv('.env')

const limit = Math.max(1, Math.min(Number(process.argv[2] ?? 100), 500))
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL missing')

const sql = postgres(databaseUrl, { ssl: 'require', max: 1, prepare: false })

type MessageRow = {
  message_id: string
  cart_id: string
  case_id: string
  email: string
  message_type: string
  sent_at: Date
  subject: string | null
  discount_code: string | null
  discount_source: string | null
  discount_shopify_id: string | null
  local_prior_orders: number
  local_first_prior_order_at: Date | null
  local_prior_order_ids: string[] | null
}

type ShopifyPriorOrderResult =
  | { status: 'checked'; priorOrders: number; firstPriorOrderAt: string | null; sampleOrderName: string | null }
  | { status: 'unavailable'; error: string }

type DiscountCheckResult =
  | { status: 'checked'; active: boolean; percentage: number | null; title: string | null; typename: string | null }
  | { status: 'unavailable'; error: string }

function sha(email: string) {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 12)
}

function masked(email: string) {
  const [, domain = ''] = email.split('@')
  return `sha256:${sha(email)}@${domain.replace(/^[^.@]+/, '*')}`
}

function shopifyReady() {
  return Boolean(process.env.SHOPIFY_ADMIN_ACCESS_TOKEN)
}

async function shopifyGraphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const domain = process.env.SHOPIFY_SHOP_DOMAIN ?? 'fancy-palas.myshopify.com'
  const token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN
  const version = process.env.SHOPIFY_ADMIN_API_VERSION ?? '2025-10'
  if (!token) throw new Error('SHOPIFY_ADMIN_ACCESS_TOKEN missing')

  const res = await fetch(`https://${domain}/admin/api/${version}/graphql.json`, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const body = (await res.json()) as { data?: T; errors?: Array<{ message: string }> }
  if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join(' | '))
  if (!body.data) throw new Error('empty Shopify response')
  return body.data
}

async function checkShopifyPriorOrders(email: string, sentAt: Date): Promise<ShopifyPriorOrderResult> {
  if (!shopifyReady()) return { status: 'unavailable', error: 'Shopify Admin env missing' }
  const before = sentAt.toISOString()
  const q = `email:"${email.replace(/"/g, '\\"')}" created_at:<${before} financial_status:paid`
  try {
    const data = await shopifyGraphql<{
      orders: {
        edges: Array<{ node: { name: string | null; createdAt: string } }>
      }
    }>(
      `query PriorOrders($q: String!) {
        orders(first: 10, query: $q, sortKey: CREATED_AT, reverse: false) {
          edges { node { name createdAt } }
        }
      }`,
      { q },
    )
    const orders = data.orders.edges.map((e) => e.node)
    return {
      status: 'checked',
      priorOrders: orders.length,
      firstPriorOrderAt: orders[0]?.createdAt ?? null,
      sampleOrderName: orders[0]?.name ?? null,
    }
  } catch (err) {
    return { status: 'unavailable', error: (err as Error).message }
  }
}

async function checkDiscount(code: string): Promise<DiscountCheckResult> {
  if (!shopifyReady()) return { status: 'unavailable', error: 'Shopify Admin env missing' }
  try {
    const data = await shopifyGraphql<{
      codeDiscountNodeByCode: {
        codeDiscount: {
          __typename: string
          title?: string | null
          status?: string | null
          customerGets?: { value?: { __typename: string; percentage?: number | null } | null } | null
        } | null
      } | null
    }>(
      `query DiscountByCode($code: String!) {
        codeDiscountNodeByCode(code: $code) {
          codeDiscount {
            __typename
            ... on DiscountCodeBasic {
              title
              status
              customerGets {
                value {
                  __typename
                  ... on DiscountPercentage { percentage }
                }
              }
            }
          }
        }
      }`,
      { code },
    )
    const discount = data.codeDiscountNodeByCode?.codeDiscount
    return {
      status: 'checked',
      active: discount?.status === 'ACTIVE',
      percentage: discount?.customerGets?.value?.percentage ?? null,
      title: discount?.title ?? null,
      typename: discount?.__typename ?? null,
    }
  } catch (err) {
    return { status: 'unavailable', error: (err as Error).message }
  }
}

try {
  const rows = await sql<MessageRow[]>`
    SELECT
      m.id AS message_id,
      m.cart_id,
      m.case_id,
      lower(m.email) AS email,
      m.message_type,
      m.sent_at,
      m.subject,
      m.discount_code,
      m.discount_source,
      m.discount_shopify_id,
      COUNT(o.shopify_order_id)::int AS local_prior_orders,
      MIN(o.placed_at) AS local_first_prior_order_at,
      ARRAY_REMOVE(ARRAY_AGG(o.shopify_order_id ORDER BY o.placed_at ASC), NULL) AS local_prior_order_ids
    FROM abandoned_cart_messages m
    LEFT JOIN orders o
      ON lower(o.email) = lower(m.email)
     AND o.placed_at IS NOT NULL
     AND o.placed_at < m.sent_at
     AND o.status IN ('paid', 'fulfilled')
    WHERE m.status = 'sent'
      AND m.sent_at IS NOT NULL
      AND m.message_type IN ('abandoned_cart_1', 'abandoned_cart_2', 'abandoned_cart_3')
    GROUP BY m.id
    ORDER BY m.sent_at DESC
    LIMIT ${limit}`

  const uniqueCodes = Array.from(new Set(rows.map((r) => r.discount_code).filter((c): c is string => Boolean(c))))
  const discountByCode = new Map<string, DiscountCheckResult>()
  for (const code of uniqueCodes) {
    discountByCode.set(code, await checkDiscount(code))
  }

  const shopifyPriorByMessage = new Map<string, ShopifyPriorOrderResult>()
  for (const row of rows) {
    if (!row.discount_code) continue
    shopifyPriorByMessage.set(row.message_id, await checkShopifyPriorOrders(row.email, row.sent_at))
  }

  const withDiscount = rows.filter((r) => r.discount_code)
  const withoutDiscount = rows.filter((r) => !r.discount_code)
  const localViolations = withDiscount.filter((r) => r.local_prior_orders > 0)
  const shopifyViolations = withDiscount.filter((r) => {
    const checked = shopifyPriorByMessage.get(r.message_id)
    return checked?.status === 'checked' && checked.priorOrders > 0
  })
  const noDiscountButLocallyNew = withoutDiscount.filter((r) => r.local_prior_orders === 0)
  const nonTenPercentCodes = uniqueCodes.filter((code) => {
    const checked = discountByCode.get(code)
    return checked?.status === 'checked' && checked.percentage !== 0.1
  })

  console.log(`# Audit abandoned-cart discounts`)
  console.log(`Generated at: ${new Date().toISOString()}`)
  console.log(`Sample: last ${rows.length} sent abandoned-cart emails`)
  console.log(`Shopify direct check: ${shopifyReady() ? 'available' : 'unavailable'}`)
  console.log('')
  console.log(`sent_total=${rows.length}`)
  console.log(`with_discount=${withDiscount.length}`)
  console.log(`without_discount=${withoutDiscount.length}`)
  console.log(`unique_discount_codes=${uniqueCodes.length}`)
  console.log(`local_discount_to_prior_customer=${localViolations.length}`)
  console.log(`shopify_discount_to_prior_customer=${shopifyViolations.length}`)
  console.log(`non_10_percent_discount_codes=${nonTenPercentCodes.length}`)
  console.log(`no_discount_but_locally_new=${noDiscountButLocallyNew.length}`)
  console.log('')

  const byType = rows.reduce<Record<string, { total: number; discount: number }>>((acc, row) => {
    acc[row.message_type] ??= { total: 0, discount: 0 }
    acc[row.message_type].total += 1
    if (row.discount_code) acc[row.message_type].discount += 1
    return acc
  }, {})
  console.log(`## By message_type`)
  for (const [type, stats] of Object.entries(byType)) {
    console.log(`- ${type}: total=${stats.total} with_discount=${stats.discount}`)
  }
  console.log('')

  console.log(`## Discount code checks`)
  for (const code of uniqueCodes) {
    const checked = discountByCode.get(code)
    if (checked?.status === 'checked') {
      console.log(`- ${code}: active=${checked.active} percentage=${checked.percentage} type=${checked.typename}`)
    } else {
      console.log(`- ${code}: unavailable=${checked?.error ?? 'not checked'}`)
    }
  }
  console.log('')

  if (localViolations.length || shopifyViolations.length || nonTenPercentCodes.length) {
    console.log(`## Violations`)
    for (const row of withDiscount) {
      const shopify = shopifyPriorByMessage.get(row.message_id)
      const localBad = row.local_prior_orders > 0
      const shopifyBad = shopify?.status === 'checked' && shopify.priorOrders > 0
      const codeBad = row.discount_code ? nonTenPercentCodes.includes(row.discount_code) : false
      if (!localBad && !shopifyBad && !codeBad) continue
      console.log(
        [
          `- message=${row.message_id}`,
          `sent_at=${row.sent_at.toISOString()}`,
          `recipient=${masked(row.email)}`,
          `type=${row.message_type}`,
          `code=${row.discount_code}`,
          `local_prior_orders=${row.local_prior_orders}`,
          `local_first_prior_order_at=${row.local_first_prior_order_at?.toISOString() ?? 'null'}`,
          `shopify_prior_orders=${shopify?.status === 'checked' ? shopify.priorOrders : 'unavailable'}`,
          `shopify_first_prior_order_at=${shopify?.status === 'checked' ? (shopify.firstPriorOrderAt ?? 'null') : 'unavailable'}`,
        ].join(' '),
      )
    }
  } else {
    console.log(`## Violations`)
    console.log('- none')
  }
  console.log('')

  console.log(`## Last discounted messages`)
  for (const row of withDiscount.slice(0, 20)) {
    const shopify = shopifyPriorByMessage.get(row.message_id)
    console.log(
      [
        `- sent_at=${row.sent_at.toISOString()}`,
        `recipient=${masked(row.email)}`,
        `type=${row.message_type}`,
        `code=${row.discount_code}`,
        `source=${row.discount_source}`,
        `local_prior_orders=${row.local_prior_orders}`,
        `shopify_prior_orders=${shopify?.status === 'checked' ? shopify.priorOrders : 'unavailable'}`,
      ].join(' '),
    )
  }
} finally {
  await sql.end()
}
