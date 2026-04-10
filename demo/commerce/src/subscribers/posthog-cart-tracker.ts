// Subscriber: posthog.events.received → ingestCartEvent
//
// The plugin-posthog-proxy emits this framework-level event after forwarding
// a PostHog batch to the upstream. This subscriber is the *demo-owned* bridge
// that decides what to do with it — here, routing cart:* / checkout:* events
// to the ingestCartEvent command so the cart-tracking tables get populated.
//
// No raw SQL. No direct DB access. CQRS-compliant: the subscriber only
// dispatches a command, which goes through service → repository.

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
