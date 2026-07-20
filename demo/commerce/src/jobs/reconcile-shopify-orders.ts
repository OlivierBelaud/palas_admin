// Cron: every 15 minutes — pull recently-paid Shopify orders and
// dispatch `ingestCartEvent` for any local cart that hasn't reached
// `completed`. This is the visitor-session-aware counterpart to
// `reconcile-shopify-daily` (which writes directly to `carts`) — it
// routes through `ingestCartEvent` so the future cohort attribution
// path (Phase D of the visitor-session epic) triggers automatically.
//
// All the work lives in the `reconcileShopifyOrders` command — this is
// a thin scheduler so the same command can be run on demand (admin
// dashboard or `manta exec`).
//
// Production-only: in dev/test we no-op so local servers don't hit the
// prod Shopify Admin API on every reload. Trigger manually via
// `command.reconcileShopifyOrders({})` when needed.

interface ReconcileResult {
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
}

const EMPTY: ReconcileResult = {
  scanned: 0,
  dispatched: 0,
  already_completed: 0,
  no_local_cart: 0,
  errors: 0,
  order_refresh_requested: 0,
  inserted_cart_order_links: 0,
  inserted_order_contact_links: 0,
  deleted_duplicate_links: 0,
  remaining_projection_issues: 0,
  duration_ms: 0,
}

export default defineJob('reconcile-shopify-orders', '*/15 * * * *', async ({ command, log }) => {
  if (process.env.NODE_ENV !== 'production') {
    log.info(`[reconcile-shopify-orders] skipped (NODE_ENV=${process.env.NODE_ENV ?? 'undefined'}, prod-only)`)
    return EMPTY
  }

  const commands = command as unknown as {
    reconcileShopifyOrders(input: Record<string, never>): Promise<ReconcileResult>
  }
  const result = await commands.reconcileShopifyOrders({})
  log.info(
    `[reconcile-shopify-orders] scanned=${result.scanned} dispatched=${result.dispatched} already_completed=${result.already_completed} no_local_cart=${result.no_local_cart} order_refresh_requested=${result.order_refresh_requested} inserted_cart_order_links=${result.inserted_cart_order_links} inserted_order_contact_links=${result.inserted_order_contact_links} deleted_duplicate_links=${result.deleted_duplicate_links} remaining_projection_issues=${result.remaining_projection_issues} errors=${result.errors} duration_ms=${result.duration_ms}`,
  )
  return result
})
