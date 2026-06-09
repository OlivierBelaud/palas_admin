import { extractPosthogEvents } from '../modules/cart-tracking/posthog-adapter'

export default defineSubscriber({
  event: 'posthog.events.received',
  subscriberId: 'identity-resolution-shadow',
  handler: async (message, { command, log }) => {
    const data = message.data as { body?: unknown } | undefined
    const events = extractPosthogEvents(data?.body)

    for (const evt of events) {
      if (evt.event === '$snapshot') continue

      try {
        // biome-ignore lint/suspicious/noExplicitAny: command registry is dynamically typed
        await (command as any).recordIdentityResolution({ event: evt as unknown as Record<string, unknown> })
      } catch (err) {
        log.error(
          `[identity-resolution-shadow] recordIdentityResolution failed for ${evt.event ?? 'unknown'}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        )
      }
    }
  },
})
