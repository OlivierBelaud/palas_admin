// One-shot backfill — pull paid Shopify orders over a 60-day window and
// upsert the corresponding rows in `carts` as completed. Closes the gap
// when the storefront Web Pixel misses `checkout:completed` events
// (~28% of conversions). Without this backfill ~68 contacts/month receive
// an abandoned-cart relance email despite having converted on Shopify.
//
// Shares the exact same matching + upsert logic as the live webhook and
// the daily reconcile cron — see `upsert-shopify-order.ts`. Direct
// postgres + Shopify REST on purpose (same rationale as the abandoned
// carts cron, see `detect-abandoned-carts.ts` header).
//
// Run with:
//   pnpm exec tsx scripts/backfill-shopify-completions.ts          # local DB
//   pnpm exec tsx scripts/backfill-shopify-completions.ts --prod   # Neon prod
//   pnpm exec tsx scripts/backfill-shopify-completions.ts --prod --dry-run

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { type ShopifyOrderPayload, upsertShopifyOrder } from '../src/modules/cart-tracking/upsert-shopify-order'
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
const WINDOW_DAYS = 60
const PAGE_LIMIT = 250

const needsSsl = useProd || /neon\.tech|amazonaws\.com|render\.com|railway\.app/.test(DATABASE_URL)
const sql = postgres(DATABASE_URL, { ssl: needsSsl ? 'require' : undefined, max: 4, prepare: false })

interface ShopifyOrdersResponse {
  orders: ShopifyOrderPayload[]
}

function parseNextLink(header: string | null): string | null {
  if (!header) return null
  for (const part of header.split(',')) {
    const m = part.match(/<([^>]+)>;\s*rel="next"/)
    if (m) return m[1]
  }
  return null
}

async function fetchOrdersPage(url: string): Promise<{ orders: ShopifyOrderPayload[]; nextUrl: string | null }> {
  const { data: body, response } = await shopifyAdminJson<ShopifyOrdersResponse>(url, {}, { maxAttempts: 2 })
  const nextUrl = parseNextLink(response.headers.get('link'))
  return { orders: body.orders ?? [], nextUrl }
}

try {
  console.log(`[backfill-shopify-completions] target: ${useProd ? 'PROD' : 'LOCAL'}  dryRun: ${dryRun}`)
  const t0 = Date.now()

  const sinceIso = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
  let url: string | null =
    `${shopify.endpoint}/orders.json` +
    `?status=any&financial_status=paid&created_at_min=${encodeURIComponent(sinceIso)}&limit=${PAGE_LIMIT}`

  let scanned = 0
  let matchedByCartToken = 0
  let matchedByEmail = 0
  let insertedNew = 0
  let alreadyCompletedSkip = 0
  let errors = 0
  let pages = 0

  while (url) {
    pages++
    const { orders, nextUrl } = await fetchOrdersPage(url)
    scanned += orders.length

    for (const order of orders) {
      try {
        const outcome = await upsertShopifyOrder(sql, order, { dryRun })
        if (outcome.already_completed) {
          alreadyCompletedSkip++
        } else if (outcome.matched_via === 'cart_token') {
          matchedByCartToken++
        } else if (outcome.matched_via === 'email') {
          matchedByEmail++
        } else if (outcome.matched_via === 'inserted') {
          insertedNew++
        }
      } catch (err) {
        errors++
        if (errors <= 10) {
          console.warn(`  error on order ${order.id}: ${(err as Error).message}`)
        }
      }
    }

    console.log(
      `  page=${pages} scanned=${scanned} matched_cart_token=${matchedByCartToken} matched_email=${matchedByEmail} inserted_new=${insertedNew} already_completed_skip=${alreadyCompletedSkip} errors=${errors}`,
    )

    url = nextUrl
  }

  console.log(`\n=== DONE in ${Math.round((Date.now() - t0) / 1000)}s ===`)
  console.log(`scanned:                  ${scanned}`)
  console.log(`matched_by_cart_token:    ${matchedByCartToken}`)
  console.log(`matched_by_email:         ${matchedByEmail}`)
  console.log(`inserted_new:             ${insertedNew}`)
  console.log(`already_completed_skip:   ${alreadyCompletedSkip}`)
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
