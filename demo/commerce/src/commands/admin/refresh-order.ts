import { fetchShopifyOrderSnapshot, normalizeShopifyOrderId } from '../../modules/order/refresh-order'

interface RawDb {
  raw<T = unknown>(query: string, params?: unknown[]): Promise<T[]>
}

const REPLACE_FIELDS = [
  'email',
  'order_number',
  'status',
  'financial_status',
  'fulfillment_status',
  'total_price',
  'currency',
  'items',
  'placed_at',
  'cancelled_at',
  'shopify_synced_at',
]

export default defineCommand({
  name: 'refreshOrder',
  description: 'Refresh one Order snapshot from Shopify Admin using shopify_order_id as the key.',
  input: z.object({
    shopify_order_id: z.string().min(1),
    reason: z.string().nullable().optional(),
    source: z.string().nullable().optional(),
    dryRun: z.boolean().default(false),
  }),
  workflow: async (input, { step, log }) => {
    const shopifyOrderId = normalizeShopifyOrderId(input.shopify_order_id)
    const snapshot = await fetchShopifyOrderSnapshot(shopifyOrderId)
    if (!snapshot) {
      log.warn(`[refreshOrder] shopify_order_id=${shopifyOrderId} not found in Shopify`)
      return { shopify_order_id: shopifyOrderId, found: false, changed_fields: [] as string[] }
    }

    const svc = step.service as unknown as {
      order: {
        listOrders(
          filters: Record<string, unknown>,
          opts?: Record<string, unknown>,
        ): Promise<Array<Record<string, unknown>>>
        upsertWithReplace(
          rows: Record<string, unknown>[],
          replaceFields?: string[],
          conflictTarget?: string[],
        ): Promise<Array<{ id: string }>>
      }
    }
    const existing = (await svc.order.listOrders({ shopify_order_id: shopifyOrderId }, { take: 1 }))[0] ?? null
    const changedFields = diffFields(existing, snapshot as unknown as Record<string, unknown>)

    if (!input.dryRun) {
      const rows = await svc.order.upsertWithReplace([snapshot as unknown as Record<string, unknown>], REPLACE_FIELDS, [
        'shopify_order_id',
      ])
      const orderId = rows[0]?.id ?? (existing?.id as string | undefined) ?? null
      if (orderId && snapshot.email) {
        await step.action('link-order-contact', {
          invoke: async (_i: unknown, ctx) => {
            const db = ctx.app.resolve('IDatabasePort') as RawDb | undefined
            if (!db) return null
            await db.raw(
              `INSERT INTO order_contact (id, order_id, contact_id, created_at, updated_at)
               SELECT gen_random_uuid(), $1, c.id::text, NOW(), NOW()
                 FROM contacts c
                WHERE LOWER(c.email) = LOWER($2)
                ORDER BY c.updated_at DESC NULLS LAST
                LIMIT 1
               ON CONFLICT DO NOTHING`,
              [orderId, snapshot.email],
            )
            return null
          },
          compensate: async () => {},
        })({})
        await step.emit('contact.refresh-requested', {
          email: snapshot.email,
          reason: 'shopify_order_refresh',
          source: 'refreshOrder',
          requested_at: new Date().toISOString(),
        })
      }
    }

    log.info(
      `[refreshOrder] shopify_order_id=${shopifyOrderId} dry_run=${input.dryRun} changed=${changedFields.join(',') || '-'} items=${snapshot.items.length}`,
    )
    return {
      shopify_order_id: shopifyOrderId,
      found: true,
      changed_fields: changedFields,
      email: snapshot.email,
      items_count: snapshot.items.length,
      dry_run: input.dryRun,
    }
  },
})

function diffFields(existing: Record<string, unknown> | null, snapshot: Record<string, unknown>): string[] {
  if (!existing) return Object.keys(snapshot)
  const changed: string[] = []
  for (const field of REPLACE_FIELDS) {
    const before = normalizeComparable(existing[field])
    const after = normalizeComparable(snapshot[field])
    if (JSON.stringify(before) !== JSON.stringify(after)) changed.push(field)
  }
  return changed
}

function normalizeComparable(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object') return value
  return value ?? null
}
