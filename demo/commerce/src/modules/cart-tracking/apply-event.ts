// Pure event → carts upsert logic, extracted so both the rebuildCarts command
// and the local rebuild-production.mjs maintenance script share the exact
// same semantics. Kept free of framework imports (no defineCommand, no
// globals) so it can be imported from a standalone Node script.

import { matchContactByEventKeys } from '../contact/match-by-event-keys'
import { upsertContactFromEvent } from '../contact/upsert-contact-from-event'
import { type NormalizedCartEvent, normalizeCartEvent } from './posthog-adapter'

export const STAGES = ['cart', 'checkout_started', 'checkout_engaged', 'payment_attempted', 'completed'] as const

export const SPAM_EMAIL_RE = /storebotmail|joonix\.net|mailinator|guerrillamail/i

export interface PosthogEvent {
  uuid?: string
  event: string
  distinct_id: string | null
  timestamp: string
  // biome-ignore lint/suspicious/noExplicitAny: PostHog event properties are free-form JSON
  properties: Record<string, any>
}

export type RawDb = { raw: <T>(sql: string, params?: unknown[]) => Promise<T[]> }

export type ApplyOutcome = 'rebuilt' | 'skipped' | 'error'

export function actionToStage(action: string): (typeof STAGES)[number] {
  if (action.startsWith('cart:')) return 'cart'
  if (action === 'checkout:started') return 'checkout_started'
  if (action === 'checkout:payment_info_submitted') return 'payment_attempted'
  if (action === 'checkout:completed') return 'completed'
  return 'checkout_engaged'
}

export async function applyEvent(
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
    // status is derived: only 'active' or 'completed'. All abandonment
    // variants are derived at read time from highest_stage + last_action_at.
    const status = highestStage === 'completed' ? 'completed' : 'active'
    const merge = (next: unknown, prev: unknown) => next ?? prev ?? null

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

    // Best-effort retroactive contact attachment + link maintenance.
    //
    // Three concerns, in order:
    //   (1) When we know an email, ensure a `contacts` row exists, refresh
    //       identity fields (first-write-wins), and ensure the cart is linked
    //       via `cart_contact`. This is the bulk-replay twin of the live
    //       `upsertContactFromCartSignal` command — without it, every cart
    //       written by `applyEvent` (cron, rebuild) was missing its link.
    //   (2) First-write-wins backfill of `contacts.distinct_id` so anonymous
    //       PostHog ids are recovered the moment an email-bearing event
    //       lands for the same person.
    //   (3) Backfill `carts.shopify_customer_id` from a matched Contact when
    //       the cart still has none — already existed, kept verbatim.
    try {
      const refreshed = await db.raw<{ id: string; shopify_customer_id: string | null }>(
        'SELECT id, shopify_customer_id FROM carts WHERE cart_token = $1 LIMIT 1',
        [n.cart_token],
      )
      const cartRow = refreshed[0]
      if (cartRow) {
        // (1) Upsert contact + link whenever we have an email.
        if (n.email && !SPAM_EMAIL_RE.test(n.email)) {
          await upsertContactFromEvent(db, {
            cart_id: cartRow.id,
            email: n.email,
            first_name: n.first_name,
            last_name: n.last_name,
            phone: n.phone,
            city: n.city,
            country_code: n.country_code,
            distinct_id: n.distinct_id,
            shopify_customer_id: n.shopify_customer_id,
          })
        }

        // (2) (3) Match by ANY key — covers events that carry a distinct_id
        // without an email (anonymous browse session merged later).
        const matched = await matchContactByEventKeys(db, {
          email: n.email,
          distinct_id: n.distinct_id,
          shopify_customer_id: n.shopify_customer_id,
        })
        if (matched) {
          const contactRow = await db.raw<{ shopify_customer_id: string | null; distinct_id: string | null }>(
            'SELECT shopify_customer_id, distinct_id FROM contacts WHERE id = $1 LIMIT 1',
            [matched.id],
          )
          const contact = contactRow[0]
          if (contact) {
            // (3) Backfill cart.shopify_customer_id from contact.
            if (!cartRow.shopify_customer_id && contact.shopify_customer_id) {
              await db.raw('UPDATE carts SET shopify_customer_id = $1 WHERE id = $2 AND shopify_customer_id IS NULL', [
                contact.shopify_customer_id,
                cartRow.id,
              ])
            }
            // (2) Backfill contact.distinct_id from event (first-write-wins).
            if (!contact.distinct_id && n.distinct_id) {
              await db.raw(
                'UPDATE contacts SET distinct_id = $1, updated_at = NOW() WHERE id = $2 AND distinct_id IS NULL',
                [n.distinct_id, matched.id],
              )
            }
          }
        }
      }
    } catch (err) {
      if (priorErrors < 10) log.warn(`[applyEvent] match-contact: ${(err as Error).message.substring(0, 100)}`)
    }

    return 'rebuilt'
  } catch (err) {
    if (priorErrors < 10) log.warn(`[applyEvent] ${evt.event}: ${(err as Error).message.substring(0, 100)}`)
    return 'error'
  }
}
