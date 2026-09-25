import { gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { posthogWithVisitorContext } from '../src/server/posthog-visitor-context'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

function request(headers: Record<string, string>, body: BodyInit = '{"event":"$pageview"}') {
  return new Request('https://crm.example/api/posthog/e/', { method: 'POST', headers, body })
}

describe('CRM PostHog request context', () => {
  it.each([
    [{ 'x-forwarded-for': '203.0.113.8, 10.0.0.1' }, '203.0.113.8'],
    [{ 'x-real-ip': '2001:db8::8' }, '2001:db8::8'],
    [{ 'x-forwarded-for': 'invalid, 203.0.113.8', 'x-real-ip': '203.0.113.9' }, undefined],
    [{ 'x-forwarded-for': '0.0.0.0' }, undefined],
    [{ 'x-forwarded-for': '0:0:0:0:0:0:0:0' }, undefined],
    [{}, undefined],
  ])('uses only a valid visitor IP from %j', async (headers, expected) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))
    const emit = vi.fn(async () => {})
    await posthogWithVisitorContext(request(headers as Record<string, string>), { emit })
    expect(emit).toHaveBeenCalledOnce()
    expect(emit.mock.calls[0]).toEqual([
      'posthog.events.received',
      { body: { event: '$pageview' }, context: expected ? { client_ip: expected } : {} },
    ])
  })

  it('isolates concurrent requests without changing shared emit or forwarding bytes', async () => {
    vi.stubEnv('POSTHOG_API_KEY', '')
    vi.stubEnv('KLAVIYO_API_KEY', '')
    const resolvers: Array<(response: Response) => void> = []
    const upstream = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Promise<Response>((resolve) => resolvers.push(resolve)))
    const received: unknown[] = []
    const app = {
      marker: 'shared app',
      async emit(name: string, data: unknown) {
        expect(this.marker).toBe('shared app')
        received.push({ name, data })
      },
    }
    const originalEmit = app.emit
    const bodies = [gzipSync('{"event":"$pageview","uuid":"first"}'), '{"event":"$pageview","uuid":"second"}']
    const sends = bodies.map((body, i) =>
      posthogWithVisitorContext(
        request({ 'x-forwarded-for': `203.0.113.${i + 1}`, 'user-agent': `Browser ${i + 1}` }, body),
        app,
      ),
    )
    await vi.waitFor(() => expect(resolvers).toHaveLength(2))
    resolvers[1](new Response('second accepted', { status: 202 }))
    await sends[1]
    resolvers[0](new Response('first accepted', { status: 200 }))
    const responses = await Promise.all(sends)
    expect(app.emit).toBe(originalEmit)
    expect(received).toEqual(
      [2, 1].map((i) => ({
        name: 'posthog.events.received',
        data: {
          body: { event: '$pageview', uuid: i === 1 ? 'first' : 'second' },
          context: { client_ip: `203.0.113.${i}`, user_agent: `Browser ${i}` },
        },
      })),
    )
    expect(upstream.mock.calls[0][1]?.body).toEqual(new Uint8Array(bodies[0] as Buffer))
    expect(responses.map((r) => r.status)).toEqual([200, 202])
    expect(await responses[1].text()).toBe('second accepted')
  })

  it('preserves binary recordings and CORS without emitting an event', async () => {
    vi.stubEnv('POSTHOG_PROXY_ALLOWED_ORIGINS', 'https://fancypalas.com')
    const upstream = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('accepted', { status: 202 }))
    const emit = vi.fn(async () => {})
    const bytes = new Uint8Array([0, 255, 1, 7])
    const response = await posthogWithVisitorContext(request({ origin: 'https://fancypalas.com' }, bytes), { emit })
    expect(upstream.mock.calls[0][1]?.body).toEqual(bytes)
    expect(response.headers.get('access-control-allow-origin')).toBe('https://fancypalas.com')
    expect(emit).not.toHaveBeenCalled()
  })
})
