// One-shot backfill — pull Shopify customers + Klaviyo profiles + Shopify
// orders from PostHog DW, dedup by lowercased email, write to prod Neon.
//
// Run with:
//   cd demo/commerce
//   pnpm exec tsx scripts/backfill-prod-v1.ts --prod
//
// Idempotent: ON CONFLICT DO UPDATE on email/shopify_order_id unique keys.

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'

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
const PH_HOST = process.env.POSTHOG_HOST ?? 'https://eu.i.posthog.com'
process.env.POSTHOG_API_KEY ?? process.env.POSTHOG_PERSONAL_API_KEY ?? ''
if (!DATABASE_URL) {
  console.error('DATABASE_URL missing')
  process.exit(1)
}

const sql = postgres(DATABASE_URL, { ssl: useProd ? 'require' : undefined, max: 4, prepare: false })

async function hogql<T = unknown[]>(query: string, label: string): Promise<{ columns: string[]; results: T[] }> {
  const res = await fetch(`${PH_HOST}/api/projects/@current/query/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PH_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query }, refresh: 'force_blocking' }),
  })
  if (!res.ok) throw new Error(`[${label}] HogQL ${res.status} ${await res.text()}`)
  const data = (await res.json()) as { columns?: string[]; results?: T[] }
  return { columns: data.columns ?? [], results: data.results ?? [] }
}

interface ContactDraft {
  email: string
  phone: string | null
  locale: string
  first_name: string | null
  last_name: string | null
  country_code: string | null
  city: string | null
  shopify_customer_id: string | null
  klaviyo_profile_id: string | null
  klaviyo_subscribed: boolean
  klaviyo_suppressed: boolean
  shopify_synced_at: Date | null
  klaviyo_synced_at: Date | null
}

function emptyContact(email: string): ContactDraft {
  return {
    email,
    phone: null,
    locale: 'fr-FR',
    first_name: null,
    last_name: null,
    country_code: null,
    city: null,
    shopify_customer_id: null,
    klaviyo_profile_id: null,
    klaviyo_subscribed: false,
    klaviyo_suppressed: false,
    shopify_synced_at: null,
    klaviyo_synced_at: null,
  }
}

function toDate(v: unknown): Date | null {
  if (!v || typeof v !== 'string') return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

function _tryJson<T = unknown>(s: unknown): T | null {
  if (!s || typeof s !== 'string') return null
  try {
    return JSON.parse(s) as T
  } catch {
    return null
  }
}

// ── Step 1: pull Shopify customers ──────────────────────────────────────
async function pullShopifyCustomers(map: Map<string, ContactDraft>): Promise<number> {
  console.log('[1/5] pull Shopify customers from HogQL...')
  const PAGE = 5000
  let offset = 0
  let total = 0
  while (true) {
    const { results } = await hogql<unknown[]>(
      `SELECT
        id,
        JSONExtractString(default_email_address, 'emailAddress') AS email,
        first_name, last_name, locale,
        JSONExtractString(default_phone_number, 'phoneNumber') AS phone,
        JSONExtractString(default_address, 'city') AS city,
        JSONExtractString(default_address, 'countryCodeV2') AS country,
        toString(created_at) AS shopify_created_at,
        toString(updated_at) AS shopify_updated_at
      FROM shopify_customers
      ORDER BY id
      LIMIT ${PAGE} OFFSET ${offset}`,
      'shopify_customers',
    )
    if (results.length === 0) break
    for (const r of results) {
      const row = r as Array<unknown>
      const email = (row[1] as string | null)?.toLowerCase().trim()
      if (!email) continue
      const draft = map.get(email) ?? emptyContact(email)
      // Shopify wins on e-com fields
      draft.shopify_customer_id = String(row[0])
      draft.first_name = (row[2] as string) || draft.first_name
      draft.last_name = (row[3] as string) || draft.last_name
      const locale = row[4] as string | null
      if (locale) draft.locale = locale
      draft.phone = (row[5] as string) || draft.phone
      draft.city = (row[6] as string) || draft.city
      draft.country_code = (row[7] as string) || draft.country_code
      draft.shopify_synced_at = new Date()
      map.set(email, draft)
      total++
    }
    offset += PAGE
    console.log(`  pulled ${offset} (received ${results.length} this batch)`)
    if (results.length < PAGE) break
  }
  return total
}

// ── Step 2: pull Klaviyo profiles ───────────────────────────────────────
async function pullKlaviyoProfiles(map: Map<string, ContactDraft>): Promise<number> {
  console.log('[2/5] pull Klaviyo profiles from HogQL...')
  const PAGE = 5000
  let offset = 0
  let total = 0
  while (true) {
    const { results } = await hogql<unknown[]>(
      `SELECT
        id, email, first_name, last_name, locale,
        JSONExtractString(location, 'country') AS country,
        JSONExtractString(location, 'city') AS city,
        phone_number,
        toString(created) AS k_created,
        toString(updated) AS k_updated
      FROM klaviyo_profiles
      WHERE email != ''
      ORDER BY id
      LIMIT ${PAGE} OFFSET ${offset}`,
      'klaviyo_profiles',
    )
    if (results.length === 0) break
    for (const r of results) {
      const row = r as Array<unknown>
      const email = (row[1] as string | null)?.toLowerCase().trim()
      if (!email) continue
      const draft = map.get(email) ?? emptyContact(email)
      draft.klaviyo_profile_id = String(row[0])
      // Klaviyo as fallback for missing e-com fields
      draft.first_name = draft.first_name ?? ((row[2] as string) || null)
      draft.last_name = draft.last_name ?? ((row[3] as string) || null)
      const klocale = row[4] as string | null
      if (klocale && draft.locale === 'fr-FR') draft.locale = klocale
      draft.country_code = draft.country_code ?? ((row[5] as string) || null)
      draft.city = draft.city ?? ((row[6] as string) || null)
      draft.phone = draft.phone ?? ((row[7] as string) || null)
      // klaviyo_subscribed / klaviyo_suppressed enriched later via Klaviyo API direct
      draft.klaviyo_synced_at = new Date()
      map.set(email, draft)
      total++
    }
    offset += PAGE
    console.log(`  pulled ${offset} (received ${results.length} this batch)`)
    if (results.length < PAGE) break
  }
  return total
}

// ── Step 3: insert contacts in chunks ───────────────────────────────────
async function insertContacts(map: Map<string, ContactDraft>): Promise<number> {
  console.log(`[3/5] insert ${map.size} contacts...`)
  const CHUNK = 500
  const all = Array.from(map.values())
  let inserted = 0
  for (let i = 0; i < all.length; i += CHUNK) {
    const batch = all.slice(i, i + CHUNK)
    await sql`
      INSERT INTO contacts ${sql(
        batch.map((c) => ({
          email: c.email,
          phone: c.phone,
          locale: c.locale,
          first_name: c.first_name,
          last_name: c.last_name,
          country_code: c.country_code,
          city: c.city,
          shopify_customer_id: c.shopify_customer_id,
          klaviyo_profile_id: c.klaviyo_profile_id,
          klaviyo_subscribed: c.klaviyo_subscribed,
          klaviyo_suppressed: c.klaviyo_suppressed,
          shopify_synced_at: c.shopify_synced_at,
          klaviyo_synced_at: c.klaviyo_synced_at,
        })),
      )}
      ON CONFLICT (email) DO UPDATE SET
        phone = COALESCE(EXCLUDED.phone, contacts.phone),
        locale = EXCLUDED.locale,
        first_name = COALESCE(EXCLUDED.first_name, contacts.first_name),
        last_name = COALESCE(EXCLUDED.last_name, contacts.last_name),
        country_code = COALESCE(EXCLUDED.country_code, contacts.country_code),
        city = COALESCE(EXCLUDED.city, contacts.city),
        shopify_customer_id = COALESCE(EXCLUDED.shopify_customer_id, contacts.shopify_customer_id),
        klaviyo_profile_id = COALESCE(EXCLUDED.klaviyo_profile_id, contacts.klaviyo_profile_id),
        klaviyo_subscribed = EXCLUDED.klaviyo_subscribed,
        klaviyo_suppressed = EXCLUDED.klaviyo_suppressed,
        shopify_synced_at = COALESCE(EXCLUDED.shopify_synced_at, contacts.shopify_synced_at),
        klaviyo_synced_at = COALESCE(EXCLUDED.klaviyo_synced_at, contacts.klaviyo_synced_at),
        updated_at = NOW()
    `
    inserted += batch.length
    console.log(`  inserted ${inserted}/${all.length}`)
  }
  return inserted
}

// ── Step 4: pull orders + insert + link ─────────────────────────────────
async function backfillOrders(): Promise<{ orders: number; links: number }> {
  console.log('[4/5] pull Shopify orders + link to contacts...')
  const PAGE = 5000
  let offset = 0
  let totalOrders = 0
  let totalLinks = 0

  while (true) {
    const { results } = await hogql<unknown[]>(
      `SELECT
        legacy_resource_id AS shopify_order_id,
        lower(email) AS email,
        toString(name) AS order_number,
        display_financial_status AS financial_status,
        display_fulfillment_status AS fulfillment_status,
        toFloat(JSONExtractString(current_total_price_set, 'shopMoney', 'amount')) AS total_price,
        currency_code,
        toString(created_at) AS placed_at,
        toString(cancelled_at) AS cancelled_at
      FROM shopify_orders
      WHERE legacy_resource_id != ''
      ORDER BY legacy_resource_id
      LIMIT ${PAGE} OFFSET ${offset}`,
      'shopify_orders',
    )
    if (results.length === 0) break

    const orderBatch = results.map((r) => {
      const row = r as Array<unknown>
      const finStatus = String(row[3] ?? '').toUpperCase()
      const fulfillStatus = String(row[4] ?? '').toUpperCase()
      const cancelledAt = toDate(row[8])
      const status = cancelledAt
        ? 'cancelled'
        : finStatus === 'REFUNDED'
          ? 'refunded'
          : fulfillStatus === 'FULFILLED'
            ? 'fulfilled'
            : finStatus === 'PAID'
              ? 'paid'
              : 'pending'
      return {
        shopify_order_id: String(row[0]),
        email: (row[1] as string) || null,
        order_number: row[2] as string,
        status,
        financial_status: row[3] as string,
        fulfillment_status: row[4] as string,
        total_price: Number(row[5]) || 0,
        currency: (row[6] as string) || 'EUR',
        items: null as null,
        placed_at: toDate(row[7]),
        cancelled_at: cancelledAt,
        shopify_synced_at: new Date(),
      }
    })

    await sql`
      INSERT INTO orders ${sql(orderBatch)}
      ON CONFLICT (shopify_order_id) DO UPDATE SET
        email = EXCLUDED.email,
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

    totalOrders += orderBatch.length
    offset += PAGE
    console.log(`  inserted orders ${totalOrders} (batch ${results.length})`)
    if (results.length < PAGE) break
  }

  // Link orders to contacts via email
  console.log('  linking orders → contacts via email...')
  const linked = await sql<{ id: string }[]>`
    INSERT INTO order_contact (id, order_id, contact_id, created_at, updated_at)
    SELECT
      gen_random_uuid()::text,
      o.id,
      c.id,
      NOW(),
      NOW()
    FROM orders o
    JOIN contacts c ON LOWER(o.email) = c.email
    WHERE NOT EXISTS (
      SELECT 1 FROM order_contact oc WHERE oc.order_id = o.id AND oc.contact_id = c.id
    )
    RETURNING id
  `
  totalLinks = linked.length
  return { orders: totalOrders, links: totalLinks }
}

