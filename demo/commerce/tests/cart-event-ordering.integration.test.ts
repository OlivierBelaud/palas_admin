import { readFileSync } from 'node:fs'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { linkCurrentCartContact } from '../src/modules/cart-tracking/link-current-cart-contact'
import { ingestRecoveredCartEvent, recoverPosthogEvents } from '../src/modules/cart-tracking/posthog-recovery'
import type { HogQLEventRow } from '../src/modules/cart-tracking/posthog-sync'

const url = process.env.PALAS_TEST_DATABASE_URL
const suite = url ? describe : describe.skip
type Row = Record<string, unknown>
type Command = { workflow: (input: Row, ctx: unknown) => Promise<unknown> }
let command: Command
suite('cart event ordering on PostgreSQL', () => {
  let sql: ReturnType<typeof postgres>
  const db = { raw: async <T>(q: string, p: unknown[] = []) => [...(await sql.unsafe(q, p as never[]))] as T[] }
  let failContact = false
  const contacts: Row[] = []
  const conversions: Row[] = []
  const emits: Row[] = []
  const list = async (filters: Row) => [
    ...(await sql.unsafe(
      `SELECT * FROM carts WHERE ${Object.keys(filters)
        .map((key, i) => `"${key}" = $${i + 1}`)
        .join(' AND ')}`,
      Object.values(filters) as never[],
    )),
  ]
  const dataForSql = (data: Row) =>
    Object.fromEntries(
      Object.entries(data).map(([key, value]) => [
        key,
        key === 'items' || key === 'discounts' ? (value == null ? null : JSON.stringify(value)) : value,
      ]),
    )
  const ctx = {
    step: {
      service: {
        cart: {
          list,
          create: async (data: Row) => (await sql`INSERT INTO carts ${sql(dataForSql(data))} RETURNING *`)[0],
          update: async (id: string, data: Row) =>
            (await sql`UPDATE carts SET ${sql(dataForSql(data))} WHERE id=${id} RETURNING *`)[0],
        },
      },
      action:
        (
          _name: string,
          def: { invoke: (input: unknown, ctx: { app: { resolve: () => typeof db } }) => Promise<unknown> },
        ) =>
        async (input: unknown) =>
          def.invoke(input, { app: { resolve: () => db } }),
      command: {
        upsertContactFromCartSignal: async (input: Row) => {
          if (failContact) throw new Error('temporary contact failure')
          contacts.push(input)
        },
        attributeSessionConversion: async (input: Row) => {
          conversions.push(input)
        },
      },
      emit: async (name: string, payload: Row) => {
        emits.push({ name, ...payload })
      },
    },
  }
  const event = (at: string, overrides: Row = {}) => ({
    cart_token: 'same-cart',
    action: 'cart:updated',
    occurred_at: at,
    email: 'current@example.test',
    items: [{ id: 'one' }],
    total_price: 10,
    currency: 'EUR',
    ...overrides,
  })
  beforeAll(async () => {
    if (!url || !['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) throw new Error('Local database required')
    sql = postgres(url, { max: 8, connection: { search_path: 'cart_ordering_test' }, onnotice: () => {} })
    await sql`CREATE SCHEMA cart_ordering_test`
    await sql`CREATE TABLE carts (id text PRIMARY KEY DEFAULT gen_random_uuid()::text, cart_token text UNIQUE, highest_stage text DEFAULT 'cart', status text DEFAULT 'active', cart_birth_at timestamptz, last_action_at timestamptz, completed_at timestamptz, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW(), deleted_at timestamptz, items jsonb, total_price numeric, item_count int, currency text, last_action text, distinct_id text, email text, first_name text, last_name text, phone text, city text, country_code text, browser_locale text, shopify_customer_id text, checkout_token text, order_id text, shopify_order_id text, is_first_order boolean, shipping_method text, shipping_price numeric, discounts_amount numeric, discounts jsonb, subtotal_price numeric, total_tax numeric)`
    await sql`CREATE TABLE cart_contact (id text PRIMARY KEY, cart_id text, contact_id text, created_at timestamptz, updated_at timestamptz, deleted_at timestamptz)`
    await sql.unsafe(
      readFileSync(new URL('../drizzle/migrations/20260922113000_posthog_recovery.sql', import.meta.url), 'utf8'),
    )
    vi.stubGlobal('z', z)
    vi.stubGlobal('defineCommand', (value: Command) => value)
    command = (await import('../src/commands/admin/ingest-cart-event')).default as unknown as Command
  })
  beforeEach(async () => {
    await sql`TRUNCATE carts, cart_contact, posthog_recovery_state, posthog_recovery_receipts`
    await sql`INSERT INTO carts (id,cart_token,cart_birth_at) VALUES ('cart-1','same-cart','2026-09-21T11:00Z')`
    failContact = false
    contacts.length = 0
    conversions.length = 0
    emits.length = 0
  })
  afterAll(async () => {
    vi.unstubAllGlobals()
    if (sql) {
      await sql`DROP SCHEMA cart_ordering_test CASCADE`
      await sql.end()
    }
  })
  it('does not replace a newer snapshot when an older failed enrichment is retried', async () => {
    const old = event('2026-09-21T12:00:00Z')
    failContact = true
    expect(await command.workflow(old, ctx)).toMatchObject({ recovery_pending: true })
    failContact = false
    await command.workflow(
      event('2026-09-21T12:05:00Z', { items: [{ id: 'one' }, { id: 'two' }], total_price: 20 }),
      ctx,
    )
    await command.workflow(old, ctx)
    const [cart] = await list({ id: 'cart-1' })
    expect(cart.item_count).toBe(2)
    expect(Number(cart.total_price)).toBe(20)
    expect(cart.last_action_at.toISOString()).toBe('2026-09-21T12:05:00.000Z')
  })
  it('keeps a newer cleared cart empty through replay and preserves its birth', async () => {
    await command.workflow(event('2026-09-21T12:00:00Z'), ctx)
    await command.workflow(event('2026-09-21T12:05:00Z', { action: 'cart:cleared', items: [], total_price: 0 }), ctx)
    await command.workflow(event('2026-09-21T12:00:00Z'), ctx)
    const [cart] = await list({ id: 'cart-1' })
    expect(cart.items).toEqual([])
    expect(Number(cart.total_price)).toBe(0)
    expect(cart.last_action).toBe('cart:cleared')
    expect(cart.cart_birth_at.toISOString()).toBe('2026-09-21T11:00:00.000Z')
  })
  it('attributes an older checkout completion without replacing the recent snapshot or identity', async () => {
    await command.workflow(event('2026-09-21T12:05:00Z', { total_price: 20, email: 'new@example.test' }), ctx)
    await command.workflow(
      event('2026-09-21T12:00:00Z', {
        action: 'checkout:completed',
        email: 'old@example.test',
        first_name: 'Old',
        shopify_order_id: 'order-1',
      }),
      ctx,
    )
    const [cart] = await list({ id: 'cart-1' })
    expect(cart.highest_stage).toBe('completed')
    expect(cart.status).toBe('completed')
    expect(cart.completed_at.toISOString()).toBe('2026-09-21T12:00:00.000Z')
    expect(cart.shopify_order_id).toBe('order-1')
    expect(Number(cart.total_price)).toBe(20)
    expect(cart.email).toBe('new@example.test')
    expect(cart.first_name).toBeNull()
    expect(contacts.at(-1)?.email).toBe('new@example.test')
    expect(conversions).toHaveLength(1)
    expect(conversions[0]).toMatchObject({ conversion_at: '2026-09-21T12:00:00Z', order_id: 'order-1' })
    expect(emits.at(-1)?.email).toBe('new@example.test')
  })
  it('fills missing identity during an old replay without overwriting the newer snapshot', async () => {
    await command.workflow(event('2026-09-21T12:05:00Z', { email: null, total_price: 20 }), ctx)
    await command.workflow(event('2026-09-21T12:00:00Z', { email: 'recovered@example.test' }), ctx)
    const [cart] = await list({ id: 'cart-1' })
    expect(cart.email).toBe('recovered@example.test')
    expect(Number(cart.total_price)).toBe(20)
    expect(contacts.at(-1)?.email).toBe('recovered@example.test')
  })
  it('retains the first snapshot on exact timestamp ties and still retries failed followups', async () => {
    failContact = true
    expect(await command.workflow(event('2026-09-21T12:00:00Z'), ctx)).toMatchObject({ recovery_pending: true })
    failContact = false
    await command.workflow(event('2026-09-21T12:00:00Z', { total_price: 20 }), ctx)
    await command.workflow(event('2026-09-21T12:00:00Z'), ctx)
    expect(Number((await list({ id: 'cart-1' }))[0].total_price)).toBe(10)
    expect(contacts).toHaveLength(2)
  })
  it('orders timestamps beyond JavaScript millisecond precision', async () => {
    await command.workflow(event('2026-09-21T12:00:00.123456Z'), ctx)
    await command.workflow(event('2026-09-21T12:00:00.123457Z', { total_price: 20 }), ctx)
    await command.workflow(event('2026-09-21T12:00:00.123456Z'), ctx)
    expect(Number((await list({ id: 'cart-1' }))[0].total_price)).toBe(20)
  })
  it('keeps the newest snapshot and highest funnel with concurrent out-of-order writers', async () => {
    await Promise.all(
      Array.from({ length: 16 }, (_, i) =>
        command.workflow(
          event(`2026-09-21T12:00:${String(i).padStart(2, '0')}Z`, {
            total_price: i,
            action: i === 3 ? 'checkout:payment_info_submitted' : 'cart:updated',
          }),
          ctx,
        ),
      ),
    )
    const [cart] = await list({ id: 'cart-1' })
    expect(Number(cart.total_price)).toBe(15)
    expect(cart.highest_stage).toBe('payment_attempted')
  })
  it('arbitrates two first events through the unique cart token', async () => {
    await sql`TRUNCATE carts`
    await Promise.all([
      command.workflow(event('2026-09-21T12:00:00Z'), ctx),
      command.workflow(event('2026-09-21T12:05:00Z', { total_price: 20 }), ctx),
    ])
    const carts = await list({ cart_token: 'same-cart' })
    expect(carts).toHaveLength(1)
    expect(Number(carts[0].total_price)).toBe(20)
  })
  it('fences an old in-flight contact link after a newer email arrives', async () => {
    await command.workflow(event('2026-09-21T12:00:00Z', { email: 'old@example.test' }), ctx)
    await linkCurrentCartContact(db, 'cart-1', 'old-contact', 'old@example.test')
    await command.workflow(event('2026-09-21T12:05:00Z', { email: 'new@example.test' }), ctx)
    await linkCurrentCartContact(db, 'cart-1', 'new-contact', 'new@example.test')
    expect(await linkCurrentCartContact(db, 'cart-1', 'old-contact', 'old@example.test')).toBe(false)
    expect(
      (await sql`SELECT contact_id FROM cart_contact WHERE cart_id='cart-1'`).map((row) => row.contact_id),
    ).toEqual(['new-contact'])
  })
  it('serializes concurrent same-identity links without duplicates on the legacy pivot schema', async () => {
    await command.workflow(event('2026-09-21T12:00:00Z'), ctx)
    await sql`INSERT INTO cart_contact (id,cart_id,contact_id) VALUES ('legacy','cart-1','old-contact')`
    await Promise.all(
      Array.from({ length: 12 }, () => linkCurrentCartContact(db, 'cart-1', 'current-contact', 'current@example.test')),
    )
    expect(
      (await sql`SELECT contact_id FROM cart_contact WHERE cart_id='cart-1'`).map((row) => row.contact_id),
    ).toEqual(['current-contact'])
  })

  it('runs durable recovery through the actual cart command, retrying A while deduplicating newer B', async () => {
    const rows: HogQLEventRow[] = [
      [
        'event-a',
        'cart:updated',
        'visitor',
        '2026-09-21 12:00:00.123456',
        { email: 'current@example.test', cart: { token: 'same-cart', items: [{ id: 'one' }], total_price: 10 } },
      ],
      [
        'event-b',
        'cart:updated',
        'visitor',
        '2026-09-21 12:05:00.123456',
        {
          email: 'current@example.test',
          cart: { token: 'same-cart', items: [{ id: 'one' }, { id: 'two' }], total_price: 20 },
        },
      ],
    ]
    let retry = false
    const seen: string[] = []
    const ingest = async (input: Row) => {
      seen.push(String(input.occurred_at))
      failContact = !retry && String(input.occurred_at).includes('12:00:00')
      return ingestRecoveredCartEvent(input, {
        ingestCartEvent: (value) => command.workflow(value, ctx),
        refreshCart: async () => ({}),
      })
    }
    const run = () =>
      recoverPosthogEvents({ db, ingest, now: () => Date.parse('2026-09-22T00:00:00Z'), fetchPage: async () => rows })
    await run()
    expect((await sql`SELECT status FROM posthog_recovery_receipts WHERE event_uuid='event-a'`)[0].status).toBe('retry')
    expect((await sql`SELECT status FROM posthog_recovery_receipts WHERE event_uuid='event-b'`)[0].status).toBe('done')
    retry = true
    await sql`UPDATE posthog_recovery_receipts SET next_retry_at='2020-01-01' WHERE event_uuid='event-a'`
    await run()
    expect(seen.filter((value) => value.includes('12:05:00'))).toHaveLength(1)
    expect(seen.filter((value) => value.includes('12:00:00'))).toHaveLength(2)
    const [cart] = await list({ id: 'cart-1' })
    expect(Number(cart.total_price)).toBe(20)
    expect(cart.item_count).toBe(2)
    expect(
      (await sql`SELECT status,payload FROM posthog_recovery_receipts WHERE event_uuid='event-a'`)[0],
    ).toMatchObject({ status: 'done', payload: null })
  })
})
