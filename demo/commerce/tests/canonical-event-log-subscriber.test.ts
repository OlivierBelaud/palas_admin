import { beforeAll, describe, expect, it, vi } from 'vitest'

type SubscriberDefinition = {
  handler(
    message: { data?: Record<string, unknown> },
    context: {
      command: Record<string, unknown>
      log: { error(message: string): void }
    },
  ): Promise<void>
}

let subscriber: SubscriberDefinition

beforeAll(async () => {
  vi.stubGlobal('defineSubscriber', (definition: SubscriberDefinition) => definition)
  subscriber = (await import('../src/subscribers/canonical-event-log-shadow')).default as unknown as SubscriberDefinition
})

describe('canonical Event Hub subscriber', () => {
  it('processes the batch then propagates projection failures to the durable transport', async () => {
    const recordCanonicalEventLog = vi
      .fn()
      .mockRejectedValueOnce(new Error('canonical journal unavailable'))
      .mockResolvedValueOnce({ ok: true })
    const log = { error: vi.fn() }

    await expect(
      subscriber.handler(
        {
          data: {
            body: {
              batch: [
                { uuid: 'evt_1', event: '$pageview', distinct_id: 'visitor_1', properties: {} },
                { uuid: 'evt_2', event: '$pageview', distinct_id: 'visitor_1', properties: {} },
              ],
            },
            posthog: { forwarded: true, status: 200 },
          },
        },
        { command: { recordCanonicalEventLog }, log },
      ),
    ).rejects.toThrow('canonical journal unavailable')

    expect(recordCanonicalEventLog).toHaveBeenCalledTimes(2)
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('canonical journal unavailable'))
  })
})
