// Command: relance abandoned carts via Klaviyo.
//
// Mirrors the selection of the `abandoned-carts` admin page query
// (src/queries/admin/abandoned-carts.ts): identified carts (email != null),
// status != completed, windowed over the last `maxAgeDays`. Adds two
// relance-specific filters on top:
//   - last_action_at <= now - minIdleHours  (don't spam active shoppers)
//   - abandon_notified_at IS NULL           (our own idempotence)
//
// Then enriches via HogQL (klaviyo_events DW) with `last_abandon_email_at`
// — same enrichment the admin page uses. Carts that already received a
// native Shopify/Klaviyo abandonment email within the last 24h are skipped,
// to avoid double-emailing the customer through two parallel systems.
//
// For each remaining cart, sends TWO Klaviyo events:
//   1. "Checkout Abandoned"     — customer-facing, trigger their recovery flow
//   2. "Ops Cart Abandoned"     — internal alert, same profile but distinct
//                                 metric so Klaviyo can route it to an ops flow
// Only when BOTH events succeed do we mark the cart (idempotence). On any
// failure the cart is counted as error and retried on the next cron tick.

import { sendKlaviyoEvent } from '../../utils/klaviyo'
import { buildRecoveryUrl } from '../../utils/recovery-url'

type RawDb = { raw: <T>(sql: string, params?: unknown[]) => Promise<T[]> }

interface EligibleCart {
  id: string
  cart_token: string
  checkout_token: string | null
  email: string
  first_name: string | null
  last_name: string | null
  phone: string | null
  city: string | null
  country_code: string | null
  items: unknown
  total_price: number | null
  item_count: number | null
  currency: string | null
  highest_stage: string
  status: string
  last_action: string
  last_action_at: Date
  abandon_notified_count: number | null
}

const SKIP_RECENT_EMAIL_HOURS = 24

