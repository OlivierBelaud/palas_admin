import { beforeAll, describe, expect, it, vi } from 'vitest'

type CommandDefinition = {
  workflow(input: Record<string, never>, context: { step: Record<string, unknown>; log: Log }): Promise<unknown>
}

type Log = {
  info(message: string): void
  warn(message: string): void
}

let command: CommandDefinition

beforeAll(async () => {
  vi.stubGlobal('defineCommand', (definition: CommandDefinition) => definition)
  vi.stubGlobal('z', { object: () => ({}) })
  vi.stubGlobal(
    'MantaError',
    class MantaError extends Error {
      constructor(_code: string, message: string) {
        super(message)
      }
    },
  )
  command = (await import('../src/commands/admin/reconcile-shopify-orders')).default as unknown as CommandDefinition
})

describe('reconcileShopifyOrders command', () => {
  it('recovers a paid order missed by the webhook through the normal cart ingestion path', async () => {
    process.env.SHOPIFY_ADMIN_ACCESS_TOKEN = 'test-token'
    process.env.SHOPIFY_SHOP_DOMAIN = 'fancy-palas.myshopify.com'
    const emitted: string[] = []
    const ingested: Array<Record<string, unknown>> = []
    const db = {
      raw: async <T>(sql: string) => {
        if (sql.includes('projected_orders')) {
          return [
            {
              projected_orders: 1,
              missing_cart_order_links: 1,
              missing_order_contact_links: 0,
              duplicate_order_contact_pairs: 0,
              orphan_cart_order_links: 0,
              orphan_order_contact_links: 0,
            },
          ] as T[]
        }
        if (sql.includes('LEFT(cart_token, 24)')) {
          return [
            {
              id: 'cart_1',
              cart_token: 'cart-token-that-is-long-enough',
              highest_stage: 'checkout',
              distinct_id: 'visitor_1',
            },
          ] as T[]
        }
        throw new Error(`Unexpected SQL: ${sql}`)
      },
    }
    const fetchMock = vi.fn(async (_url: string | URL, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          orders: [
            {
              id: '9001',
              email: 'buyer@example.com',
              cart_token: 'cart-token-that-is-long-enough',
              checkout_token: 'checkout-token',
              created_at: '2026-07-20T10:00:00.000Z',
              total_price: '120.00',
              currency: 'EUR',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const action = (
      _name: string,
      config: {
        invoke(input: unknown, context: Record<string, unknown>): Promise<unknown>
      },
    ) => {
      return (input: unknown) =>
        config.invoke(input, {
          app: { infra: { db } },
          signal: new AbortController().signal,
        })
    }
    const step = {
      action,
      emit: async (event: string) => {
        emitted.push(event)
      },
      command: {
        ingestCartEvent: async (input: Record<string, unknown>) => {
          ingested.push(input)
        },
      },
    }
    const log: Log = { info: vi.fn(), warn: vi.fn() }

    const result = (await command.workflow({}, { step, log })) as Record<string, number>

    expect(result).toMatchObject({
      scanned: 1,
      dispatched: 1,
      order_refresh_requested: 1,
      inserted_cart_order_links: 0,
      remaining_projection_issues: 1,
      errors: 0,
    })
    expect(emitted).toEqual(['order.refresh-requested'])
    expect(ingested).toEqual([
      expect.objectContaining({
        action: 'checkout:completed',
        shopify_order_id: '9001',
        cart_token: 'cart-token-that-is-long-enough',
        items_has_payload: false,
        total_price_has_payload: true,
      }),
    ])
    expect(fetchMock).toHaveBeenCalledOnce()
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.method).toBeUndefined()
  })
})
