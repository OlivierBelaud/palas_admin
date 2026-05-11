// Unit tests — upsertShopifyCustomer.
//
// Drives the helper with a fake postgres-js `sql` tagged-template. We record
// every (template, params) call so we can assert on the SQL keywords used
// without booting a real DB. The route file is the IO boundary; this helper
// is the pure orchestration layer.
//
// Three cases covered (per spec):
//   1. new — no row matches shopify_id or email → INSERT
//   2. existing match by shopify_customer_id → UPDATE first-write-wins
//   3. existing match by email (different shopify_id) → UPDATE,
//      shopify_customer_id is set on the row, first-write-wins on identity

import { describe, expect, it } from 'vitest'
import {
  type ShopifyCustomerPayload,
  type SqlClient,
  upsertShopifyCustomer,
} from '../src/modules/contact/upsert-shopify-customer'

interface SqlCall {
  text: string
  params: unknown[]
}

interface FakeSql {
  sql: SqlClient
  calls: SqlCall[]
  setNext: (rows: unknown[]) => void
}

/**
 * Build a fake `sql` tagged-template. Each call records the joined template
 * (so tests can assert on keywords) and the params. The caller may queue up
 * a per-call result by pushing to `nextResults`.
 */
function makeFakeSql(queue: unknown[][]): FakeSql {
  const calls: SqlCall[] = []
  const localQueue = [...queue]

  function tagged(strings: TemplateStringsArray, ...params: unknown[]): Promise<unknown[]> {
    const text = strings.join('?')
    calls.push({ text, params })
    const next = localQueue.shift() ?? []
    return Promise.resolve(next)
  }
  // postgres-js exposes .json + .unsafe on the tagged function. We provide
  // stubs sufficient for the code paths we exercise.
  // biome-ignore lint/suspicious/noExplicitAny: shim for postgres-js Sql surface
  ;(tagged as any).json = (v: unknown) => v
  // biome-ignore lint/suspicious/noExplicitAny: shim for postgres-js Sql surface
  ;(tagged as any).unsafe = (text: string, params: unknown[] = []) => {
    calls.push({ text, params })
    const next = localQueue.shift() ?? []
    return Promise.resolve(next)
  }

  return {
    sql: tagged as unknown as SqlClient,
    calls,
    setNext: (rows: unknown[]) => localQueue.push(rows),
  }
}

const BASE: ShopifyCustomerPayload = {
  id: 1234567890,
  email: 'jane@example.com',
  first_name: 'Jane',
  last_name: 'Doe',
  phone: '+33611111111',
  orders_count: 3,
  total_spent: '149.90',
  locale: 'fr',
  default_address: { city: 'Paris', country_code: 'FR' },
}

describe('upsertShopifyCustomer', () => {
  it('case 1 (new): inserts a contact when no row matches shopify_id or email', async () => {
    const fake = makeFakeSql([
      [], // findByShopifyId → none
      [], // findByEmail → none
      [{ id: 'contact-new-1' }], // INSERT RETURNING
      // reattachHistoryForContact uses sql.unsafe — returns IDs
      [],
    ])

    const out = await upsertShopifyCustomer(fake.sql, BASE)

    expect(out.matched_via).toBe('inserted')
    expect(out.contact_id).toBe('contact-new-1')
    expect(out.created).toBe(true)
    expect(out.carts_reattached).toBe(0)

    expect(fake.calls[0].text).toMatch(/shopify_customer_id =/)
    expect(fake.calls[0].params).toContain('1234567890')
    expect(fake.calls[1].text).toMatch(/LOWER\(email\)/i)
    expect(fake.calls[2].text).toMatch(/INSERT INTO contacts/i)
    // Params for INSERT must include the lowercased email
    expect(fake.calls[2].params).toContain('jane@example.com')
  })

  it('case 2 (existing by shopify_id): UPDATEs first-write-wins on identity', async () => {
    const fake = makeFakeSql([
      // findByShopifyId → match (with pre-existing names)
      [
        {
          id: 'contact-1',
          email: 'jane@example.com',
          shopify_customer_id: '1234567890',
          phone: '+33600000000',
          first_name: 'Existing',
          last_name: 'Name',
          locale: 'fr-FR',
          country_code: 'FR',
          city: 'Lyon',
        },
      ],
      [], // UPDATE — no rows returned
      [], // reattach — no rows
    ])

    const out = await upsertShopifyCustomer(fake.sql, BASE)

    expect(out.matched_via).toBe('shopify_customer_id')
    expect(out.contact_id).toBe('contact-1')
    expect(out.created).toBe(false)
    // The UPDATE SQL is the second call
    expect(fake.calls[1].text).toMatch(/UPDATE contacts/i)
    expect(fake.calls[1].text).toMatch(/COALESCE\(phone, /)
    expect(fake.calls[1].text).toMatch(/COALESCE\(first_name, /)
  })

  it('case 3 (existing by email, different shopify_id): matches by email and stamps shopify_id', async () => {
    const fake = makeFakeSql([
      [], // findByShopifyId → none
      // findByEmail → existing row but with NULL shopify_customer_id (pixel-seeded contact)
      [
        {
          id: 'contact-2',
          email: 'jane@example.com',
          shopify_customer_id: null,
          phone: null,
          first_name: null,
          last_name: null,
          locale: 'fr-FR',
          country_code: null,
          city: null,
        },
      ],
      [], // UPDATE
      [], // reattach
    ])

    const out = await upsertShopifyCustomer(fake.sql, BASE)

    expect(out.matched_via).toBe('email')
    expect(out.contact_id).toBe('contact-2')
    expect(out.created).toBe(false)
    expect(fake.calls[2].text).toMatch(/UPDATE contacts/i)
    // COALESCE preserves NULL → fills from payload
    expect(fake.calls[2].text).toMatch(/COALESCE\(shopify_customer_id,/)
  })

  it('returns noop and writes nothing when payload has no email', async () => {
    const fake = makeFakeSql([])
    const out = await upsertShopifyCustomer(fake.sql, { ...BASE, email: null })

    expect(out.matched_via).toBe('noop')
    expect(out.contact_id).toBe(null)
    expect(out.created).toBe(false)
    expect(fake.calls.length).toBe(0)
  })

  it('dry-run on existing match does not call UPDATE', async () => {
    const fake = makeFakeSql([
      [
        {
          id: 'contact-1',
          email: 'jane@example.com',
          shopify_customer_id: '1234567890',
          phone: null,
          first_name: null,
          last_name: null,
          locale: null,
          country_code: null,
          city: null,
        },
      ],
    ])
    const out = await upsertShopifyCustomer(fake.sql, BASE, { dryRun: true })

    expect(out.matched_via).toBe('shopify_customer_id')
    expect(out.contact_id).toBe('contact-1')
    // Only the SELECT happened; no UPDATE
    expect(fake.calls.length).toBe(1)
    expect(fake.calls[0].text).not.toMatch(/UPDATE/i)
  })
})
