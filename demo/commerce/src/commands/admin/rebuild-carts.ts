// Command: rebuild the carts snapshot table from PostHog events.
// Wipes carts + cart_events, replays all cart/checkout events from PostHog
// through the same upsert logic as ingestCartEvent.
//
// Decomposed into 3 steps per WORKFLOW_PROGRESS.md §11:
//   1. fetch-events   — paginated HogQL reads from PostHog (respects ctx.signal).
//   2. replay-events  — ctx.forEach(events, { batchSize: 500 }, apply) — progress + cancel built in.
//   3. persist-stats  — final summary counts.
//
// Compensation is documented as no-op: the rebuild is destructive by design
// (step 2 wipes both tables at the start). The user accepts this trade-off;
// compensation logs a warning only.
//
// Event extraction goes through `normalizeCartEvent` so this command and the
// live subscriber share the exact same read semantics (v2 unified schema +
// v1 legacy fallback). Never inspect `evt.properties` directly here.

import { type NormalizedCartEvent, normalizeCartEvent } from '../../modules/cart-tracking/posthog-adapter'

const STAGES = ['cart', 'checkout_started', 'checkout_engaged', 'payment_attempted', 'completed'] as const

const SPAM_EMAIL_RE = /storebotmail|joonix\.net|mailinator|guerrillamail/i

function actionToStage(action: string): (typeof STAGES)[number] {
  if (action.startsWith('cart:')) return 'cart'
  if (action === 'checkout:started') return 'checkout_started'
  if (action === 'checkout:payment_info_submitted') return 'payment_attempted'
  if (action === 'checkout:completed') return 'completed'
  return 'checkout_engaged'
}

interface PosthogEvent {
  event: string
  distinct_id: string | null
  timestamp: string
  // biome-ignore lint/suspicious/noExplicitAny: PostHog event properties are free-form JSON
  properties: Record<string, any>
}

type RawDb = { raw: <T>(sql: string, params?: unknown[]) => Promise<T[]> }

const POSTHOG_PAGE_SIZE = 1000

