export default defineCommand({
  name: 'consolidateCarts',
  description:
    'Find duplicate carts (same distinct_id) and merge them: move events to the most recent cart, merge identity fields, delete orphans.',
  input: z.object({}),
  workflow: async (_input, { step, log }) => {
    // Use step.action for raw SQL — these are maintenance operations that cannot use service CRUD
    // MantaInfra.db is typed as `unknown` (framework-agnostic); narrow to the raw() shape we need.
    type RawDb = { raw: <T>(sql: string, params?: unknown[]) => Promise<T[]> }
    const result = await step.action('consolidate-find-duplicates', {
      invoke: async (_i: unknown, ctx) => {
        const db = ctx.app.infra.db as RawDb | undefined
        if (!db) throw new MantaError('UNEXPECTED_STATE', 'No database configured')

        // Find duplicate carts: same distinct_id with multiple entries
        const duplicates = await db.raw<{
          distinct_id: string
          cart_ids: string[]
          tokens: string[]
          cnt: number
        }>(
          `SELECT distinct_id, array_agg(id ORDER BY updated_at DESC) AS cart_ids,
                  array_agg(cart_token ORDER BY updated_at DESC) AS tokens,
                  COUNT(*) AS cnt
           FROM carts
           WHERE distinct_id IS NOT NULL
           GROUP BY distinct_id
           HAVING COUNT(*) > 1`,
        )

        if (duplicates.length === 0) {
          return { consolidated: 0, groups: 0 }
        }

        let totalMerged = 0

        for (const group of duplicates) {
          const cartIds = group.cart_ids
          const keepId = cartIds[0] // most recently updated = main cart

          for (let i = 1; i < cartIds.length; i++) {
            const orphanId = cartIds[i]

            // Move events from orphan to keeper
            await db.raw('UPDATE cart_events SET cart_id = $1 WHERE cart_id = $2', [keepId, orphanId])

            // Merge identity and checkout info from orphan into keeper
            await db.raw(
              `UPDATE carts SET
                email = COALESCE(carts.email, o.email),
                first_name = COALESCE(carts.first_name, o.first_name),
                last_name = COALESCE(carts.last_name, o.last_name),
                phone = COALESCE(carts.phone, o.phone),
                city = COALESCE(carts.city, o.city),
                country_code = COALESCE(carts.country_code, o.country_code),
                shopify_customer_id = COALESCE(carts.shopify_customer_id, o.shopify_customer_id),
                checkout_token = COALESCE(carts.checkout_token, o.checkout_token),
                shopify_order_id = COALESCE(carts.shopify_order_id, o.shopify_order_id),
                highest_stage = CASE
                  WHEN array_position(ARRAY['cart','checkout_started','checkout_engaged','payment_attempted','completed'], carts.highest_stage)
                     >= array_position(ARRAY['cart','checkout_started','checkout_engaged','payment_attempted','completed'], o.highest_stage)
                  THEN carts.highest_stage ELSE o.highest_stage END,
                updated_at = NOW()
              FROM carts o
              WHERE carts.id = $1 AND o.id = $2`,
              [keepId, orphanId],
            )

            // Delete orphan events and cart
            await db.raw('DELETE FROM cart_events WHERE cart_id = $1', [orphanId])
            await db.raw('DELETE FROM carts WHERE id = $1', [orphanId])

            totalMerged++
          }
        }

        return { consolidated: totalMerged, groups: duplicates.length }
      },
      compensate: async (output, _ctx) => {
        // Non-compensable operation — consolidation merges and deletes are irreversible
        log.warn(`[consolidateCarts] Cannot compensate: ${output.consolidated} carts were already merged`)
      },
    })({})

    log.info(`[consolidateCarts] Consolidated ${result.consolidated} duplicate carts across ${result.groups} groups`)

    return result
  },
})
