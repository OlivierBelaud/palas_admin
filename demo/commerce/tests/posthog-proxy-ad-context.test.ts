import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { posthogWithVisitorContext } from '../src/server/posthog-visitor-context'

vi.mock('../src/modules/event-hub/dispatch-runner', () => ({
  flushDispatchLogByEventDestinationKey: vi.fn(async () => ({})),
}))

describe('published PostHog proxy to advertising dispatches', () => {
  let command: { workflow: (input: unknown, context: unknown) => Promise<unknown> }
  let subscriber: { handler: (message: unknown, context: unknown) => Promise<void> }
  beforeAll(async () => {
    vi.stubGlobal('defineCommand', (value: unknown) => value)
    vi.stubGlobal('defineSubscriber', (value: unknown) => value)
    vi.stubGlobal('z', z)
    command = (await import('../src/commands/admin/record-canonical-event-log')).default as unknown as typeof command
    subscriber = (await import('../src/subscribers/canonical-event-log-shadow')).default as unknown as typeof subscriber
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })
  afterAll(() => vi.unstubAllGlobals())

  it.each([true, false])('preserves anonymous visitor context and respects ads consent (%s)', async (consented) => {
    vi.stubEnv('POSTHOG_API_KEY', '')
    vi.stubEnv('KLAVIYO_API_KEY', '')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
    const dispatches: Record<string, unknown>[] = []
    const raw = vi.fn(async () => [])
    const commandContext = {
      step: {
        service: {
          contact: { list: async () => [] },
          eventLog: { create: async () => ({}) },
          dispatchLog: { create: async (row: Record<string, unknown>) => dispatches.push(row) },
        },
        action:
          (_name: string, action: { invoke: (input: unknown, context: unknown) => unknown }) => (input: unknown) =>
            action.invoke(input, { app: { resolve: () => ({ raw }) } }),
      },
    }
    const log = { error: vi.fn() }
    const deliveries: Promise<void>[] = []
    const req = Object.assign(
      new Request('https://crm.example/api/posthog/e/', {
        method: 'POST',
        headers: { 'x-forwarded-for': '203.0.113.10, 10.0.0.2', 'user-agent': 'Mozilla/5.0 visitor-browser' },
        body: JSON.stringify({
          uuid: `evt_anonymous_${consented}`,
          event: '$pageview',
          distinct_id: 'anonymous_visitor',
          timestamp: '2026-09-25T08:00:00.000Z',
          properties: {
            $current_url: 'https://fancypalas.com/products/bague-test',
            palas_consent_ads: consented,
            palas_consent_analytics: true,
          },
        }),
      }),
      {
        app: {
          emit: (_name: string, data: unknown) => {
            const delivery = subscriber.handler(
              { data },
              {
                command: { recordCanonicalEventLog: (input: unknown) => command.workflow(input, commandContext) },
                log,
              },
            )
            deliveries.push(delivery)
            return delivery
          },
        },
      },
    )
    await posthogWithVisitorContext(req, req.app)
    await Promise.all(deliveries)
    expect(log.error).not.toHaveBeenCalled()
    expect(deliveries).toHaveLength(1)
    for (const destination of ['meta_capi', 'pinterest']) {
      const row = dispatches.find((dispatch) => dispatch.destination === destination)
      expect(row, destination).toMatchObject({ status: consented ? 'pending' : 'invalid' })
      if (consented) {
        expect(row?.request_payload).toMatchObject({
          data: [
            { user_data: { client_ip_address: '203.0.113.10', client_user_agent: 'Mozilla/5.0 visitor-browser' } },
          ],
        })
      } else {
        expect(row?.error_code).toContain('consent_not_granted')
      }
    }
  })
})