export default defineCommand({
  name: 'notifyAbandonedCarts',
  description: 'Send Klaviyo relance events for abandoned identified carts idle for >= minIdleHours',
  input: z.object({
    minIdleHours: z.number().int().positive().max(720).default(2),
    maxAgeDays: z.number().int().positive().max(90).default(30),
    batchLimit: z.number().int().positive().max(500).default(100),
  }),
  workflow: async (input, { step, log }) => {
    const adminBase = (process.env.ADMIN_BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, '')

    const result = await step.action('notify-abandoned-carts', {
      invoke: async (_i: unknown, ctx) => {
        const db = ctx.app.infra.db as RawDb | undefined
        if (!db) throw new MantaError('UNEXPECTED_STATE', 'No database configured')

        // ── 1. Fetch eligible carts — same filter as abandoned-carts page
        //       + idle >= minIdleHours + not yet notified by us.
        const maxAgeMs = input.maxAgeDays * 86400 * 1000
        const minIdleMs = input.minIdleHours * 3600 * 1000
        const now = Date.now()
        const lowerBound = new Date(now - maxAgeMs)
        const upperBound = new Date(now - minIdleMs)

        const carts = await db.raw<EligibleCart>(
          `SELECT id, cart_token, checkout_token, email, first_name, last_name, phone,
                  city, country_code, items, total_price, item_count, currency,
                  highest_stage, status, last_action, last_action_at,
                  abandon_notified_count
             FROM carts
            WHERE email IS NOT NULL
              AND status <> 'completed'
              AND abandon_notified_at IS NULL
              AND last_action_at >= $1
              AND last_action_at <= $2
            ORDER BY last_action_at ASC
            LIMIT $3`,
          [lowerBound, upperBound, input.batchLimit],
        )

        if (carts.length === 0) {
          log.info('[notifyAbandonedCarts] no eligible carts')
          return { notified: 0, skipped: 0, errors: 0, scanned: 0 }
        }

        // ── 2. Klaviyo enrichment: last_abandon_email_at per email.
        //       Same HogQL as the admin query in abandoned-carts.ts — skip if a
        //       native Shopify/Klaviyo abandonment email was sent recently.
        const emailsList = Array.from(new Set(carts.map((c) => c.email.toLowerCase())))
          .map((e) => `'${e.replace(/'/g, "''")}'`)
          .join(',')

        const lastAbandonEmailByEmail = new Map<string, Date>()
        const phHost = process.env.POSTHOG_HOST ?? 'https://eu.i.posthog.com'
        const phKey = process.env.POSTHOG_API_KEY
        if (phKey && emailsList.length > 0) {
          try {
            const res = await fetch(`${phHost}/api/projects/@current/query/`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${phKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                query: {
                  kind: 'HogQLQuery',
                  query: `
                    SELECT lower(kp.email) AS email, max(ke.datetime) AS last_at
                    FROM klaviyo_events ke
                    JOIN klaviyo_profiles kp ON kp.id = JSONExtractString(ke.relationships, 'profile', 'data', 'id')
                    JOIN klaviyo_metrics km ON km.id = JSONExtractString(ke.relationships, 'metric', 'data', 'id')
                    WHERE lower(kp.email) IN (${emailsList})
                      AND (
                        km.name = 'Shopify_Checkout_Abandonned'
                        OR (
                          km.name = 'Received Email'
                          AND (
                            positionCaseInsensitive(JSONExtractString(ke.event_properties, 'Subject'), 'oublié quelque chose') > 0
                            OR positionCaseInsensitive(JSONExtractString(ke.event_properties, 'Subject'), 'pensez encore') > 0
                            OR positionCaseInsensitive(JSONExtractString(ke.event_properties, 'Subject'), 'attend plus que vous') > 0
                          )
                        )
                      )
                    GROUP BY lower(kp.email)
                    LIMIT 10000
                  `,
                },
                refresh: 'force_blocking',
              }),
              signal: ctx.signal,
            })
            if (res.ok) {
              const data = (await res.json()) as { results?: unknown[][] }
              for (const row of data.results ?? []) {
                const email = row[0] as string | null
                const ts = row[1] as string | null
                if (email && ts) lastAbandonEmailByEmail.set(email, new Date(ts))
              }
            } else {
              log.warn(`[notifyAbandonedCarts] HogQL enrichment ${res.status} — continuing without it`)
            }
          } catch (err) {
            log.warn(`[notifyAbandonedCarts] HogQL enrichment failed: ${(err as Error).message}`)
          }
        }

        const recentEmailCutoff = now - SKIP_RECENT_EMAIL_HOURS * 3600 * 1000

        // ── 3. Iterate + send + mark
        let notified = 0
        let skipped = 0
        let errors = 0

        for (const cart of carts) {
          if (ctx.signal?.aborted) break

          const recent = lastAbandonEmailByEmail.get(cart.email.toLowerCase())
          if (recent && recent.getTime() >= recentEmailCutoff) {
            skipped++
            log.info(`[notifyAbandonedCarts] skip cart=${cart.id} — recent native email at ${recent.toISOString()}`)
            continue
          }

          const itemsArr = Array.isArray(cart.items) ? (cart.items as unknown[]) : []
          const recoveryItems = itemsArr.map((it) => {
            const o = (it ?? {}) as { id?: unknown; quantity?: unknown }
            const id = o.id
            const qty = o.quantity
            return {
              id: typeof id === 'string' || typeof id === 'number' ? id : null,
              quantity: typeof qty === 'number' ? qty : null,
            }
          })

          const recoveryUrl = buildRecoveryUrl({
            checkout_token: cart.checkout_token,
            cart_token: cart.cart_token,
            items: recoveryItems,
          })
          const adminUrl = `${adminBase}/admin/paniers/${cart.id}`

          const baseProps = {
            cart_id: cart.id,
            cart_token: cart.cart_token,
            checkout_token: cart.checkout_token,
            recovery_url: recoveryUrl,
            total_price: cart.total_price ?? 0,
            currency: cart.currency ?? 'EUR',
            item_count: cart.item_count ?? 0,
            items: cart.items ?? [],
            highest_stage: cart.highest_stage,
            last_action: cart.last_action,
            last_action_at:
              cart.last_action_at instanceof Date
                ? cart.last_action_at.toISOString()
                : new Date(cart.last_action_at).toISOString(),
            first_name: cart.first_name,
            last_name: cart.last_name,
            city: cart.city,
            country_code: cart.country_code,
          }

          const nextCount = (cart.abandon_notified_count ?? 0) + 1
          const dedupe = `${cart.id}:${nextCount}`

          const profile = {
            email: cart.email,
            first_name: cart.first_name,
            last_name: cart.last_name,
            phone: cart.phone,
          }

          const customerRes = await sendKlaviyoEvent({
            ...profile,
            metric: 'Checkout Abandoned',
            properties: baseProps,
            value: cart.total_price ?? 0,
            value_currency: cart.currency ?? 'EUR',
            unique_id: `checkout-abandoned:${dedupe}`,
          })

          if (!customerRes.ok) {
            errors++
            log.error(
              `[notifyAbandonedCarts] customer event failed cart=${cart.id} status=${customerRes.status ?? '-'} err=${customerRes.error ?? ''}`,
            )
            continue
          }

          const opsRes = await sendKlaviyoEvent({
            ...profile,
            metric: 'Ops Cart Abandoned',
            properties: { ...baseProps, admin_url: adminUrl },
            value: cart.total_price ?? 0,
            value_currency: cart.currency ?? 'EUR',
            unique_id: `ops-cart-abandoned:${dedupe}`,
          })

          if (!opsRes.ok) {
            errors++
            log.error(
              `[notifyAbandonedCarts] ops event failed cart=${cart.id} status=${opsRes.status ?? '-'} err=${opsRes.error ?? ''}`,
            )
            continue
          }

          // Both events succeeded — mark the cart (idempotence). Failure to
          // mark is treated as an error: the email was sent but the next
          // cron tick will try to send again. We accept this over the
          // opposite risk (mark without sending).
          await db.raw(
            `UPDATE carts
                SET abandon_notified_at = now(),
                    abandon_notified_count = COALESCE(abandon_notified_count, 0) + 1,
                    updated_at = now()
              WHERE id = $1`,
            [cart.id],
          )

          notified++
        }

        return { notified, skipped, errors, scanned: carts.length }
      },
      compensate: async (output, _ctx) => {
        // External email sends are irreversible — compensation is a no-op
        // by design (same pattern as purgeEmptyCarts / rebuildCarts).
        log.warn(`[notifyAbandonedCarts] Non-compensable: ${output.notified} Klaviyo notifications already sent`)
      },
    })({})

    log.info(
      `[notifyAbandonedCarts] scanned=${result.scanned} notified=${result.notified} skipped=${result.skipped} errors=${result.errors}`,
    )
    return result
  },
})
