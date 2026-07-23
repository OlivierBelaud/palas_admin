// Audit orphan orders + enrich contacts with PostHog distinct_id and
// Klaviyo exchange_id cache.
//
// Run with:
//   pnpm exec tsx scripts/audit-orphans-and-enrich.ts --prod

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

const DATABASE_URL = process.env.DATABASE_URL!
const PH_HOST = process.env.POSTHOG_HOST ?? 'https://eu.i.posthog.com'
process.env.POSTHOG_API_KEY ?? process.env.POSTHOG_PERSONAL_API_KEY ?? ''

const sql = postgres(DATABASE_URL, { ssl: useProd ? 'require' : undefined, max: 4, prepare: false })

async function hogql<T = unknown[]>(query: string): Promise<{ columns: string[]; results: T[] }> {
  const res = await fetch(`${PH_HOST}/api/projects/@current/query/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PH_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query }, refresh: 'force_blocking' }),
  })
  if (!res.ok) throw new Error(`HogQL ${res.status} ${await res.text()}`)
  const data = (await res.json()) as { columns?: string[]; results?: T[] }
  return { columns: data.columns ?? [], results: data.results ?? [] }
}

async function shopifyGraphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  return await requestShopifyAdminGraphql<T>(query, variables)
}

function gidNum(gid: string): string {
  const m = gid.match(/(\d+)$/)
  return m ? m[1] : gid
}

// ── Phase 1: pull orders WITH metadata via Shopify Admin to audit orphans ─
async function _auditOrphans(): Promise<void> {
  console.log('[audit-orphans] pulling orders with metadata via Shopify Admin...')
  const orphanRows: Array<{
    shopify_order_id: string
    placed_at: Date | null
    total_price: number
    source_name: string | null
    tags: string[]
    customer_id: string | null
    billing_first: string | null
    billing_last: string | null
    note: string | null
  }> = []

  let cursor: string | null = null
  let page = 0
  while (true) {
    page++
    type Resp = {
      orders: {
        edges: Array<{
          node: {
            id: string
            email: string | null
            createdAt: string
            sourceName: string | null
            tags: string[]
            note: string | null
            customer: { id: string; email: string | null } | null
            billingAddress: { firstName: string | null; lastName: string | null } | null
            currentTotalPriceSet: { shopMoney: { amount: string } }
          }
        }>
        pageInfo: { hasNextPage: boolean; endCursor: string | null }
      }
    }
    const data: Resp = await shopifyGraphql<Resp>(
      `query Orders($cursor: String) {
        orders(first: 250, after: $cursor, query: "email:*") {
          edges { node { id } }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { cursor },
    )
    if (data.orders.edges.length === 0) break
    cursor = data.orders.pageInfo.endCursor
    if (!data.orders.pageInfo.hasNextPage) break
    if (page > 80) break // safety
  }

  // Now pull all orders missing email
  cursor = null
  page = 0
  while (true) {
    page++
    type RespFull = {
      orders: {
        edges: Array<{
          node: {
            id: string
            email: string | null
            createdAt: string
            sourceName: string | null
            tags: string[]
            note: string | null
            customer: { id: string; email: string | null } | null
            billingAddress: { firstName: string | null; lastName: string | null } | null
            currentTotalPriceSet: { shopMoney: { amount: string } }
          }
        }>
        pageInfo: { hasNextPage: boolean; endCursor: string | null }
      }
    }
    const data: RespFull = await shopifyGraphql<RespFull>(
      `query Orders($cursor: String) {
        orders(first: 250, after: $cursor, sortKey: CREATED_AT) {
          edges {
            node {
              id email createdAt sourceName tags note
              customer { id email }
              billingAddress { firstName lastName }
              currentTotalPriceSet { shopMoney { amount } }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { cursor },
    )
    for (const edge of data.orders.edges) {
      const n = edge.node
      const email = (n.email ?? n.customer?.email ?? '').trim()
      if (email) continue // not an orphan
      orphanRows.push({
        shopify_order_id: gidNum(n.id),
        placed_at: n.createdAt ? new Date(n.createdAt) : null,
        total_price: Number(n.currentTotalPriceSet.shopMoney.amount) || 0,
        source_name: n.sourceName,
        tags: n.tags ?? [],
        customer_id: n.customer ? gidNum(n.customer.id) : null,
        billing_first: n.billingAddress?.firstName ?? null,
        billing_last: n.billingAddress?.lastName ?? null,
        note: n.note,
      })
    }
    cursor = data.orders.pageInfo.endCursor
    if (!data.orders.pageInfo.hasNextPage) break
    if (page > 80) break
  }

  console.log(`[audit-orphans] found ${orphanRows.length} orders without email`)

  // Histogram by source_name
  const bySource = new Map<string, number>()
  const byTag = new Map<string, number>()
  let withCustomerId = 0
  let withBillingName = 0

  for (const r of orphanRows) {
    bySource.set(r.source_name ?? '<null>', (bySource.get(r.source_name ?? '<null>') ?? 0) + 1)
    for (const t of r.tags) byTag.set(t, (byTag.get(t) ?? 0) + 1)
    if (r.customer_id) withCustomerId++
    if (r.billing_first || r.billing_last) withBillingName++
  }

  console.log('\n[audit-orphans] By source_name:')
  for (const [k, v] of [...bySource.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v}`)
  }

  console.log('\n[audit-orphans] Top 15 tags:')
  for (const [k, v] of [...byTag.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`  ${k}: ${v}`)
  }

  console.log(`\n[audit-orphans] customer_id present: ${withCustomerId}`)
  console.log(`[audit-orphans] billing_address name present: ${withBillingName}`)

  // Sample 5
  console.log('\n[audit-orphans] sample 5:')
  for (const r of orphanRows.slice(0, 5)) {
    console.log(
      `  #${r.shopify_order_id} ${r.placed_at?.toISOString().split('T')[0]} ${r.total_price}€ src=${r.source_name} tags=${r.tags.slice(0, 3).join(',')} customer_id=${r.customer_id ?? 'null'} name=${r.billing_first ?? ''} ${r.billing_last ?? ''}`,
    )
  }
}

// ── Phase 2: backfill distinct_id from cart_events ──────────────────────
async function _backfillDistinctIds(): Promise<void> {
  console.log('\n[distinct_id] backfilling from cart_events...')
  const result = await sql`
    UPDATE contacts c
    SET distinct_id = sub.distinct_id, updated_at = NOW()
    FROM (
      SELECT DISTINCT ON (LOWER(email)) LOWER(email) AS email_lc, distinct_id
      FROM cart_events
      WHERE email IS NOT NULL AND distinct_id IS NOT NULL
      ORDER BY LOWER(email), occurred_at DESC
    ) sub
    WHERE c.email = sub.email_lc AND c.distinct_id IS NULL
  `
  console.log(`  → updated ${result.count} contacts with distinct_id`)
}

// ── Phase 3: backfill klaviyo_exchange_resolved ──────────────────────────
async function backfillKlaviyoExchanges(): Promise<void> {
  console.log('\n[klaviyo_exchange] backfilling from klaviyo_events...')

  // Pull all (email, exchange_id, event_datetime) tuples from klaviyo_events
  // where the URL contains a _kx parameter.
  let offset = 0
  const PAGE = 5000
  let totalInserted = 0

  while (true) {
    const { results } = await hogql<unknown[]>(
      `SELECT
        lower(kp.email) AS email,
        extract(JSONExtractString(ke.event_properties, 'URL'), '_kx=([^&]+)') AS kx,
        ke.datetime AS sent_at
      FROM klaviyo_events ke
      JOIN klaviyo_profiles kp ON kp.id = JSONExtractString(ke.relationships, 'profile', 'data', 'id')
      WHERE JSONExtractString(ke.event_properties, 'URL') LIKE '%_kx=%'
        AND lower(kp.email) != ''
      ORDER BY email, sent_at DESC
      LIMIT ${PAGE} OFFSET ${offset}`,
    )
    if (results.length === 0) break

    const batch = results
      .map((r) => {
        const row = r as Array<unknown>
        const email = row[0] as string | null
        const kx = row[1] as string | null
        const sent = row[2] as string | null
        if (!email || !kx || !sent) return null
        const decoded = decodeURIComponent(kx)
        return {
          email: email.toLowerCase().trim(),
          exchange_id: decoded,
          resolved_at: new Date(sent),
        }
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)

    if (batch.length === 0) break

    // Dedup by exchange_id within the batch (keep most recent resolved_at)
    const dedupMap = new Map<string, (typeof batch)[number]>()
    for (const r of batch) {
      const ex = dedupMap.get(r.exchange_id)
      if (!ex || r.resolved_at > ex.resolved_at) dedupMap.set(r.exchange_id, r)
    }
    const dedupedBatch = Array.from(dedupMap.values())

    await sql`
      INSERT INTO klaviyo_exchange_resolved ${sql(dedupedBatch)}
      ON CONFLICT (exchange_id) DO UPDATE SET
        resolved_at = GREATEST(EXCLUDED.resolved_at, klaviyo_exchange_resolved.resolved_at),
        updated_at = NOW()
    `
    totalInserted += batch.length
    console.log(`  inserted ${totalInserted} (offset ${offset})`)

    offset += PAGE
    if (results.length < PAGE) break
  }

  console.log(`[klaviyo_exchange] DONE — ${totalInserted} exchange_ids cached`)
}

try {
  console.log('[audit-orphans-and-enrich] target: PROD')
  const t0 = Date.now()

  // auditOrphans() already done in last run
  // backfillDistinctIds() already done in last run
  await backfillKlaviyoExchanges()

  // Final summary
  const [a] = await sql<{ n: string }[]>`SELECT COUNT(*)::text AS n FROM contacts WHERE distinct_id IS NOT NULL`
  const [b] = await sql<{ n: string }[]>`SELECT COUNT(*)::text AS n FROM klaviyo_exchange_resolved`
  console.log(`\n=== FINAL ===`)
  console.log(`contacts with distinct_id: ${a.n}`)
  console.log(`klaviyo_exchange_resolved: ${b.n}`)
  console.log(`elapsed: ${Math.round((Date.now() - t0) / 1000)}s`)
} catch (err) {
  console.error('FAILED:', err)
  process.exitCode = 1
} finally {
  await sql.end()
}
