// Command: rebuild the carts snapshot table from PostHog events.
// Wipes the carts + cart_events tables, then replays all cart:* and checkout:*
// events from PostHog Data Warehouse through ingestCartEvent.

export default defineCommand({
  name: 'rebuildCarts',
  description: 'Wipe carts table and rebuild from PostHog event history',
  input: z.object({}),
  workflow: async (_input, { step, log }) => {
    type RawDb = { raw: <T>(sql: string, params?: unknown[]) => Promise<T[]> }

    // Step 1: Fetch all cart/checkout events from PostHog, ordered chronologically
    const posthogEvents = await step.action('fetch-posthog-events', {
      invoke: async () => {
        const host = process.env.POSTHOG_HOST ?? 'https://eu.i.posthog.com'
        const key = process.env.POSTHOG_API_KEY
        if (!key) throw new MantaError('INVALID_STATE', 'POSTHOG_API_KEY is required for rebuild')

        const res = await fetch(`${host}/api/projects/@current/query/`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: {
              kind: 'HogQLQuery',
              query: `
                SELECT event, distinct_id, timestamp, properties
                FROM events
                WHERE event LIKE 'cart:%' OR event LIKE 'checkout:%'
                ORDER BY timestamp ASC
                LIMIT 10000
              `,
            },
          }),
        })

        if (!res.ok) throw new MantaError('UNEXPECTED_STATE', `PostHog ${res.status}`)

        const data = (await res.json()) as { results?: unknown[][]; columns?: string[] }
        if (!data.results || !data.columns) return []

        return data.results.map((row) => {
          const obj: Record<string, unknown> = {}
          data.columns!.forEach((col, i) => {
            obj[col] = row[i]
          })
          return obj
        })
      },
      compensate: async () => {},
    })({})

    log.info(`[rebuildCarts] Fetched ${posthogEvents.length} events from PostHog`)
    if (posthogEvents.length === 0) return { rebuilt: 0, skipped: 0, errors: 0 }

    // Step 2: Wipe existing carts + cart_events
    await step.action('wipe-tables', {
      invoke: async (_i: unknown, ctx) => {
        const db = ctx.app.infra.db as RawDb | undefined
        if (!db) throw new MantaError('UNEXPECTED_STATE', 'No database')
        await db.raw('DELETE FROM cart_events')
        await db.raw('DELETE FROM carts')
      },
      compensate: async () => {
        log.warn('[rebuildCarts] Cannot undo wipe')
      },
    })({})
    log.info('[rebuildCarts] Tables wiped')

    // Step 3: Replay events through ingestCartEvent command
    let rebuilt = 0
    let skipped = 0
    let errors = 0

    const replay = await step.action('replay-events', {
      invoke: async (_i: unknown, ctx) => {
        const commands = ctx.app.commands as Record<string, (input: unknown) => Promise<unknown>>
        const ingestCartEvent = commands.ingestCartEvent
        if (!ingestCartEvent) throw new MantaError('UNEXPECTED_STATE', 'ingestCartEvent command not found')

        // biome-ignore lint/suspicious/noExplicitAny: PostHog event shape varies
        for (const evt of posthogEvents as any[]) {
          const props = typeof evt.properties === 'string' ? JSON.parse(evt.properties) : (evt.properties ?? {})
          const $set = props.$set ?? {}
          const cart = props.cart ?? {}

          const cartToken = (props.cart_token ?? cart.cart_token) as string | undefined
          if (!cartToken) {
            skipped++
            continue
          }

          // Bot filter
          const email = ($set.email ?? props.email ?? null) as string | null
          if (email && /storebotmail|joonix\.net|mailinator\.com|guerrillamail/i.test(email)) {
            skipped++
            continue
          }

          const items = (cart.items ?? props.items ?? []) as unknown[]

          try {
            await ingestCartEvent({
              cart_token: cartToken,
              action: evt.event,
              occurred_at: evt.timestamp ?? new Date().toISOString(),
              distinct_id: evt.distinct_id ?? null,
              email,
              first_name: ($set.first_name ?? null) as string | null,
              last_name: ($set.last_name ?? null) as string | null,
              phone: ($set.phone ?? null) as string | null,
              city: ($set.city ?? null) as string | null,
              country_code: ($set.country ?? null) as string | null,
              shopify_customer_id: props.shopify_customer_id != null ? String(props.shopify_customer_id) : null,
              items,
              changed_items: props.changed_items ?? null,
              total_price: Number(cart.total_price ?? props.total_price ?? 0),
              currency: (cart.currency ?? props.currency ?? 'EUR') as string,
              order_id: null,
              shopify_order_id: (props.shopify_order_id as string | null) ?? null,
              is_first_order: (props.is_first_order as boolean | null) ?? null,
              shipping_method: (props.shipping_method as string | null) ?? null,
              shipping_price: props.shipping_price != null ? Number(props.shipping_price) : null,
              discounts_amount: props.discounts_amount != null ? Number(props.discounts_amount) : null,
              discounts: props.discounts ?? null,
              subtotal_price: props.subtotal_price != null ? Number(props.subtotal_price) : null,
              total_tax: props.total_tax != null ? Number(props.total_tax) : null,
              raw_properties: props,
            })
            rebuilt++
          } catch (err) {
            errors++
            if (errors <= 10) {
              log.warn(`[rebuildCarts] ${evt.event} failed: ${(err as Error).message}`)
            }
          }
        }

        return { rebuilt, skipped, errors }
      },
      compensate: async () => {
        log.warn('[rebuildCarts] Cannot undo replay')
      },
    })({})

    log.info(`[rebuildCarts] Done — rebuilt: ${replay.rebuilt}, skipped: ${replay.skipped}, errors: ${replay.errors}`)
    return replay
  },
})
