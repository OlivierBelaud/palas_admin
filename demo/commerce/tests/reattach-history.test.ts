// Smoke tests — reattachHistoryForContact.
//
// Drives the helper with a fake `RawDb` that records every SQL it was
// asked to run. We're not validating Postgres semantics here, just that
// the helper builds the expected UPDATE and reports the rows it
// touched. Pairs with the prod runtime where the actual UPDATE clause
// is gated by `WHERE shopify_customer_id IS NULL` so we never clobber.

import { describe, expect, it, vi } from 'vitest'
import { type RawDb, reattachHistoryForContact } from '../src/modules/contact/reattach-history'

function makeDb(returnIds: string[]): RawDb & { sqls: string[]; params: unknown[][] } {
  const sqls: string[] = []
  const params: unknown[][] = []
  const raw = vi.fn(async (sql: string, p: unknown[] = []): Promise<unknown[]> => {
    sqls.push(sql)
    params.push(p)
    return returnIds.map((id) => ({ id }))
  })
  return { sqls, params, raw: raw as unknown as RawDb['raw'] }
}

describe('reattachHistoryForContact', () => {
  it('updates anonymous carts matching the email and reports the count', async () => {
    const db = makeDb(['cart-a', 'cart-b', 'cart-c'])
    const out = await reattachHistoryForContact(db, {
      email: 'Jane@Example.COM',
      shopify_customer_id: '12345',
    })

    expect(out.carts_attached).toBe(3)
    expect(out.orders_attached).toBe(0)
    expect(db.sqls[0]).toMatch(/UPDATE carts/i)
    expect(db.sqls[0]).toMatch(/shopify_customer_id IS NULL/)
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
    const db = makeDb([])
    await reattachHistoryForContact(db, { email: 'MIXED@Case.COM', shopify_customer_id: '999' })
    expect(db.params[0]).toEqual(['999', 'mixed@case.com'])
  })
})
