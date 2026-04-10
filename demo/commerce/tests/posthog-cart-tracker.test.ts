// Unit tests — posthog-adapter helpers.
// These are the pure functions behind the posthog-cart-tracker subscriber.
// We test them in isolation (no framework globals) via the adapter module.

import { describe, expect, it } from 'vitest'
import { extractPosthogEvents, toIngestInput } from '../src/modules/cart-tracking/posthog-adapter'

describe('extractPosthogEvents', () => {
  it('returns [] for empty body', () => {
    expect(extractPosthogEvents(null)).toEqual([])
    expect(extractPosthogEvents(undefined)).toEqual([])
  })

  it('wraps a single event object in an array', () => {
    const evt = { event: 'cart:viewed', properties: { cart_token: 'abc' } }
    expect(extractPosthogEvents(evt)).toEqual([evt])
  })

  it('returns arrays as-is', () => {
    const events = [{ event: 'cart:viewed' }, { event: 'cart:updated' }]
    expect(extractPosthogEvents(events)).toEqual(events)
  })

  it('unwraps the `batch` property', () => {
    const batch = [{ event: 'cart:viewed' }, { event: 'cart:updated' }]
    expect(extractPosthogEvents({ batch })).toEqual(batch)
  })
})

describe('toIngestInput', () => {
  it('returns null for non-cart events (ignored)', () => {
    expect(toIngestInput({ event: '$pageview', properties: { cart_token: 'abc' } })).toBeNull()
    expect(toIngestInput({ event: 'unknown:event', properties: { cart_token: 'abc' } })).toBeNull()
  })

  it('returns null when cart_token is missing', () => {
    expect(toIngestInput({ event: 'cart:viewed', properties: {} })).toBeNull()
  })

  it('accepts cart:cleared (regression: previously missing from command enum)', () => {
    const result = toIngestInput({
      event: 'cart:cleared',
      properties: { cart_token: 'tok-1' },
    })
    expect(result).not.toBeNull()
    expect(result?.action).toBe('cart:cleared')
    expect(result?.cart_token).toBe('tok-1')
  })

  it('accepts cart:closed and cart:discount_applied', () => {
    expect(toIngestInput({ event: 'cart:closed', properties: { cart_token: 'x' } })?.action).toBe('cart:closed')
    expect(toIngestInput({ event: 'cart:discount_applied', properties: { cart_token: 'x' } })?.action).toBe(
      'cart:discount_applied',
    )
  })

  it('resolves cart_token from top-level properties first', () => {
    const result = toIngestInput({
      event: 'cart:viewed',
      properties: { cart_token: 'top', cart: { cart_token: 'nested' } },
    })
    expect(result?.cart_token).toBe('top')
  })

  it('falls back to nested cart.cart_token when top-level is absent', () => {
    const result = toIngestInput({
      event: 'cart:viewed',
      properties: { cart: { cart_token: 'nested' } },
    })
    expect(result?.cart_token).toBe('nested')
  })

  it('extracts identity fields from $set', () => {
    const result = toIngestInput({
      event: 'checkout:contact_info_submitted',
      distinct_id: 'd1',
      properties: {
        cart_token: 't1',
        $set: { email: 'a@b.com', first_name: 'Jane', last_name: 'Doe', phone: '+123' },
      },
    })
    expect(result?.email).toBe('a@b.com')
    expect(result?.first_name).toBe('Jane')
    expect(result?.last_name).toBe('Doe')
    expect(result?.phone).toBe('+123')
    expect(result?.distinct_id).toBe('d1')
  })

  it('defaults currency to EUR and total_price to 0', () => {
    const result = toIngestInput({ event: 'cart:viewed', properties: { cart_token: 't' } })
    expect(result?.currency).toBe('EUR')
    expect(result?.total_price).toBe(0)
  })

  it('passes through items array', () => {
    const items = [{ id: '1', title: 'Shoe', quantity: 2, price: 50 }]
    const result = toIngestInput({
      event: 'cart:product_added',
      properties: { cart_token: 't', items },
    })
    expect(result?.items).toEqual(items)
  })
})

describe('subscriber routing (simulated)', () => {
  // Simulate what the subscriber does: iterate a batch, convert each event,
  // and dispatch to command.ingestCartEvent. We use a mock to verify the flow.
  async function simulateSubscriber(body: unknown, mockIngestCartEvent: (input: unknown) => Promise<void>) {
    const events = extractPosthogEvents(body)
    for (const evt of events) {
      const input = toIngestInput(evt)
      if (!input) continue
      await mockIngestCartEvent(input)
    }
  }

  it('calls ingestCartEvent once per cart/checkout event in a batch', async () => {
    const calls: unknown[] = []
    const mockIngest = async (input: unknown) => {
      calls.push(input)
    }
    const batch = {
      batch: [
        { event: 'cart:product_added', properties: { cart_token: 't1', items: [] } },
        { event: 'cart:cleared', properties: { cart_token: 't1' } },
        { event: 'checkout:completed', properties: { cart_token: 't1' } },
        { event: '$pageview', properties: { cart_token: 't1' } }, // should be skipped
        { event: 'cart:viewed', properties: {} }, // no cart_token → skipped
      ],
    }
    await simulateSubscriber(batch, mockIngest)
    expect(calls).toHaveLength(3)
    expect((calls[0] as { action: string }).action).toBe('cart:product_added')
    expect((calls[1] as { action: string }).action).toBe('cart:cleared')
    expect((calls[2] as { action: string }).action).toBe('checkout:completed')
  })
})
