import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdminApiRequest } from '../src/modules/admin/api/_shared'
import { GET } from '../src/modules/admin/api/tracking-control/route'

afterEach(() => vi.unstubAllEnvs())

describe('tracking control admin endpoint', () => {
  it('rejects unauthenticated and non-admin requests before data access', async () => {
    vi.stubEnv('JWT_SECRET', '')
    const raw = vi.fn()
    for (const type of [undefined, 'customer']) {
      const request = Object.assign(new Request('https://crm.test/api/admin/tracking-control?destination=meta_capi'), {
        app: { infra: { db: { raw } } },
        authContext: type ? { type, id: 'test' } : undefined,
      }) as AdminApiRequest
      expect((await GET(request)).status).toBe(401)
    }
    expect(raw).not.toHaveBeenCalled()
  })
  it('rejects bad ranges without querying and never leaks database failure details', async () => {
    const raw = vi.fn().mockRejectedValue(new Error('postgres://secret:password@internal-db'))
    const request = (query: string) =>
      Object.assign(new Request(`https://crm.test/api/admin/tracking-control?${query}`), {
        app: { infra: { db: { raw } } },
        authContext: { type: 'admin', id: 'test' },
      }) as AdminApiRequest
    expect((await GET(request('destination=meta_capi&hours=99'))).status).toBe(400)
    expect(raw).not.toHaveBeenCalled()
    const response = await GET(request('destination=meta_capi'))
    expect(response.status).toBe(503)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.text()).not.toMatch(/password|secret|postgres|internal-db/)
  })
  it('keeps the local control usable when remote credentials are missing', async () => {
    for (const name of [
      'META_PIXEL_ID',
      'FACEBOOK_PIXEL_ID',
      'META_ACCESS_TOKEN',
      'FACEBOOK_ACCESS_TOKEN',
      'META_READ_ACCESS_TOKEN',
      'META_AD_ACCOUNT_ID',
    ])
      vi.stubEnv(name, '')
    const raw = vi.fn(async () => [])
    const request = Object.assign(
      new Request('https://crm.test/api/admin/tracking-control?destination=meta_capi&hours=7'),
      {
        app: { infra: { db: { raw } } },
        authContext: { type: 'admin', id: 'test' },
      },
    ) as AdminApiRequest
    const response = await GET(request)
    expect(response.status).toBe(200)
    const { data } = await response.json()
    expect(data.local.rows).toEqual([])
    expect(data.remote.every((section: { state: string }) => section.state === 'not_configured')).toBe(true)
    expect(data.destination).toBe('meta_capi')
    expect(data.config.send_configured).toBe(false)
  })
})
