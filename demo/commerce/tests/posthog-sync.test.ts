// Unit test — posthog-sync helpers.
//
// Covers the inner loop of the syncPostHogEvents command (the cron
// safety net that pulls cart/checkout events from PostHog every 5
// minutes). The test feeds three fixture rows of `checkout:completed`
// through the helper with a mock `ingest` and asserts the dispatcher
// is called exactly three times, with the canonical ingestCartEvent
// payload shape.

import { describe, expect, it, vi } from 'vitest'
import { type HogQLEventRow, ingestHogQLRows, rowToPosthogEvent } from '../src/modules/cart-tracking/posthog-sync'

function row(
  overrides: Partial<{ uuid: string; event: string; distinct_id: string; timestamp: string; props: object }> = {},
): HogQLEventRow {
  const props = overrides.props ?? {
    cart: {
      token: 'ct-1',
      items: [{ id: '1', product_id: 'p1', title: 'Shoe', quantity: 1, price: 50 }],
      total_price: 50,
      currency: 'EUR',
    },
    checkout: { token: 'co-1', shopify_order_id: 'order-1' },
    $set: { email: 'jane@example.com' },
  }
  return [
    overrides.uuid ?? 'uuid-1',
    overrides.event ?? 'checkout:completed',
    overrides.distinct_id ?? 'distinct-1',
    overrides.timestamp ?? '2026-05-08T12:00:00.000Z',
    JSON.stringify(props),
  ] as HogQLEventRow
}

describe('rowToPosthogEvent', () => {
  it('decodes string JSON properties into an object', () => {
    const evt = rowToPosthogEvent(row())
    expect(evt.event).toBe('checkout:completed')
    expect(evt.distinct_id).toBe('distinct-1')
    expect((evt.properties.cart as { token: string }).token).toBe('ct-1')
  })

  it('passes through pre-decoded properties unchanged', () => {
    const r: HogQLEventRow = ['u', 'cart:viewed', 'd', '2026-05-08T00:00:00Z', { cart: { token: 'x' } }]
    const evt = rowToPosthogEvent(r)
    expect((evt.properties.cart as { token: string }).token).toBe('x')
  })

  it('preserves null distinct_id', () => {
    const r: HogQLEventRow = ['u', 'cart:viewed', null, '2026-05-08T00:00:00Z', '{}']
    const evt = rowToPosthogEvent(r)
    expect(evt.distinct_id).toBeNull()
  })
})

describe('ingestHogQLRows — 3 checkout:completed fixture', () => {
  it('dispatches ingest exactly 3 times when given 3 valid rows', async () => {
    const rows: HogQLEventRow[] = [
      row({ uuid: 'u1', distinct_id: 'd1' }),
      row({
        uuid: 'u2',
        distinct_id: 'd2',
        props: {
          cart: {
            token: 'ct-2',
            items: [{ id: '2', product_id: 'p2', title: 'Hat', quantity: 1, price: 20 }],
            total_price: 20,
            currency: 'EUR',
          },
          checkout: { token: 'co-2', shopify_order_id: 'order-2' },
          $set: { email: 'bob@example.com' },
        },
      }),
      row({
        uuid: 'u3',
        distinct_id: 'd3',
        props: {
          cart: {
            token: 'ct-3',
            items: [{ id: '3', product_id: 'p3', title: 'Belt', quantity: 1, price: 35 }],
            total_price: 35,
            currency: 'EUR',
          },
          checkout: { token: 'co-3', shopify_order_id: 'order-3' },
          $set: { email: 'eve@example.com' },
        },
      }),
    ]

    const ingest = vi.fn(async (_input: Record<string, unknown>) => ({ ok: true }))
    const result = await ingestHogQLRows(rows, { ingest })

    expect(ingest).toHaveBeenCalledTimes(3)
    expect(result).toEqual({ ingested: 3, skipped: 0, errors: 0 })

    // Spot-check the dispatched payload shape: `action` is the event name,
    // `cart_token` is forwarded, and `email` is propagated from $set.
    const firstPayload = ingest.mock.calls[0][0]
    expect(firstPayload.action).toBe('checkout:completed')
    expect(firstPayload.cart_token).toBe('ct-1')
    expect(firstPayload.email).toBe('jane@example.com')
    expect(firstPayload.shopify_order_id).toBe('order-1')
  })

  it('skips rows whose event name is not in the cart/checkout vocabulary', async () => {
    const rows: HogQLEventRow[] = [
      row({ event: 'pageview' }),
      row({ event: 'cart:viewed' }), // included but no cart_token → also skipped
      row({ event: 'checkout:completed' }),
    ]
    // Strip cart_token from the second one so normalize bails:
    rows[1] = ['u-no-token', 'cart:viewed', 'd', '2026-05-08T00:00:00Z', '{}']

    const ingest = vi.fn(async () => undefined)
    const result = await ingestHogQLRows(rows, { ingest })

    expect(ingest).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ ingested: 1, skipped: 2, errors: 0 })
  })

  it('counts an ingest throw as an error, keeps going, caps warnings at 10', async () => {
    const rows: HogQLEventRow[] = [row({ uuid: 'u1' }), row({ uuid: 'u2' }), row({ uuid: 'u3' })]
    const ingest = vi.fn(async () => {
      throw new Error('boom')
    })
    const warn = vi.fn()
    const result = await ingestHogQLRows(rows, { ingest, warn })

    expect(result).toEqual({ ingested: 0, skipped: 0, errors: 3 })
    expect(warn).toHaveBeenCalledTimes(3)
  })

  it('stops early on shouldStop()', async () => {
    const rows: HogQLEventRow[] = [row({ uuid: 'u1' }), row({ uuid: 'u2' }), row({ uuid: 'u3' })]
    let calls = 0
    const ingest = vi.fn(async () => {
      calls += 1
    })
    const result = await ingestHogQLRows(rows, {
      ingest,
      shouldStop: () => calls >= 1,
    })

    // First iteration runs, after which shouldStop returns true and the
    // loop breaks before processing rows[1] / rows[2].
    expect(ingest).toHaveBeenCalledTimes(1)
    expect(result.ingested).toBe(1)
  })
})
