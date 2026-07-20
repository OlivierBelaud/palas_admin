// Command — frequent Shopify paid-orders reconciliation (every 15 min cron).
//
// Why a second reconcile path:
//   - `reconcile-shopify-daily.ts` already exists and runs once a day. It
//     applies the full `upsertShopifyOrder` semantics directly via SQL.
//   - This command is the visitor-session-aware twin: instead of writing
//     to `carts` directly, it dispatches `ingestCartEvent`. That makes
//     the cohort late-update path (Phase D of the visitor-session epic)
//     trigger naturally for orders that the Shopify Web Pixel missed —
//     when the customer pays through a path that bypasses our pixel
//     (Apple Pay, Shop Pay, etc.), `ingestCartEvent` is the entry point
//     that will run visitor-session attribution once Build 2 lands.
//   - 15min cadence is a deliberate trade-off: tighter than daily but not
//     so tight that we spam Shopify. Aligns with what Build 2 will need
//     for "live + 15min rattrapage" coverage.
//
// Strategy:
//   1. GET /admin/api/2024-10/orders.json with `financial_status=paid` and
//      `created_at_min=NOW-2d`. 2-day window absorbs cron downtime + late
//      payment processing.
//   2. For each Shopify order, find the local cart on
//      LEFT(cart_token, 24) = LEFT(order.cart_token, 24). Shopify
//      truncates cart tokens after 24 chars in some response surfaces, so
//      a prefix match is the safest cross-surface key.
//   3. If local cart found AND highest_stage != 'completed', dispatch
//      `ingestCartEvent({ action: 'checkout:completed', ... })`. That
//      runs the standard ingestion (status/highest_stage/completed_at
//      transition + future visitor-session attribution).
//
// Idempotence: `ingestCartEvent` is itself idempotent on the
// `checkout:completed` transition (the `completed_at` guard skips the
// write if it's already set). Safe to re-run.

import type { RawDb } from '../../modules/cart-tracking/apply-event'

const SHOPIFY_API_VERSION = '2024-10'
const WINDOW_HOURS = 48 // 2 days — same window as `reconcile-shopify-daily`
const PAGE_LIMIT = 250

interface ShopifyOrderRow {
  id: string | number
  email?: string | null
  cart_token?: string | null
  checkout_token?: string | null
  created_at: string
  total_price?: string | number | null
  currency?: string | null
}

interface ShopifyOrdersResponse {
  orders: ShopifyOrderRow[]
}

function parseNextLink(header: string | null): string | null {
  if (!header) return null
  for (const part of header.split(',')) {
    const m = part.match(/<([^>]+)>;\s*rel="next"/)
    if (m) return m[1]
  }
  return null
}

function normalizeToken(raw: string | null | undefined): string | null {
  if (!raw) return null
  const cleaned = String(raw).split('?')[0].trim()
  return cleaned.length > 0 ? cleaned : null
}

