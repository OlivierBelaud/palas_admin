import { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
// @ts-expect-error The standalone Node .mjs CLI intentionally has no TypeScript declarations.
import { retrieveGoogleAdsDiagnostics } from '../scripts/google-ads-diagnostics.mjs'

const env = { GOOGLE_ADS_CLIENT_ID: 'client', GOOGLE_ADS_CLIENT_SECRET: 'secret', GOOGLE_ADS_REFRESH_TOKEN: 'refresh' }
function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status })
}
function stub(body: unknown, status = 200) {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(respond({ access_token: 'access' }))
    .mockResolvedValueOnce(respond(body, status))
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('Google Ads read-only request diagnostics', () => {
  it('refreshes existing OAuth grant and GETs the encoded request id without an event upload', async () => {
    const fetcher = stub({
      requestStatusPerDestination: [{ requestStatus: 'SUCCESS', eventsIngestionStatus: { recordCount: '1' } }],
    })
    expect(await retrieveGoogleAdsDiagnostics('request+/123', env)).toEqual({
      requestStatusPerDestination: [
        { requestStatus: 'SUCCESS', eventsIngestionStatus: { recordCount: '1' }, errorCounts: [], warningCounts: [] },
      ],
    })
    expect(fetcher.mock.calls[0][0]).toBe('https://oauth2.googleapis.com/token')
    expect(fetcher.mock.calls[0][1].body.get('grant_type')).toBe('refresh_token')
    expect(fetcher.mock.calls[0][1].body.get('refresh_token')).toBe('refresh')
    const url = new URL(fetcher.mock.calls[1][0])
    expect(url.origin + url.pathname).toBe('https://datamanager.googleapis.com/v1/requestStatus:retrieve')
    expect(url.searchParams.get('requestId')).toBe('request+/123')
    expect(fetcher.mock.calls[1][1]).toMatchObject({
      method: 'GET',
      headers: { Authorization: 'Bearer access' },
      redirect: 'error',
    })
    expect(fetcher.mock.calls[1][1]).not.toHaveProperty('body')
  })
  it('retains processing and failed statuses, official enums and counts but removes identifiers and provider descriptions', async () => {
    stub({
      requestStatusPerDestination: [
        { requestStatus: 'PROCESSING', destination: { accountId: 'private-account' } },
        {
          requestStatus: 'PARTIAL_SUCCESS',
          eventsIngestionStatus: { recordCount: '2', email: 'email@example.com' },
          errorInfo: {
            errorCounts: [{ reason: 'PROCESSING_ERROR_REASON_INVALID_GCLID', recordCount: '1', description: 'secret' }],
          },
          warningInfo: { warningCounts: [{ reason: 'PROCESSING_WARNING_REASON_INTERNAL_ERROR', recordCount: '1' }] },
        },
        {
          requestStatus: 'FAILED',
          errorInfo: {
            errorCounts: [{ reason: 'PROCESSING_ERROR_REASON_SECRET_TOKEN', recordCount: 'email@example.com' }],
          },
        },
      ],
    })
    const result = await retrieveGoogleAdsDiagnostics('request', env)
    expect(result.requestStatusPerDestination.map((row: { requestStatus: string }) => row.requestStatus)).toEqual([
      'PROCESSING',
      'PARTIAL_SUCCESS',
      'FAILED',
    ])
    expect(result.requestStatusPerDestination[1].errorCounts).toEqual([
      { reason: 'PROCESSING_ERROR_REASON_INVALID_GCLID', recordCount: '1' },
    ])
    expect(result.requestStatusPerDestination[1].warningCounts).toEqual([
      { reason: 'PROCESSING_WARNING_REASON_INTERNAL_ERROR', recordCount: '1' },
    ])
    expect(JSON.stringify(result)).not.toMatch(/private-account|email@example|secret|SECRET_TOKEN/)
  })
  it.each([
    {},
    { requestStatusPerDestination: [] },
    { requestStatusPerDestination: [{ requestStatus: 'secret' }] },
    { error: { message: 'secret' } },
  ])('rejects malformed 2xx responses', async (body) => {
    stub(body)
    await expect(retrieveGoogleAdsDiagnostics('request', env)).rejects.toThrow('invalid response')
  })
  it.each([401, 403, 429, 503])('reports HTTP %s without leaking provider payload', async (status) => {
    stub({ error: { message: 'secret email@example.com' } }, status)
    await expect(retrieveGoogleAdsDiagnostics('request', env)).rejects.toThrow(`HTTP ${status}`)
  })
  it('rejects missing credentials and request id before any network call', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    await expect(retrieveGoogleAdsDiagnostics('request', {})).rejects.toThrow('OAuth credentials')
    await expect(retrieveGoogleAdsDiagnostics('', env)).rejects.toThrow('request id')
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('sanitizes refused refresh credentials without contacting diagnostics', async () => {
    const fetcher = vi.fn().mockResolvedValue(respond({ error: 'invalid_grant', error_description: 'secret' }, 400))
    vi.stubGlobal('fetch', fetcher)
    await expect(retrieveGoogleAdsDiagnostics('request', env)).rejects.toThrow('reauthorize')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('sanitizes thrown transport errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('secret-token')))
    await expect(retrieveGoogleAdsDiagnostics('request', env)).rejects.toThrow('request failed')
  })
  it('honors an already cancelled operation before any HTTP call', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    await expect(retrieveGoogleAdsDiagnostics('request', env, AbortSignal.abort())).rejects.toThrow('request failed')
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('bounds an in-flight request and hides transport errors', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url, options) =>
          new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(new Error('secret-token')), { once: true })
          }),
      ),
    )
    const result = retrieveGoogleAdsDiagnostics('request', env).catch((error: Error) => error.message)
    await vi.advanceTimersByTimeAsync(15000)
    expect(await result).toBe('Google diagnostic request failed, timed out or was cancelled')
  })
  it('rejects missing access tokens without querying diagnostics', async () => {
    const fetcher = vi.fn().mockResolvedValue(respond({ access_token: '' }))
    vi.stubGlobal('fetch', fetcher)
    await expect(retrieveGoogleAdsDiagnostics('request', env)).rejects.toThrow('invalid response')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('provides help without credentials or network', () => {
    const help = execFileSync(process.execPath, ['demo/commerce/scripts/google-ads-diagnostics.mjs', '--help'], {
      encoding: 'utf8',
      env: {},
    })
    expect(help).toContain('--request-id')
    expect(help).toContain('does not confirm final Ads attribution')
  })
})
