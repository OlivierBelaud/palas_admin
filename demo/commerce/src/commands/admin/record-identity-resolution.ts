import {
  compareIdentityResolvers,
  emailSha256,
  type IdentityServiceLike,
  type RawPosthogEvent,
} from '../../modules/identity/resolve-event-identity'

interface IdentityResolutionLogService {
  create(data: Record<string, unknown>): Promise<unknown>
}

function toDate(value: string | null | undefined): Date {
  if (!value) return new Date()
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed : new Date()
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500)
}

export default defineCommand({
  name: 'recordIdentityResolution',
  description: 'Shadow-log V1 vs V2 identity resolution for one inbound PostHog event. No production side effects.',
  input: z.object({
    event: z.record(z.unknown()),
  }),
  workflow: async (input, { step }) => {
    const event = input.event as RawPosthogEvent
    const services = step.service as unknown as IdentityServiceLike & {
      identityResolutionLog: IdentityResolutionLogService
    }

    const started = Date.now()
    try {
      const comparison = await compareIdentityResolvers(event, services)
      const durationMs = Date.now() - started
      const { signals, v1, v2 } = comparison

      await services.identityResolutionLog.create({
        event_id: signals.event_id,
        event_name: signals.event_name,
        observed_at: toDate(signals.observed_at),
        resolved_at: new Date(),
        posthog_distinct_id: signals.posthog_distinct_id,
        session_id: signals.session_id,
        cart_token: signals.cart_token,
        checkout_token: signals.checkout_token,
        v1_email_sha256: emailSha256(v1.email),
        v1_source: v1.source,
        v1_contact_id: v1.contact_id,
        v2_email_sha256: emailSha256(v2.email),
        v2_source: v2.source,
        v2_contact_id: v2.contact_id,
        resolution_status: comparison.status,
        matched_v1: comparison.matched_v1,
        duration_ms: durationMs,
        error_message: null,
        aliases_seen: comparison.aliases_seen,
        evidence: comparison.evidence,
      })

      return {
        ok: true,
        status: comparison.status,
        matched_v1: comparison.matched_v1,
        v1_source: v1.source,
        v2_source: v2.source,
        duration_ms: durationMs,
      }
    } catch (err) {
      const durationMs = Date.now() - started
      const message = errorMessage(err)
      const props = (event.properties ?? {}) as Record<string, unknown>

      await services.identityResolutionLog.create({
        event_id:
          typeof event.uuid === 'string' ? event.uuid : typeof props.$insert_id === 'string' ? props.$insert_id : null,
        event_name: typeof event.event === 'string' ? event.event : 'unknown',
        observed_at: toDate(typeof event.timestamp === 'string' ? event.timestamp : null),
        resolved_at: new Date(),
        posthog_distinct_id: typeof event.distinct_id === 'string' ? event.distinct_id : null,
        session_id: typeof props.$session_id === 'string' ? props.$session_id : null,
        cart_token: null,
        checkout_token: null,
        v1_email_sha256: null,
        v1_source: null,
        v1_contact_id: null,
        v2_email_sha256: null,
        v2_source: null,
        v2_contact_id: null,
        resolution_status: 'error',
        matched_v1: false,
        duration_ms: durationMs,
        error_message: message,
        aliases_seen: null,
        evidence: null,
      })

      return { ok: false, status: 'error', error: message, duration_ms: durationMs }
    }
  },
})
