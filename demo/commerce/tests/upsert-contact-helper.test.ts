// Unit tests — upsert-contact-helper.
//
// Covers the three cases the plan requires (no-email -> not exercised
// because the command isn't even called), new email, and known email.
// Plus a couple of regression guards on the merge semantics.

import { describe, expect, it, vi } from 'vitest'
import {
  buildContactPatch,
  type CartContactLinkOps,
  type CartContactRow,
  type ContactRepo,
  type ContactRow,
  upsertContactAndLink,
} from '../src/modules/contact/upsert-contact-helper'

function makeContactRepo(initial: ContactRow[] = []): ContactRepo {
  const rows: ContactRow[] = [...initial]
  return {
    list: vi.fn(async (filters: Record<string, unknown>) =>
      rows.filter((r) => Object.entries(filters).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v)),
    ),
    create: vi.fn(async (data: Record<string, unknown>) => {
      const created: ContactRow = {
        id: `contact-${rows.length + 1}`,
        email: (data.email as string) ?? '',
        phone: (data.phone as string | null) ?? null,
        first_name: (data.first_name as string | null) ?? null,
        last_name: (data.last_name as string | null) ?? null,
        country_code: (data.country_code as string | null) ?? null,
        city: (data.city as string | null) ?? null,
        shopify_customer_id: (data.shopify_customer_id as string | null) ?? null,
        distinct_id: (data.distinct_id as string | null) ?? null,
      }
      rows.push(created)
      return created
    }),
    update: vi.fn(async (id: string, data: Record<string, unknown>) => {
      const idx = rows.findIndex((r) => r.id === id)
      if (idx < 0) throw new Error(`contact ${id} not found`)
      Object.assign(rows[idx], data)
      return rows[idx]
    }),
  }
}

function makeLinkRepo(initial: CartContactRow[] = []): CartContactLinkOps {
  const rows: CartContactRow[] = [...initial]
  return {
    list: vi.fn(async (where: Record<string, unknown>) =>
      rows.filter((r) => Object.entries(where).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v)),
    ),
    link: vi.fn(async (input: { cart_id: string; contact_id: string }) => {
      rows.push({ cart_id: input.cart_id, contact_id: input.contact_id })
      return { success: true as const }
    }),
    unlink: vi.fn(async (input: { cart_id: string; contact_id: string }) => {
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        if (rows[i].cart_id === input.cart_id && rows[i].contact_id === input.contact_id) {
          rows.splice(i, 1)
        }
      }
      return { success: true as const }
    }),
  }
}

describe('buildContactPatch — distinct_id first-write-wins', () => {
  it('never overwrites an existing distinct_id with a new one (one contact, many devices)', () => {
    const existing: ContactRow = {
      id: 'c1',
      email: 'jane@example.com',
      phone: null,
      first_name: null,
      last_name: null,
      country_code: null,
      city: null,
      shopify_customer_id: null,
      distinct_id: 'ph-original',
    }
    const patch = buildContactPatch(
      existing,
      { cart_id: 'cart-1', email: 'jane@example.com', distinct_id: 'ph-second-browser' },
      new Date(),
    )
    expect(patch.distinct_id).toBe('ph-original')
  })

  it('fills in distinct_id when the contact had none', () => {
    const existing: ContactRow = {
      id: 'c1',
      email: 'jane@example.com',
      phone: null,
      first_name: null,
      last_name: null,
      country_code: null,
      city: null,
      shopify_customer_id: null,
      distinct_id: null,
    }
    const patch = buildContactPatch(
      existing,
      { cart_id: 'cart-1', email: 'jane@example.com', distinct_id: 'ph-first-seen' },
      new Date(),
    )
    expect(patch.distinct_id).toBe('ph-first-seen')
  })
})

