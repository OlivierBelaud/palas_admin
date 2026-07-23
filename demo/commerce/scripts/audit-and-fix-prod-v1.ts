// Audit + fix — pull MISSING customers and orders from Shopify Admin direct
// (the DW had ~26% orders with no email at all). Idempotent: only upserts.
//
// Run with:
//   pnpm exec tsx scripts/audit-and-fix-prod-v1.ts --prod

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { shopifyAdminGraphql as requestShopifyAdminGraphql } from '../vercel-fast-functions/shopify-admin-transport.mjs'

const here = dirname(fileURLToPath(import.meta.url))

function loadEnv(rel: string, override: boolean): void {
  const full = resolve(here, '..', rel)
  try {
    const raw = readFileSync(full, 'utf8')
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (!m) continue
      if (override || !process.env[m[1]]) process.env[m[1]] = m[2]
    }
  } catch {
    // ignore
  }
}

const useProd = process.argv.includes('--prod')
loadEnv('.env', false)
if (useProd) loadEnv('.env.production', true)

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('DATABASE_URL missing')
  process.exit(1)
}

const needsSsl = useProd || /neon\.tech|amazonaws\.com|render\.com|railway\.app/.test(DATABASE_URL)
const sql = postgres(DATABASE_URL, { ssl: needsSsl ? 'require' : undefined, max: 4, prepare: false })

async function shopifyGraphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  return await requestShopifyAdminGraphql<T>(query, variables)
}