export default defineCommand({
  name: 'rebuildCarts',
  description: 'Wipe carts table and rebuild from PostHog event history',
  input: z.object({}),
  workflow: async (_input, { step, log }) => {
    // ── Step 1: fetch-events — paged reads from PostHog ────────────
    const fetchEvents = step.action('fetch-events', {
      invoke: async (_i: unknown, ctx): Promise<{ events: PosthogEvent[] }> => {
        const host = process.env.POSTHOG_HOST ?? 'https://eu.i.posthog.com'
        const key = process.env.POSTHOG_API_KEY
        if (!key) throw new MantaError('INVALID_STATE', 'POSTHOG_API_KEY is required')

        log.info('[rebuildCarts] Fetching events from PostHog (paginated)...')

        // First: a single count query so the progress bar is determinate from
        // the very first poll. ~100ms, negligible vs the paginated fetch.
        const countRes = await fetch(`${host}/api/projects/@current/query/`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: {
              kind: 'HogQLQuery',
              query: `SELECT count() FROM events WHERE event LIKE 'cart:%' OR event LIKE 'checkout:%'`,
            },
          }),
          signal: ctx.signal,
        })
        if (!countRes.ok) throw new MantaError('UNEXPECTED_STATE', `PostHog count ${countRes.status}`)
        const countData = (await countRes.json()) as { results?: unknown[][] }
        const totalEvents = Number(countData.results?.[0]?.[0] ?? 0) || null
        log.info(`[rebuildCarts] Total events to fetch: ${totalEvents ?? 'unknown'}`)

        // Seed the progress bar immediately so the toast shows a determinate
        // bar from the first poll, not an indeterminate spinner.
        ctx.progress?.(0, totalEvents, `Fetching ${totalEvents ?? '?'} events from PostHog`)

        // NOTE: we accumulate all events in memory before replaying them so the
        // replay step can report determinate progress (known total). For
        // PostHog-scale data this is fine; if a user needs to replay truly
        // millions of events, this should be revisited as a follow-up (stream
        // the AsyncIterable directly into ctx.forEach in step 2).
        const events: PosthogEvent[] = []
        let offset = 0
        let page = 0
        while (true) {
          if (ctx.signal?.aborted) {
            throw new MantaError('CONFLICT', 'Cancelled during fetch', { code: 'WORKFLOW_CANCELLED' })
          }

          const res = await fetch(`${host}/api/projects/@current/query/`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query: {
                kind: 'HogQLQuery',
                query: `SELECT event, distinct_id, timestamp, properties FROM events WHERE event LIKE 'cart:%' OR event LIKE 'checkout:%' ORDER BY timestamp ASC LIMIT ${POSTHOG_PAGE_SIZE} OFFSET ${offset}`,
              },
            }),
            signal: ctx.signal,
          })
          if (!res.ok) throw new MantaError('UNEXPECTED_STATE', `PostHog ${res.status}`)
          const data = (await res.json()) as { results?: unknown[][]; columns?: string[] }
          if (!data.results) throw new MantaError('UNEXPECTED_STATE', 'No results from PostHog')

          const batch = data.results.map(
            // biome-ignore lint/suspicious/noExplicitAny: PostHog row shape
            (row: any): PosthogEvent => ({
              event: row[0] as string,
              distinct_id: (row[1] ?? null) as string | null,
              timestamp: row[2] as string,
              properties: typeof row[3] === 'string' ? JSON.parse(row[3]) : (row[3] ?? {}),
            }),
          )

          for (const e of batch) events.push(e)
          page += 1
          offset += batch.length

          ctx.progress?.(
            events.length,
            totalEvents,
            `Fetched ${events.length}${totalEvents ? `/${totalEvents}` : ''} events`,
          )

          if (batch.length < POSTHOG_PAGE_SIZE) break
        }

        log.info(`[rebuildCarts] Fetched ${events.length} events across ${page} page(s)`)
        return { events }
      },
      compensate: async () => {
        // Fetch is side-effect-free — nothing to undo.
      },
    })

    // ── Step 2: replay-events — apply events to carts table ────────
    const replayEvents = step.action('replay-events', {
      invoke: async (
        input: { events: PosthogEvent[] },
        ctx,
      ): Promise<{ rebuilt: number; skipped: number; errors: number }> => {
        const db = ctx.app.resolve('IDatabasePort') as RawDb | undefined
        if (!db) throw new MantaError('UNEXPECTED_STATE', 'No database')

        // Wipe tables at the start — preserves existing behavior. If the
        // workflow is cancelled or fails mid-flight, the carts table is left
        // in an intermediate state (documented trade-off).
        await db.raw('DELETE FROM cart_events')
        await db.raw('DELETE FROM carts')
        log.info('[rebuildCarts] Tables wiped')

        let rebuilt = 0
        let skipped = 0
        let errors = 0

        const forEach = ctx.forEach
        if (!forEach) {
          throw new MantaError('UNEXPECTED_STATE', 'ctx.forEach is required to replay events')
        }

        await forEach(
          input.events,
          {
            batchSize: 500,
            message: (info) => `Replayed ${info.done}/${info.total ?? '?'} events`,
          },
          async (batch) => {
            for (const evt of batch) {
              const outcome = await applyEvent(db, evt, log, errors)
              if (outcome === 'rebuilt') rebuilt += 1
              else if (outcome === 'skipped') skipped += 1
              else errors += 1
            }
          },
        )

        return { rebuilt, skipped, errors }
      },
      compensate: async (output) => {
        // Destructive by design — cannot roll back wiped + rebuilt carts (WP-F13).
        // We surface a structured warn so operators see the cart tables are in an
        // intermediate state after a cancelled/failed rebuild. No automatic repair
        // is possible — the only remedy is to re-run the workflow.
        log.warn(
          'Workflow cancelled after destructive operation — cart tables are in an intermediate state and require manual inspection or a full re-run',
          {
            step: 'replay-events',
            command: 'rebuildCarts',
            nonReversible: true,
            rebuilt: output.rebuilt,
            skipped: output.skipped,
            errors: output.errors,
          },
        )
      },
    })

    // ── Step 3: persist-stats — single summary SELECT ──────────────
    const persistStats = step.action('persist-stats', {
      invoke: async (
        input: { rebuilt: number; skipped: number; errors: number },
        _ctx,
      ): Promise<{ rebuilt: number; skipped: number; errors: number }> => {
        // Summary is derived from step 2's output — we simply forward it.
        // A separate step exists to match the plan's structure (fetch/replay/persist)
        // and give the UI a clear "finalisation" checkpoint.
        log.info(`[rebuildCarts] Done — rebuilt: ${input.rebuilt}, skipped: ${input.skipped}, errors: ${input.errors}`)
        return input
      },
      compensate: async () => {
        // No side-effects.
      },
    })

    // Orchestrate the 3 steps.
    const { events } = await fetchEvents({})
    const replayResult = await replayEvents({ events })
    const result = await persistStats(replayResult)
    return result
  },
})

// ─── Helpers ───────────────────────────────────────────────────────────

type ApplyOutcome = 'rebuilt' | 'skipped' | 'error'

