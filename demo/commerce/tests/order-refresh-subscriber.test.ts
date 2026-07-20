import { beforeAll, describe, expect, it, vi } from 'vitest'

type SubscriberDefinition = {
  handler(
    message: { data?: Record<string, unknown> },
    context: { command: Record<string, unknown>; log: { warn(message: string): void; error(message: string): void } },
  ): Promise<void>
}

let subscriber: SubscriberDefinition
let cartSubscriber: SubscriberDefinition
let contactSubscriber: SubscriberDefinition

beforeAll(async () => {
  vi.stubGlobal('defineSubscriber', (definition: SubscriberDefinition) => definition)
  subscriber = (await import('../src/subscribers/order-refresh')).default as unknown as SubscriberDefinition
  cartSubscriber = (await import('../src/subscribers/cart-refresh')).default as unknown as SubscriberDefinition
  contactSubscriber = (await import('../src/subscribers/contact-refresh')).default as unknown as SubscriberDefinition
})

describe('projection refresh subscribers', () => {
  it('propagates refresh failures so the event transport can retry them', async () => {
    const refreshOrder = vi.fn(async () => {
      throw new Error('Shopify timeout')
    })
    const log = { warn: vi.fn(), error: vi.fn() }

    await expect(
      subscriber.handler(
        { data: { shopify_order_id: 'gid://shopify/Order/9001', source: 'webhook' } },
        { command: { refreshOrder }, log },
      ),
    ).rejects.toThrow('Shopify timeout')

    expect(refreshOrder).toHaveBeenCalledOnce()
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Shopify timeout'))
  })

  it('propagates cart refresh failures so a partial cart link can be retried', async () => {
    const refreshCart = vi.fn(async () => {
      throw new Error('cart link interrupted')
    })
    const log = { warn: vi.fn(), error: vi.fn() }

    await expect(
      cartSubscriber.handler(
        { data: { shopify_order_id: '9001', source: 'order-refresh' } },
        { command: { refreshCart }, log },
      ),
    ).rejects.toThrow('cart link interrupted')

    expect(refreshCart).toHaveBeenCalledOnce()
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('cart link interrupted'))
  })

  it('propagates contact refresh failures so a partial contact link can be retried', async () => {
    const refreshContact = vi.fn(async () => {
      throw new Error('contact projection interrupted')
    })
    const log = { warn: vi.fn(), error: vi.fn() }

    await expect(
      contactSubscriber.handler(
        { data: { email: 'BUYER@example.com', source: 'order-refresh' } },
        { command: { refreshContact }, log },
      ),
    ).rejects.toThrow('contact projection interrupted')

    expect(refreshContact).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'buyer@example.com',
      }),
    )
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('contact projection interrupted'))
  })
})