function toDate(v: unknown): Date | null {
  if (!v || typeof v !== 'string') return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

function gidNum(gid: string): string {
  // gid://shopify/Order/12345 → "12345"
  const m = gid.match(/(\d+)$/)
  return m ? m[1] : gid
}

// ── Pull ALL orders via cursor pagination ───────────────────────────────
async function pullAllOrders(): Promise<
  Array<{
    shopify_order_id: string
    email: string | null
    order_number: string
    status: string
    financial_status: string | null
    fulfillment_status: string | null
    total_price: number
    currency: string
    placed_at: Date | null
    cancelled_at: Date | null
    shopify_synced_at: Date
  }>
> {
  const out: Awaited<ReturnType<typeof pullAllOrders>> = []
  let cursor: string | null = null
  let page = 0

  while (true) {
    page++
    const query = `
      query Orders($cursor: String) {
        orders(first: 250, after: $cursor, sortKey: CREATED_AT) {
          edges {
            cursor
            node {
              id
              name
              email
              displayFinancialStatus
              displayFulfillmentStatus
              cancelledAt
              createdAt
              currentTotalPriceSet { shopMoney { amount currencyCode } }
              customer { email }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `
    type Resp = {
      orders: {
        edges: Array<{
          cursor: string
          node: {
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
        }>
        pageInfo: { hasNextPage: boolean; endCursor: string | null }
      }
    }
    const data: Resp = await shopifyGraphql<Resp>(query, { cursor })
    for (const edge of data.orders.edges) {
      const n = edge.node
      const email = (n.email ?? n.customer?.email ?? '').trim() || null
      const fin = (n.displayFinancialStatus ?? '').toUpperCase()
      const ful = (n.displayFulfillmentStatus ?? '').toUpperCase()
      const cancelledAt = toDate(n.cancelledAt)
      const status = cancelledAt
        ? 'cancelled'
        : fin === 'REFUNDED'
          ? 'refunded'
          : ful === 'FULFILLED'
            ? 'fulfilled'
            : fin === 'PAID'
              ? 'paid'
              : 'pending'
      out.push({
        shopify_order_id: gidNum(n.id),
        email: email ? email.toLowerCase() : null,
        order_number: n.name,
        status,
        financial_status: n.displayFinancialStatus,
        fulfillment_status: n.displayFulfillmentStatus,
        total_price: Number(n.currentTotalPriceSet.shopMoney.amount) || 0,
        currency: n.currentTotalPriceSet.shopMoney.currencyCode || 'EUR',
        placed_at: toDate(n.createdAt),
        cancelled_at: cancelledAt,
        shopify_synced_at: new Date(),
      })
    }
    cursor = data.orders.pageInfo.endCursor
    if (page % 5 === 0 || !data.orders.pageInfo.hasNextPage) {
      console.log(`  orders page ${page}: total so far ${out.length}`)
    }
    if (!data.orders.pageInfo.hasNextPage) break
  }
  return out
}

// ── Pull ALL customers via cursor pagination ────────────────────────────
async function pullAllCustomers(): Promise<
  Array<{
    shopify_customer_id: string
    email: string | null
    first_name: string | null
    last_name: string | null
    locale: string | null
    phone: string | null
    city: string | null
    country_code: string | null
    shopify_synced_at: Date
  }>
> {
  const out: Awaited<ReturnType<typeof pullAllCustomers>> = []
  let cursor: string | null = null
  let page = 0

  while (true) {
    page++
    const query = `
      query Customers($cursor: String) {
        customers(first: 250, after: $cursor) {
          edges {
            cursor
            node {
              id
              email
              firstName
              lastName
              locale
              phone
              defaultAddress { city countryCodeV2 }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `
    type Resp = {
      customers: {
        edges: Array<{
          cursor: string
          node: {
            id: string
            email: string | null
            firstName: string | null
            lastName: string | null
            locale: string | null
            phone: string | null
            defaultAddress: { city: string | null; countryCodeV2: string | null } | null
          }
        }>
        pageInfo: { hasNextPage: boolean; endCursor: string | null }
      }
    }
    const data: Resp = await shopifyGraphql<Resp>(query, { cursor })
    for (const edge of data.customers.edges) {
      const n = edge.node
      const email = (n.email ?? '').trim().toLowerCase() || null
      out.push({
        shopify_customer_id: gidNum(n.id),
        email,
        first_name: n.firstName,
        last_name: n.lastName,
        locale: n.locale,
        phone: n.phone,
        city: n.defaultAddress?.city ?? null,
        country_code: n.defaultAddress?.countryCodeV2 ?? null,
        shopify_synced_at: new Date(),
      })
    }
    cursor = data.customers.pageInfo.endCursor
    if (page % 5 === 0 || !data.customers.pageInfo.hasNextPage) {
      console.log(`  customers page ${page}: total so far ${out.length}`)
    }
    if (!data.customers.pageInfo.hasNextPage) break
  }
  return out
}

// ── Upsert customers as contacts ────────────────────────────────────────
async function upsertContacts(rows: Awaited<ReturnType<typeof pullAllCustomers>>): Promise<number> {
  const withEmail = rows.filter((r) => r.email)
  console.log(`  upserting ${withEmail.length} contacts (skipped ${rows.length - withEmail.length} without email)`)
  const CHUNK = 500
  let done = 0
  for (let i = 0; i < withEmail.length; i += CHUNK) {
    const batch = withEmail.slice(i, i + CHUNK)
    await sql`
      INSERT INTO contacts ${sql(
        batch.map((r) => ({
          email: r.email!,
          phone: r.phone,
          locale: r.locale ?? 'fr-FR',
          first_name: r.first_name,
          last_name: r.last_name,
          country_code: r.country_code,
          city: r.city,
          shopify_customer_id: r.shopify_customer_id,
          shopify_synced_at: r.shopify_synced_at,
        })),
      )}
      ON CONFLICT (email) DO UPDATE SET
        phone = COALESCE(EXCLUDED.phone, contacts.phone),
        locale = COALESCE(EXCLUDED.locale, contacts.locale),
        first_name = COALESCE(EXCLUDED.first_name, contacts.first_name),
        last_name = COALESCE(EXCLUDED.last_name, contacts.last_name),
        country_code = COALESCE(EXCLUDED.country_code, contacts.country_code),
        city = COALESCE(EXCLUDED.city, contacts.city),
        shopify_customer_id = EXCLUDED.shopify_customer_id,
        shopify_synced_at = EXCLUDED.shopify_synced_at,
        updated_at = NOW()
    `
    done += batch.length
    if (done % 2000 === 0 || done === withEmail.length) {
      console.log(`  contacts upserted ${done}/${withEmail.length}`)
    }
  }
  return done
}

// ── Upsert orders ───────────────────────────────────────────────────────
async function upsertOrders(rows: Awaited<ReturnType<typeof pullAllOrders>>): Promise<number> {
  const CHUNK = 500
  let done = 0
  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = rows.slice(i, i + CHUNK)
    await sql`
      INSERT INTO orders ${sql(
        batch.map((r) => ({
          shopify_order_id: r.shopify_order_id,
          email: r.email,
          order_number: r.order_number,
          status: r.status,
          financial_status: r.financial_status,
          fulfillment_status: r.fulfillment_status,
          total_price: r.total_price,
          currency: r.currency,
          items: null,
          placed_at: r.placed_at,
          cancelled_at: r.cancelled_at,
          shopify_synced_at: r.shopify_synced_at,
        })),
      )}
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
    done += batch.length
    if (done % 2000 === 0 || done === rows.length) {
      console.log(`  orders upserted ${done}/${rows.length}`)
    }
  }
  return done
}

// ── Relink everything ───────────────────────────────────────────────────
async function relinkAll(): Promise<{ orderLinks: number; cartLinks: number }> {
  console.log('  relinking orders → contacts...')
  const ol = await sql<{ id: string }[]>`
    INSERT INTO order_contact (id, order_id, contact_id, created_at, updated_at)
    SELECT gen_random_uuid()::text, o.id::text, c.id::text, NOW(), NOW()
    FROM orders o
    JOIN contacts c ON LOWER(o.email) = c.email
    WHERE NOT EXISTS (
      SELECT 1 FROM order_contact oc WHERE oc.order_id = o.id::text AND oc.contact_id = c.id::text
    )
    RETURNING id
  `
  console.log('  relinking carts → contacts...')
  const cl = await sql<{ id: string }[]>`
    INSERT INTO cart_contact (id, cart_id, contact_id, created_at, updated_at)
    SELECT gen_random_uuid()::text, ca.id::text, c.id::text, NOW(), NOW()
    FROM carts ca
    JOIN contacts c ON LOWER(ca.email) = c.email
    WHERE ca.email IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM cart_contact cc WHERE cc.cart_id = ca.id::text AND cc.contact_id = c.id::text
    )
    RETURNING id
  `
  return { orderLinks: ol.length, cartLinks: cl.length }
}

try {
  console.log('[audit-and-fix] target: PROD')
  const t0 = Date.now()

  console.log('[1/4] pull ALL customers from Shopify Admin (paginated)...')
  const customers = await pullAllCustomers()
  console.log(`  → pulled ${customers.length} customers`)

  console.log('[2/4] upsert contacts...')
  const c = await upsertContacts(customers)
  console.log(`  → ${c} contacts written`)

  console.log('[3/4] pull ALL orders from Shopify Admin (paginated)...')
  const orders = await pullAllOrders()
  console.log(`  → pulled ${orders.length} orders`)

  console.log('[4/4] upsert orders + relink...')
  await upsertOrders(orders)
  const links = await relinkAll()
  console.log(`  → ${links.orderLinks} new order_contact links, ${links.cartLinks} new cart_contact links`)

  // Final state
  const [a] = await sql<{ n: string }[]>`SELECT COUNT(*)::text AS n FROM contacts`
  const [b] = await sql<{ n: string }[]>`SELECT COUNT(*)::text AS n FROM orders`
  const [d] = await sql<{ n: string }[]>`SELECT COUNT(*)::text AS n FROM cart_contact`
  const [e] = await sql<{ n: string }[]>`SELECT COUNT(*)::text AS n FROM order_contact`
  const [f] = await sql<{ n: string }[]>`
    SELECT COUNT(*)::text AS n FROM orders o
    WHERE NOT EXISTS (SELECT 1 FROM order_contact oc WHERE oc.order_id = o.id::text)
  `

  console.log(`\n=== FINAL STATE ===`)
  console.log(`contacts:        ${a.n}`)
  console.log(`orders:          ${b.n}`)
  console.log(`order_contact:   ${e.n}`)
  console.log(`cart_contact:    ${d.n}`)
  console.log(`orders orphans:  ${f.n}`)
  console.log(`elapsed:         ${Math.round((Date.now() - t0) / 1000)}s`)
} catch (err) {
  console.error('[audit-and-fix] FAILED:', err)
  process.exitCode = 1
} finally {
  await sql.end()
}
