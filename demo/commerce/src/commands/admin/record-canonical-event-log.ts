import { isGa4CanonicalEventName } from '../../modules/event-hub/canonical-contract'
import { normalizePosthogEventToCanonical } from '../../modules/event-hub/canonical-posthog'
import { flushDispatchLogByEventDestinationKey, type RawDispatchDb } from '../../modules/event-hub/dispatch-runner'
import { ga4DestinationConnector, mapCanonicalToGa4 } from '../../modules/event-hub/ga4-connector'
import { mapCanonicalToGoogleAds } from '../../modules/event-hub/google-ads-connector'
import {
  compareIdentityResolvers,
  type IdentityServiceLike,
  type RawPosthogEvent,
} from '../../modules/identity/resolve-event-identity'

interface EventLogService {
  create(data: Record<string, unknown>): Promise<unknown>
}

interface DispatchLogService {
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
  description: 'Normalize one inbound PostHog event into Event Hub and immediately dispatch ready GA4 payloads.',
  input: z.object({
    event: z.record(z.unknown()),
    posthog_forwarded: z.boolean().optional(),
    posthog_status: z.number().int().optional().nullable(),
    source_context: z.record(z.unknown()).optional(),
  }),
  workflow: async (input, { step }) => {
    const event = input.event as RawPosthogEvent
    const services = step.service as unknown as IdentityServiceLike & {
      eventLog: EventLogService
      dispatchLog: DispatchLogService
    }

    const comparison = await compareIdentityResolvers(event, services)
    const canonical = normalizePosthogEventToCanonical(
      event,
      comparison,
      {
        forwarded: input.posthog_forwarded,
        status: input.posthog_status ?? null,
      },
      input.source_context ?? {},
    )

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

    if (isGa4CanonicalEventName(canonical.event_name)) {
      const ga4 = mapCanonicalToGa4(canonical.event_name, canonical.payload_normalized)
      try {
        await services.dispatchLog.create({
          event_destination_key: `${canonical.event_id}:ga4`,
          event_id: canonical.event_id,
          canonical_event_name: canonical.event_name,
          source_event_name: canonical.raw_event_name,
          destination: 'ga4',
          status: ga4.ok ? 'pending' : 'invalid',
          event_received_at: toDate(canonical.event_time),
          first_attempt_at: null,
          last_attempt_at: null,
          next_attempt_at: ga4.ok ? new Date() : null,
          sent_at: null,
          attempt_count: 0,
          http_status: null,
          error_code: ga4.ok ? null : (ga4.errors[0] ?? 'ga4_invalid_payload'),
          error_message: ga4.ok ? null : ga4.errors.join(', '),
          request_payload: ga4.payload,
          response_payload: null,
          metadata: { ...ga4.metadata, ready: ga4.ok, errors: ga4.ok ? [] : ga4.errors },
        })
      } catch (err) {
        if (!isDuplicateError(err)) throw err
      }

      if (ga4.ok) {
        await step.action('flush-live-ga4-dispatch', {
          invoke: async (_i: unknown, ctx) => {
            const db = ctx.app.resolve('IDatabasePort') as RawDispatchDb | undefined
            if (!db?.raw) throw new MantaError('UNEXPECTED_STATE', 'No database configured')

            return flushDispatchLogByEventDestinationKey({
              db,
              connector: ga4DestinationConnector,
              eventDestinationKey: `${canonical.event_id}:ga4`,
              signal: ctx.signal,
            })
          },
          compensate: async () => {
            // Dispatch rows are idempotent by event_destination_key; the cron
            // retry path resumes pending/retry rows after partial progress.
          },
        })({})
      }
    }

    const googleAds = mapCanonicalToGoogleAds(canonical.event_name, canonical.payload_normalized)
    if (googleAds.supported) {
      try {
        await services.dispatchLog.create({
          event_destination_key: `${canonical.event_id}:google_ads`,
          event_id: canonical.event_id,
          canonical_event_name: canonical.event_name,
          source_event_name: canonical.raw_event_name,
          destination: 'google_ads',
          status: googleAds.ok ? 'pending' : 'invalid',
          event_received_at: toDate(canonical.event_time),
          first_attempt_at: null,
          last_attempt_at: null,
          next_attempt_at: googleAds.ok ? new Date() : null,
          sent_at: null,
          attempt_count: 0,
          http_status: null,
          error_code: googleAds.ok ? null : (googleAds.errors[0] ?? 'google_ads_invalid_payload'),
          error_message: googleAds.ok ? null : googleAds.errors.join(', '),
          request_payload: googleAds.payload,
          response_payload: null,
          metadata: { ...googleAds.metadata, ready: googleAds.ok, errors: googleAds.ok ? [] : googleAds.errors },
        })
      } catch (err) {
        if (!isDuplicateError(err)) throw err
      }
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
