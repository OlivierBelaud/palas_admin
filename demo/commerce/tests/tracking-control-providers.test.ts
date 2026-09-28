import { afterEach, describe, expect, it, vi } from 'vitest'
import { readProviderEvidence } from '../src/modules/tracking-control/providers'
import type { ProviderReadInput } from '../src/modules/tracking-control/types'

const window = { from: '2026-09-28T01:00:00.000Z', to: '2026-09-28T08:00:00.000Z', timezone: 'UTC' }
const input = (destination: ProviderReadInput['destination']): ProviderReadInput => ({
  destination,
  window,
  google_requests: [],
  google_request_count: 0,
})
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
const metaEnv = { META_PIXEL_ID: '12345', META_ACCESS_TOKEN: 'never-expose-me' }
afterEach(() => vi.useRealTimers())

describe('tracking control provider evidence', () => {
  it('coalesces identical reads without changing freshness and invalidates on credentials or range', async () => {
    const fetcher = vi.fn(async () => json([]))
    const env = { PINTEREST_AD_ACCOUNT_ID: '123', PINTEREST_ACCESS_TOKEN: 'secret' }
    const [first, second] = await Promise.all([
      readProviderEvidence(input('pinterest'), env, fetcher),
      readProviderEvidence(input('pinterest'), env, fetcher),
    ])
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(second.sections[0].fetched_at).toBe(first.sections[0].fetched_at)
    await readProviderEvidence(input('pinterest'), { ...env, PINTEREST_ACCESS_TOKEN: 'changed' }, fetcher)
    expect(fetcher).toHaveBeenCalledTimes(2)
    await readProviderEvidence(
      { ...input('pinterest'), window: { ...window, from: '2026-09-28T02:00:00Z' } },
      env,
      fetcher,
    )
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('cancels oversized streamed responses before consuming the remaining body', async () => {
    let cancelled = false
    const fetcher = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(1_000_001))
            },
            cancel() {
              cancelled = true
            },
          }),
        ),
    )
    const result = await readProviderEvidence(
      input('pinterest'),
      { PINTEREST_AD_ACCOUNT_ID: '123', PINTEREST_ACCESS_TOKEN: 'secret' },
      fetcher,
    )
    expect(result.sections[0].state).toBe('error')
    expect(cancelled).toBe(true)
  })

  it('keeps Meta server/browser counts separate and preserves them when quality is denied', async () => {
    const fetcher = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
      const u = new URL(String(url))
      expect(u.origin).toBe('https://graph.facebook.com')
      expect(init?.redirect).toBe('error')
      expect(u.searchParams.has('access_token')).toBe(false)
      if (u.pathname.endsWith('dataset_quality')) return json({ error: { message: 'never-expose-me', code: 200 } }, 403)
      const source = u.searchParams.get('event_source')
      return json({
        data: [
          {
            start_time: '2026-09-28T01:00:00Z',
            end_time: '2026-09-28T08:00:00Z',
            aggregation: 'event',
            data: [{ event: 'AddToCart', count: source === 'SERVER_ONLY' ? 40 : 10 }],
          },
        ],
      })
    })
    const result = await readProviderEvidence(input('meta_capi'), metaEnv, fetcher)
    expect(result.sections.find((s) => s.key === 'meta_server')?.rows[0].value).toBe(40)
    expect(result.sections.find((s) => s.key === 'meta_browser')?.rows[0].value).toBe(10)
    expect(result.sections.find((s) => s.key === 'meta_quality')?.state).toBe('permission_denied')
    expect(JSON.stringify(result)).not.toContain('never-expose-me')
  })

  it('does not follow provider pagination and marks the evidence partial', async () => {
    const fetcher = vi.fn(async () =>
      json({ data: [{ data: [{ value: 'Purchase', count: 3 }] }], paging: { next: 'https://evil.example/secret' } }),
    )
    const result = await readProviderEvidence(input('meta_capi'), metaEnv, fetcher)
    expect(result.sections.find((s) => s.key === 'meta_server')?.state).toBe('partial')
    expect(fetcher.mock.calls.length).toBeLessThanOrEqual(5)
  })

  it('distinguishes rate limits, malformed responses, and missing setup without leaking errors', async () => {
    const emptyFetch = vi.fn()
    const missing = await readProviderEvidence(input('meta_capi'), {}, emptyFetch)
    expect(emptyFetch).not.toHaveBeenCalled()
    expect(missing.sections.every((s) => s.state === 'not_configured')).toBe(true)
    const limited = await readProviderEvidence(
      input('meta_capi'),
      metaEnv,
      vi.fn(async () => json({ message: 'secret' }, 429)),
    )
    expect(limited.sections.find((s) => s.key === 'meta_server')?.state).toBe('rate_limited')
    const malformed = await readProviderEvidence(
      input('meta_capi'),
      metaEnv,
      vi.fn(async () => json({ unknown: true })),
    )
    expect(malformed.sections.find((s) => s.key === 'meta_server')?.state).toBe('error')
    expect(JSON.stringify(limited)).not.toContain('secret')
  })

  it('times out even while consuming a stalled response body', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn(async () => new Response(new ReadableStream({ start() {} })))
    const promise = readProviderEvidence(input('meta_capi'), metaEnv, fetcher)
    await vi.advanceTimersByTimeAsync(7_001)
    const result = await promise
    expect(result.sections.find((s) => s.key === 'meta_server')?.state).toBe('unavailable')
  })

  it.each([
    10, 60,
  ])('bounds Google status reads to %s and exposes mixed outcomes without claiming event totals', async (limit) => {
    const requests = Array.from({ length: limit + 2 }, (_, i) => ({
      request_id: `r${i}`,
      event_name: 'add_to_cart',
    }))
    const fetcher = vi.fn(async (url: URL | RequestInfo) => {
      const u = new URL(String(url))
      if (u.hostname === 'oauth2.googleapis.com') return json({ access_token: 'oauth-secret' })
      expect(u.hostname).toBe('datamanager.googleapis.com')
      return json({
        requestStatusPerDestination: [
          {
            destination: {
              operatingAccount: { accountType: 'GOOGLE_ADS', accountId: '123' },
              productDestinationId: '7795313739',
            },
            requestStatus: u.searchParams.get('requestId') === 'r0' ? 'PROCESSING' : 'SUCCESS',
          },
        ],
      })
    })
    const result = await readProviderEvidence(
      {
        ...input('google_ads'),
        google_requests: requests,
        google_request_count: limit + 2,
        google_limit: limit === 60 ? 60 : undefined,
      },
      {
        GOOGLE_ADS_CUSTOMER_ID: '123',
        GOOGLE_ADS_CLIENT_ID: 'client',
        GOOGLE_ADS_CLIENT_SECRET: 'secret',
        GOOGLE_ADS_REFRESH_TOKEN: 'refresh',
      },
      fetcher,
    )
    expect(fetcher).toHaveBeenCalledTimes(limit + 1)
    expect(result.sections[0].state).toBe('partial')
    expect(result.sections[0].rows.some((r) => r.label === 'SUCCESS' && r.value === limit - 1)).toBe(true)
    expect(result.sections[0].message).toContain(`${limit} / ${limit + 2}`)
    expect(JSON.stringify(result)).not.toContain('oauth-secret')
  })

  it('does not count a Google status for another destination as our success', async () => {
    const fetcher = vi.fn(async (url: URL | RequestInfo) =>
      String(url).includes('oauth2')
        ? json({ access_token: 'secret' })
        : json({
            requestStatusPerDestination: [
              {
                destination: { operatingAccount: { accountType: 'GOOGLE_ADS', accountId: '999' } },
                requestStatus: 'SUCCESS',
              },
            ],
          }),
    )
    const result = await readProviderEvidence(
      {
        ...input('google_ads'),
        google_requests: [{ request_id: 'r1', event_name: 'add_to_cart' }],
        google_request_count: 1,
      },
      {
        GOOGLE_ADS_CUSTOMER_ID: '123',
        GOOGLE_ADS_CLIENT_ID: 'client',
        GOOGLE_ADS_CLIENT_SECRET: 'secret',
        GOOGLE_ADS_REFRESH_TOKEN: 'refresh',
      },
      fetcher,
    )
    expect(result.sections[0].state).toBe('error')
    expect(result.sections[0].rows.some((r) => r.label === 'SUCCESS')).toBe(false)
  })

  it('parses Pinterest official array quality schema, not received-event counts', async () => {
    const fetcher = vi.fn(async (url: URL | RequestInfo) => {
      expect(String(url)).toContain('lookback_period=1d')
      expect(String(url)).toContain('ingestion_source=CONVERSIONS_API')
      return json([
        {
          ingestion_source: 'CONVERSIONS_API',
          source_platform: 'WEB',
          lookback_period: '1d',
          overall_status: 'GOOD',
          quality_components: {
            hashed_email: { add_to_cart: { coverage: 85, issues: [{ reason: 'private email' }] } },
            external_event_id: { add_to_cart: { coverage: 100, overlap: 25 } },
          },
        },
      ])
    })
    const result = await readProviderEvidence(
      input('pinterest'),
      { PINTEREST_AD_ACCOUNT_ID: '123', PINTEREST_ACCESS_TOKEN: 'secret' },
      fetcher,
    )
    expect(result.sections[0].rows.some((r) => r.event_name === 'add_to_cart' && r.value === 85)).toBe(true)
    expect(result.sections[0].window).toBeNull()
    expect(result.sections[0].granularity).toContain('1 jour')
    expect(JSON.stringify(result)).not.toContain('private email')
  })

  it('does not treat GA4 measurement credentials as reporting credentials', async () => {
    const fetcher = vi.fn()
    const result = await readProviderEvidence(
      input('ga4'),
      { GA4_MEASUREMENT_ID: 'G-ABC', GA4_API_SECRET: 'secret' },
      fetcher,
    )
    expect(fetcher).not.toHaveBeenCalled()
    expect(result.sections[0].state).toBe('not_configured')
    expect(result.config.current_mode).toContain('validation')
  })

  it('reports the GA4 property timezone and daily scope, not the local hourly window', async () => {
    const fetcher = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
      expect(String(url)).toBe('https://analyticsdata.googleapis.com/v1beta/properties/123:runReport')
      expect(JSON.parse(String(init?.body)).dimensions).toEqual([{ name: 'eventName' }])
      return json({
        dimensionHeaders: [{ name: 'eventName' }],
        metricHeaders: [{ name: 'eventCount' }],
        rows: [{ dimensionValues: [{ value: 'add_to_cart' }], metricValues: [{ value: '40' }] }],
        rowCount: 1,
        metadata: { timeZone: 'Europe/Paris' },
      })
    })
    const result = await readProviderEvidence(
      input('ga4'),
      { GA4_PROPERTY_ID: '123', GA4_READ_ACCESS_TOKEN: 'secret', GA4_DEBUG: 'false' },
      fetcher,
    )
    expect(result.sections[0].rows[0].value).toBe(40)
    expect(result.sections[0].window?.timezone).toBe('Europe/Paris')
    expect(result.sections[0].window?.from).toBe('2026-09-28')
    expect(result.sections[0].limitations.join(' ')).toContain('horaire')
  })

  it('rejects malformed public IDs and ignores endpoint overrides', async () => {
    const fetcher = vi.fn(async (url: URL | RequestInfo) => {
      expect(new URL(String(url)).hostname).toBe('graph.facebook.com')
      return json({ data: [] })
    })
    await readProviderEvidence(input('meta_capi'), { ...metaEnv, META_CAPI_ENDPOINT: 'https://evil.example' }, fetcher)
    const invalid = await readProviderEvidence(
      input('meta_capi'),
      { ...metaEnv, META_PIXEL_ID: '../secret' },
      vi.fn(() => {
        throw new Error('should not call')
      }),
    )
    expect(invalid.config.identifiers[0].value).toBeNull()
  })
  it('reads Meta quality without inventing a period and keeps account attribution separate', async () => {
    const fetcher = vi.fn(async (url: URL | RequestInfo) => {
      const u = new URL(String(url))
      if (u.pathname.endsWith('dataset_quality'))
        return json({
          web: [
            {
              event_name: 'Purchase',
              event_match_quality: { composite_score: 8.5, diagnostics: [{ solution: 'private upstream message' }] },
              event_coverage: { percentage: 90 },
              data_freshness: { upload_frequency: 'real_time' },
            },
          ],
        })
      if (u.pathname.endsWith('insights'))
        return json({
          data: [
            {
              date_start: '2026-09-28',
              date_stop: '2026-09-28',
              actions: [{ action_type: 'offsite_conversion.fb_pixel_purchase', value: '12' }],
            },
          ],
        })
      return json({ data: [] })
    })
    const result = await readProviderEvidence(
      input('meta_capi'),
      { ...metaEnv, META_AD_ACCOUNT_ID: 'act_777' },
      fetcher,
    )
    const quality = result.sections.find((s) => s.key === 'meta_quality')!
    expect(quality.window).toBeNull()
    expect(quality.rows.find((r) => r.label.includes('/ 10'))?.value).toBe(8.5)
    expect(result.sections.find((s) => s.key === 'meta_ads')?.rows[0].value).toBe(12)
    expect(result.sections.find((s) => s.key === 'meta_ads')?.provenance).toContain('pas exclusivement')
    expect(fetcher).toHaveBeenCalledTimes(5)
    expect(JSON.stringify(result)).not.toContain('private upstream message')
  })

  it('preserves Google successful evidence when another status read fails and sanitizes reasons', async () => {
    const fetcher = vi.fn(async (url: URL | RequestInfo) => {
      const u = new URL(String(url))
      if (u.hostname === 'oauth2.googleapis.com') return json({ access_token: 'oauth-secret' })
      if (u.searchParams.get('requestId') === 'failed-read') return json({ message: 'sensitive access token' }, 403)
      return json({
        requestStatusPerDestination: [
          {
            requestStatus: 'PARTIAL_SUCCESS',
            errorInfo: {
              errorCounts: [
                { recordCount: '1', reason: 'PROCESSING_ERROR_REASON_DUPLICATE_TRANSACTION_ID' },
                { recordCount: '1', reason: 'sensitive access token' },
              ],
            },
          },
        ],
      })
    })
    const requests = ['ok', 'failed-read'].map((request_id) => ({
      request_id,
      event_name: 'purchase',
    }))
    const result = await readProviderEvidence(
      { ...input('google_ads'), google_requests: requests, google_request_count: 2 },
      {
        GOOGLE_ADS_CUSTOMER_ID: '123',
        GOOGLE_ADS_CLIENT_ID: 'client',
        GOOGLE_ADS_CLIENT_SECRET: 'secret',
        GOOGLE_ADS_REFRESH_TOKEN: 'refresh',
        GOOGLE_OAUTH_TOKEN_ENDPOINT: 'https://evil.example',
        GOOGLE_ADS_ENDPOINT: 'https://evil.example',
      },
      fetcher,
    )
    expect(result.sections[0].state).toBe('partial')
    expect(result.sections[0].rows.some((r) => r.label === 'PARTIAL_SUCCESS')).toBe(true)
    expect(result.sections[0].rows.some((r) => r.label.includes('DUPLICATE_TRANSACTION_ID'))).toBe(true)
    expect(result.sections[0].message).toContain('1 / 2')
    expect(JSON.stringify(result)).not.toContain('sensitive access token')
  })

  it('makes GA4 sampling, thresholding and pagination visible as partial evidence', async () => {
    const fetcher = vi.fn(async () =>
      json({
        dimensionHeaders: [{ name: 'eventName' }],
        metricHeaders: [{ name: 'eventCount' }],
        rows: [{ dimensionValues: [{ value: 'purchase' }], metricValues: [{ value: '2' }] }],
        rowCount: 500,
        metadata: { timeZone: 'Europe/Paris', subjectToThresholding: true, samplingMetadatas: [{}] },
      }),
    )
    const result = await readProviderEvidence(
      input('ga4'),
      { GA4_PROPERTY_ID: '123', GA4_READ_ACCESS_TOKEN: 'secret' },
      fetcher,
    )
    expect(result.sections[0].state).toBe('partial')
    expect(result.sections[0].limitations.join(' ')).toContain('Échantillonnage')
    expect(result.sections[0].limitations.join(' ')).toContain('confidentialité')
  })

  it('returns safe evidence for transport failures instead of throwing or echoing credentials', async () => {
    const result = await readProviderEvidence(
      input('meta_capi'),
      metaEnv,
      vi.fn(async () => {
        throw new Error('https://example.com/?token=never-expose-me')
      }),
    )
    expect(result.sections.find((s) => s.key === 'meta_server')?.state).toBe('unavailable')
    expect(JSON.stringify(result)).not.toContain('never-expose-me')
  })
})

