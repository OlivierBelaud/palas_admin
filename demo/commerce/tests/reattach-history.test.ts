// Smoke tests — reattachHistoryForContact.
//
// Drives the helper with a fake `RawDb` that records every SQL it was
// asked to run. We're not validating Postgres semantics here, just that
// the helper builds the expected UPDATE and reports the rows it
// touched. Pairs with the prod runtime where the actual UPDATE clause
// is gated by `WHERE shopify_customer_id IS NULL` so we never clobber.

import { describe, expect, it, vi } from 'vitest'
import {
  type RawDb,
  reattachHistoryForContact,
  reattachShopifyCustomerHistory,
} from '../src/modules/contact/reattach-history'

function makeDb(
  cartIds: string[],
  contactId: string | null = null,
  orderIds: string[] = [],
): RawDb & { sqls: string[]; params: unknown[][] } {
  const sqls: string[] = []
  const params: unknown[][] = []
  const raw = vi.fn(async (sql: string, p: unknown[] = []): Promise<unknown[]> => {
    sqls.push(sql)
    params.push(p)
    if (/UPDATE carts/i.test(sql)) return cartIds.map((id) => ({ id }))
    if (/SELECT id::text AS id FROM contacts/i.test(sql)) return contactId ? [{ id: contactId }] : []
    if (/order_contact/i.test(sql)) return orderIds.map((id) => ({ id }))
    return []
  })
  return { sqls, params, raw: raw as unknown as RawDb['raw'] }
}

describe('reattachHistoryForContact', () => {
  it('updates anonymous carts matching the email and reports the count', async () => {
    const db = makeDb(['cart-a', 'cart-b', 'cart-c'], 'contact-1')
    const out = await reattachHistoryForContact(db, {
      email: 'Jane@Example.COM',
      shopify_customer_id: '12345',
    })

    expect(out.carts_attached).toBe(3)
    expect(out.orders_attached).toBe(0)
    expect(db.sqls[0]).toMatch(/UPDATE carts/i)
    expect(db.sqls[0]).toMatch(/shopify_customer_id IS NULL/)
    expect(db.sqls[2]).toMatch(/NOT EXISTS/)
    expect(db.params[0]).toEqual(['12345', 'jane@example.com'])
  })

  it('is a no-op when email or shopify_customer_id is missing', async () => {
    const db = makeDb([])
    const a = await reattachHistoryForContact(db, { email: '', shopify_customer_id: 'sh-1' })
    const b = await reattachHistoryForContact(db, { email: 'jane@example.com', shopify_customer_id: '   ' })
    expect(a.carts_attached).toBe(0)
    expect(b.carts_attached).toBe(0)
    expect(db.sqls).toHaveLength(0)
  })

  it('lowercases the email before matching', async () => {
    const db = makeDb([], 'contact-1')
    await reattachHistoryForContact(db, { email: 'MIXED@Case.COM', shopify_customer_id: '999' })
    expect(db.params[0]).toEqual(['999', 'mixed@case.com'])
  })

  it('surfaces a missing contact after stamping carts so reconciliation can retry', async () => {
    const db = makeDb(['cart-a'])

    await expect(
      reattachHistoryForContact(db, {
        email: 'jane@example.com',
        shopify_customer_id: '12345',
      }),
    ).rejects.toThrow('contact not found')
  })

  it('propagates a failed cart link and repairs it on retry without restamping the cart', async () => {
    let attempt = 0
    let cartUpdateCalls = 0
    const raw: RawDb['raw'] = async <T>(sql: string): Promise<T[]> => {
      if (/UPDATE carts/i.test(sql)) {
        cartUpdateCalls += 1
        return (cartUpdateCalls === 1 ? [{ id: 'cart-a' }] : []) as T[]
      }
      if (/SELECT id::text AS id FROM contacts/i.test(sql)) return [{ id: 'contact-1' }] as T[]
      if (/INSERT INTO cart_contact/i.test(sql)) {
        attempt += 1
        if (attempt === 1) throw new Error('cart_contact unavailable')
        return [{ cart_id: 'cart-a' }] as T[]
      }
      if (/order_contact/i.test(sql)) return [] as T[]
      return []
    }
    const db: RawDb = { raw }
    const input = { email: 'jane@example.com', shopify_customer_id: '12345' }

    await expect(reattachHistoryForContact(db, input)).rejects.toThrow('cart_contact unavailable')
    await expect(reattachHistoryForContact(db, input)).resolves.toMatchObject({
      carts_attached: 0,
      cart_links_attached: 1,
    })
  })

  it('lets the Shopify reconciliation workflow observe reattachment failures', async () => {
    const db: RawDb = {
      raw: async () => {
        throw new Error('history unavailable')
      },
    }

    await expect(
      reattachShopifyCustomerHistory(db, [
        { email: 'jane@example.com', shopify_customer_id: '12345' },
      ]),
    ).rejects.toThrow('history unavailable')
  })

  it('aggregates repaired links separately from newly stamped carts', async () => {
    const db = makeDb(['cart-a'], 'contact-1')
    db.raw = vi.fn(async (sql: string): Promise<unknown[]> => {
      if (/UPDATE carts/i.test(sql)) return [{ id: 'cart-a' }]
      if (/SELECT id::text AS id FROM contacts/i.test(sql)) return [{ id: 'contact-1' }]
      if (/INSERT INTO cart_contact/i.test(sql)) return [{ cart_id: 'cart-a' }]
      return []
    }) as unknown as RawDb['raw']

    await expect(
      reattachShopifyCustomerHistory(db, [
        { email: 'jane@example.com', shopify_customer_id: '12345' },
      ]),
    ).resolves.toEqual({
      carts_attached: 1,
      cart_links_attached: 1,
      orders_attached: 0,
    })
  })
})
