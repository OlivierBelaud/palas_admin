import { describe, expect, it, vi } from 'vitest'
import { loadLocalControl, parseControlRequest } from '../src/modules/tracking-control/local-query'

const now = new Date('2026-09-28T12:00:00Z')
const params = (query: string) => new URLSearchParams(query)

describe('tracking control bounds', () => {
  it('supports seven hours and a half-open custom UTC interval', () => {
    expect(parseControlRequest(params('destination=meta_capi&hours=7'), now).window).toEqual({
      from: '2026-09-28T05:00:00.000Z',
      to: now.toISOString(),
      timezone: 'UTC',
    })
    expect(
      parseControlRequest(params('destination=ga4&from=2026-09-28T05:00:00Z&to=2026-09-28T06:00:00Z'), now).window.to,
    ).toBe('2026-09-28T06:00:00.000Z')
  })
  it.each([
    'destination=unknown',
    'destination=ga4&hours=25',
    'destination=ga4&hours=0',
    'destination=ga4&from=2026-09-28T05:00:00Z',
    'destination=ga4&from=2026-09-28T06:00:00Z&to=2026-09-28T05:00:00Z',
    'destination=ga4&from=2026-09-27T11:00:00Z&to=2026-09-28T05:00:00Z',
    'destination=ga4&from=2026-09-28T05:00:00Z&to=2026-09-28T13:00:00Z',
    'destination=ga4&from=2026-09-28T05:00:00&to=2026-09-28T06:00:00',
    'destination=ga4&hours=7&from=2026-09-28T05:00:00Z&to=2026-09-28T06:00:00Z',
  ])('rejects invalid request %s', (query) => {
    expect(() => parseControlRequest(params(query), now)).toThrow()
  })
})

describe('tracking control local evidence', () => {
  it('does not expose raw receipts or customer identifiers and preserves validation state', async () => {
    const raw = vi.fn(async (sql: string) => {
      if (sql.includes('control:cohort'))
        return [
          {
            event_name: 'add_to_cart',
            captured: '2',
            eligible: '2',
            excluded: '0',
            unknown_eligibility: '0',
            missing_dispatch: '0',
            statuses: { sent: 1, validated: 1 },
          },
        ]
      if (sql.includes('control:sends')) return [{ event_name: 'add_to_cart', count: '1' }]
      if (sql.includes('control:recent'))
        return [
          {
            event_id: 'evt1',
            event_name: 'add_to_cart',
            status: 'validated',
            attempt_count: 4,
            received_at: now,
            sent_at: null,
            last_attempt_at: now,
            http_status: 200,
            error_code: null,
            details_available: true,
            receipt_kind: 'validation_only',
            email: 'private@example.test',
            request_payload: { access_token: 'secret' },
            response_payload: { raw: 'secret' },
          },
        ]
      if (sql.includes('control:counts')) return [{ receipt_count: '2', google_request_count: '0' }]
      return []
    })
    const input = parseControlRequest(params('destination=pinterest&hours=7'), now)
    const result = await loadLocalControl(input, { raw: raw as never })
    expect(result.local.rows[0]).toMatchObject({
      provider_event_name: 'add_to_cart',
      statuses: { sent: 1, validated: 1 },
    })
    expect(result.local.recent[0]).toMatchObject({
      status: 'validated',
      receipt_kind: 'validation_only',
      attempt_count: 4,
    })
    expect(JSON.stringify(result)).not.toMatch(/private@|access_token|secret|request_payload|response_payload/)
    expect(result.local.receipt_count).toBe(2)
    for (const [sql, args] of raw.mock.calls as unknown as Array<[string, unknown[]]>) {
      expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/)
      expect(args).toContain('pinterest')
    }
  })
})
