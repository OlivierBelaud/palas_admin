import { describe, expect, it, vi } from 'vitest'
import { applyEvent, type RawDb } from '../src/modules/cart-tracking/apply-event'

describe('applyEvent replay semantics', () => {
  it('preserves the first identity and known snapshot when replaying an incomplete checkout event', async () => {
    const existingItems = [{ id: 'variant_1', title: 'Bracelet', quantity: 1 }]
    const writes: Array<{ sql: string; params?: unknown[] }> = []
    const db: RawDb = {
      raw: async <T>(sql: string, params?: unknown[]) => {
        if (sql.startsWith('SELECT * FROM carts WHERE cart_token')) {
          return [
            {
              id: 'cart_row_1',
              cart_token: 'cart_1',
              highest_stage: 'cart',
              status: 'active',
              distinct_id: 'anonymous_1',
              email: null,
              items: existingItems,
              total_price: 49,
              item_count: 1,
              currency: 'EUR',
              last_action_at: '2026-07-20T09:00:00.000Z',
            },
          ] as T[]
        }
        if (sql.startsWith('UPDATE carts SET')) {
          writes.push({ sql, params })
          return [] as T[]
        }
        if (sql.startsWith('SELECT id, shopify_customer_id FROM carts')) return [] as T[]
        throw new Error(`Unexpected SQL: ${sql}`)
      },
    }

    const outcome = await applyEvent(
      db,
      {
        event: 'checkout:shipping_info_submitted',
        distinct_id: 'identified_2',
        timestamp: '2026-07-20T10:00:00.000Z',
        properties: {
          cart: { token: 'cart_1' },
          checkout: { token: 'checkout_1' },
        },
      },
      { warn: vi.fn() },
      0,
    )

    expect(outcome).toBe('rebuilt')
    expect(writes).toHaveLength(1)
    expect(writes[0]?.params?.[0]).toBe('anonymous_1')
    expect(writes[0]?.params?.[7]).toEqual(existingItems)
    expect(writes[0]?.params?.[8]).toBe(49)
    expect(writes[0]?.params?.[9]).toBe(1)
    expect(writes[0]?.params?.[10]).toBe('EUR')
  })

  it('keeps the current snapshot and action when a stale cart event arrives late', async () => {
    const existingItems = [{ id: 'variant_current', title: 'Bracelet', quantity: 2 }]
    const writes: Array<{ sql: string; params?: unknown[] }> = []
    const db: RawDb = {
      raw: async <T>(sql: string, params?: unknown[]) => {
        if (sql.startsWith('SELECT * FROM carts WHERE cart_token')) {
          return [
            {
              id: 'cart_row_1',
              cart_token: 'cart_1',
              highest_stage: 'checkout_started',
              status: 'active',
              distinct_id: 'anonymous_1',
              email: null,
              items: existingItems,
              total_price: 98,
              item_count: 2,
              currency: 'EUR',
              last_action: 'checkout:started',
              last_action_at: '2026-07-20T10:00:00.000Z',
            },
          ] as T[]
        }
        if (sql.startsWith('UPDATE carts SET')) {
          writes.push({ sql, params })
          return [] as T[]
        }
        if (sql.startsWith('SELECT id, shopify_customer_id FROM carts')) return [] as T[]
        throw new Error(`Unexpected SQL: ${sql}`)
      },
    }

    const outcome = await applyEvent(
      db,
      {
        event: 'cart:product_added',
        distinct_id: 'anonymous_1',
        timestamp: '2026-07-20T09:00:00.000Z',
        properties: {
          cart: {
            token: 'cart_1',
            items: [{ id: 'variant_stale', title: 'Old item', quantity: 1 }],
            total_price: 10,
            currency: 'EUR',
          },
        },
      },
      { warn: vi.fn() },
      0,
    )

    expect(outcome).toBe('rebuilt')
    expect(writes[0]?.params?.[7]).toEqual(existingItems)
    expect(writes[0]?.params?.[8]).toBe(98)
    expect(writes[0]?.params?.[9]).toBe(2)
    expect(writes[0]?.params?.[11]).toBe('checkout:started')
    expect(writes[0]?.params?.[12]).toBe('2026-07-20T10:00:00.000Z')
  })
})
