// Command: rebuild the carts snapshot table from PostHog events.
// Wipes carts + cart_events, replays all cart/checkout events from PostHog
// through the same upsert logic as ingestCartEvent.

const STAGES = ['cart', 'checkout_started', 'checkout_engaged', 'payment_attempted', 'completed'] as const

function actionToStage(action: string): (typeof STAGES)[number] {
  if (action.startsWith('cart:')) return 'cart'
  if (action === 'checkout:started') return 'checkout_started'
  if (action === 'checkout:payment_info_submitted') return 'payment_attempted'
  if (action === 'checkout:completed') return 'completed'
  return 'checkout_engaged'
}

export default defineCommand({
  name: 'rebuildCarts',
  description: 'Wipe carts table and rebuild from PostHog event history',
  input: z.object({}),
  workflow: async (_input, { step, log }) => {
    type RawDb = { raw: <T>(sql: string, params?: unknown[]) => Promise<T[]> }

    const result = await step.action('rebuild', {
      invoke: async (_i: unknown, ctx) => {
        const db = ctx.app.resolve('IDatabasePort') as RawDb | undefined
        if (!db) throw new MantaError('UNEXPECTED_STATE', 'No database')

        // 1. Fetch events from PostHog
        const host = process.env.POSTHOG_HOST ?? 'https://eu.i.posthog.com'
        const key = process.env.POSTHOG_API_KEY
        if (!key) throw new MantaError('INVALID_STATE', 'POSTHOG_API_KEY is required')

        log.info('[rebuildCarts] Fetching events from PostHog...')
        const res = await fetch(`${host}/api/projects/@current/query/`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: {
              kind: 'HogQLQuery',
              query: `SELECT event, distinct_id, timestamp, properties FROM events WHERE event LIKE 'cart:%' OR event LIKE 'checkout:%' ORDER BY timestamp ASC LIMIT 10000`,
            },
          }),
        })
        if (!res.ok) throw new MantaError('UNEXPECTED_STATE', `PostHog ${res.status}`)
        const data = (await res.json()) as { results?: unknown[][]; columns?: string[] }
        if (!data.results) throw new MantaError('UNEXPECTED_STATE', 'No results from PostHog')

        // biome-ignore lint/suspicious/noExplicitAny: PostHog row shape
        const events = data.results.map((row: any) => ({
          event: row[0] as string,
          distinct_id: row[1] as string,
          timestamp: row[2] as string,
          properties: typeof row[3] === 'string' ? JSON.parse(row[3]) : row[3],
        }))
        log.info(`[rebuildCarts] Fetched ${events.length} events`)

        // 2. Wipe tables
        await db.raw('DELETE FROM cart_events')
        await db.raw('DELETE FROM carts')
        log.info('[rebuildCarts] Tables wiped')

        // 3. Replay events
        let rebuilt = 0
        let skipped = 0
        let errors = 0

        for (const evt of events) {
          const props = evt.properties ?? {}
          const $set = props.$set ?? {}
          const cart = props.cart ?? {}
          const cartToken = (props.cart_token ?? cart.cart_token) as string | undefined
          if (!cartToken) {
            skipped++
            continue
          }
          const email = ($set.email ?? props.email ?? null) as string | null
          if (email && /storebotmail|joonix\.net|mailinator|guerrillamail/i.test(email)) {
            skipped++
            continue
          }

          const items = JSON.stringify(cart.items ?? props.items ?? [])
          const totalPrice = Number(cart.total_price ?? props.total_price ?? 0)
          const currency = (cart.currency ?? props.currency ?? 'EUR') as string
          const itemCount = (cart.items ?? props.items ?? []).length
          const newStage = actionToStage(evt.event)

          try {
            // Find by cart_token first, then fall back to distinct_id
            // (Shopify sends checkout_token as cart_token for checkout:* events)
            let existing = await db.raw<{ id: string; highest_stage: string; status: string; [k: string]: unknown }>(
              'SELECT * FROM carts WHERE cart_token = $1 LIMIT 1',
              [cartToken],
            )
            if (existing.length === 0 && evt.distinct_id) {
              existing = await db.raw<{ id: string; highest_stage: string; status: string; [k: string]: unknown }>(
                'SELECT * FROM carts WHERE distinct_id = $1 LIMIT 1',
                [evt.distinct_id],
              )
            }

            const currentStage = (existing[0]?.highest_stage as string) ?? 'cart'
            const stageIdx = Math.max(STAGES.indexOf(currentStage as never), STAGES.indexOf(newStage))
            const highestStage = STAGES[stageIdx] ?? newStage
            const status =
              evt.event === 'checkout:completed' ? 'completed' : ((existing[0]?.status as string) ?? 'active')
            const merge = (n: unknown, e: unknown) => n ?? e ?? null

            if (existing.length > 0) {
              const ex = existing[0]
              await db.raw(
                `UPDATE carts SET distinct_id=$1, email=$2, first_name=$3, last_name=$4, phone=$5, city=$6, country_code=$7, items=$8::jsonb, total_price=$9, item_count=$10, currency=$11, last_action=$12, last_action_at=$13, highest_stage=$14, status=$15, shopify_order_id=$16, shipping_price=$17, discounts_amount=$18, subtotal_price=$19, total_tax=$20, updated_at=$13 WHERE id=$21`,
                [
                  merge(evt.distinct_id, ex.distinct_id),
                  merge(email, ex.email),
                  merge($set.first_name, ex.first_name),
                  merge($set.last_name, ex.last_name),
                  merge($set.phone, ex.phone),
                  merge($set.city, ex.city),
                  merge($set.country, ex.country_code),
                  items,
                  totalPrice,
                  itemCount,
                  currency,
                  evt.event,
                  evt.timestamp,
                  highestStage,
                  status,
                  merge(props.shopify_order_id, ex.shopify_order_id),
                  props.shipping_price != null ? Number(props.shipping_price) : null,
                  props.discounts_amount != null ? Number(props.discounts_amount) : null,
                  props.subtotal_price != null ? Number(props.subtotal_price) : null,
                  props.total_tax != null ? Number(props.total_tax) : null,
                  ex.id,
                ],
              )
            } else {
              await db.raw(
                `INSERT INTO carts (id, cart_token, distinct_id, email, first_name, last_name, phone, city, country_code, items, total_price, item_count, currency, last_action, last_action_at, highest_stage, status, shopify_order_id, shipping_price, discounts_amount, subtotal_price, total_tax, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $14, $14)`,
                [
                  cartToken,
                  evt.distinct_id,
                  email,
                  $set.first_name ?? null,
                  $set.last_name ?? null,
                  $set.phone ?? null,
                  $set.city ?? null,
                  $set.country ?? null,
                  items,
                  totalPrice,
                  itemCount,
                  currency,
                  evt.event,
                  evt.timestamp,
                  highestStage,
                  status,
                  props.shopify_order_id ?? null,
                  props.shipping_price != null ? Number(props.shipping_price) : null,
                  props.discounts_amount != null ? Number(props.discounts_amount) : null,
                  props.subtotal_price != null ? Number(props.subtotal_price) : null,
                  props.total_tax != null ? Number(props.total_tax) : null,
                ],
              )
            }
            rebuilt++
          } catch (err) {
            errors++
            if (errors <= 10) log.warn(`[rebuildCarts] ${evt.event}: ${(err as Error).message.substring(0, 100)}`)
          }
        }

        return { rebuilt, skipped, errors }
      },
      compensate: async () => {
        log.warn('[rebuildCarts] Cannot undo — data already modified')
      },
    })({})

    log.info(`[rebuildCarts] Done — rebuilt: ${result.rebuilt}, skipped: ${result.skipped}, errors: ${result.errors}`)
    return result
  },
})
