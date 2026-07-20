import { beforeAll, describe, expect, it, vi } from 'vitest'

type SubscriberDefinition = {
  handler(
    message: { data?: Record<string, unknown> },
    context: {
      command: Record<string, unknown>
      log: { info(message: string): void; error(message: string): void }
    },
  ): Promise<void>
}

let subscriber: SubscriberDefinition

beforeAll(async () => {
  vi.stubGlobal('defineSubscriber', (definition: SubscriberDefinition) => definition)
  subscriber = (await import('../src/subscribers/posthog-cart-tracker')).default as unknown as SubscriberDefinition
})

describe('posthog cart tracker subscriber', () => {
  it('propagates cart projection failures so the durable event transport can retry the batch', async () => {
    const ingestCartEvent = vi.fn(async () => {
      throw new Error('cart projection unavailable')
    })
    const log = { info: vi.fn(), error: vi.fn() }

    await expect(
      subscriber.handler(
        {
          data: {
            body: {
              event: 'cart:product_added',
              distinct_id: 'anonymous_1',
              properties: {
                cart: {
                  token: 'cart_1',
                  items: [{ id: 'variant_1', product_id: 'product_1', title: 'Bracelet', quantity: 1, price: 49 }],
                  total_price: 49,
                  currency: 'EUR',
                },
                $set: { email: 'buyer@example.com' },
              },
            },
          },
        },
        { command: { ingestCartEvent }, log },
      ),
    ).rejects.toThrow('cart projection unavailable')

    expect(ingestCartEvent).toHaveBeenCalledOnce()
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('cart projection unavailable'))
  })
})
