// Unit tests — matchContactByEventKeys.
//
// Pure read-only helper. Drive it with a tiny in-memory `RawDb` mock and
// assert the priority order: email > shopify_customer_id > klaviyo > distinct_id.

import { describe, expect, it, vi } from 'vitest'
import { matchContactByEventKeys, type RawDb } from '../src/modules/contact/match-by-event-keys'

interface ContactRow {
  id: string
  email: string | null
  shopify_customer_id?: string | null
  klaviyo_profile_id?: string | null
  distinct_id?: string | null
}

function makeDb(rows: ContactRow[]): RawDb & { calls: string[] } {
  const calls: string[] = []
  const raw = vi.fn(async (sql: string, params: unknown[] = []): Promise<unknown[]> => {
    calls.push(sql)
    if (sql.includes('LOWER(email)')) {
      const target = String(params[0] ?? '').toLowerCase()
      return rows.filter((r) => (r.email ?? '').toLowerCase() === target).map((r) => ({ id: r.id, email: r.email }))
    }
    if (sql.includes('shopify_customer_id = $1')) {
      const target = String(params[0] ?? '')
      return rows.filter((r) => r.shopify_customer_id === target).map((r) => ({ id: r.id, email: r.email }))
    }
    if (sql.includes('klaviyo_profile_id = $1')) {
      const target = String(params[0] ?? '')
      return rows.filter((r) => r.klaviyo_profile_id === target).map((r) => ({ id: r.id, email: r.email }))
    }
    if (sql.includes('distinct_id = $1')) {
      const target = String(params[0] ?? '')
      return rows.filter((r) => r.distinct_id === target).map((r) => ({ id: r.id, email: r.email }))
    }
    return []
  })
  return { calls, raw: raw as unknown as RawDb['raw'] }
}

describe('matchContactByEventKeys', () => {
  it('matches by email (case-insensitive)', async () => {
    const db = makeDb([{ id: 'c1', email: 'jane@example.com' }])
    const hit = await matchContactByEventKeys(db, { email: 'JANE@Example.COM' })
    expect(hit?.id).toBe('c1')
  })

  it('matches by distinct_id when no email is provided', async () => {
    const db = makeDb([{ id: 'c2', email: 'bob@example.com', distinct_id: 'ph-1' }])
    const hit = await matchContactByEventKeys(db, { distinct_id: 'ph-1' })
    expect(hit?.id).toBe('c2')
  })

  it('returns null when no key matches anything', async () => {
    const db = makeDb([{ id: 'c1', email: 'jane@example.com' }])
    const hit = await matchContactByEventKeys(db, { email: 'unknown@example.com', distinct_id: 'unknown' })
    expect(hit).toBeNull()
  })

  it('email beats distinct_id — first key in the priority order wins', async () => {
    // Two distinct contacts: one matches email, another matches distinct_id.
    // The helper must return the email-matched contact even though the
    // distinct_id would also have hit.
    const db = makeDb([
      { id: 'c-email', email: 'jane@example.com' },
      { id: 'c-distinct', email: 'someone-else@example.com', distinct_id: 'ph-1' },
    ])
    const hit = await matchContactByEventKeys(db, { email: 'jane@example.com', distinct_id: 'ph-1' })
    expect(hit?.id).toBe('c-email')
  })

  it('falls through to shopify_customer_id when email is absent', async () => {
    const db = makeDb([{ id: 'c3', email: null, shopify_customer_id: 'sh-9' }])
    const hit = await matchContactByEventKeys(db, { shopify_customer_id: 'sh-9' })
    expect(hit?.id).toBe('c3')
  })

  it('shopify_customer_id beats klaviyo_exchange_id and distinct_id', async () => {
    const db = makeDb([
      { id: 'c-shop', email: null, shopify_customer_id: 'sh-9' },
      { id: 'c-kla', email: null, klaviyo_profile_id: 'kx-1' },
      { id: 'c-ph', email: null, distinct_id: 'ph-1' },
    ])
    const hit = await matchContactByEventKeys(db, {
      shopify_customer_id: 'sh-9',
      klaviyo_exchange_id: 'kx-1',
      distinct_id: 'ph-1',
    })
    expect(hit?.id).toBe('c-shop')
  })
})
