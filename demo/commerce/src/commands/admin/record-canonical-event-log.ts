import {
  compareIdentityResolvers,
  type IdentityServiceLike,
  type RawPosthogEvent,
} from '../../modules/identity/resolve-event-identity'
import { normalizePosthogEventToCanonical } from '../../modules/event-hub/canonical-posthog'

interface EventLogService {
  create(data: Record<string, unknown>): Promise<unknown>
}

function toDate(value: string): Date {
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed : new Date()
}

function isDuplicateError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /duplicate key|unique constraint|event_id/i.test(message)
}

export default defineCommand({
  name: 'recordCanonicalEventLog',
  description: 'Shadow-normalize one inbound PostHog event into the Event Hub hot log. No dispatch side effects.',
  input: z.object({
    event: z.record(z.unknown()),
    posthog_forwarded: z.boolean().optional(),
    posthog_status: z.number().int().optional().nullable(),
  }),
  workflow: async (input, { step }) => {
    const event = input.event as RawPosthogEvent
    const services = step.service as unknown as IdentityServiceLike & {
      eventLog: EventLogService
    }

    const comparison = await compareIdentityResolvers(event, services)
    const canonical = normalizePosthogEventToCanonical(event, comparison, {
      forwarded: input.posthog_forwarded,
      status: input.posthog_status ?? null,
    })

    if (!canonical) {
      return { ok: true, skipped: true, reason: 'not_canonical_business_event' }
    }

    try {
      await services.eventLog.create({
        event_id: canonical.event_id,
        event_name: canonical.event_name,
        source: canonical.source,
        received_at: new Date(),
        page_type: canonical.page_type,
        market: canonical.market,
        identity_muid: null,
        identity_email_sha256: canonical.identity_email_sha256,
        distinct_id: canonical.distinct_id,
        valid: canonical.valid,
        validation_errors: canonical.validation_errors,
        payload_normalized: canonical.payload_normalized,
      })
    } catch (err) {
      if (isDuplicateError(err)) {
        return { ok: true, duplicate: true, event_id: canonical.event_id, event_name: canonical.event_name }
      }
      throw err
    }

    return {
      ok: true,
      event_id: canonical.event_id,
      event_name: canonical.event_name,
      raw_event_name: canonical.raw_event_name,
      valid: canonical.valid,
      event_time: toDate(canonical.event_time).toISOString(),
    }
  },
})
