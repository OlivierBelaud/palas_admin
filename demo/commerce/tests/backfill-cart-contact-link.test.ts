// Smoke tests — backfillCartContactLink (pure orchestration helper).
//
// Drives the helper with an in-memory repo so we exercise every branch:
//   - existing contact, no link, no backfills needed → only inserts link
//   - existing contact + cart has distinct_id but contact doesn't → backfill
//   - existing contact + contact has shopify_customer_id but cart doesn't → backfill
//   - no existing contact → insert contact, set distinct_id flag, insert link
//   - re-run with link already present → no-op for link insert

import { describe, expect, it } from 'vitest'
import {
  type BackfillRepo,
  backfillCartContactLink,
  type CartRow,
  type ContactLookupRow,
} from '../src/modules/contact/backfill-cart-contact-link'

function makeCart(over: Partial<CartRow> = {}): CartRow {
  return {
    id: 'cart-1',
    email: 'Jane@Example.COM',
    first_name: 'Jane',
    last_name: 'Doe',
    phone: null,
    city: null,
    country_code: 'FR',
    distinct_id: null,
    shopify_customer_id: null,
    ...over,
  }
}

interface RecordingRepo extends BackfillRepo {
  inserts: { contacts: number; links: number }
  updates: { contactDistinctId: Array<[string, string]>; cartShopifyId: Array<[string, string]> }
}

function makeRepo(opts: { existingContact?: ContactLookupRow | null; hasLink?: boolean }): RecordingRepo {
  const inserts = { contacts: 0, links: 0 }
  const updates = {
    contactDistinctId: [] as Array<[string, string]>,
    cartShopifyId: [] as Array<[string, string]>,
  }
  return {
    findContactByLowerEmail: async () => opts.existingContact ?? null,
    insertContact: async () => {
      inserts.contacts++
      return { id: 'contact-new' }
    },
    updateContactDistinctId: async (cid, did) => {
      updates.contactDistinctId.push([cid, did])
    },
    updateCartShopifyCustomerId: async (cid, sid) => {
      updates.cartShopifyId.push([cid, sid])
    },
    hasLink: async () => opts.hasLink ?? false,
    insertLink: async () => {
      inserts.links++
    },
    inserts,
    updates,
  }
}

describe('backfillCartContactLink', () => {
  it('existing contact, no link, no cross-backfills → only inserts the link', async () => {
    const repo = makeRepo({
      existingContact: { id: 'c-1', email: 'jane@example.com', shopify_customer_id: null, distinct_id: 'd-1' },
      hasLink: false,
    })
    const out = await backfillCartContactLink(repo, makeCart({ distinct_id: 'd-1' }))
    expect(out).not.toBeNull()
    if (!out) return
    expect(out.contact_created).toBe(false)
    expect(out.link_inserted).toBe(true)
    expect(out.contact_distinct_id_set).toBe(false)
    expect(out.cart_shopify_customer_id_set).toBe(false)
    expect(repo.inserts).toEqual({ contacts: 0, links: 1 })
    expect(repo.updates.contactDistinctId).toEqual([])
  })

  it('cart has distinct_id and contact does not → backfills contact.distinct_id', async () => {
    const repo = makeRepo({
      existingContact: { id: 'c-1', email: 'jane@example.com', shopify_customer_id: null, distinct_id: null },
      hasLink: false,
    })
    const out = await backfillCartContactLink(repo, makeCart({ distinct_id: 'd-42' }))
    expect(out).not.toBeNull()
    if (!out) return
    expect(out.contact_distinct_id_set).toBe(true)
    expect(repo.updates.contactDistinctId).toEqual([['c-1', 'd-42']])
  })

  it('contact has shopify_customer_id and cart does not → backfills cart.shopify_customer_id', async () => {
    const repo = makeRepo({
      existingContact: { id: 'c-1', email: 'jane@example.com', shopify_customer_id: '999', distinct_id: null },
      hasLink: false,
    })
    const out = await backfillCartContactLink(repo, makeCart({ shopify_customer_id: null }))
    expect(out).not.toBeNull()
    if (!out) return
    expect(out.cart_shopify_customer_id_set).toBe(true)
    expect(repo.updates.cartShopifyId).toEqual([['cart-1', '999']])
  })

  it('no existing contact → inserts contact + link, sets distinct_id flag when cart has one', async () => {
    const repo = makeRepo({ existingContact: null, hasLink: false })
    const out = await backfillCartContactLink(repo, makeCart({ distinct_id: 'd-9' }))
    expect(out).not.toBeNull()
    if (!out) return
    expect(out.contact_created).toBe(true)
    expect(out.link_inserted).toBe(true)
    expect(out.contact_distinct_id_set).toBe(true)
    expect(repo.inserts).toEqual({ contacts: 1, links: 1 })
  })

  it('re-run with link already present → no-op for the link', async () => {
    const repo = makeRepo({
      existingContact: { id: 'c-1', email: 'jane@example.com', shopify_customer_id: null, distinct_id: 'd-1' },
      hasLink: true,
    })
    const out = await backfillCartContactLink(repo, makeCart({ distinct_id: 'd-1' }))
    expect(out).not.toBeNull()
    if (!out) return
    expect(out.link_inserted).toBe(false)
    expect(repo.inserts.links).toBe(0)
  })

  it('returns null on empty email (caller filters upstream)', async () => {
    const repo = makeRepo({})
    const out = await backfillCartContactLink(repo, makeCart({ email: '   ' }))
    expect(out).toBeNull()
    expect(repo.inserts).toEqual({ contacts: 0, links: 0 })
  })
})
