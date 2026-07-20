import { describe, expect, it } from 'vitest'
import { computeSystemAudit, type RawDb, runSystemAudit } from '../src/utils/system-audit'

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

  it('persists a terminal completed run after all health boundaries are computed', async () => {
    const writes: Array<{ query: string; params?: unknown[] }> = []
    const healthy = makeDb({})
    const db: RawDb = {
      raw: async <T = Record<string, unknown>>(query: string, params?: unknown[]): Promise<T[]> => {
        if (query.includes('INSERT INTO system_audit_runs')) return [{ id: 'audit_123' }] as T[]
        if (query.includes('UPDATE system_audit_runs')) {
          writes.push({ query, params })
          return [] as T[]
        }
        return healthy.raw<T>(query, params)
      },
    }

    const result = await runSystemAudit(db, 'manual')

    expect(result.run_id).toBe('audit_123')
    expect(result.summary.overall_status).toBe('ok')
    expect(result.findings).toEqual([])
    expect(writes).toHaveLength(1)
    expect(writes[0]?.query).toContain("status = 'completed'")
    expect(writes[0]?.params?.slice(0, 2)).toEqual(['audit_123', 'ok'])
  })

  it('persists a failed run and an actionable system finding when a boundary query fails', async () => {
    const writes: Array<{ query: string; params?: unknown[] }> = []
    const healthy = makeDb({})
    const db: RawDb = {
      raw: async <T = Record<string, unknown>>(query: string, params?: unknown[]): Promise<T[]> => {
        if (query.includes('INSERT INTO system_audit_runs')) return [{ id: 'run_failed_123' }] as T[]
        if (query.includes('FROM event_logs')) throw new Error('event projection unavailable')
        if (query.includes('UPDATE system_audit_runs') || query.includes('INSERT INTO system_audit_findings')) {
          writes.push({ query, params })
          return [] as T[]
        }
        return healthy.raw<T>(query, params)
      },
    }

    await expect(runSystemAudit(db, 'nightly')).rejects.toThrow('event projection unavailable')

    expect(writes).toHaveLength(2)
    expect(writes[0]?.query).toContain("status = 'failed'")
    expect(writes[0]?.params).toMatchObject(['run_failed_123', expect.any(String), 'event projection unavailable'])
    expect(writes[1]?.query).toContain('INSERT INTO system_audit_findings')
    expect(writes[1]?.params?.slice(0, 6)).toEqual([
      'run_failed_123',
      'system',
      'audit_failed',
      'critical',
      'Audit système échoué',
      'event projection unavailable',
    ])
  })
})