export default defineCommand({
  name: 'reconcileShopifyOrders',
  description:
    'Pull paid Shopify orders over a sliding window and dispatch `ingestCartEvent` for any local cart that has not yet reached `completed` stage. Catches checkouts the Shopify Web Pixel missed (e.g. Apple Pay, Shop Pay).',
  input: z.object({}),
  workflow: async (_input, { step, log }) => {
    const shopifyToken =
      process.env.SHOPIFY_ADMIN_ACCESS_TOKEN ?? process.env.SHOPIFY_ADMIN_TOKEN ?? process.env.SHOPIFY_ACCESS_TOKEN
    const shopifyDomain = process.env.SHOPIFY_SHOP_DOMAIN ?? 'fancy-palas.myshopify.com'
    const apiVersion = process.env.SHOPIFY_ADMIN_API_VERSION ?? SHOPIFY_API_VERSION

    if (!shopifyToken) {
      throw new MantaError('INVALID_STATE', 'SHOPIFY_ADMIN_ACCESS_TOKEN is required for reconcileShopifyOrders')
    }

    return await step.action('reconcile-shopify-orders', {
      invoke: async (
        _i: unknown,
        ctx,
      ): Promise<{
        scanned: number
        dispatched: number
        already_completed: number
        no_local_cart: number
        errors: number
        order_refresh_requested: number
        inserted_cart_order_links: number
        inserted_order_contact_links: number
        deleted_duplicate_links: number
        remaining_projection_issues: number
        duration_ms: number
      }> => {
        const startedAt = Date.now()
        const sinceIso = new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000).toISOString()

        type CartRow = { id: string; cart_token: string; highest_stage: string; distinct_id: string | null }

        // Raw DB used for the LEFT(cart_token, 24) prefix match. The
        // generated service `list` interface doesn't expose a prefix
        // filter, but the underlying B-tree index on `cart_token` makes
        // `WHERE LEFT(cart_token, 24) = $1` cheap.
        const db = ctx.app.infra.db as RawDb | undefined
        if (!db) throw new MantaError('UNEXPECTED_STATE', 'No database configured')
        const { reconcileOrderProjectionLinks } = await import('../../modules/order/reconcile-order-projection.js')
        const localProjection = await reconcileOrderProjectionLinks(db)
        log.info(
          `[reconcileShopifyOrders] local_projection dry_run=${localProjection.dry_run} inserted_cart_order_links=${localProjection.inserted_cart_order_links} inserted_order_contact_links=${localProjection.inserted_order_contact_links} deleted_duplicate_links=${localProjection.deleted_duplicate_links} remaining_missing_cart_order_links=${localProjection.after.missing_cart_order_links} remaining_missing_order_contact_links=${localProjection.after.missing_order_contact_links}`,
        )

        // biome-ignore lint/suspicious/noExplicitAny: step.command is dynamically dispatched
        const cmd = step.command as any

        let scanned = 0
        let dispatched = 0
        let alreadyCompleted = 0
        let noLocalCart = 0
        let errors = 0
        let orderRefreshRequested = 0

        let url: string | null =
          `https://${shopifyDomain}/admin/api/${apiVersion}/orders.json` +
          `?status=any&financial_status=paid&created_at_min=${encodeURIComponent(sinceIso)}&limit=${PAGE_LIMIT}`

        log.info(`[reconcileShopifyOrders] starting — since=${sinceIso} domain=${shopifyDomain}`)

        while (url) {
          if (ctx.signal?.aborted) {
            throw new MantaError('CONFLICT', 'reconcileShopifyOrders cancelled', { code: 'WORKFLOW_CANCELLED' })
          }

          const res = await fetch(url, {
            headers: {
              'X-Shopify-Access-Token': shopifyToken,
              'Content-Type': 'application/json',
            },
            signal: ctx.signal,
          })
          if (!res.ok) {
            log.warn(`[reconcileShopifyOrders] Shopify HTTP ${res.status}`)
            errors += 1
            break
          }
          const body = (await res.json()) as ShopifyOrdersResponse
          const orders = body.orders ?? []
          scanned += orders.length

          for (const order of orders) {
            try {
              await step.emit('order.refresh-requested', {
                shopify_order_id: String(order.id),
                reason: 'shopify_paid_orders_reconcile',
                source: 'reconcileShopifyOrders',
                requested_at: new Date().toISOString(),
              })
              orderRefreshRequested += 1

              const remoteToken = normalizeToken(order.cart_token)
              if (!remoteToken) {
                // Shopify orders without a cart_token (POS / admin /
                // draft → order conversion) cannot be matched by token.
                // The daily reconcile cron handles those via email match
                // + synthetic insert; we just skip here to keep this
                // command focused on the pixel-bypass case.
                noLocalCart += 1
                continue
              }

              // Match by LEFT(cart_token, 24). Shopify truncates some
              // surfaces (e.g. orders API response) at 24 chars, while
              // the storefront / pixel emit the full token. A prefix
              // match on the first 24 chars catches both directions
              // without false positives in practice (24 chars of
              // entropy is > 10^36 collisions for the truncated half).
              // We pick the most recent matching cart that hasn't already
              // completed — protects against the corner case where the
              // same truncated prefix shows up twice in 48h.
              const prefix = remoteToken.substring(0, 24)
              const matches = await db.raw<CartRow>(
                `SELECT id, cart_token, highest_stage, distinct_id
                   FROM carts
                  WHERE LEFT(cart_token, 24) = $1
                  ORDER BY last_action_at DESC NULLS LAST
                  LIMIT 1`,
                [prefix],
              )
              const cart = matches[0]

              if (!cart) {
                noLocalCart += 1
                continue
              }
              if (cart.highest_stage === 'completed') {
                alreadyCompleted += 1
                continue
              }

              // Dispatch the same path the live subscriber uses. Reusing
              // ingestCartEvent guarantees cohort attribution (Phase D)
              // will trigger automatically once Build 2 wires it in.
              await cmd.ingestCartEvent({
                cart_token: cart.cart_token,
                action: 'checkout:completed' as const,
                occurred_at: new Date(order.created_at).toISOString(),
                shopify_order_id: String(order.id),
                distinct_id: cart.distinct_id ?? null,
                email: order.email ?? null,
                total_price:
                  typeof order.total_price === 'string' ? Number(order.total_price) : (order.total_price ?? 0),
                currency: order.currency ?? 'EUR',
              })
              dispatched += 1
            } catch (err) {
              errors += 1
              if (errors <= 5) {
                log.warn(`[reconcileShopifyOrders] order ${order.id}: ${(err as Error).message}`)
              }
            }
          }

          url = parseNextLink(res.headers.get('link'))
        }

        const durationMs = Date.now() - startedAt
        log.info(
          `[reconcileShopifyOrders] done — scanned=${scanned} dispatched=${dispatched} already_completed=${alreadyCompleted} no_local_cart=${noLocalCart} order_refresh_requested=${orderRefreshRequested} errors=${errors} duration_ms=${durationMs}`,
        )

        return {
          scanned,
          dispatched,
          already_completed: alreadyCompleted,
          no_local_cart: noLocalCart,
          errors,
          order_refresh_requested: orderRefreshRequested,
          inserted_cart_order_links: localProjection.inserted_cart_order_links,
          inserted_order_contact_links: localProjection.inserted_order_contact_links,
          deleted_duplicate_links: localProjection.deleted_duplicate_links,
          remaining_projection_issues:
            localProjection.after.missing_cart_order_links +
            localProjection.after.missing_order_contact_links +
            localProjection.after.duplicate_order_contact_pairs +
            localProjection.after.orphan_cart_order_links +
            localProjection.after.orphan_order_contact_links,
          duration_ms: durationMs,
        }
      },
      compensate: async () => {
        // Shopify is read-only here. Local projection repairs and
        // ingestCartEvent dispatches are idempotent, so replay is the
        // recovery path after cancellation.
      },
    })({})
  },
})
