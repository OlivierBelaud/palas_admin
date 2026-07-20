import { extractPosthogEvents } from '../modules/cart-tracking/posthog-adapter'

export default defineSubscriber({
  event: 'posthog.events.received',
  subscriberId: 'canonical-event-log-shadow',
  handler: async (message, { command, log }) => {
    const data = message.data as
      | {
          body?: unknown
          posthog?: { forwarded?: boolean; status?: number | null }
          context?: Record<string, unknown>
        }
      | undefined
    const events = extractPosthogEvents(data?.body)
    const posthog = data?.posthog ?? {}
    const failures: unknown[] = []

    for (const evt of events) {
      try {
        // biome-ignore lint/suspicious/noExplicitAny: command registry is dynamically typed.
        await (command as any).recordCanonicalEventLog({
          event: evt as unknown as Record<string, unknown>,
          posthog_forwarded: posthog.forwarded,
          posthog_status: posthog.status ?? null,
          source_context: data?.context ?? {},
        })
      } catch (err) {
        failures.push(err)
        log.error(
          `[canonical-event-log-shadow] recordCanonicalEventLog failed for ${evt.event ?? 'unknown'}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        )
      }
    }

    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) {
      throw new AggregateError(failures, `${failures.length} canonical Event Hub projections failed`)
    }
  },
})