async function applyEvent(
  db: RawDb,
  evt: PosthogEvent,
  log: { warn: (msg: string) => void },
  priorErrors: number,
): Promise<ApplyOutcome> {
  const n: NormalizedCartEvent | null = normalizeCartEvent(evt)
  if (!n) return 'skipped'
  if (n.email && SPAM_EMAIL_RE.test(n.email)) return 'skipped'

  // Only events that carry cart state should overwrite snapshot totals.
  // `checkout:*` + `cart:closed` can fire without re-embedding the cart —
  // we preserve the existing snapshot instead of zeroing it out.
  const items = n.cart_has_payload ? JSON.stringify(n.items) : null
  const totalPrice = n.cart_has_payload ? n.total_price : null
  const currency = n.cart_has_payload ? n.currency : null
  const itemCount = n.cart_has_payload ? n.item_count : null
  const newStage = actionToStage(n.event)

  try {
    // Find by cart_token first, then fall back to distinct_id.
    // (In v1 Shopify sent checkout_token as cart_token for checkout:* events;
    // v2 preserves the original cart_token via a cart attribute, so this
    // fallback is mostly defensive now.)
    let existing = await db.raw<{ id: string; highest_stage: string; status: string; [k: string]: unknown }>(
      'SELECT * FROM carts WHERE cart_token = $1 LIMIT 1',
      [n.cart_token],
    )
    if (existing.length === 0 && n.distinct_id) {
      existing = await db.raw<{ id: string; highest_stage: string; status: string; [k: string]: unknown }>(
        'SELECT * FROM carts WHERE distinct_id = $1 LIMIT 1',
        [n.distinct_id],
      )
    }

    const currentStage = (existing[0]?.highest_stage as string) ?? 'cart'
    const stageIdx = Math.max(STAGES.indexOf(currentStage as never), STAGES.indexOf(newStage))
    const highestStage = STAGES[stageIdx] ?? newStage
    const status = n.event === 'checkout:completed' ? 'completed' : ((existing[0]?.status as string) ?? 'active')
    const merge = (next: unknown, prev: unknown) => next ?? prev ?? null

    // Skip inserting a fresh cart row when the FIRST event for this cart_token
    // carries no purchase signal (empty items AND zero/absent total).
    // These are legitimate noise (cart:viewed on an empty cart page).
    const hasPurchaseSignal = n.items.length > 0 || n.total_price > 0
    if (existing.length === 0 && !hasPurchaseSignal) {
      return 'skipped'
    }

    if (existing.length > 0) {
      const ex = existing[0]
      const nextItems = items ?? (ex.items ? JSON.stringify(ex.items) : JSON.stringify([]))
      const nextTotalPrice = totalPrice ?? (ex.total_price as number | null) ?? 0
      const nextItemCount = itemCount ?? (ex.item_count as number | null) ?? 0
      const nextCurrency = currency ?? (ex.currency as string | null) ?? 'EUR'
      await db.raw(
        `UPDATE carts SET distinct_id=$1, email=$2, first_name=$3, last_name=$4, phone=$5, city=$6, country_code=$7, items=$8::jsonb, total_price=$9, item_count=$10, currency=$11, last_action=$12, last_action_at=$13, highest_stage=$14, status=$15, checkout_token=$16, shopify_order_id=$17, shipping_price=$18, discounts_amount=$19, subtotal_price=$20, total_tax=$21, updated_at=$13 WHERE id=$22`,
        [
          merge(n.distinct_id, ex.distinct_id),
          merge(n.email, ex.email),
          merge(n.first_name, ex.first_name),
          merge(n.last_name, ex.last_name),
          merge(n.phone, ex.phone),
          merge(n.city, ex.city),
          merge(n.country_code, ex.country_code),
          nextItems,
          nextTotalPrice,
          nextItemCount,
          nextCurrency,
          n.event,
          n.occurred_at,
          highestStage,
          status,
          merge(n.checkout_token, ex.checkout_token),
          merge(n.shopify_order_id, ex.shopify_order_id),
          n.shipping_price ?? (ex.shipping_price as number | null),
          n.discounts_amount ?? (ex.discounts_amount as number | null),
          n.subtotal_price ?? (ex.subtotal_price as number | null),
          n.total_tax ?? (ex.total_tax as number | null),
          ex.id,
        ],
      )
    } else {
      await db.raw(
        `INSERT INTO carts (id, cart_token, distinct_id, email, first_name, last_name, phone, city, country_code, items, total_price, item_count, currency, last_action, last_action_at, highest_stage, status, checkout_token, shopify_order_id, shipping_price, discounts_amount, subtotal_price, total_tax, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $14, $14)`,
        [
          n.cart_token,
          n.distinct_id,
          n.email,
          n.first_name,
          n.last_name,
          n.phone,
          n.city,
          n.country_code,
          items ?? '[]',
          totalPrice ?? 0,
          itemCount ?? 0,
          currency ?? 'EUR',
          n.event,
          n.occurred_at,
          highestStage,
          status,
          n.checkout_token,
          n.shopify_order_id,
          n.shipping_price,
          n.discounts_amount,
          n.subtotal_price,
          n.total_tax,
        ],
      )
    }
    return 'rebuilt'
  } catch (err) {
    if (priorErrors < 10) log.warn(`[rebuildCarts] ${evt.event}: ${(err as Error).message.substring(0, 100)}`)
    return 'error'
  }
}
