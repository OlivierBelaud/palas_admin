import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { RawDb } from '../src/utils/raw-db'

type LoadSystemDashboardData = typeof import('../src/queries/admin/system-dashboard').loadSystemDashboardData

let loadSystemDashboardData: LoadSystemDashboardData

beforeAll(async () => {
  vi.stubGlobal('defineQuery', (definition: unknown) => definition)
  vi.stubGlobal('z', { object: () => ({}) })
  ;({ loadSystemDashboardData } = await import('../src/queries/admin/system-dashboard'))
})

afterAll(() => {
  vi.unstubAllGlobals()
})

describe('system dashboard audit selection', () => {
  it('keeps the latest terminal verdict and exposes a stale in-flight audit as critical', async () => {
    const db = makeDb({
      terminalStartedAt: new Date('2026-07-20T00:00:00.000Z'),
      staleStartedAt: new Date('2026-07-20T01:00:00.000Z'),
    })

    const result = await loadSystemDashboardData(db)

    expect(result.meta.audit_run).toMatchObject({ id: 'terminal_123', status: 'completed' })
    expect(result.status).toBe('critical')
    expect(result.findings[0]).toMatchObject({
      source: 'system',
      key: 'audit_stuck',
      severity: 'critical',
      summary: expect.stringContaining('running_456'),
    })
  })

  it('does not keep an orphaned run critical after a newer terminal audit succeeds', async () => {
    const db = makeDb({
      terminalStartedAt: new Date('2026-07-20T02:00:00.000Z'),
      staleStartedAt: new Date('2026-07-20T01:00:00.000Z'),
    })

    const result = await loadSystemDashboardData(db)

    expect(result.status).toBe('ok')
    expect(result.findings).toEqual([])
  })
})

function makeDb({
  terminalStartedAt,
  staleStartedAt,
}: {
  terminalStartedAt: Date
  staleStartedAt: Date
}): RawDb {
  return {
    raw: async <T = Record<string, unknown>>(query: string): Promise<T[]> => {
      if (query.includes("status IN ('completed', 'failed')")) {
        return [
          {
            id: 'terminal_123',
            trigger: 'nightly',
            status: 'completed',
            overall_status: 'ok',
            started_at: terminalStartedAt,
            finished_at: new Date(terminalStartedAt.getTime() + 60_000),
            summary: {
              health: [
                {
                  key: 'shopify',
                  label: 'Shopify',
                  status: 'ok',
                  summary: 'Healthy',
                  details: [],
                  href: '/orders',
                },
              ],
            },
            error_message: null,
          },
        ] as T[]
      }
      if (query.includes("status = 'running'")) {
        return [{ id: 'running_456', started_at: staleStartedAt }] as T[]
      }
      if (query.includes('FROM system_audit_findings')) return [] as T[]
      if (query.includes('WITH carts_30 AS')) {
        return [
          {
            carts_30d: '0',
            active_carts_30d: '0',
            completed_30d: '0',
            abandoned_revenue_30d: '0',
            identified_events_24h: '0',
            events_24h: '0',
            sent_recovery_emails_30d: '0',
            recovered_cases_30d: '0',
            recovered_revenue_30d: '0',
          },
        ] as T[]
      }
      throw new Error(`Unexpected query: ${query}`)
    },
  }
}
