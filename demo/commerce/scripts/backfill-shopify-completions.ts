// One-shot backfill — pull paid Shopify orders over a 60-day window and
// upsert the corresponding rows in `carts` as completed. Closes the gap
// when the storefront Web Pixel misses `checkout:completed` events
// (~28% of conversions). Without this backfill ~68 contacts/month receive
// an abandoned-cart relance email despite having converted on Shopify.
//
// Direct postgres + Shopify REST on purpose — Manta `defineCommand`
// short-circuits at 300ms via Promise.race; from a one-shot CLI we want
// the full pipeline awaited inline. See `detect-abandoned-carts.ts`
// header for the long version of the rationale.
//
// Run with:
//   pnpm exec tsx scripts/backfill-shopify-completions.ts          # local DB
//   pnpm exec tsx scripts/backfill-shopify-completions.ts --prod   # Neon prod
//   pnpm exec tsx scripts/backfill-shopify-completions.ts --prod --dry-run

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
const dryRun = process.argv.includes('--dry-run')
loadEnv('.env', false)
if (useProd) loadEnv('.env.production', true)

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('DATABASE_URL missing')
  process.exit(1)
}

const SHOPIFY_DOMAIN = 'fancy-palas.myshopify.com'
const SHOPIFY_TOKEN =
  process.env.SHOPIFY_ADMIN_TOKEN ?? process.env.SHOPIFY_ACCESS_TOKEN ?? process.env.SHOPIFY_ADMIN_ACCESS_TOKEN
if (!SHOPIFY_TOKEN) {
  console.error(
    '[backfill-shopify-completions] missing SHOPIFY_ADMIN_TOKEN / SHOPIFY_ACCESS_TOKEN / SHOPIFY_ADMIN_ACCESS_TOKEN env',
  )
  process.exit(1)
}
const API_VER = '2024-10'
const WINDOW_DAYS = 60
const PAGE_LIMIT = 250
const MATCH_WINDOW_DAYS = 30

const needsSsl = useProd || /neon\.tech|amazonaws\.com|render\.com|railway\.app/.test(DATABASE_URL)
const sql = postgres(DATABASE_URL, { ssl: needsSsl ? 'require' : undefined, max: 4, prepare: false })

interface ShopifyLineItem {
  id?: number | string
  product_id?: number | string | null
  variant_id?: number | string | null
  sku?: string | null
  title?: string | null
  variant_title?: string | null
  quantity?: number
  price?: string | number | null
  total_discount?: string | number | null
  image_url?: string | null
}

interface ShopifyOrder {
  id: number | string
  email: string | null
  cart_token: string | null
  checkout_token: string | null
  created_at: string
  total_price: string | number | null
  currency: string | null
  line_items: ShopifyLineItem[] | null
  financial_status?: string | null
}

interface ShopifyOrdersResponse {
  orders: ShopifyOrder[]
}

interface CartRow {
  id: string
  email: string | null
  items: unknown
  currency: string | null
  shopify_order_id: string | null
  highest_stage: string
  status: string
  last_action_at: Date | string | null
}

// Some `cart_token` values arrive with a query-string suffix (`?key=...`)
// when ingested via the Web Pixel. Strip it so we match the canonical token.
function normalizeCartToken(raw: string | null): string | null {
  if (!raw) return null
  const cleaned = raw.split('?')[0].trim()
  return cleaned.length > 0 ? cleaned : null
}

function toNumber(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return fallback
}

function mapLineItems(items: ShopifyLineItem[] | null): Array<Record<string, unknown>> {
  if (!Array.isArray(items)) return []
  return items.map((li) => {
    const quantity = typeof li.quantity === 'number' ? li.quantity : 1
    const unitPrice = toNumber(li.price, 0)
    const linePrice = unitPrice * quantity
    return {
      id: li.variant_id != null ? String(li.variant_id) : li.id != null ? String(li.id) : '',
      product_id: li.product_id != null ? String(li.product_id) : '',
      sku: li.sku ?? '',
      title: li.title ?? '',
      variant_title: li.variant_title ?? '',
      quantity,
      price: unitPrice,
      line_price: linePrice,
      image_url: li.image_url ?? null,
      url: null,
    }
  })
}

// Parse the Shopify `Link` header for the `rel="next"` URL.
// Format: `<url>; rel="previous", <url>; rel="next"`
function parseNextLink(header: string | null): string | null {
  if (!header) return null
  const parts = header.split(',')
  for (const part of parts) {
    const m = part.match(/<([^>]+)>;\s*rel="next"/)
    if (m) return m[1]
  }
  return null
}

async function fetchOrdersPage(url: string): Promise<{ orders: ShopifyOrder[]; nextUrl: string | null }> {
  const res = await fetch(url, {
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_TOKEN as string,
      'Content-Type': 'application/json',
    },
  })
  if (!res.ok) {
    throw new Error(`Shopify ${res.status} ${await res.text()}`)
  }
  const body = (await res.json()) as ShopifyOrdersResponse
  const nextUrl = parseNextLink(res.headers.get('link'))
  return { orders: body.orders ?? [], nextUrl }
}

async function findCartByToken(token: string): Promise<CartRow | null> {
  // The pixel ingests the token as `<token>?key=<key>` (URL-encoded form
  // observed in `carts.cart_token`), while the Shopify Orders REST API
  // returns only the bare token. Try exact first, then prefix match.
  let rows = await sql<CartRow[]>`
    SELECT id, email, items, currency, shopify_order_id, highest_stage, status, last_action_at
      FROM carts
     WHERE cart_token = ${token}
     LIMIT 1`
  if (rows.length === 0) {
    rows = await sql<CartRow[]>`
      SELECT id, email, items, currency, shopify_order_id, highest_stage, status, last_action_at
        FROM carts
       WHERE cart_token LIKE ${`${token}?key=%`}
       LIMIT 1`
  }
  return rows[0] ?? null
}