describe('buildContactPatch', () => {
  it('lowercases the email and bumps last_activity_at', () => {
    const now = new Date('2026-05-08T12:00:00Z')
    const patch = buildContactPatch(undefined, { cart_id: 'c1', email: 'Jane@Example.COM' }, now)
    expect(patch.email).toBe('jane@example.com')
    expect(patch.last_activity_at).toBe(now)
  })

  it('preserves existing non-null fields and fills missing ones', () => {
    const existing: ContactRow = {
      id: 'c1',
      email: 'jane@example.com',
      phone: '+33000',
      first_name: 'Jane',
      last_name: null,
      country_code: 'FR',
      city: null,
      shopify_customer_id: null,
      distinct_id: 'd1',
    }
    const patch = buildContactPatch(
      existing,
      {
        cart_id: 'cart-1',
        email: 'jane@example.com',
        first_name: 'OVERWRITE',
        last_name: 'Doe',
        phone: null,
        city: 'Paris',
        country_code: null,
        shopify_customer_id: 'sh-99',
      },
      new Date(),
    )
    expect(patch.first_name).toBe('Jane') // existing wins
    expect(patch.last_name).toBe('Doe') // filled in
    expect(patch.phone).toBe('+33000') // existing wins over null
    expect(patch.city).toBe('Paris') // filled in
    expect(patch.country_code).toBe('FR') // existing wins
    expect(patch.shopify_customer_id).toBe('sh-99') // filled in
    expect(patch.distinct_id).toBe('d1') // existing wins
  })
})

describe('upsertContactAndLink', () => {
  it('new email -> creates the contact and the cart->contact link', async () => {
    const contact = makeContactRepo()
    const link = makeLinkRepo()

    const result = await upsertContactAndLink({
      contact,
      link,
      input: {
        cart_id: 'cart-1',
        email: 'Jane@Example.com',
        first_name: 'Jane',
        last_name: 'Doe',
        distinct_id: 'd-1',
      },
    })

    expect(result.created).toBe(true)
    expect(result.link_changed).toBe(true)
    expect(contact.create).toHaveBeenCalledTimes(1)
    expect(contact.update).not.toHaveBeenCalled()
    expect(link.link).toHaveBeenCalledTimes(1)
    expect(link.unlink).not.toHaveBeenCalled()

    const createdPayload = (contact.create as unknown as { mock: { calls: [Record<string, unknown>][] } }).mock
      .calls[0][0]
    expect(createdPayload.email).toBe('jane@example.com') // lowercased
    expect(createdPayload.first_name).toBe('Jane')
  })

  it('known email + same cart link -> updates the contact, link untouched', async () => {
    const contact = makeContactRepo([
      {
        id: 'c1',
        email: 'jane@example.com',
        phone: null,
        first_name: 'Jane',
        last_name: null,
        country_code: null,
        city: null,
        shopify_customer_id: null,
        distinct_id: null,
      },
    ])
    const link = makeLinkRepo([{ cart_id: 'cart-1', contact_id: 'c1' }])

    const result = await upsertContactAndLink({
      contact,
      link,
      input: {
        cart_id: 'cart-1',
        email: 'jane@example.com',
        last_name: 'Doe',
        phone: '+33000',
        distinct_id: 'd-1',
      },
    })

    expect(result.created).toBe(false)
    expect(result.contact_id).toBe('c1')
    expect(result.link_changed).toBe(false)
    expect(contact.update).toHaveBeenCalledTimes(1)
    expect(contact.create).not.toHaveBeenCalled()
    expect(link.link).not.toHaveBeenCalled()
    expect(link.unlink).not.toHaveBeenCalled()

    // The update payload preserves first_name='Jane' and fills last_name + phone
    const updateCall = (contact.update as unknown as { mock: { calls: [string, Record<string, unknown>][] } }).mock
      .calls[0]
    expect(updateCall[1].first_name).toBe('Jane')
    expect(updateCall[1].last_name).toBe('Doe')
    expect(updateCall[1].phone).toBe('+33000')
  })

  it('cart already linked to a DIFFERENT contact -> repoints the link', async () => {
    const contact = makeContactRepo([
      {
        id: 'c1',
        email: 'jane@example.com',
        phone: null,
        first_name: null,
        last_name: null,
        country_code: null,
        city: null,
        shopify_customer_id: null,
        distinct_id: null,
      },
    ])
    const link = makeLinkRepo([{ cart_id: 'cart-1', contact_id: 'c-old' }])

    const result = await upsertContactAndLink({
      contact,
      link,
      input: { cart_id: 'cart-1', email: 'jane@example.com' },
    })

    expect(result.created).toBe(false)
    expect(result.link_changed).toBe(true)
    expect(link.unlink).toHaveBeenCalledTimes(1)
    expect(link.link).toHaveBeenCalledTimes(1)
  })
})
