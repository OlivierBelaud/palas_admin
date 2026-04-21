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

export default defineSubscriber({
  event: 'posthog.events.received',
  subscriberId: 'posthog-cart-tracker',
  handler: async (message, { command, log }) => {
    const data = message.data as { body?: unknown } | undefined
    const events = extractPosthogEvents(data?.body)

    for (const evt of events) {
      const input = toIngestInput(evt)
      if (!input) continue

      // Skip bots: storebotmail, joonix, known test patterns
      let email = input.email as string | null
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
  },
})
