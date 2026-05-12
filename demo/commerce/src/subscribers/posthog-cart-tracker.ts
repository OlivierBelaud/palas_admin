// Subscriber: posthog.events.received → ingestCartEvent
//
// The plugin-posthog-proxy emits this framework-level event after forwarding
// a PostHog batch to the upstream. This subscriber is the *demo-owned* bridge
// that decides what to do with it — here, routing cart:* / checkout:* events
// to the ingestCartEvent command so the cart-tracking tables get populated.
//
// Identity enrichment: cart:* events don't carry $set.email (the theme only
// populates it on $identify and on checkout:contact_info_submitted). When we
// have a distinct_id but no email, we look up `person.properties.email` via
// PostHog so the cart lands in the DB with its owner attached. Cached 5 min
// per process to avoid hammering PostHog.
//
// No raw SQL. No direct DB access. CQRS-compliant: the subscriber only
// dispatches a command, which goes through service → repository.

import { resolveEmailByDistinctId } from '../modules/cart-tracking/identity-resolver'
import { extractPosthogEvents, toIngestInput } from '../modules/cart-tracking/posthog-adapter'
import { extractSessionId } from '../modules/visitor-session/attribution'

export default defineSubscriber({
  event: 'posthog.events.received',
  subscriberId: 'posthog-cart-tracker',
  handler: async (message, { command, log }) => {
    const data = message.data as { body?: unknown } | undefined
    const events = extractPosthogEvents(data?.body)

    for (const evt of events) {
      const input = toIngestInput(evt)
      const isCartEvent = input != null

      // Email recovery + bot filter only apply to cart events. We compute
      // `email` once and re-use it for the optional session dispatch below.
      let email: string | null = isCartEvent ? ((input.email as string | null) ?? null) : null
      if (isCartEvent) {
        // Skip bots: storebotmail, joonix, known test patterns
        if (email && /storebotmail|joonix\.net|mailinator\.com|guerrillamail/i.test(email)) {
          log.info(`[posthog-cart-tracker] Skipped bot: ${email}`)
          continue
        }

        // Recover email from PostHog person when missing on the event itself.
        // The checkout identity bridge + Klaviyo cookie decrypt upstream have
        // already written $identify → person.properties.email in PostHog for
        // users we've seen before; this closes the loop on cart:* events that
        // land without email in $set.
        if (!email && input.distinct_id) {
          const recovered = await resolveEmailByDistinctId(input.distinct_id as string)
          if (recovered) {
            email = recovered
            input.email = recovered
            log.info(`[posthog-cart-tracker] Recovered email ${recovered} for distinct_id=${input.distinct_id}`)
          }
        }

        try {
          // biome-ignore lint/suspicious/noExplicitAny: command registry is dynamically typed (ingestCartEvent is discovered at boot)
          await (command as any).ingestCartEvent(input)
        } catch (err) {
          log.error(
            `[posthog-cart-tracker] ingestCartEvent failed for ${evt.event}: ${err instanceof Error ? err.message : String(err)}`,
          )
        }
      }

      // ── Visitor-session dispatch ─────────────────────────────────
      // Runs OUTSIDE the cart-event branch: session tracking covers ALL
      // events with a $session_id + distinct_id (pageviews, identifies,
      // checkout:started, cart events, etc.). Errors here MUST NOT abort
      // the loop — cart tracking has already been done, and the cron
      // rattrapage will replay any session-write we lose here.
      const sessionId = extractSessionId(evt as { properties?: Record<string, unknown> })
      const distinctId = (evt.distinct_id ?? null) as string | null
      if (sessionId && distinctId) {
        const props = (evt.properties ?? {}) as Record<string, unknown>
        const $set = (props.$set as Record<string, unknown> | undefined) ?? {}
        const sessionEmail = email ?? ((($set.email as string | undefined) ?? null) as string | null)
        try {
          // biome-ignore lint/suspicious/noExplicitAny: command registry is dynamically typed
          await (command as any).upsertVisitorSessionFromEvent({
            distinct_id: distinctId,
            session_id: sessionId,
            // PostHog SDK sets `$insert_id` for client-side dedup; HogQL rows
            // expose the canonical `uuid` field (used by the cron path).
            event_uuid:
              (evt as { uuid?: string }).uuid ??
              (props.$insert_id as string | undefined) ??
              (props.$event_uuid as string | undefined) ??
              null,
            event_name: (evt.event as string | undefined) ?? '',
            occurred_at: (evt.timestamp as string | undefined) ?? new Date().toISOString(),
            email_on_event: sessionEmail,
            current_url: (props.$current_url as string | undefined) ?? null,
            utm_source: (props.utm_source as string | undefined) ?? null,
            utm_medium: (props.utm_medium as string | undefined) ?? null,
            utm_campaign: (props.utm_campaign as string | undefined) ?? null,
            referring_domain: (props.$referring_domain as string | undefined) ?? null,
          })
        } catch (err) {
          log.error(
            `[posthog-cart-tracker] upsertVisitorSessionFromEvent failed for ${evt.event}: ${err instanceof Error ? err.message : String(err)}`,
          )
        }
      }
    }
  },
})