// ── Step 5: link existing carts to contacts ─────────────────────────────
async function backfillCartContact(): Promise<number> {
  console.log('[5/5] link existing carts → contacts via email...')
  const linked = await sql<{ id: string }[]>`
    INSERT INTO cart_contact (id, cart_id, contact_id, created_at, updated_at)
    SELECT
      gen_random_uuid()::text,
      ca.id,
      c.id,
      NOW(),
      NOW()
    FROM carts ca
    JOIN contacts c ON LOWER(ca.email) = c.email
    WHERE ca.email IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM cart_contact cc WHERE cc.cart_id = ca.id AND cc.contact_id = c.id
    )
    RETURNING id
  `
  return linked.length
}

try {
  console.log(`[backfill-prod-v1] target: ${useProd ? 'PROD (Neon)' : 'LOCAL'}`)
  const map = new Map<string, ContactDraft>()
  const startedAt = Date.now()

  const customers = await pullShopifyCustomers(map)
  console.log(`  ✓ Shopify customers merged: ${customers}`)

  const profiles = await pullKlaviyoProfiles(map)
  console.log(`  ✓ Klaviyo profiles merged: ${profiles}`)
  console.log(`  → unique contacts after dedup: ${map.size}`)

  const inserted = await insertContacts(map)
  console.log(`  ✓ contacts upserted: ${inserted}`)

  const ordersResult = await backfillOrders()
  console.log(`  ✓ orders upserted: ${ordersResult.orders}, order_contact links created: ${ordersResult.links}`)

  const cartLinks = await backfillCartContact()
  console.log(`  ✓ cart_contact links created: ${cartLinks}`)

  const elapsed = Math.round((Date.now() - startedAt) / 1000)
  console.log(`\n[backfill-prod-v1] DONE in ${elapsed}s`)
} catch (err) {
  console.error('[backfill-prod-v1] FAILED:', err)
  process.exitCode = 1
} finally {
  await sql.end()
}