describe('Meta safe Graph errors', () => {
  it('classifies a Graph permission error carried by HTTP400 without leaking its message', async () => {
    const result = await readProviderEvidence(
      input('meta_capi'),
      metaEnv,
      vi.fn(async () => json({ error: { code: 190, message: 'secret-token-private' } }, 400)),
    )
    expect(result.sections.find((s) => s.key === 'meta_server')?.state).toBe('permission_denied')
    expect(JSON.stringify(result)).not.toContain('secret-token-private')
  })
})

describe('matrix provider reads', () => {
  it('reads only Meta server stats for the matrix, without requiring bucket end_time', async () => {
    const fetcher = vi.fn(async (url: URL | RequestInfo) => {
      const u = new URL(String(url))
      expect(u.pathname).toMatch(/\/12345\/stats$/)
      expect(u.searchParams.get('event_source')).toBe('SERVER_ONLY')
      return json({ data: [{ start_time: '2026-09-28T01:00:00Z', data: [{ event: 'PageView', count: 42 }] }] })
    })
    const result = await readProviderEvidence({ ...input('meta_capi'), counts_only: true }, metaEnv, fetcher)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(result.sections).toHaveLength(1)
    expect(result.sections[0]).toMatchObject({
      state: 'available',
      window: null,
      rows: [{ event_name: 'PageView', value: 42 }],
    })
  })
  it('requests September 28, not September 27, for a Paris calendar day in GA4', async () => {
    const fetcher = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body)).dateRanges).toEqual([{ startDate: '2026-09-28', endDate: '2026-09-28' }])
      return json({
        dimensionHeaders: [{ name: 'eventName' }],
        metricHeaders: [{ name: 'eventCount' }],
        rows: [],
        metadata: { timeZone: 'Europe/Paris' },
      })
    })
    const result = await readProviderEvidence(
      { ...input('ga4'), window: { from: '2026-09-27T22:00:00Z', to: '2026-09-28T22:00:00Z', timezone: 'UTC' } },
      { GA4_PROPERTY_ID: '123', GA4_READ_ACCESS_TOKEN: 'secret' },
      fetcher,
    )
    expect(result.sections[0].state).toBe('available')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
