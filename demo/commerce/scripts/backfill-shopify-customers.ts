// One-shot — pull every Shopify customer (paginated REST) and upsert each
// one into `contacts` via the shared `upsertShopifyCustomer` helper. Closes
// the audit gap of ~250 Shopify customers that exist on the merchant side
// but never had a contacts row created (e.g. customers created in Shopify
// Admin before the pixel was deployed).
//
// Idempotent — re-running is a no-op (first-write-wins on identity,
// aggregates refreshed).
//
// Run with:
//   pnpm exec tsx scripts/backfill-shopify-customers.ts          # local DB
//   pnpm exec tsx scripts/backfill-shopify-customers.ts --prod
//   pnpm exec tsx scripts/backfill-shopify-customers.ts --prod --dry-run

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { type ShopifyCustomerPayload, upsertShopifyCustomer } from '../src/modules/contact/upsert-shopify-customer'
import { resolveShopifyAdminConfig, shopifyAdminJson } from '../vercel-fast-functions/shopify-admin-transport.mjs'

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
const dryRun = process.argv.includes('--dry-run')
loadEnv('.env', false)
if (useProd) loadEnv('.env.production', true)

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('DATABASE_URL missing')
  process.exit(1)
}

const shopify = resolveShopifyAdminConfig()
const PAGE_LIMIT = 250

const needsSsl = useProd || /neon\.tech|amazonaws\.com|render\.com|railway\.app/.test(DATABASE_URL)
const sql = postgres(DATABASE_URL, { ssl: needsSsl ? 'require' : undefined, max: 4, prepare: false })

interface ShopifyCustomersResponse {
  customers: ShopifyCustomerPayload[]
}

function parseNextLink(header: string | null): string | null {
  if (!header) return null
  for (const part of header.split(',')) {
    const m = part.match(/<([^>]+)>;\s*rel="next"/)
    if (m) return m[1]
  }
  return null
}

async function fetchCustomersPage(
  url: string,
): Promise<{ customers: ShopifyCustomerPayload[]; nextUrl: string | null }> {
  const { data: body, response } = await shopifyAdminJson<ShopifyCustomersResponse>(url, {}, { maxAttempts: 2 })
  const nextUrl = parseNextLink(response.headers.get('link'))
  return { customers: body.customers ?? [], nextUrl }
}

try {
  console.log(`[backfill-shopify-customers] target: ${useProd ? 'PROD' : 'LOCAL'}  dryRun: ${dryRun}`)
  const t0 = Date.now()

  let url: string | null = `${shopify.endpoint}/customers.json?limit=${PAGE_LIMIT}`

  let scanned = 0
  let matchedByShopifyId = 0
  let matchedByEmail = 0
  let insertedNew = 0
  let noopNoEmail = 0
  let cartsReattachedTotal = 0
  let errors = 0
  let pages = 0

  while (url) {
    pages++
    const { customers, nextUrl } = await fetchCustomersPage(url)
    scanned += customers.length

    for (const customer of customers) {
      try {
        const outcome = await upsertShopifyCustomer(sql, customer, { dryRun })
        if (outcome.matched_via === 'shopify_customer_id') matchedByShopifyId++
        else if (outcome.matched_via === 'email') matchedByEmail++
        else if (outcome.matched_via === 'inserted') insertedNew++
        else if (outcome.matched_via === 'noop') noopNoEmail++
        cartsReattachedTotal += outcome.carts_reattached
      } catch (err) {
        errors++
        if (errors <= 10) {
          console.warn(`  error on customer ${customer.id}: ${(err as Error).message}`)
        }
      }
    }

    console.log(
      `  page=${pages} scanned=${scanned} matched_shopify_id=${matchedByShopifyId} matched_email=${matchedByEmail} inserted_new=${insertedNew} noop_no_email=${noopNoEmail} carts_reattached=${cartsReattachedTotal} errors=${errors}`,
    )

    url = nextUrl
  }

  console.log(`\n=== DONE in ${Math.round((Date.now() - t0) / 1000)}s ===`)
  console.log(`scanned:                  ${scanned}`)
  console.log(`matched_by_shopify_id:    ${matchedByShopifyId}`)
  console.log(`matched_by_email:         ${matchedByEmail}`)
  console.log(`inserted_new:             ${insertedNew}`)
  console.log(`noop_no_email:            ${noopNoEmail}`)
  console.log(`carts_reattached:         ${cartsReattachedTotal}`)
  console.log(`errors:                   ${errors}`)
  if (dryRun) {
    console.log(`\n(dry-run — no rows written)`)
  }
} catch (err) {
  console.error('FAILED:', err)
  process.exitCode = 1
} finally {
  await sql.end()
}
