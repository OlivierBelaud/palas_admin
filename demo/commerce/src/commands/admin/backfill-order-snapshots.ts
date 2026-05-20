import {
  mapShopifyOrderNodeToSnapshot,
  normalizeShopifyOrderId,
  type OrderSnapshot,
} from '../../modules/order/refresh-order'
import { ShopifyAdminClient } from '../../modules/shopify-admin/client'

interface RawDb {
  raw<T = unknown>(query: string, params?: unknown[]): Promise<T[]>
}

export interface BackfillOrderSnapshotsInput {
  limit: number
  dryRun: boolean
  onlyMissingItems: boolean
  delayMs: number
}

interface ActionContext {
  app: { resolve<T = unknown>(name: string): T }
  resumeState?: unknown
  budgetMs?: number
  yield?: (resumeState: unknown) => never
}

interface StepWithAction {
  action<TInput, TOutput>(
    name: string,
    config: {
      invoke: (input: TInput, ctx: ActionContext) => Promise<TOutput>
      compensate: (output: TOutput, ctx: ActionContext) => Promise<void>
    },
  ): (input: TInput) => Promise<TOutput>
}

interface CommandLog {
  info(message: string): void
  warn(message: string): void
}

const SHOPIFY_BATCH_SIZE = 50
const YIELD_SAFETY_MS = 800
const MIN_SERVERLESS_SLICE_MS = 45_000

