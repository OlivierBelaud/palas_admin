import { describe, expect, it, vi } from 'vitest'
import type { RuntimeSql } from '../src/utils/manta-runtime'

vi.mock('../src/utils/order-session-attribution-repair', () => ({
  repairOrderSessionAttribution: vi.fn(async () => ({
    scanned_orders: 0,
    repaired_orders: 0,
    remaining_unattributed_orders: 0,
  })),
}))

const { upsertShopifyOrder } = await import('../src/modules/cart-tracking/upsert-shopify-order')

type State = {
  cart: {
    id: string
    email: string
    items: unknown
    currency: string
    shopify_order_id: string | null
    highest_stage: string
    status: string
    last_action_at: string
  }
  orderId: string | null
  failOrderUpsertOnce: boolean
  cartOrders: Set<string>
  orderContacts: Set<string>
  cartContacts: Set<string>
}

function createSql(state: State): RuntimeSql {
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join('?').replace(/\s+/g, ' ').trim()

    if (query.includes('FROM carts') && query.includes('WHERE shopify_order_id =')) {
      return state.cart.shopify_order_id === values[0] ? [state.cart] : []
    }
    if (query.includes('FROM carts') && query.includes('WHERE cart_token =')) {
      return values[0] === 'cart-token' ? [state.cart] : []
    }
    if (query.startsWith('UPDATE carts')) {
      state.cart.status = 'completed'
      state.cart.highest_stage = 'completed'
      state.cart.shopify_order_id = String(values[2])
      return []
    }
    if (query.startsWith('INSERT INTO orders')) {
      if (state.failOrderUpsertOnce) {
        state.failOrderUpsertOnce = false
        throw new Error('orders write interrupted')
      }
      state.orderId = 'order_pk_1'
      return [{ id: state.orderId }]
    }
    if (query.startsWith('INSERT INTO cart_order')) {
      state.cartOrders.add(`${values[0]}:${values[1]}`)
      return []
    }
    if (query.includes('FROM contacts') && query.includes('LOWER(email)')) {
      return [{ id: 'contact_1' }]
    }
    if (query.startsWith('INSERT INTO order_contact')) {
      state.orderContacts.add(`${values[0]}:${values[1]}`)
      return []
    }
    if (query.startsWith('INSERT INTO cart_contact')) {
      state.cartContacts.add(`${values[0]}:${values[1]}`)
      return []
    }
    throw new Error(`Unexpected SQL: ${query}`)
  }) as RuntimeSql
  sql.unsafe = async <T = unknown>() => [] as T
  sql.json = (value: unknown) => value
  return sql
}

describe('upsertShopifyOrder integration', () => {
  it('resumes a partial projection and keeps replay links singular', async () => {
    const state: State = {
      cart: {
        id: 'cart_1',
        email: 'buyer@example.com',
        items: [],
        currency: 'EUR',
        shopify_order_id: null,
        highest_stage: 'checkout',
        status: 'active',
        last_action_at: '2026-07-20T09:55:00.000Z',
      },
      orderId: null,
      failOrderUpsertOnce: true,
      cartOrders: new Set(),
      orderContacts: new Set(),
      cartContacts: new Set(),
    }
    const sql = createSql(state)
    const order = {
      id: '9001',
      email: 'buyer@example.com',
      cart_token: 'cart-token',
      checkout_token: 'checkout-token',
      created_at: '2026-07-20T10:00:00.000Z',
      total_price: '120.00',
      currency: 'EUR',
      line_items: [],
      financial_status: 'paid',
    }

    await expect(upsertShopifyOrder(sql, order)).rejects.toThrow('orders write interrupted')
    expect(state.cart).toMatchObject({
      shopify_order_id: '9001',
      highest_stage: 'completed',
      status: 'completed',
    })
    expect(state.orderId).toBeNull()

    const resumed = await upsertShopifyOrder(sql, order)
    expect(resumed).toEqual({ matched_via: 'noop', cart_id: 'cart_1', already_completed: true })
    expect(state.orderId).toBe('order_pk_1')
    expect(state.cartOrders.size).toBe(1)
    expect(state.orderContacts.size).toBe(1)
    expect(state.cartContacts.size).toBe(1)

    await upsertShopifyOrder(sql, order)
    expect(state.cartOrders.size).toBe(1)
    expect(state.orderContacts.size).toBe(1)
    expect(state.cartContacts.size).toBe(1)
  })
})
