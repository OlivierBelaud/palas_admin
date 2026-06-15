import { describe, expect, it } from 'vitest'
import { GET } from '../src/modules/event-hub/api/muid/route'

function makeReq(url: string) {
  return new Request(url, {
    method: 'GET',
    headers: {
      origin: 'https://fancypalas.com',
    },
  })
}

describe('Event Hub muid route', () => {
  it('sets the muid cookie without blocking on consent during observation phase', async () => {
    const res = await GET(makeReq('https://admin.fancypalas.com/api/event-hub/muid'))

    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toContain('muid=')
    expect(await res.json()).toMatchObject({ ok: true })
  })

  it('keeps accepting the legacy analytics_storage query param', async () => {
    const res = await GET(makeReq('https://admin.fancypalas.com/api/event-hub/muid?analytics_storage=true'))

    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toContain('muid=')
    expect(await res.json()).toMatchObject({ ok: true })
  })

  it('accepts a valid client-created muid so browser events and server cookie stay aligned', async () => {
    const res = await GET(makeReq('https://admin.fancypalas.com/api/event-hub/muid?m=muid_0123456789abcdef0123456789abcdef'))

    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toContain('muid=muid_0123456789abcdef0123456789abcdef')
    expect(await res.json()).toMatchObject({ ok: true, muid: 'muid_0123456789abcdef0123456789abcdef' })
  })
})