interface BackfillProgress {
  scanned: number
  found: number
  refreshed: number
  dry_run: boolean
  errors: number
  samples: Array<{ shopify_order_id: string; items_count: number }>
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export default defineCommand({
  name: 'backfillOrderSnapshots',
  description: 'Refresh incomplete Order snapshots from Shopify in controlled batches.',
  input: z.object({
    limit: z.number().int().min(1).max(500).default(25),
    dryRun: z.boolean().default(true),
    onlyMissingItems: z.boolean().default(true),
    delayMs: z.number().int().min(0).max(5000).default(150),
  }),
  workflow: async (input, { step, log }) => {
    return runBackfillOrderSnapshots(input, step as StepWithAction, log)
  },
})

export async function runBackfillOrderSnapshots(
  input: BackfillOrderSnapshotsInput,
  step: StepWithAction,
  log: CommandLog,
): Promise<BackfillProgress> {
  const result = await step.action<unknown, BackfillProgress>('backfill-order-snapshots-batch', {
    invoke: async (_i: unknown, ctx) => {
      const startedAt = Date.now()
      const previous = normalizeProgress(ctx.resumeState, input.dryRun)
      const db = ctx.app.resolve<RawDb | undefined>('IDatabasePort')
      if (!db) throw new MantaError('UNEXPECTED_STATE', 'No database configured')

      const remaining = Math.max(0, input.limit - previous.scanned)
      if (remaining === 0) return previous

      const where = input.onlyMissingItems ? "WHERE items IS NULL OR items = '[]'::jsonb" : ''
      const rows = await db.raw<{ shopify_order_id: string }>(
        `SELECT shopify_order_id
           FROM orders
           ${where}
          ORDER BY placed_at DESC NULLS LAST
          LIMIT $1`,
        [remaining],
      )

      const client = new ShopifyAdminClient({
        domain: process.env.SHOPIFY_SHOP_DOMAIN ?? 'fancy-palas.myshopify.com',
      })
      const progress: BackfillProgress = { ...previous, dry_run: input.dryRun, samples: [...previous.samples] }

      for (let offset = 0; offset < rows.length; offset += SHOPIFY_BATCH_SIZE) {
        const batch = rows.slice(offset, offset + SHOPIFY_BATCH_SIZE)
        progress.scanned += batch.length
        const ids = batch.map((row) => `gid://shopify/Order/${normalizeShopifyOrderId(row.shopify_order_id)}`)
        const snapshots = await fetchOrderSnapshotsBatch(client, ids)

        for (const snapshot of snapshots) {
          progress.found += 1
          if (progress.samples.length < 10) {
            progress.samples.push({ shopify_order_id: snapshot.shopify_order_id, items_count: snapshot.items.length })
          }
        }

        if (!input.dryRun && snapshots.length > 0) {
          try {
            await upsertOrderSnapshots(db, snapshots)
            progress.refreshed += snapshots.length
          } catch (err) {
            progress.errors += snapshots.length
            if (progress.errors <= 5) {
              log.warn(`[backfillOrderSnapshots] batch offset ${offset}: ${(err as Error).message}`)
            }
          }
        }

        if (shouldYield(startedAt, ctx.budgetMs) && progress.scanned < input.limit) {
          ctx.yield?.(progress)
        }

        if (input.delayMs > 0 && offset + SHOPIFY_BATCH_SIZE < rows.length) {
          await sleep(input.delayMs)
        }
      }

      return progress
    },
    compensate: async () => {},
  })({})

  log.info(
    `[backfillOrderSnapshots] scanned=${result.scanned} found=${result.found} refreshed=${result.refreshed} dry_run=${input.dryRun} errors=${result.errors}`,
  )
  return result
}

function normalizeProgress(state: unknown, dryRun: boolean): BackfillProgress {
  if (!state || typeof state !== 'object') {
    return { scanned: 0, found: 0, refreshed: 0, dry_run: dryRun, errors: 0, samples: [] }
  }
  const value = state as Partial<BackfillProgress>
  return {
    scanned: Number(value.scanned ?? 0),
    found: Number(value.found ?? 0),
    refreshed: Number(value.refreshed ?? 0),
    dry_run: dryRun,
    errors: Number(value.errors ?? 0),
    samples: Array.isArray(value.samples) ? value.samples.slice(0, 10) : [],
  }
}

function shouldYield(startedAt: number, budgetMs?: number): boolean {
  if (!budgetMs || budgetMs === Infinity) return false
  return Date.now() - startedAt > Math.max(0, Math.max(budgetMs, MIN_SERVERLESS_SLICE_MS) - YIELD_SAFETY_MS)
}

async function fetchOrderSnapshotsBatch(client: ShopifyAdminClient, ids: string[]): Promise<OrderSnapshot[]> {
  if (ids.length === 0) return []
  const data = await client.query<{ nodes: unknown[] }>(
    `query OrdersByIds($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Order {
          id
          name
          email
          displayFinancialStatus
          displayFulfillmentStatus
          cancelledAt
          createdAt
          currentTotalPriceSet { shopMoney { amount currencyCode } }
          customer { id email }
          lineItems(first: 100) {
            edges {
              node {
                id
                title
                quantity
                sku
                variantTitle
                variant { id title product { id } }
                originalUnitPriceSet { shopMoney { amount } }
                discountedTotalSet { shopMoney { amount } }
              }
            }
          }
        }
      }
    }`,
    { ids },
  )
  return data.nodes
    .filter((node): node is Parameters<typeof mapShopifyOrderNodeToSnapshot>[0] => Boolean(node))
    .map((node) => mapShopifyOrderNodeToSnapshot(node))
}

async function upsertOrderSnapshots(db: RawDb, snapshots: OrderSnapshot[]): Promise<void> {
  await db.raw(
    `WITH payload AS (
       SELECT *
         FROM jsonb_to_recordset($1::jsonb) AS x(
           shopify_order_id text,
           shopify_customer_id text,
           email text,
           order_number text,
           status text,
           financial_status text,
           fulfillment_status text,
           total_price numeric,
           currency text,
           items jsonb,
           placed_at timestamptz,
           cancelled_at timestamptz,
           shopify_synced_at timestamptz
         )
     )
     INSERT INTO orders
      (id, shopify_order_id, shopify_customer_id, email, order_number, status, financial_status, fulfillment_status,
       total_price, currency, items, placed_at, cancelled_at, shopify_synced_at, created_at, updated_at)
     SELECT
       gen_random_uuid(), shopify_order_id, shopify_customer_id, email, order_number, status, financial_status, fulfillment_status,
       total_price, currency, items, placed_at, cancelled_at, shopify_synced_at, NOW(), NOW()
     FROM payload
     ON CONFLICT (shopify_order_id) DO UPDATE SET
       email = EXCLUDED.email,
       shopify_customer_id = EXCLUDED.shopify_customer_id,
       order_number = EXCLUDED.order_number,
       status = EXCLUDED.status,
       financial_status = EXCLUDED.financial_status,
       fulfillment_status = EXCLUDED.fulfillment_status,
       total_price = EXCLUDED.total_price,
       currency = EXCLUDED.currency,
       items = EXCLUDED.items,
       placed_at = EXCLUDED.placed_at,
       cancelled_at = EXCLUDED.cancelled_at,
       shopify_synced_at = EXCLUDED.shopify_synced_at,
       updated_at = NOW()`,
    [
      JSON.stringify(
        snapshots.map((snapshot) => ({
          shopify_order_id: snapshot.shopify_order_id,
          shopify_customer_id: snapshot.shopify_customer_id,
          email: snapshot.email,
          order_number: snapshot.order_number,
          status: snapshot.status,
          financial_status: snapshot.financial_status,
          fulfillment_status: snapshot.fulfillment_status,
          total_price: snapshot.total_price,
          currency: snapshot.currency,
          items: snapshot.items,
          placed_at: snapshot.placed_at,
          cancelled_at: snapshot.cancelled_at,
          shopify_synced_at: snapshot.shopify_synced_at,
        })),
      ),
    ],
  )
}