async function findCartByEmailRecent(email: string, createdAt: Date): Promise<CartRow | null> {
  const windowStart = new Date(createdAt.getTime() - MATCH_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const windowEnd = new Date(createdAt.getTime() + 24 * 60 * 60 * 1000)
  const rows = await sql<CartRow[]>`
    SELECT id, email, items, currency, shopify_order_id, highest_stage, status, last_action_at
      FROM carts
     WHERE LOWER(email) = LOWER(${email})
       AND shopify_order_id IS NULL
       AND last_action_at >= ${windowStart}
       AND last_action_at <= ${windowEnd}
     ORDER BY last_action_at DESC
     LIMIT 1`
  return rows[0] ?? null
}

interface CompletionPatch {
  shopifyOrderId: string
  checkoutToken: string | null
  totalPrice: number
  email: string | null
  itemsJson: string
  currency: string
  lastActionAt: Date
}

async function updateCartCompleted(cart: CartRow, patch: CompletionPatch): Promise<void> {
  // First-write-wins on email/items/currency : we don't overwrite a value
  // the cart already carries (cheaper than diffing in SQL, and matches the
  // existing applyEvent merge semantics).
  const nextEmail = cart.email ?? patch.email
  const nextItems = cart.items ?? JSON.parse(patch.itemsJson)
  const nextCurrency = cart.currency ?? patch.currency
  await sql`
    UPDATE carts
       SET status = 'completed',
           highest_stage = 'completed',
           last_action = 'checkout:completed',
           last_action_at = ${patch.lastActionAt},
           shopify_order_id = ${patch.shopifyOrderId},
           checkout_token = COALESCE(checkout_token, ${patch.checkoutToken}),
           total_price = ${patch.totalPrice},
           email = ${nextEmail},
           items = ${sql.json(nextItems as never)},
           currency = ${nextCurrency},
           updated_at = NOW()
     WHERE id = ${cart.id}`
}

async function insertCompletedCart(patch: CompletionPatch & { cartToken: string }): Promise<void> {
  await sql`
    INSERT INTO carts
      (id, cart_token, checkout_token, email, items, total_price, currency,
       last_action, last_action_at, highest_stage, status, shopify_order_id,
       item_count, created_at, updated_at)
    VALUES
      (gen_random_uuid(), ${patch.cartToken}, ${patch.checkoutToken}, ${patch.email},
       ${sql.json(JSON.parse(patch.itemsJson) as never)}, ${patch.totalPrice}, ${patch.currency},
       'checkout:completed', ${patch.lastActionAt}, 'completed', 'completed',
       ${patch.shopifyOrderId}, ${(JSON.parse(patch.itemsJson) as unknown[]).length}, NOW(), NOW())`
}

try {
  console.log(`[backfill-shopify-completions] target: ${useProd ? 'PROD' : 'LOCAL'}  dryRun: ${dryRun}`)
  const t0 = Date.now()

  const sinceIso = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
  let url: string | null =
    `https://${SHOPIFY_DOMAIN}/admin/api/${API_VER}/orders.json` +
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
        const shopifyOrderId = String(order.id)
        const cartTokenRaw = order.cart_token ?? null
        const cartTokenNorm = normalizeCartToken(cartTokenRaw)
        const checkoutToken = order.checkout_token ?? null
        const email = (order.email ?? '').trim() || null
        const createdAt = new Date(order.created_at)
        const totalPrice = toNumber(order.total_price, 0)
        const currency = order.currency ?? 'EUR'
        const lineItems = mapLineItems(order.line_items)
        const itemsJson = JSON.stringify(lineItems)

        let cart: CartRow | null = null
        let matchedVia: 'cart_token' | 'email' | null = null

        if (cartTokenNorm) {
          cart = await findCartByToken(cartTokenNorm)
          if (cart) matchedVia = 'cart_token'
        }

        if (!cart && email) {
          cart = await findCartByEmailRecent(email, createdAt)
          if (cart) matchedVia = 'email'
        }

        if (cart) {
          if (cart.shopify_order_id && cart.highest_stage === 'completed') {
            alreadyCompletedSkip++
            continue
          }
          if (dryRun) {
            if (matchedVia === 'cart_token') matchedByCartToken++
            else if (matchedVia === 'email') matchedByEmail++
            continue
          }
          await updateCartCompleted(cart, {
            shopifyOrderId,
            checkoutToken,
            totalPrice,
            email,
            itemsJson,
            currency,
            lastActionAt: createdAt,
          })
          if (matchedVia === 'cart_token') matchedByCartToken++
          else if (matchedVia === 'email') matchedByEmail++
        } else {
          // No cart row at all (likely a POS / admin order with no Shopify
          // cart_token). Insert a synthetic completed row so analytics +
          // anti-relance guards see it.
          if (dryRun) {
            insertedNew++
            continue
          }
          const syntheticToken = cartTokenNorm ?? `shopify-order-${shopifyOrderId}`
          await insertCompletedCart({
            cartToken: syntheticToken,
            checkoutToken,
            totalPrice,
            email,
            itemsJson,
            currency,
            lastActionAt: createdAt,
            shopifyOrderId,
          })
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
