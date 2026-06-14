import { describe, expect, it } from 'vitest'
import { computeSystemAudit, type RawDb } from '../src/utils/system-audit'

type Fixtures = {
  posthog?: Record<string, unknown>
  eventHub?: Record<string, unknown>
}

function makeDb(fixtures: Fixtures): RawDb {
  return {
    raw: async <T = Record<string, unknown>>(query: string): Promise<T[]> => {
      if (query.includes('FROM contacts')) {
        return [
          {
            contacts_latest: new Date(),
            orders_latest: new Date(),
            contacts_synced: '10',
            orders_synced: '5',
          },
        ] as T[]
      }
      if (query.includes('FROM event_logs')) {
        return [
          {
            total: '49',
            invalid: '0',
            non_dispatchable_internal: '49',
            identified: '49',
            latest_at: new Date(),
            ...fixtures.posthog,
          },
        ] as T[]
      }
      if (query.includes('FROM klaviyo_events')) {
        return [{ latest_synced_at: new Date(), events_7d: '10' }] as T[]
      }
      if (query.includes('FROM dispatch_logs')) {
        return [
          {
            total: '8',
            sent: '0',
            failed: '0',
            consent_blocked: '8',
            pending_stale: '0',
            ...fixtures.eventHub,
          },
        ] as T[]
      }
      if (query.includes('FROM abandoned_cart_messages')) {
        return [
          {
            sent_7d: '10',
            failed_7d: '0',
            overdue_pending: '0',
            missing_locale_7d: '0',
            snapshot_errors_7d: '0',
            blocked_checks_24h: '0',
            discount_existing_customer_30d: '0',
          },
        ] as T[]
      }
      throw new Error(`Unexpected query: ${query}`)
    },
  }
}

describe('system audit', () => {
  it('does not report CRM-only non-dispatchable events as malformed PostHog events', async () => {
    const result = await computeSystemAudit(makeDb({}))

    expect(result.findings.find((finding) => finding.key === 'posthog_invalid_events')).toBeUndefined()
    expect(result.summary.health.find((item) => item.key === 'posthog')).toMatchObject({ status: 'ok' })
    expect(result.summary.metrics.posthog_non_dispatchable_internal_24h).toBe(49)
  })

  it('does not report Google Ads consent blocks as actionable Event Hub failures', async () => {
    const result = await computeSystemAudit(makeDb({}))

    expect(result.findings.find((finding) => finding.key === 'event_hub_dispatch_failed')).toBeUndefined()
    expect(result.summary.health.find((item) => item.key === 'event_hub')).toMatchObject({ status: 'ok' })
    expect(result.summary.metrics.event_hub_consent_blocked_24h).toBe(8)
  })

  it('still reports actionable Event Hub failures', async () => {
    const result = await computeSystemAudit(
      makeDb({
        eventHub: {
          failed: '2',
          consent_blocked: '0',
        },
      }),
    )

    expect(result.findings.find((finding) => finding.key === 'event_hub_dispatch_failed')).toMatchObject({
      severity: 'critical',
      count: 2,
    })
    expect(result.summary.health.find((item) => item.key === 'event_hub')).toMatchObject({ status: 'critical' })
  })
})
